/**
 * Пилот конструктора v4: сценарий → 3 варианта → правка в 3D (стены, окна, двери,
 * ярусы, участок) → 2D-план → бюджет вилкой и паспорт → рендеры → заявка.
 * Архитектор Лев — текстом (rgrouter) и голосом (InWorld) через сервер пилота.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyCommand,
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
  type AreaCheck,
  type LifeScenario,
} from "../engine/scenario.ts";
import { solve, type Variant } from "../engine/solver.ts";
import { promptFor, viewSet, STAGE2 } from "../engine/render-plan.ts";
import { rederive } from "../engine/derive.ts";
import type { Project, Side } from "../engine/types.ts";
import { FINISHES, roomSpec } from "../grammar/index.ts";
import { PILOT } from "../pilot.config.ts";
import { chatTools, commentOn, projectContext, realtimeTools, systemPrompt } from "./architect.ts";
import { VoiceSession, type VoiceState } from "./voice.ts";
import { PlanSvg } from "./PlanSvg.tsx";
import type { WallPick } from "./Scene.tsx";

const HouseScene = lazy(() => import("./Scene.tsx"));
const API = (import.meta.env.VITE_PILOT_API as string | undefined) ?? "http://localhost:8790";
const SESSION = Math.random().toString(36).slice(2);
const SIDE_RU: Record<Side, string> = { N: "север", E: "восток", S: "юг", W: "запад" };
const mln = (n: number) => (n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

type ChatMsg = { role: "user" | "assistant" | "system"; text: string };
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
  const [selected, setSelected] = useState<WallPick | null>(null);
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
  const [lead, setLead] = useState({ name: "", phone: "", comment: "" });
  const [leadState, setLeadState] = useState("");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [windowPreset, setWindowPreset] = useState<WindowPreset>("standard");
  const [styleText, setStyleText] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  const setCurrent = useCallback((p: Project | null, pushHistory = true) => {
    if (pushHistory && currentRef.current)
      setHistory((h) => [...h.slice(-30), currentRef.current!]);
    currentRef.current = p;
    setCurrentState(p);
  }, []);

  const say = (role: ChatMsg["role"], text: string) => setChat((c) => [...c, { role, text }]);

  const build = useCallback(
    (s: LifeScenario) => {
      const t = performance.now();
      const check = checkArea(s);
      setArea(check);
      const r = solve(briefFromScenario(s));
      setVariants(r.variants);
      setElapsed(Math.round(performance.now() - t));
      if (r.variants[0]) {
        setCurrent(r.variants[0].project);
        setComments([r.variants[0].rank?.why ?? ""]);
      }
      return { check, r };
    },
    [setCurrent],
  );

  // ?demo — сразу собрать варианты по анкете по умолчанию (быстрый показ и проверка).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("demo")) build(DEFAULT_SCENARIO);
  }, [build]);

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
        const s: LifeScenario = {
          ...scenario,
          adults: Number(a.adults ?? scenario.adults),
          kids: Number(a.kids ?? scenario.kids),
          kidsShareRoom: Boolean(a.kidsShareRoom ?? scenario.kidsShareRoom),
          pets: { dogs: Number(a.dogs ?? scenario.pets?.dogs ?? 0) },
          workFromHome: Number(a.workFromHome ?? scenario.workFromHome ?? 0),
          guestsOften: Boolean(a.guestsOften ?? scenario.guestsOften),
          sauna: Boolean(a.sauna ?? scenario.sauna),
          storage: a.storageLots ? "lots" : scenario.storage,
          car: Boolean(a.car ?? scenario.car),
          tiers:
            a.tiers === "1" ? 1 : a.tiers === "2" ? 2 : a.tiers === "any" ? "any" : scenario.tiers,
          desiredAreaM2: a.desiredAreaMaxM2
            ? { min: 0, max: Number(a.desiredAreaMaxM2) }
            : scenario.desiredAreaM2,
          budgetRub: a.budgetMaxRub ? { min: 0, max: Number(a.budgetMaxRub) } : scenario.budgetRub,
          styleHints: a.style ? [String(a.style)] : scenario.styleHints,
        };
        setScenario(s);
        const { check, r } = build(s);
        return `${check.message} Собрано вариантов: ${r.variants.length}. ${r.variants
          .map((v, i) => `${i + 1}) ${v.summary}; ${v.rank?.why ?? ""}`)
          .join(" ")} Опции: ${check.options.map((o) => `${o.label} — ${o.reason}`).join("; ")}`;
      }
      if (name === "select_variant") {
        const v = variants[Number(a.index) - 1];
        if (!v) return "Такого варианта нет.";
        setCurrent(v.project);
        return `Выбран вариант ${a.index}: ${v.summary}`;
      }
      const parsed = toolCallToCommand(name, a);
      if (!parsed.ok) return `Команда не распознана: ${parsed.error}`;
      return run(parsed.command);
    },
    [scenario, variants, build, run, setCurrent],
  );

  const context = () =>
    projectContext(currentRef.current, {
      selectedWall: selected
        ? `кубик ${selected.moduleId}, сторона ${selected.side} (${SIDE_RU[selected.side]})`
        : undefined,
      variants: variants.map((v, i) => `${i + 1}) ${v.summary}`),
    });

  const sendChat = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    say("user", text);
    llm.current.push({ role: "user", content: text });
    setBusy(true);
    try {
      for (let round = 0; round < 4; round++) {
        const r = await fetch(`${API}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: systemPrompt(context()),
            messages: llm.current,
            tools: chatTools(),
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        const m = j.message as {
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
        `Чат недоступен: ${(e as Error).message}. Запущен ли npm run pilot и есть ли ключ rgrouter?`,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = async () => {
    if (voice) {
      voice.stop();
      setVoice(null);
      return;
    }
    const v = new VoiceSession(
      API.replace(/^http/, "ws") + "/voice",
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
      { instructions: () => systemPrompt(context()), tools: realtimeTools(), continuous },
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
    try {
      const r = await fetch(`${API}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Pilot-Session": SESSION },
        body: JSON.stringify({ shots: pick.map((v) => ({ id: v.id, prompt: promptFor(p, v) })) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRenders(
        pick.map((v) => {
          const res = (
            j.results as { id: string; url?: string; b64?: string; error?: string }[]
          ).find((x) => x.id === v.id);
          return {
            id: v.id,
            label: v.label,
            src: res?.b64 ? `data:image/png;base64,${res.b64}` : res?.url,
            error: res?.error,
          };
        }),
      );
    } catch (e) {
      setRenders([{ id: "err", label: "Ошибка", error: (e as Error).message }]);
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
      const j = await r.json();
      setLeadState(r.ok ? "Заявка ушла в Telegram ✓" : `Ошибка: ${j.error}`);
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
    setScenario({ ...scenario, plot });
    const p = currentRef.current;
    if (p) setCurrent(rederive({ ...p, plot, placementLocked: false }, p.terrace.side));
  };

  const s = scenario;
  const sel = selected && current ? current.modules.find((m) => m.id === selected.moduleId) : null;
  const selRoom = sel ? current!.rooms.find((r) => r.moduleIds.includes(sel.id)) : null;
  const hasUpper = current ? modulesOnTier(current, 2).length > 0 : false;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">ЭкоКуб · конструктор v4 · пилот</h1>
          <p className="text-xs text-neutral-500">
            Тестовая версия, цены и отделки — черновик. Сервер пилота:{" "}
            {health?.ok ? (
              <span>
                на связи (чат {health.rgrouter ? "✓" : "нет ключа"}, голос{" "}
                {health.inworld ? "✓" : "нет ключа"}, Telegram {health.telegram ? "✓" : "нет ключа"}
                )
              </span>
            ) : (
              <span className="text-red-600">не запущен — npm run pilot</span>
            )}
          </p>
        </div>
        {elapsed !== null && (
          <span className="text-xs text-neutral-500">3 варианта собраны за {elapsed} мс</span>
        )}
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[300px_1fr_360px]">
        {/* ── Левая колонка: сценарий и участок ── */}
        <aside className="space-y-3">
          <section className="space-y-2 rounded-lg border bg-white p-3">
            <h2 className="font-semibold">Кто будет жить</h2>
            <Num
              label="Взрослые"
              value={s.adults}
              min={1}
              max={6}
              onChange={(n) => setScenario({ ...s, adults: n })}
            />
            <Num
              label="Дети"
              value={s.kids}
              max={6}
              onChange={(n) => setScenario({ ...s, kids: n })}
            />
            <Check
              label="Дети в одной комнате"
              value={!!s.kidsShareRoom}
              onChange={(b) => setScenario({ ...s, kidsShareRoom: b })}
            />
            <Num
              label="Собаки"
              value={s.pets?.dogs ?? 0}
              max={5}
              onChange={(n) => setScenario({ ...s, pets: { dogs: n } })}
            />
            <Num
              label="Работают из дома"
              value={s.workFromHome ?? 0}
              max={4}
              onChange={(n) => setScenario({ ...s, workFromHome: n })}
            />
            <Check
              label="Часто гости"
              value={!!s.guestsOften}
              onChange={(b) => setScenario({ ...s, guestsOften: b })}
            />
            <Check
              label="Сауна"
              value={!!s.sauna}
              onChange={(b) => setScenario({ ...s, sauna: b })}
            />
            <Check
              label="Много хранения"
              value={s.storage === "lots"}
              onChange={(b) => setScenario({ ...s, storage: b ? "lots" : "normal" })}
            />
            <Check label="Машина" value={!!s.car} onChange={(b) => setScenario({ ...s, car: b })} />
            <label className="flex items-center justify-between text-sm">
              Этажность
              <select
                className="rounded border px-2 py-1"
                value={String(s.tiers ?? "any")}
                onChange={(e) =>
                  setScenario({
                    ...s,
                    tiers: e.target.value === "any" ? "any" : (Number(e.target.value) as 1 | 2),
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
                setScenario({ ...s, desiredAreaM2: n ? { min: 0, max: n } : undefined })
              }
            />
            <Num
              label="Бюджет до, млн ₽"
              value={s.budgetRub ? s.budgetRub.max / 1e6 : 0}
              max={100}
              step={0.5}
              onChange={(n) =>
                setScenario({ ...s, budgetRub: n ? { min: 0, max: n * 1e6 } : undefined })
              }
            />
            <Btn kind="primary" onClick={() => build(s)}>
              Собрать 3 варианта
            </Btn>
            {area && (
              <div className={`rounded p-2 text-sm ${area.fits ? "bg-green-50" : "bg-amber-50"}`}>
                <p>{area.message}</p>
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
        </aside>

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
            {current && history.length > 0 && (
              <Btn
                onClick={() => {
                  const prev = history[history.length - 1];
                  setHistory((h) => h.slice(0, -1));
                  setCurrent(prev, false);
                }}
              >
                ↶ Отменить
              </Btn>
            )}
          </div>

          <div id="pilot-3d" className="h-[520px] overflow-hidden rounded-lg border bg-white">
            {!current ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-neutral-500">
                Расскажите Льву о семье или заполните анкету слева и нажмите «Собрать 3 варианта».
              </div>
            ) : tab === "3d" ? (
              <Suspense fallback={<div className="p-4">Загружаю 3D…</div>}>
                <HouseScene project={current} selected={selected} onPick={setSelected} shot />
              </Suspense>
            ) : tab === "plan1" || tab === "plan2" ? (
              <PlanSvg project={current} tier={tab === "plan1" ? 1 : 2} />
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
                  <p className="mt-1 text-xs">
                    Сверка с ориентиром: модули, отделка, доставка, кран и фундамент — в середине
                    вилки {Math.round(passport.budget.benchmark.allInMidPerM2 / 1000)} тыс. ₽/м²
                    (ориентир владельца {passport.budget.benchmark.perM2 / 1000} тыс.); терраса и
                    опции — сверху.
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
                <b>Правка:</b>
                <span className="text-neutral-600">
                  {sel
                    ? `стена «${SIDE_RU[selected!.side]}» · ${selRoom ? roomSpec(selRoom.type).label : ""} · ярус ${sel.tier}`
                    : "кликните по стене дома в 3D"}
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
                      run({ op: "door", action: "move", side: selected!.side, moduleId: sel.id })
                    }
                  >
                    вход сюда
                  </Btn>
                  <Btn
                    onClick={() =>
                      run({ op: "door", action: "remove", side: selected!.side, moduleId: sel.id })
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
                          onClick={() => run({ op: "set_overhang", side: selected!.side, mm })}
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
                          run({ op: "resize_room", roomId: k.id, modules: k.moduleIds.length + 1 })
                        }
                      >
                        кухня больше
                      </Btn>
                      <Btn
                        onClick={() =>
                          run({ op: "resize_room", roomId: k.id, modules: k.moduleIds.length - 1 })
                        }
                      >
                        кухня меньше
                      </Btn>
                    </>
                  ) : null;
                })()}
                {selRoom && selRoom.type !== "kitchen-living" && (
                  <Btn onClick={() => run({ op: "remove_room", roomId: selRoom.id })}>
                    убрать «{roomSpec(selRoom.type).label}»
                  </Btn>
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
                <Btn onClick={() => styleText && run({ op: "describe_style", text: styleText })}>
                  понять стиль
                </Btn>
              </div>
              <p className="text-xs text-neutral-500">
                {current.modules.length} кубиков · {factoryModules(current).modules.length} модулей
                · {Math.round(warmContourM2(current))} м² · {trucksForCubes(current.modules.length)}{" "}
                трала
              </p>
            </section>
          )}

          {current && (
            <section className="space-y-2 rounded-lg border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>Рендеры</b>
                <Btn onClick={snapshot}>Снимок 3D (стадия 1)</Btn>
                <Btn kind="primary" disabled={renderBusy} onClick={doRenders}>
                  {renderBusy ? "Рисую…" : "Фото-рендеры (3 кадра, ~12 ₽)"}
                </Btn>
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
        </main>

        {/* ── Правая колонка: архитектор и заявка ── */}
        <aside className="space-y-3">
          <section className="flex h-[620px] flex-col rounded-lg border bg-white">
            <div className="flex items-center justify-between border-b p-3">
              <b>{PILOT.architect.name}</b>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={continuous}
                    disabled={!!voice}
                    onChange={(e) => setContinuous(e.target.checked)}
                  />
                  без кнопки
                </label>
                <Btn kind={voice ? "primary" : "ghost"} onClick={toggleVoice}>
                  {voice ? "■ голос" : "🎤 голос"}
                </Btn>
              </div>
            </div>
            {voice && !continuous && (
              <button
                type="button"
                className="m-2 rounded bg-red-600 py-3 text-white active:bg-red-800"
                onPointerDown={() => voice.pressTalk()}
                onPointerUp={() => voice.releaseTalk()}
                onPointerLeave={() => voice.releaseTalk()}
              >
                Держите и говорите
              </button>
            )}
            {(voice || voiceInfo) && (
              <p className="px-3 text-xs text-neutral-500">
                Голос: {voiceState}
                {voiceInfo ? ` · ${voiceInfo}` : ""}
              </p>
            )}
            <div className="flex-1 space-y-2 overflow-auto p-3 text-sm">
              {chat.map((m, i) => (
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
              ))}
              {busy && <p className="text-xs text-neutral-400">Лев думает…</p>}
            </div>
            <form
              className="flex gap-1 border-t p-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat(input);
              }}
            >
              <input
                className="flex-1 rounded border px-2 py-1 text-sm"
                placeholder="Например: нас четверо и собака, хочу 90 м²"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <Btn kind="primary" onClick={() => void sendChat(input)} disabled={busy}>
                ➤
              </Btn>
            </form>
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
