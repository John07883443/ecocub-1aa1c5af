/**
 * Пилот конструктора v4: сценарий → 3 варианта → правка в 3D (стены, окна, двери,
 * ярусы, участок) → 2D-план → бюджет вилкой и паспорт → рендеры → заявка.
 * Архитектор Лев — текстом (rgrouter) и голосом (InWorld) через сервер пилота.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyCommand,
  removeRoomGuard,
  toolCallToCommand,
  DOOR_PRESETS,
  type EditorCommand,
} from "../engine/commands.ts";
import { WINDOW_PRESETS, type WindowPreset } from "../engine/derive.ts";
import { factoryModules, trucksForCubes } from "../engine/factory.ts";
import { buildPassport } from "../engine/passport.ts";
import { modulesOnTier, warmContourM2 } from "../engine/rules.ts";
import {
  briefFromScenario,
  checkArea,
  programFromScenario,
  type AreaCheck,
  type LifeScenario,
} from "../engine/scenario.ts";
import { solve, type Variant } from "../engine/solver.ts";
import { promptFor, viewSet, STAGE2 } from "../engine/render-plan.ts";
import { rederive } from "../engine/derive.ts";
import type { Project, Side } from "../engine/types.ts";
import { FINISHES, roomSpec } from "../grammar/index.ts";
import { PILOT } from "../pilot.config.ts";
import {
  chatTools,
  commentOn,
  mergeScenario,
  projectContext,
  rebuildSummary,
  realtimeTools,
  systemPrompt,
  whatIf,
} from "./architect.ts";
import { VOICE_STATE_RU, VoiceSession, type VoiceState } from "./voice.ts";
import { readJson, runJob, runRenderJob } from "./render-client.ts";
import {
  choiceToCommands,
  mergeChoice,
  optionsContext,
  parseOptionReply,
  styleOptions,
  type OptionCard,
} from "./options.ts";
import {
  answer as answerStep,
  currentMode,
  interviewContext,
  progress as interviewProgress,
  startInterview,
  stepsForFields,
  touchForm,
  STEPS,
  type InterviewState,
  type Step,
} from "./interview.ts";
import { evaluate } from "../engine/rules.ts";
import { PlanSvg } from "./PlanSvg.tsx";
import type { WallPick } from "./Scene.tsx";

const HouseScene = lazy(() => import("./Scene.tsx"));
/** Серверная часть пилота — маршруты сайта /api/pilot/* (тот же домен, https на бою). */
const API = (import.meta.env.VITE_PILOT_API as string | undefined) ?? "/api/pilot";
/** Голос: адрес релея из /api/pilot/health; локально — scripts/pilot-server.mjs. */
const LOCAL_VOICE = "ws://localhost:8790/voice";
const SESSION = Math.random().toString(36).slice(2);
const SIDE_RU: Record<Side, string> = { N: "север", E: "восток", S: "юг", W: "запад" };
const mln = (n: number) => (n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

type Offer = { text: string; command: EditorCommand; state: "open" | "done" | "declined" };
type ChatMsg = {
  role: "user" | "assistant" | "system";
  text: string;
  /** Карточки A/B/C или предложение кнопками. */
  kind?: "options" | "offer";
  options?: OptionCard[];
  offer?: Offer;
};
type Chip = { label: string; run: () => void };

const STEP_RU: Record<Step, string> = {
  plot: "участок",
  people: "семья",
  pets: "питомцы",
  elderly: "родители",
  lifestyle: "образ жизни",
  style: "стиль",
  budget: "бюджет",
};

type DesignOut = {
  intent: string;
  project: Project | null;
  valid: boolean;
  fallback: boolean;
  attempts: number;
  precedent: string;
  why: string;
};
type CriticOut = {
  score: number;
  verdict: string;
  notes: string[];
  commands: EditorCommand[];
};
type LlmMsg = Record<string, unknown>;

const DEFAULT_SCENARIO: LifeScenario = {
  adults: 2,
  kids: 1,
  pets: { dogs: 0 },
  workFromHome: 0,
  guestsOften: false,
  sauna: false,
  storage: "normal",
  car: false,
  terrace: true,
  tiers: "any",
  desiredAreaM2: { min: 50, max: 90 },
  plot: { widthM: 25, depthM: 35, northDeg: 0 },
};

function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <input
        type="number"
        className="w-24 rounded border px-2 py-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Btn({
  children,
  onClick,
  kind = "ghost",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  kind?: "primary" | "ghost";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        (kind === "primary"
          ? "bg-neutral-900 text-white hover:bg-neutral-700 "
          : "border bg-white hover:bg-neutral-100 ") +
        "rounded px-3 py-1.5 text-sm disabled:opacity-40"
      }
    >
      {children}
    </button>
  );
}

export function PilotApp() {
  const [scenario, setScenario] = useState<LifeScenario>(DEFAULT_SCENARIO);
  const [area, setArea] = useState<AreaCheck | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [current, setCurrentState] = useState<Project | null>(null);
  const currentRef = useRef<Project | null>(null);
  const [history, setHistory] = useState<Project[]>([]);
  const [selected, setSelectedWall] = useState<WallPick | null>(null);
  /** Выбранная комната: клик по кубику на плане или по стене в 3D. */
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [tab, setTab] = useState<"3d" | "plan1" | "plan2" | "passport">(() => {
    const t =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    return t === "plan1" || t === "plan2" || t === "passport" ? t : "3d";
  });
  const [comments, setComments] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: "assistant", text: PILOT.architect.greeting },
  ]);
  const llm = useRef<LlmMsg[]>([{ role: "assistant", content: PILOT.architect.greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<VoiceSession | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceInfo, setVoiceInfo] = useState("");
  const [continuous, setContinuous] = useState(false);
  const [renders, setRenders] = useState<
    { id: string; label: string; src?: string; error?: string }[]
  >([]);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderStatus, setRenderStatus] = useState("");
  const [lead, setLead] = useState({ name: "", phone: "", comment: "" });
  const [leadState, setLeadState] = useState("");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [windowPreset, setWindowPreset] = useState<WindowPreset>("standard");
  const [styleText, setStyleText] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [interview, setInterviewState] = useState<InterviewState>(() => startInterview());
  const interviewRef = useRef(interview);
  const setInterview = useCallback((f: (s: InterviewState) => InterviewState) => {
    interviewRef.current = f(interviewRef.current);
    setInterviewState(interviewRef.current);
  }, []);
  /** Карточки A/B/C, которые сейчас на экране (Лев понимает ссылки на них). */
  const optionsRef = useRef<OptionCard[] | null>(null);
  const [flash, setFlash] = useState(0);
  const [aiBusy, setAiBusy] = useState("");

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => readJson<Record<string, unknown>>(r))
      .then((j) => setHealth(j.ok ? j.data : { ok: false }))
      .catch(() => setHealth({ ok: false }));
  }, []);

  const setCurrent = useCallback((p: Project | null, pushHistory = true) => {
    if (pushHistory && currentRef.current)
      setHistory((h) => [...h.slice(-30), currentRef.current!]);
    currentRef.current = p;
    setCurrentState(p);
  }, []);

  const say = (role: ChatMsg["role"], text: string) => setChat((c) => [...c, { role, text }]);

  /** Человек сам поправил анкету: значение меняется, шаг интервью Лев только подтверждает. */
  const setForm = (step: Step, next: LifeScenario) => {
    setScenario(next);
    setInterview((i) => touchForm(i, step));
  };

  /** Выбор стены в 3D выбирает и комнату — для «Удалить комнату». */
  const setSelected = useCallback((w: WallPick | null) => {
    setSelectedWall(w);
    const p = currentRef.current;
    setSelectedRoomId(
      w && p ? (p.rooms.find((r) => r.moduleIds.includes(w.moduleId))?.id ?? null) : null,
    );
  }, []);

  // Для голоса: инструкции собираются в момент запроса, а не по старому замыканию.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const variantsRef = useRef<Variant[]>([]);
  variantsRef.current = variants;
  const selectedRef = useRef<WallPick | null>(null);
  selectedRef.current = selected;

  const build = useCallback(
    (s: LifeScenario) => {
      const t = performance.now();
      const check = checkArea(s);
      setArea(check);
      const r = solve(briefFromScenario(s));
      setVariants(r.variants);
      setElapsed(Math.round(performance.now() - t));
      const before = currentRef.current;
      let summary = "";
      if (r.variants[0]) {
        summary = before ? rebuildSummary(before, r.variants[0].project) : "";
        setCurrent(r.variants[0].project);
        setComments([summary, r.variants[0].rank?.why ?? ""].filter(Boolean));
        setFlash((x) => x + 1);
      }
      return { check, r, summary };
    },
    [setCurrent],
  );

  // Дом на экране сразу: интервью уточняет его, а не начинает с пустого экрана.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("demo")) return;
    if (!currentRef.current) build(DEFAULT_SCENARIO);
  }, [build]);

  // ?demo — сразу собрать варианты по анкете по умолчанию (быстрый показ и проверка).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("demo")) return;
    // ?demo&tiers=2&variant=2 — для показа и скриншотов.
    const tiers = q.get("tiers");
    const { r } = build({
      ...DEFAULT_SCENARIO,
      ...(tiers === "1" || tiers === "2" ? { tiers: Number(tiers) as 1 | 2 } : {}),
    });
    const v = r.variants[Number(q.get("variant") ?? 1) - 1];
    if (v) setCurrent(v.project, false);
  }, [build, setCurrent]);

  /** Применить команду редактора с проверкой правил; вернуть текст для архитектора. */
  const run = useCallback(
    (cmd: EditorCommand): string => {
      const p = currentRef.current;
      if (!p) return "Дом ещё не собран — сначала соберите варианты.";
      const res = applyCommand(p, cmd);
      if (res.ok) {
        const c = commentOn(p, res.project);
        setCurrent(res.project);
        setComments([res.message, ...c]);
        return [res.message, ...c].join(" ");
      }
      const text = [`Нельзя: ${res.reason}.`, ...res.violations.slice(0, 2), res.suggestion ?? ""]
        .filter(Boolean)
        .join(" ");
      setComments([text]);
      return text;
    },
    [setCurrent],
  );

  const runTool = useCallback(
    async (name: string, args: unknown): Promise<string> => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (name === "set_scenario") {
        const s = mergeScenario(scenarioRef.current, a);
        scenarioRef.current = s;
        setScenario(s);
        setInterview((i) => answerStep(i, stepsForFields(Object.keys(a))));
        const { check, r, summary } = build(s);
        return `${summary ? `Дом пересобран: ${summary}. ` : ""}${check.message} Собрано вариантов: ${r.variants.length}. ${r.variants
          .map((v, i) => `${i + 1}) ${v.summary}; ${v.rank?.why ?? ""}`)
          .join(" ")} Опции: ${check.options.map((o) => `${o.label} — ${o.reason}`).join("; ")}`;
      }
      if (name === "what_if") return whatIf(currentRef.current, a);
      if (name === "confirm_step") {
        const step = String(a.step) as Step;
        if (!STEPS.includes(step)) return "Нет такого шага.";
        setInterview((i) => answerStep(i, [step]));
        return interviewContext(interviewRef.current, scenarioRef.current);
      }
      if (name === "show_options") return showOptions();
      if (name === "apply_options") return applyChoice(String(a.text ?? ""));
      if (name === "design_variants")
        return designVariants(Array.isArray(a.intents) ? a.intents.map(String) : undefined);
      if (name === "critic_review") return criticPass();
      if (name === "offer_change") {
        const parsed = toolCallToCommand(
          String((a.command as { op?: string })?.op ?? ""),
          a.command,
        );
        if (!parsed.ok) return `Не понял правку для кнопки: ${parsed.error}`;
        setChat((c) => [
          ...c,
          {
            role: "assistant",
            text: String(a.text ?? "Показать правку?"),
            kind: "offer",
            offer: { text: String(a.text ?? ""), command: parsed.command, state: "open" },
          },
        ]);
        return "Показал человеку кнопки «показать / не надо». Жди его выбора.";
      }
      if (name === "select_variant") {
        const v = variantsRef.current[Number(a.index) - 1];
        if (!v) return "Такого варианта нет.";
        setCurrent(v.project);
        return `Выбран вариант ${a.index}: ${v.summary}`;
      }
      const parsed = toolCallToCommand(name, a);
      if (!parsed.ok) return `Команда не распознана: ${parsed.error}`;
      return run(parsed.command);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [build, run, setCurrent],
  );

  const context = () => {
    const w = selectedRef.current;
    return projectContext(currentRef.current, {
      selectedWall: w ? `кубик ${w.moduleId}, сторона ${w.side} (${SIDE_RU[w.side]})` : undefined,
      variants: variantsRef.current.map((v, i) => `${i + 1}) ${v.summary}`),
      scenario: scenarioRef.current,
      interview: interviewContext(interviewRef.current, scenarioRef.current),
      options: optionsContext(optionsRef.current),
    });
  };

  // ── Карточки A/B/C ────────────────────────────────────────────────────
  function showOptions(): string {
    const cards = styleOptions();
    optionsRef.current = cards;
    setChat((c) => [
      ...c,
      {
        role: "assistant",
        text: "Что ближе? Можно выбрать одну карточку или смешать: «из А крышу, из Б окна».",
        kind: "options",
        options: cards,
      },
    ]);
    return `Показал карточки. ${optionsContext(cards)}`;
  }

  /** Реплика со ссылками на карточки → основа + черты → команды через движок правил. */
  function applyChoice(text: string): string {
    const cards = optionsRef.current ?? styleOptions();
    const choice = mergeChoice(cards, parseOptionReply(text));
    if (!choice) return "Не понял, какую карточку выбрали — назовите букву A, B или C.";
    let p = currentRef.current;
    if (!p) return "Дом ещё не собран.";
    const plan = choiceToCommands(p, choice);
    const notes: string[] = [];
    if (plan.tiers) {
      const s2 = mergeScenario(scenarioRef.current, { tiers: String(plan.tiers) });
      scenarioRef.current = s2;
      setScenario(s2);
      const { summary } = build(s2);
      notes.push(
        `форма: ${plan.tiers === 2 ? "два яруса" : "один ярус"}${summary ? ` (${summary})` : ""}`,
      );
      p = currentRef.current!;
    }
    let work = p;
    const failed: string[] = [];
    for (const c of choiceToCommands(work, choice).commands) {
      const r = applyCommand(work, c);
      if (r.ok) work = r.project;
      else failed.push(r.reason);
    }
    const style = cards.find((c) => c.letter === choice.base);
    work = {
      ...work,
      finishes: { ...work.finishes, styleId: style?.styleId ?? work.finishes.styleId },
      recommendations: [
        ...(work.recommendations ?? []).filter((x) => !x.startsWith("Пожелания по стилю")),
        ...(plan.wishes.length ? [`Пожелания по стилю: ${plan.wishes.join(", ")}`] : []),
      ],
    };
    const c = commentOn(p, work);
    setCurrent(work);
    setFlash((x) => x + 1);
    setInterview((i) => answerStep(i, ["style"]));
    scenarioRef.current = { ...scenarioRef.current, styleHints: [choice.summary] };
    setScenario(scenarioRef.current);
    const out = [
      `Взял: ${choice.summary}.`,
      ...notes,
      plan.wishes.length ? `Пожелания записал в паспорт: ${plan.wishes.join(", ")}.` : "",
      failed.length ? `Не всё получилось: ${failed.slice(0, 2).join("; ")}.` : "",
      ...c.slice(0, 2),
    ]
      .filter(Boolean)
      .join(" ");
    setComments([out]);
    return out;
  }

  // ── Нейросеть-архитектор и критик ─────────────────────────────────────
  async function designVariants(intents?: string[]): Promise<string> {
    const brief = briefFromScenario(scenarioRef.current);
    const list = (
      intents?.length
        ? intents
        : [
            "Фирменный ЭкоКуб: компактный объём, общая комната на юг к террасе во всю длину, спальни крылом",
            "Экономный: минимум кубиков и тралов, все модули парами",
            "Смелый: двор-терраса в развороте Г или П, либо второй ярус с консолью",
          ]
    ).slice(0, 3);
    setAiBusy("Лев раскладывает кубики…");
    try {
      const results = await Promise.all(
        list.map((intent) =>
          runJob<DesignOut>(
            API,
            "design",
            { brief, intent, style: scenarioRef.current.styleHints?.[0] },
            {
              session: SESSION,
            },
          ).catch((e: Error) => ({ intent, error: e.message }) as DesignOut & { error: string }),
        ),
      );
      const ok = results.filter((r): r is DesignOut => !!(r as DesignOut).project);
      if (!ok.length)
        return `Не получилось: ${(results[0] as { error?: string }).error ?? "сервер не ответил"}. Остались варианты солвера.`;
      const vs: Variant[] = ok.map((r, i) => {
        const p = { ...r.project!, id: `ai-${i + 1}` };
        const tiers = Math.max(...p.modules.map((m) => m.tier)) as 1 | 2;
        return {
          project: p,
          evaluation: evaluate(p),
          score: r.valid ? 1 : 0.5,
          tiers,
          summary: `${r.fallback ? "запасной (солвер)" : r.intent.split(":")[0]}: ${p.modules.length} кубиков, ${tiers === 2 ? "два яруса" : "один ярус"}${r.precedent ? `, по мотивам: ${r.precedent}` : ""}`,
          rank: { recommended: i === 0, why: r.why || r.intent } as Variant["rank"],
        };
      });
      setVariants(vs);
      setCurrent(vs[0].project);
      setFlash((x) => x + 1);
      const critic = await criticPass();
      return `${vs.map((v, i) => `${i + 1}) ${v.summary}${ok[i].fallback ? " — нейросеть не уложилась в правила, показал ближайший проверенный" : ""}`).join("; ")}. Критик: ${critic}`;
    } finally {
      setAiBusy("");
    }
  }

  async function criticPass(): Promise<string> {
    const p = currentRef.current;
    if (!p) return "Дом ещё не собран.";
    const canvas = document.querySelector<HTMLCanvasElement>("#pilot-3d canvas");
    let snapshot: string | null = null;
    try {
      snapshot = canvas ? canvas.toDataURL("image/jpeg", 0.7) : null;
    } catch {
      snapshot = null;
    }
    setAiBusy("Критик смотрит на план…");
    try {
      const r = await runJob<CriticOut>(
        API,
        "critic",
        { project: p, style: scenarioRef.current.styleHints?.[0], snapshot },
        { session: SESSION },
      );
      let work = p;
      const done: string[] = [];
      for (const c of r.commands) {
        const res = applyCommand(work, c);
        if (res.ok) {
          work = res.project;
          done.push(res.message);
        }
      }
      if (work !== p) {
        setCurrent(work);
        setFlash((x) => x + 1);
      }
      const text = `${r.verdict} (оценка ${r.score}/10).${r.notes.length ? ` ${r.notes.slice(0, 3).join(" ")}` : ""}${done.length ? ` Поправил: ${done.join(" ")}` : ""}`;
      setComments([`Независимый взгляд: ${text}`]);
      return text;
    } catch (e) {
      return `Критик недоступен: ${(e as Error).message}`;
    } finally {
      setAiBusy("");
    }
  }

  /** Быстрые ответы под текущим вопросом интервью — работают и без нейросети. */
  const chips: Chip[] = (() => {
    const step = interview.current;
    const confirm = (st: Step) => ({
      label: "Да, как в анкете",
      run: () => {
        setInterview((i) => answerStep(i, [st]));
        say("user", "Да, как в анкете");
      },
    });
    const set = (label: string, args: Record<string, unknown>) => ({
      label,
      run: () => {
        say("user", label);
        void runTool("set_scenario", args).then((out) => say("system", `⚙ ${out.slice(0, 200)}`));
      },
    });
    switch (step) {
      case "plot":
        return [
          set("Участка пока нет — возьмём 10 соток", { plotSotki: 10 }),
          set("Участок 15 соток", { plotSotki: 15 }),
        ];
      case "people":
        return [confirm("people")];
      case "pets":
        return [set("Питомцев нет", { dogs: 0, cats: 0, otherPets: 0 }), confirm("pets")];
      case "elderly":
        return [
          set("Родителей не будет", { elderly: "none" }),
          set("Приезжают в гости", { elderly: "visit" }),
          confirm("elderly"),
        ];
      case "lifestyle":
        return [confirm("lifestyle")];
      case "style":
        return [{ label: "Показать варианты A/B/C", run: () => void showOptions() }];
      case "budget":
        return [
          { label: "Пока не знаю", run: () => setInterview((i) => answerStep(i, ["budget"])) },
          set("До 12 млн", { budgetMaxRub: 12_000_000 }),
        ];
      default:
        return [
          {
            label: "Лев, предложи 3 решения",
            run: () => void sendChat("Предложи три решения нейросетью"),
          },
          {
            label: "Независимый взгляд",
            run: () => void criticPass().then((t) => say("assistant", t)),
          },
        ];
    }
  })();

  // Голос слышит актуальную анкету и дом: обновляем инструкции сессии при каждом изменении.
  useEffect(() => {
    voice?.updateInstructions();
  }, [voice, scenario, current, variants, selected]);

  const sendChat = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    say("user", text);
    // Ссылки на карточки A/B/C применяем сразу, Льву — что уже сделано.
    let note = "";
    if (optionsRef.current && parseOptionReply(text).picks.length) {
      note = applyChoice(text);
      say("system", `⚙ карточки: ${note.slice(0, 220)}`);
    }
    llm.current.push({
      role: "user",
      content: note ? `${text}\n[служебно: выбор по карточкам уже применён: ${note}]` : text,
    });
    setBusy(true);
    try {
      for (let round = 0; round < 4; round++) {
        const r = await fetch(`${API}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pilot-Session": SESSION },
          body: JSON.stringify({
            system: systemPrompt(context()),
            messages: llm.current,
            tools: chatTools(),
          }),
        });
        const jr = await readJson<{ message?: unknown }>(r);
        if (!jr.ok) throw new Error(jr.error);
        const j = jr.data;
        const m = (j.message ?? {}) as {
          content?: string;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        llm.current.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
        if (m.content) say("assistant", m.content);
        if (!m.tool_calls?.length) break;
        for (const tc of m.tool_calls) {
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            args = {};
          }
          const out = await runTool(tc.function.name, args);
          say("system", `⚙ ${tc.function.name}: ${out.slice(0, 220)}`);
          llm.current.push({ role: "tool", tool_call_id: tc.id, content: out });
        }
      }
    } catch (e) {
      say(
        "system",
        `Чат недоступен: ${(e as Error).message}. Редактор, план и бюджет работают и без чата.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = async (mode: "dialog" | "ptt" = "dialog") => {
    if (voice) {
      voice.stop();
      setVoice(null);
      setVoiceState("closed");
      return;
    }
    const hands = mode === "dialog";
    setContinuous(hands);
    // Никакой тишины: каждая причина, почему голос не стартует, — словами.
    if (!window.isSecureContext) {
      setVoiceInfo(
        "Микрофон работает только по https или на localhost. Откройте пилот на этом компьютере: http://localhost:8080/pilot",
      );
      setVoiceState("closed");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceInfo("Браузер не даёт доступ к микрофону.");
      setVoiceState("closed");
      return;
    }
    let voiceUrl = LOCAL_VOICE;
    let model: string | undefined;
    try {
      const hr = await readJson<Record<string, unknown>>(await fetch(`${API}/health`));
      if (!hr.ok) throw new Error(hr.error);
      const h = hr.data as {
        inworld?: boolean;
        voice?: boolean;
        voiceReason?: string;
        voiceUrl?: string;
        realtimeModel?: string;
      };
      if (!h.inworld) {
        setVoiceInfo("Голос не настроен: нет ключа InWorld на сервере.");
        setVoiceState("closed");
        return;
      }
      if (!h.voice) {
        setVoiceInfo(h.voiceReason ?? "Голосовой релей не запущен.");
        setVoiceState("closed");
        return;
      }
      voiceUrl = h.voiceUrl ?? LOCAL_VOICE;
      model = h.realtimeModel ?? undefined;
    } catch {
      setVoiceInfo("Сервер не отвечает. Текстовый чат и редактор работают без голоса.");
      setVoiceState("closed");
      return;
    }
    const v = new VoiceSession(
      voiceUrl,
      {
        onState: (s, d) => {
          setVoiceState(s);
          if (d) setVoiceInfo(d);
          if (s === "closed") setVoice(null);
        },
        onUserText: (t) => say("user", `🎤 ${t}`),
        onAssistantText: (t) => say("assistant", t),
        onToolCall: async (n, a) => {
          const out = await runTool(n, a);
          say("system", `⚙ ${n}: ${out.slice(0, 220)}`);
          return out;
        },
      },
      {
        instructions: () => systemPrompt(context()),
        tools: realtimeTools(),
        continuous: hands,
        model,
        greeting: () =>
          "[служебное] Поздоровайся одной фразой и задай текущий вопрос интервью из блока «Интервью» (если он уже есть в анкете — коротко подтверди и иди дальше).",
      },
    );
    setVoice(v);
    setVoiceInfo("");
    try {
      await v.start();
    } catch (e) {
      setVoiceInfo(`Микрофон: ${(e as Error).message}`);
      setVoice(null);
    }
  };

  const doRenders = async () => {
    const p = currentRef.current;
    if (!p) return;
    const vs = viewSet(p);
    const pick = [
      vs.views.find((v) => v.id === "facade-S"),
      vs.views.find((v) => v.kind === "aerial"),
      vs.views.find((v) => v.kind === "interior"),
    ].filter(Boolean) as typeof vs.views;
    setRenderBusy(true);
    setRenders(pick.map((v) => ({ id: v.id, label: v.label })));
    setRenderStatus(`Рисуем 1 из ${pick.length}…`);
    const apply = (
      results: { id: string; url?: string | null; b64?: string | null; error?: string }[],
    ) =>
      setRenders(
        pick.map((v) => {
          const res = results.find((x) => x.id === v.id);
          return {
            id: v.id,
            label: v.label,
            src: res?.b64 ? `data:image/png;base64,${res.b64}` : (res?.url ?? undefined),
            error: res?.error,
          };
        }),
      );
    try {
      const out = await runRenderJob(
        API,
        pick.map((v) => ({ id: v.id, prompt: promptFor(p, v) })),
        {
          session: SESSION,
          onProgress: (pr) => {
            apply(pr.results);
            setRenderStatus(
              pr.done < pr.total ? `Рисуем ${pr.done + 1} из ${pr.total}…` : "Готово",
            );
          },
        },
      );
      apply(out.results);
      setRenderStatus(
        out.results.some((r) => r.error)
          ? "Часть кадров не получилась — можно попробовать ещё раз."
          : "",
      );
    } catch (e) {
      setRenders([{ id: "err", label: "Не получилось", error: (e as Error).message }]);
      setRenderStatus("");
    } finally {
      setRenderBusy(false);
    }
  };

  const snapshot = () => {
    const c = document.querySelector<HTMLCanvasElement>("#pilot-3d canvas");
    if (!c) return;
    setRenders((r) => [
      {
        id: `clay-${Date.now()}`,
        label: "Снимок 3D (стадия 1, бесплатно)",
        src: c.toDataURL("image/png"),
      },
      ...r,
    ]);
  };

  const passport = useMemo(() => (current ? buildPassport(current) : null), [current]);

  const sendLead = async () => {
    if (!passport) return;
    setLeadState("Отправляю…");
    const b = passport.budget.total;
    const summary = [
      `Сценарий: взрослых ${scenario.adults}, детей ${scenario.kids}${scenario.pets?.dogs ? ", собака" : ""}`,
      `Дом: ${passport.summary.modules} кубиков (${passport.summary.factoryModules} модулей), ${passport.summary.warmContourM2} м², ярусов ${passport.summary.tiers}, тралов ${passport.summary.trucks}`,
      `Помещения: ${passport.rooms.map((r) => `${r.label} ${r.clearAreaM2} м²`).join(", ")}`,
      `Стиль: ${FINISHES.styles.find((s) => s.id === passport.styleId)?.label ?? "свой"}`,
      `Бюджет (предварительно): ${mln(b.min)}–${mln(b.max)} млн ₽`,
      `Проверить проектировщику: ${passport.verifyByDesigner.slice(0, 5).join("; ")}`,
    ].join("\n");
    try {
      const r = await fetch(`${API}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lead, summary, passport }),
      });
      const j = await readJson(r);
      setLeadState(j.ok ? "Заявка ушла в Telegram ✓" : `Ошибка: ${j.error}`);
    } catch (e) {
      setLeadState(`Ошибка: ${(e as Error).message}`);
    }
  };

  const downloadPassport = () => {
    if (!passport) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" }),
    );
    a.download = `ecocub-passport-${passport.projectId}.json`;
    a.click();
  };

  const updatePlot = (patch: Partial<NonNullable<Project["plot"]>>) => {
    const plot = { ...(scenario.plot ?? { widthM: 25, depthM: 35 }), ...patch };
    setForm("plot", { ...scenario, plot });
    const p = currentRef.current;
    if (p) setCurrent(rederive({ ...p, plot, placementLocked: false }, p.terrace.side));
  };

  const s = scenario;
  const sel = selected && current ? current.modules.find((m) => m.id === selected.moduleId) : null;
  const selRoom =
    current && selectedRoomId ? (current.rooms.find((r) => r.id === selectedRoomId) ?? null) : null;
  const removeBlock = current && selRoom ? removeRoomGuard(current, selRoom.id) : null;
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev, false);
  };
  const removeSelectedRoom = () => {
    if (!selRoom) return;
    const label = roomSpec(selRoom.type).label;
    const before = currentRef.current;
    const text = run({ op: "remove_room", roomId: selRoom.id });
    if (currentRef.current !== before) {
      setSelectedWall(null);
      setSelectedRoomId(null);
      setComments([`«${label}» убрана. Передумали — «↶ Отменить».`, text]);
    }
  };
  const hasUpper = current ? modulesOnTier(current, 2).length > 0 : false;

  return (
    <div className="min-h-screen bg-neutral-50 pb-20 text-neutral-900 lg:pb-0">
      <style>{`@keyframes pilot-flash{0%{box-shadow:inset 0 0 0 4px rgba(217,119,6,.85)}100%{box-shadow:inset 0 0 0 0 rgba(217,119,6,0)}}`}</style>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Конструктор дома ЭкоКуб · бета</h1>
          <p className="text-xs text-neutral-500">
            Тестовая версия, цены и отделки — черновик. Сервер пилота:{" "}
            {health?.ok ? (
              <span>
                на связи (чат {health.rgrouter ? "✓" : "нет ключа"}, голос{" "}
                {health.inworld ? "✓" : "нет ключа"}, Telegram {health.telegram ? "✓" : "нет ключа"}
                )
              </span>
            ) : (
              <span className="text-red-600">не отвечает — работают 3D, план и бюджет</span>
            )}
          </p>
        </div>
        {elapsed !== null && (
          <span className="text-xs text-neutral-500">3 варианта собраны за {elapsed} мс</span>
        )}
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[1fr_440px]">
        {/* ── Центр: варианты, 3D, план, паспорт ── */}
        <main className="space-y-3">
          {variants.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {variants.map((v, i) => {
                const b = buildPassport(v.project).budget.total;
                const active = current?.id === v.project.id;
                return (
                  <button
                    key={v.project.id}
                    type="button"
                    onClick={() => {
                      setCurrent(v.project);
                      setSelected(null);
                      setSelectedRoomId(null);
                      setComments([v.rank?.why ?? ""]);
                    }}
                    className={`rounded-lg border p-3 text-left text-sm ${active ? "border-neutral-900 bg-white shadow" : "bg-white/70"}`}
                  >
                    <div className="flex items-center justify-between">
                      <b>Вариант {i + 1}</b>
                      {v.rank?.recommended && (
                        <span className="rounded bg-green-600 px-2 text-xs text-white">
                          рекомендуем
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-neutral-600">{v.summary}</p>
                    <p className="mt-1 text-xs">{v.rank?.why}</p>
                    <p className="mt-1 font-medium">
                      {mln(b.min)}–{mln(b.max)} млн ₽{" "}
                      <span className="text-xs font-normal text-neutral-500">предварительно</span>
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {(
              [
                ["3d", "3D"],
                ["plan1", "План 1 яруса"],
                ["plan2", "План 2 яруса"],
                ["passport", "Паспорт и бюджет"],
              ] as const
            ).map(([k, l]) => (
              <Btn key={k} kind={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>
                {l}
              </Btn>
            ))}
            {current && history.length > 0 && <Btn onClick={undo}>↶ Отменить</Btn>}
          </div>

          <div
            id="pilot-3d"
            className="relative h-[56vh] min-h-[360px] overflow-hidden rounded-lg border bg-white"
          >
            {/* Дом пересобран — короткая подсветка рамки, сцена не перемонтируется. */}
            {flash > 0 && (
              <div
                key={`flash-${flash}`}
                className="pointer-events-none absolute inset-0 z-10 rounded-lg [animation:pilot-flash_1.4s_ease-out_forwards]"
              />
            )}
            {!current ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-neutral-500">
                Расскажите Льву о семье или заполните анкету слева и нажмите «Собрать 3 варианта».
              </div>
            ) : tab === "3d" ? (
              <Suspense fallback={<div className="p-4">Загружаю 3D…</div>}>
                <HouseScene project={current} selected={selected} onPick={setSelected} shot />
              </Suspense>
            ) : tab === "plan1" || tab === "plan2" ? (
              <PlanSvg
                project={current}
                tier={tab === "plan1" ? 1 : 2}
                selectedRoomId={selectedRoomId}
                onPickRoom={(id) => {
                  setSelectedWall(null);
                  setSelectedRoomId((cur) => (cur === id ? null : id));
                }}
              />
            ) : (
              passport && (
                <div className="h-full overflow-auto p-4 text-sm">
                  <h3 className="font-semibold">Бюджет — вилка, предварительно</h3>
                  <table className="mt-2 w-full text-left">
                    <tbody>
                      {passport.budget.lines.map((l) => (
                        <tr key={l.id} className="border-b align-top">
                          <td className="py-1 pr-2">
                            {l.label}
                            {l.placeholder && (
                              <span className="ml-1 text-xs text-amber-600">черновик</span>
                            )}
                            <div className="text-xs text-neutral-500">{l.basis}</div>
                          </td>
                          <td className="whitespace-nowrap py-1">
                            {mln(l.min)}–{mln(l.max)} млн
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-1 font-semibold">Итого</td>
                        <td className="whitespace-nowrap py-1 font-semibold">
                          {mln(passport.budget.total.min)}–{mln(passport.budget.total.max)} млн ₽
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-neutral-500">{passport.budget.disclaimer}</p>
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(current?.finishingMaterials ?? "included") === "included"}
                      onChange={(e) =>
                        current &&
                        setCurrent({
                          ...current,
                          finishingMaterials: e.target.checked ? "included" : "own",
                        })
                      }
                    />
                    Материалы чистовой отделки: включить (≈15 тыс. ₽/м²) — иначе «свои»
                  </label>
                  <p className="mt-1 text-xs">
                    Под ключ (модули, чистовая отделка работы, доставка, кран, фундамент): середина
                    вилки {Math.round(passport.budget.benchmark.allInMidPerM2 / 1000)} тыс. ₽/м²
                    (ориентир владельца {passport.budget.benchmark.perM2 / 1000} тыс.). Тёплый
                    контур без чистовой:{" "}
                    {Math.round(passport.budget.benchmark.warmShellMidPerM2 / 1000)} тыс. ₽/м²
                    (ориентир {passport.budget.benchmark.warmShellPerM2 / 1000} тыс.). Материалы
                    чистовой, терраса и опции — сверху.
                  </p>
                  <h4 className="mt-3 font-semibold">Что может изменить цену</h4>
                  <ul className="list-disc pl-5 text-xs">
                    {passport.budget.whatCanChangePrice.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  <h3 className="mt-4 font-semibold">Паспорт проекта</h3>
                  <p>
                    {passport.summary.modules} кубиков = {passport.summary.factoryModules} заводских
                    модулей
                    {passport.summary.unpairedCubes
                      ? ` + ${passport.summary.unpairedCubes} без пары`
                      : ""}
                    , {passport.summary.warmContourM2} м² тёплого контура, в чистоте{" "}
                    {passport.summary.clearAreaM2} м², терраса {passport.summary.terraceM2} м²,
                    тралов {passport.summary.trucks}.
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {passport.rooms.map((r) => (
                      <li key={r.id}>
                        {r.label} (ярус {r.tier}) — {r.clearAreaM2} м²
                        {r.subRooms.length ? `: ${r.subRooms.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                  {passport.recommendations.length > 0 && (
                    <>
                      <h4 className="mt-3 font-semibold">Учесть в доме</h4>
                      <ul className="list-disc pl-5 text-xs">
                        {passport.recommendations.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h4 className="mt-3 font-semibold">Проверить проектировщику</h4>
                  <ul className="list-disc pl-5 text-xs">
                    {passport.verifyByDesigner.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  <h4 className="mt-3 font-semibold">Допущения</h4>
                  <ul className="list-disc pl-5 text-xs">
                    {passport.assumptions.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <Btn onClick={downloadPassport}>Скачать паспорт (JSON)</Btn>
                  </div>
                </div>
              )
            )}
          </div>

          {current && selRoom && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <span>
                Выбрана комната: <b>{roomSpec(selRoom.type).label}</b> · ярус {selRoom.tier} ·{" "}
                {selRoom.moduleIds.length} куб.
              </span>
              <button
                type="button"
                disabled={!!removeBlock}
                onClick={removeSelectedRoom}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-40"
              >
                Удалить комнату
              </button>
              {history.length > 0 && <Btn onClick={undo}>↶ Отменить</Btn>}
              <Btn
                onClick={() => {
                  setSelectedWall(null);
                  setSelectedRoomId(null);
                }}
              >
                снять выбор
              </Btn>
              {removeBlock && (
                <p className="w-full text-xs text-neutral-700">
                  Удалить нельзя: {removeBlock.reason}.
                  {removeBlock.suggestion ? ` ${removeBlock.suggestion}` : ""}
                </p>
              )}
            </div>
          )}

          {comments.filter(Boolean).length > 0 && (
            <div className="rounded-lg border bg-white p-3 text-sm">
              <b>{PILOT.architect.name}:</b>
              {comments.filter(Boolean).map((c, i) => (
                <p key={i} className="mt-1">
                  {c}
                </p>
              ))}
            </div>
          )}

          {current && (
            <section className="space-y-2 rounded-lg border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>Рендеры</b>
                <Btn onClick={snapshot}>Снимок 3D (стадия 1)</Btn>
                <Btn kind="primary" disabled={renderBusy} onClick={doRenders}>
                  {renderBusy ? renderStatus || "Рисую…" : "Фото-рендеры (3 кадра, ~12 ₽)"}
                </Btn>
                {renderStatus && !renderBusy && (
                  <span className="text-xs text-amber-700">{renderStatus}</span>
                )}
                <span className="text-xs text-neutral-500">
                  Стадия 2 по 3D-снимку:{" "}
                  {STAGE2.status === "blocked" ? "ждёт images/edits у rgrouter" : "готова"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {renders.map((r) => (
                  <figure key={r.id} className="rounded border p-1">
                    {r.src ? (
                      <img src={r.src} alt={r.label} className="w-full rounded" />
                    ) : (
                      <div className="p-4 text-xs">{r.error ?? "…"}</div>
                    )}
                    <figcaption className="text-xs text-neutral-500">
                      {r.label} · визуализация
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          {/* Анкета и ручная правка — для тех, кому так удобнее (и для проектировщика). */}
          <details className="rounded-lg border bg-white">
            <summary className="cursor-pointer select-none p-3 text-sm font-medium">
              Ручная правка и анкета
              <span className="ml-2 text-xs font-normal text-neutral-500">
                всё то же можно сказать Льву словами
              </span>
            </summary>
            <div className="grid gap-3 p-3 pt-0 md:grid-cols-[300px_1fr]">
              <div className="space-y-3">
                <section className="space-y-2 rounded-lg border bg-white p-3">
                  <h2 className="font-semibold">Кто будет жить</h2>
                  <Num
                    label="Взрослые"
                    value={s.adults}
                    min={1}
                    max={6}
                    onChange={(n) => setForm("people", { ...s, adults: n })}
                  />
                  <Num
                    label="Дети"
                    value={s.kids}
                    max={6}
                    onChange={(n) => setForm("people", { ...s, kids: n })}
                  />
                  <Check
                    label="Дети в одной комнате"
                    value={!!s.kidsShareRoom}
                    onChange={(b) => setForm("people", { ...s, kidsShareRoom: b })}
                  />
                  <Num
                    label="Собаки"
                    value={s.pets?.dogs ?? 0}
                    max={5}
                    onChange={(n) => setForm("pets", { ...s, pets: { ...s.pets, dogs: n } })}
                  />
                  <Num
                    label="Кошки"
                    value={s.pets?.cats ?? 0}
                    max={5}
                    onChange={(n) => setForm("pets", { ...s, pets: { ...s.pets, cats: n } })}
                  />
                  <Num
                    label="Другие питомцы"
                    value={s.pets?.other ?? 0}
                    max={5}
                    onChange={(n) => setForm("pets", { ...s, pets: { ...s.pets, other: n } })}
                  />
                  <label className="flex items-center justify-between gap-2 text-sm">
                    Пожилые родители
                    <select
                      className="rounded border px-2 py-1"
                      value={s.elderly ? `${s.elderly.mode}-${s.elderly.count}` : "none"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "none") return setForm("elderly", { ...s, elderly: undefined });
                        const [mode, count] = v.split("-");
                        setForm("elderly", {
                          ...s,
                          elderly: {
                            mode: mode as "live" | "visit",
                            count: Number(count) as 1 | 2,
                          },
                        });
                      }}
                    >
                      <option value="none">нет</option>
                      <option value="live-1">живёт с нами: 1</option>
                      <option value="live-2">живут с нами: 2</option>
                      <option value="visit-1">приезжает в гости: 1</option>
                      <option value="visit-2">приезжают в гости: 2</option>
                    </select>
                  </label>
                  <Num
                    label="Работают из дома"
                    value={s.workFromHome ?? 0}
                    max={4}
                    onChange={(n) => setForm("lifestyle", { ...s, workFromHome: n })}
                  />
                  <Check
                    label="Часто гости"
                    value={!!s.guestsOften}
                    onChange={(b) => setForm("lifestyle", { ...s, guestsOften: b })}
                  />
                  <Check
                    label="Сауна"
                    value={!!s.sauna}
                    onChange={(b) => setForm("lifestyle", { ...s, sauna: b })}
                  />
                  <Check
                    label="Много хранения"
                    value={s.storage === "lots"}
                    onChange={(b) => setForm("lifestyle", { ...s, storage: b ? "lots" : "normal" })}
                  />
                  <Check
                    label="Машина"
                    value={!!s.car}
                    onChange={(b) => setForm("lifestyle", { ...s, car: b })}
                  />
                  <label className="flex items-center justify-between text-sm">
                    Этажность
                    <select
                      className="rounded border px-2 py-1"
                      value={String(s.tiers ?? "any")}
                      onChange={(e) =>
                        setScenario({
                          ...s,
                          tiers:
                            e.target.value === "any" ? "any" : (Number(e.target.value) as 1 | 2),
                        })
                      }
                    >
                      <option value="any">не важно</option>
                      <option value="1">один ярус</option>
                      <option value="2">два яруса</option>
                    </select>
                  </label>
                  <Num
                    label="Площадь до, м²"
                    value={s.desiredAreaM2?.max ?? 0}
                    max={300}
                    onChange={(n) =>
                      setForm("budget", { ...s, desiredAreaM2: n ? { min: 0, max: n } : undefined })
                    }
                  />
                  <Num
                    label="Бюджет до, млн ₽"
                    value={s.budgetRub ? s.budgetRub.max / 1e6 : 0}
                    max={100}
                    step={0.5}
                    onChange={(n) =>
                      setForm("budget", {
                        ...s,
                        budgetRub: n ? { min: 0, max: n * 1e6 } : undefined,
                      })
                    }
                  />
                  <Btn kind="primary" onClick={() => build(s)}>
                    Собрать 3 варианта
                  </Btn>
                  {area && (
                    <div
                      className={`rounded p-2 text-sm ${area.fits ? "bg-green-50" : "bg-amber-50"}`}
                    >
                      <p>{area.message}</p>
                      {programFromScenario(s).recommendations.map((r) => (
                        <p key={r} className="mt-1 text-xs">
                          • {r}
                        </p>
                      ))}
                      {area.options.map((o) => (
                        <p key={o.id} className="mt-1 text-xs">
                          • <b>{o.label}</b> — {o.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2 rounded-lg border bg-white p-3">
                  <h2 className="font-semibold">Участок</h2>
                  <Num
                    label="Ширина, м"
                    value={s.plot?.widthM ?? 25}
                    max={200}
                    onChange={(n) => updatePlot({ widthM: n })}
                  />
                  <Num
                    label="Глубина, м"
                    value={s.plot?.depthM ?? 35}
                    max={200}
                    onChange={(n) => updatePlot({ depthM: n })}
                  />
                  <Num
                    label="Север, °"
                    value={s.plot?.northDeg ?? 0}
                    max={359}
                    step={15}
                    onChange={(n) => updatePlot({ northDeg: n })}
                  />
                  <Num
                    label="Отступ, м"
                    value={(s.plot?.setbackMm ?? 3000) / 1000}
                    max={10}
                    step={0.5}
                    onChange={(n) => updatePlot({ setbackMm: n * 1000 })}
                  />
                  {current && (
                    <div className="flex flex-wrap gap-1">
                      <Btn onClick={() => run({ op: "rotate_house", deg: 90 })}>⟲ 90°</Btn>
                      {(
                        [
                          ["←", -1000, 0],
                          ["→", 1000, 0],
                          ["↑", 0, 1000],
                          ["↓", 0, -1000],
                        ] as const
                      ).map(([l, dx, dy]) => (
                        <Btn
                          key={l}
                          onClick={() =>
                            run({
                              op: "place_house",
                              xMm: current.placementMm.xMm + dx,
                              yMm: current.placementMm.yMm + dy,
                            })
                          }
                        >
                          {l} 1 м
                        </Btn>
                      ))}
                    </div>
                  )}
                </section>
              </div>
              <div className="space-y-3">
                {current && (
                  <section className="space-y-2 rounded-lg border bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>Правка:</b>
                      <span className="text-neutral-600">
                        {sel
                          ? `стена «${SIDE_RU[selected!.side]}» · ${selRoom ? roomSpec(selRoom.type).label : ""} · ярус ${sel.tier}`
                          : selRoom
                            ? `комната «${roomSpec(selRoom.type).label}» · ярус ${selRoom.tier}`
                            : "кликните по стене дома в 3D или по комнате на плане"}
                      </span>
                    </div>
                    {sel && selRoom && (
                      <div className="flex flex-wrap items-center gap-1">
                        <select
                          className="rounded border px-2 py-1"
                          value={windowPreset}
                          onChange={(e) => setWindowPreset(e.target.value as WindowPreset)}
                        >
                          {Object.entries(WINDOW_PRESETS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v.label} ({v.heightMm})
                            </option>
                          ))}
                        </select>
                        <Btn
                          onClick={() =>
                            run({
                              op: "window",
                              action: "add",
                              side: selected!.side,
                              moduleId: sel.id,
                              preset: windowPreset,
                            })
                          }
                        >
                          + окно
                        </Btn>
                        <Btn
                          onClick={() =>
                            run({
                              op: "window",
                              action: "set",
                              side: selected!.side,
                              moduleId: sel.id,
                              preset: windowPreset,
                            })
                          }
                        >
                          задать размер
                        </Btn>
                        <Btn
                          onClick={() =>
                            run({
                              op: "window",
                              action: "enlarge",
                              side: selected!.side,
                              moduleId: sel.id,
                            })
                          }
                        >
                          больше
                        </Btn>
                        <Btn
                          onClick={() =>
                            run({
                              op: "window",
                              action: "shrink",
                              side: selected!.side,
                              moduleId: sel.id,
                            })
                          }
                        >
                          меньше
                        </Btn>
                        <Btn
                          onClick={() =>
                            run({
                              op: "window",
                              action: "remove",
                              side: selected!.side,
                              moduleId: sel.id,
                            })
                          }
                        >
                          убрать окно
                        </Btn>
                        <span className="mx-1 text-neutral-300">|</span>
                        {Object.entries(DOOR_PRESETS).map(([k, v]) => (
                          <Btn
                            key={k}
                            onClick={() =>
                              run({
                                op: "door",
                                action: "add",
                                side: selected!.side,
                                moduleId: sel.id,
                                preset: k as keyof typeof DOOR_PRESETS,
                              })
                            }
                          >
                            + {v.label}
                          </Btn>
                        ))}
                        <Btn
                          onClick={() =>
                            run({
                              op: "door",
                              action: "move",
                              side: selected!.side,
                              moduleId: sel.id,
                            })
                          }
                        >
                          вход сюда
                        </Btn>
                        <Btn
                          onClick={() =>
                            run({
                              op: "door",
                              action: "remove",
                              side: selected!.side,
                              moduleId: sel.id,
                            })
                          }
                        >
                          убрать дверь
                        </Btn>
                        <Btn onClick={() => run({ op: "move_terrace", side: selected!.side })}>
                          терраса сюда
                        </Btn>
                        {sel.tier === 2 && (
                          <>
                            <span className="mx-1 text-neutral-300">|</span>
                            {[0, 600, 1200, 1500, 2400].map((mm) => (
                              <Btn
                                key={mm}
                                onClick={() =>
                                  run({ op: "set_overhang", side: selected!.side, mm })
                                }
                              >
                                свес {mm / 1000} м
                              </Btn>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Btn onClick={() => run({ op: "add_room", room: "bedroom" })}>+ спальня</Btn>
                      {hasUpper && (
                        <Btn onClick={() => run({ op: "add_room", room: "bedroom", tier: 2 })}>
                          + спальня на 2 ярус
                        </Btn>
                      )}
                      <Btn onClick={() => run({ op: "add_room", room: "study" })}>+ кабинет</Btn>
                      <Btn onClick={() => run({ op: "add_room", room: "wet-core" })}>+ санузел</Btn>
                      {(() => {
                        const k = current.rooms.find((r) => r.type === "kitchen-living");
                        return k ? (
                          <>
                            <Btn
                              onClick={() =>
                                run({
                                  op: "resize_room",
                                  roomId: k.id,
                                  modules: k.moduleIds.length + 1,
                                })
                              }
                            >
                              кухня больше
                            </Btn>
                            <Btn
                              onClick={() =>
                                run({
                                  op: "resize_room",
                                  roomId: k.id,
                                  modules: k.moduleIds.length - 1,
                                })
                              }
                            >
                              кухня меньше
                            </Btn>
                          </>
                        ) : null;
                      })()}
                      {selRoom ? (
                        <Btn onClick={removeSelectedRoom} disabled={!!removeBlock}>
                          − убрать «{roomSpec(selRoom.type).label}»
                        </Btn>
                      ) : (
                        <span className="self-center text-xs text-neutral-500">
                          − убрать комнату: выберите её на плане или в 3D
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <b>Стиль:</b>
                      <select
                        className="rounded border px-2 py-1"
                        value={current.finishes.styleId ?? ""}
                        onChange={(e) => run({ op: "set_style", style: e.target.value })}
                      >
                        {FINISHES.styles.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.label} ({st.region})
                          </option>
                        ))}
                      </select>
                      <input
                        className="min-w-[200px] flex-1 rounded border px-2 py-1"
                        placeholder="или словами: тёмный фасад, чёрные рамы, зелёная кровля"
                        value={styleText}
                        onChange={(e) => setStyleText(e.target.value)}
                      />
                      <Btn
                        onClick={() => styleText && run({ op: "describe_style", text: styleText })}
                      >
                        понять стиль
                      </Btn>
                    </div>
                    <p className="text-xs text-neutral-500">
                      {current.modules.length} кубиков · {factoryModules(current).modules.length}{" "}
                      модулей · {Math.round(warmContourM2(current))} м² ·{" "}
                      {trucksForCubes(current.modules.length)} трала
                    </p>
                  </section>
                )}
              </div>
            </div>
          </details>
        </main>

        {/* ── Правая колонка: архитектор и заявка ── */}
        <aside className="space-y-3">
          <section className="flex h-[78vh] flex-col rounded-lg border bg-white lg:sticky lg:top-3 lg:h-[calc(100vh-24px)]">
            <div className="border-b p-3">
              <div className="flex items-center justify-between">
                <b>{PILOT.architect.name}</b>
                <span className="text-xs text-neutral-500">
                  говорите или пишите — дом меняется сразу
                </span>
              </div>
              {/* Ход интервью: где мы и что уже знаем */}
              <div className="mt-2 flex flex-wrap gap-1">
                {STEPS.map((st) => (
                  <span
                    key={st}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      interview.confirmed.includes(st)
                        ? "bg-green-100 text-green-800"
                        : interview.current === st
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {interview.confirmed.includes(st) ? "✓ " : ""}
                    {STEP_RU[st]}
                  </span>
                ))}
                <span className="ml-auto text-[11px] text-neutral-400">
                  {interviewProgress(interview).done}/{interviewProgress(interview).total}
                  {currentMode(interview) === "confirm" ? " · подтверждаем анкету" : ""}
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-3 text-sm">
              {chat.map((m, i) =>
                m.kind === "options" && m.options ? (
                  <div key={i} className="space-y-2">
                    <p className="mr-8 rounded bg-neutral-100 p-2">{m.text}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {m.options.map((o) => (
                        <button
                          key={o.letter}
                          type="button"
                          onClick={() => void sendChat(`${o.letter}`)}
                          className="group relative overflow-hidden rounded-lg border bg-white text-left hover:border-neutral-900"
                          title={o.summary}
                        >
                          {o.image && (
                            <img
                              src={o.image}
                              alt={o.title}
                              className="h-20 w-full object-cover"
                              loading="lazy"
                            />
                          )}
                          <span className="absolute left-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white shadow">
                            {o.letter}
                          </span>
                          <span className="block p-1.5 text-[11px] font-medium leading-tight">
                            {o.title}
                          </span>
                          <span className="block px-1.5 pb-1.5 text-[10px] leading-tight text-neutral-500">
                            {o.traits.roof.label}; {o.traits.windows.label}; {o.traits.facade.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : m.kind === "offer" && m.offer ? (
                  <div key={i} className="mr-8 space-y-1 rounded bg-amber-50 p-2">
                    <p>{m.text}</p>
                    {m.offer.state === "open" ? (
                      <div className="flex gap-1">
                        <Btn
                          kind="primary"
                          onClick={() => {
                            const out = run(m.offer!.command);
                            setChat((c) =>
                              c.map((x, j) =>
                                j === i && x.offer
                                  ? { ...x, offer: { ...x.offer, state: "done" } }
                                  : x,
                              ),
                            );
                            say("system", `⚙ ${out.slice(0, 200)}`);
                            llm.current.push({
                              role: "user",
                              content: `[служебно: человек принял предложение «${m.offer!.text}»: ${out}]`,
                            });
                          }}
                        >
                          Показать
                        </Btn>
                        <Btn
                          onClick={() => {
                            setChat((c) =>
                              c.map((x, j) =>
                                j === i && x.offer
                                  ? { ...x, offer: { ...x.offer, state: "declined" } }
                                  : x,
                              ),
                            );
                            llm.current.push({
                              role: "user",
                              content: `[служебно: человек отказался от «${m.offer!.text}»]`,
                            });
                          }}
                        >
                          Не надо
                        </Btn>
                      </div>
                    ) : (
                      <p className="text-xs text-neutral-500">
                        {m.offer.state === "done" ? "✓ применено" : "отклонено"}
                      </p>
                    )}
                  </div>
                ) : (
                  <p
                    key={i}
                    className={
                      m.role === "user"
                        ? "ml-8 rounded bg-neutral-900 p-2 text-white"
                        : m.role === "system"
                          ? "text-xs text-neutral-400"
                          : "mr-8 rounded bg-neutral-100 p-2"
                    }
                  >
                    {m.text}
                  </p>
                ),
              )}
              {busy && <p className="text-xs text-neutral-400">Лев думает…</p>}
              {aiBusy && <p className="animate-pulse text-xs text-amber-700">{aiBusy}</p>}
            </div>
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t px-2 pt-2">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={c.run}
                    className="rounded-full border px-3 py-1 text-xs hover:bg-neutral-100"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex gap-1 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat(input);
              }}
            >
              <input
                className="flex-1 rounded border px-2 py-1 text-sm"
                placeholder="Например: участка нет, нас трое и три кошки"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <Btn kind="primary" onClick={() => void sendChat(input)} disabled={busy}>
                ➤
              </Btn>
            </form>
            {/* Голос — всегда внизу панели; на телефоне — закреплённая полоса внизу экрана. */}
            <div className="sticky bottom-0 z-30 border-t bg-white p-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
              {!voice ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleVoice("dialog")}
                    className="flex-1 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
                  >
                    🎙 Голосовой режим
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleVoice("ptt")}
                    className="rounded-full border px-3 py-2.5 text-xs text-neutral-600 hover:bg-neutral-100"
                    title="Рация: удерживаете кнопку, пока говорите"
                  >
                    рация
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      voiceState === "listening"
                        ? "animate-pulse bg-green-500"
                        : voiceState === "speaking"
                          ? "animate-pulse bg-blue-500"
                          : voiceState === "thinking"
                            ? "animate-pulse bg-amber-500"
                            : "bg-neutral-300"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {voiceState === "speaking" ? "Лев говорит" : VOICE_STATE_RU[voiceState]}
                    {voiceInfo ? ` · ${voiceInfo}` : ""}
                  </span>
                  {!continuous && (
                    <button
                      type="button"
                      className="select-none rounded-full bg-red-600 px-4 py-2.5 text-sm text-white active:bg-red-800"
                      onPointerDown={() => voice.pressTalk()}
                      onPointerUp={() => voice.releaseTalk()}
                      onPointerLeave={() => voice.releaseTalk()}
                    >
                      Держите и говорите
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleVoice()}
                    className="rounded-full border border-red-300 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50"
                  >
                    Завершить
                  </button>
                </div>
              )}
              {!voice && voiceInfo && (
                <p className="mt-1 text-xs text-neutral-500">Голос: {voiceInfo}</p>
              )}
            </div>
          </section>

          {passport && (
            <section className="space-y-2 rounded-lg border bg-white p-3 text-sm">
              <b>Получить точный расчёт</b>
              <input
                className="w-full rounded border px-2 py-1"
                placeholder="Имя"
                value={lead.name}
                onChange={(e) => setLead({ ...lead, name: e.target.value })}
              />
              <input
                className="w-full rounded border px-2 py-1"
                placeholder="Телефон"
                value={lead.phone}
                onChange={(e) => setLead({ ...lead, phone: e.target.value })}
              />
              <textarea
                className="w-full rounded border px-2 py-1"
                placeholder="Комментарий"
                value={lead.comment}
                onChange={(e) => setLead({ ...lead, comment: e.target.value })}
              />
              <Btn kind="primary" onClick={sendLead}>
                Отправить с паспортом проекта
              </Btn>
              {leadState && <p className="text-xs">{leadState}</p>}
              <p className="text-xs text-neutral-500">
                Пилот: заявка уходит в тестовый чат Telegram, не в прод.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export default PilotApp;
