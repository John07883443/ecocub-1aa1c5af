/**
 * Типизированные команды редактора. Голос и текст (InWorld realtime / чат LLM)
 * вызывают инструменты из COMMAND_TOOLS, вызов превращается в EditorCommand,
 * команда применяется детерминированно и проверяется правилами. Нарушает
 * hard-правило — не применяется, человек слышит объяснение.
 */
import { FINISHES, GRAMMAR, findFinish, findStyle } from "../grammar/index.ts";
import type { FinishCategory } from "../grammar/index.ts";
import { SIDES, footprint, supportOf } from "./geometry.ts";
import {
  PRESET_LADDER,
  WINDOW_PRESETS,
  placeWindow,
  presetOf,
  rederive,
  type WindowPreset,
} from "./derive.ts";
import { evaluate, explain, modulesOnTier, type Evaluation } from "./rules.ts";
import { applyStyleProfile, styleProfileFromText } from "./style.ts";
import type { ModulePlacement, Opening, Project, Room, Side } from "./types.ts";

export type WindowAction = "add" | "remove" | "enlarge" | "shrink" | "set";

export interface WindowCommand {
  op: "window";
  action: WindowAction;
  /** Сторона дома (N/E/S/W). «На этой стороне» — интерфейс подставляет сторону, на которую смотрит человек. */
  side: Side;
  roomId?: string;
  moduleId?: string;
  preset?: WindowPreset;
}

export type EditorCommand =
  | { op: "add_room"; room: "bedroom" | "study" | "wet-core"; tier?: number }
  | { op: "remove_room"; roomId: string }
  | { op: "resize_room"; roomId: string; modules: number }
  | { op: "move_terrace"; side: Side }
  | { op: "set_overhang"; side: Side; mm: number }
  | { op: "shift_upper_tier"; dxMm: number; dyMm: number }
  | { op: "set_style"; style: string }
  | { op: "set_finish"; category: FinishCategory; finishId: string }
  | { op: "describe_style"; text: string }
  | WindowCommand;

export type CommandResult =
  | { ok: true; project: Project; evaluation: Evaluation; message: string }
  | { ok: false; reason: string; violations: string[] };

// ── Разбор входа ─────────────────────────────────────────────────────────

const isSide = (x: unknown): x is Side => typeof x === "string" && (SIDES as string[]).includes(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 500;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const CATS: FinishCategory[] = ["facade", "roof", "windowFrames", "interior"];

/** Проверка формы команды от LLM: значения enum провайдер не валидирует сам. */
export function parseCommand(
  input: unknown,
): { ok: true; command: EditorCommand } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Команда — не объект" };
  const c = input as Record<string, unknown>;
  const bad = (f: string) => ({ ok: false as const, error: `Неверное поле ${f}` });
  switch (c.op) {
    case "add_room":
      if (!["bedroom", "study", "wet-core"].includes(c.room as string)) return bad("room");
      if (c.tier !== undefined && !isNum(c.tier)) return bad("tier");
      return {
        ok: true,
        command: { op: "add_room", room: c.room as "bedroom", tier: c.tier as number | undefined },
      };
    case "remove_room":
      return isStr(c.roomId)
        ? { ok: true, command: { op: "remove_room", roomId: c.roomId } }
        : bad("roomId");
    case "resize_room":
      if (!isStr(c.roomId)) return bad("roomId");
      return isNum(c.modules)
        ? { ok: true, command: { op: "resize_room", roomId: c.roomId, modules: c.modules } }
        : bad("modules");
    case "move_terrace":
      return isSide(c.side)
        ? { ok: true, command: { op: "move_terrace", side: c.side } }
        : bad("side");
    case "set_overhang":
      if (!isSide(c.side)) return bad("side");
      return isNum(c.mm)
        ? { ok: true, command: { op: "set_overhang", side: c.side, mm: c.mm } }
        : bad("mm");
    case "shift_upper_tier":
      return isNum(c.dxMm) && isNum(c.dyMm)
        ? { ok: true, command: { op: "shift_upper_tier", dxMm: c.dxMm, dyMm: c.dyMm } }
        : bad("dxMm/dyMm");
    case "set_style":
      return isStr(c.style)
        ? { ok: true, command: { op: "set_style", style: c.style } }
        : bad("style");
    case "set_finish":
      if (!CATS.includes(c.category as FinishCategory)) return bad("category");
      return isStr(c.finishId)
        ? {
            ok: true,
            command: {
              op: "set_finish",
              category: c.category as FinishCategory,
              finishId: c.finishId,
            },
          }
        : bad("finishId");
    case "describe_style":
      return isStr(c.text)
        ? { ok: true, command: { op: "describe_style", text: c.text } }
        : bad("text");
    case "window": {
      if (!["add", "remove", "enlarge", "shrink", "set"].includes(c.action as string))
        return bad("action");
      if (!isSide(c.side)) return bad("side");
      if (c.preset !== undefined && !((c.preset as string) in WINDOW_PRESETS)) return bad("preset");
      if (c.roomId !== undefined && !isStr(c.roomId)) return bad("roomId");
      if (c.moduleId !== undefined && !isStr(c.moduleId)) return bad("moduleId");
      return {
        ok: true,
        command: {
          op: "window",
          action: c.action as WindowAction,
          side: c.side,
          roomId: c.roomId as string | undefined,
          moduleId: c.moduleId as string | undefined,
          preset: c.preset as WindowPreset | undefined,
        },
      };
    }
    default:
      return { ok: false, error: `Неизвестная команда ${String(c.op)}` };
  }
}

// ── Применение ──────────────────────────────────────────────────────────

function commit(before: Project, after: Project, message: string): CommandResult {
  const ev = evaluate(after);
  if (!ev.valid) {
    const was = new Set(evaluate(before).hardViolations.map((v) => v.message));
    const fresh = ev.hardViolations.filter((v) => !was.has(v.message));
    if (fresh.length || !evaluate(before).valid)
      return { ok: false, reason: "Так построить нельзя", violations: explain(ev) };
  }
  return { ok: true, project: after, evaluation: ev, message };
}

const reject = (reason: string, violations: string[] = []): CommandResult => ({
  ok: false,
  reason,
  violations,
});

let seq = 0;
const newId = (p: Project, prefix: string) => {
  let id: string;
  do id = `${prefix}-${++seq}`;
  while (p.modules.some((m) => m.id === id) || p.rooms.some((r) => r.id === id));
  return id;
};

/** Позиции вплотную к модулю (стыки со смещением 0 / ±1710 / ±1600). */
function slotsAround(m: ModulePlacement): { xMm: number; yMm: number }[] {
  const r = footprint(m);
  const { w, d } = GRAMMAR.module.externalMm;
  const offY = [0, 1710, -1710];
  const offX = [0, 1600, -1600];
  return [
    ...offY.map((o) => ({ xMm: r.x1, yMm: r.y0 + o })),
    ...offY.map((o) => ({ xMm: r.x0 - w, yMm: r.y0 + o })),
    ...offX.map((o) => ({ xMm: r.x0 + o, yMm: r.y1 })),
    ...offX.map((o) => ({ xMm: r.x0 + o, yMm: r.y0 - d })),
  ];
}

/** Пробует пристроить модуль к помещению-якорю; берёт лучший по мягким правилам допустимый вариант. */
function tryAttach(
  p: Project,
  anchor: Room,
  tier: number,
  make: (m: ModulePlacement, p: Project) => Project,
): Project | null {
  let best: { proj: Project; score: number } | null = null;
  for (const am of p.modules.filter((m) => anchor.moduleIds.includes(m.id)))
    for (const pos of slotsAround(am)) {
      const id = newId(p, "m");
      const m: ModulePlacement = { id, xMm: pos.xMm, yMm: pos.yMm, rot: 0, tier, roomId: "" };
      const cand = rederive(make(m, p), p.terrace.side);
      const ev = evaluate(cand);
      if (ev.valid && (!best || ev.softScore > best.score))
        best = { proj: cand, score: ev.softScore };
    }
  return best?.proj ?? null;
}

function shiftUpper(p: Project, dx: number, dy: number): Project {
  return rederive(
    {
      ...p,
      modules: p.modules.map((m) =>
        m.tier === 2 ? { ...m, xMm: m.xMm + dx, yMm: m.yMm + dy } : m,
      ),
    },
    p.terrace.side,
  );
}

function windowTargets(p: Project, c: WindowCommand): ModulePlacement[] {
  if (c.moduleId) return p.modules.filter((m) => m.id === c.moduleId);
  if (c.roomId) {
    const r = p.rooms.find((x) => x.id === c.roomId);
    return r ? p.modules.filter((m) => r.moduleIds.includes(m.id)) : [];
  }
  return [];
}

function applyWindow(p: Project, c: WindowCommand): CommandResult {
  const mods = windowTargets(p, c);
  if (!mods.length) return reject("Не понял, о каком помещении речь — покажите его на плане.");
  const onFace = (m: ModulePlacement) =>
    p.openings.filter((o) => o.moduleId === m.id && o.face === c.side && o.kind === "window");
  const roomIdOf = (m: ModulePlacement) =>
    p.rooms.find((r) => r.moduleIds.includes(m.id))?.id ?? "";
  let openings: Opening[] = [...p.openings];
  let changed = 0;

  if (c.action === "add") {
    const preset = c.preset ?? "standard";
    let work: Project = p;
    for (const m of mods) {
      const w = placeWindow(work, m, c.side, preset, roomIdOf(m), `w-${++seq}`);
      if (!w) continue;
      w.userSet = true;
      openings.push(w);
      work = { ...work, openings };
      changed++;
      break;
    }
    if (!changed)
      return reject(
        `На стороне ${c.side} нет свободной наружной стены: там стык с соседним модулем или уже стоят окна с простенками ${GRAMMAR.openings.cornerPierMm} мм.`,
      );
  } else if (c.action === "remove") {
    const ids = new Set(mods.flatMap(onFace).map((o) => o.id));
    if (!ids.size) return reject(`На стороне ${c.side} окон нет.`);
    openings = openings.filter((o) => !ids.has(o.id));
    // Человек убрал окно — авто-окна этого помещения больше не досоздаём.
    openings = openings.map((o) =>
      mods.some((m) => m.id === o.moduleId) && o.kind === "window" ? { ...o, userSet: true } : o,
    );
    changed = ids.size;
  } else {
    const targets = mods.flatMap(onFace);
    if (!targets.length) {
      if (c.action === "set" || c.action === "enlarge")
        return applyWindow(p, { ...c, action: "add", preset: c.preset ?? "large" });
      return reject(`На стороне ${c.side} окон нет.`);
    }
    for (const o of targets) {
      const cur = PRESET_LADDER.indexOf(presetOf(o));
      const next: WindowPreset =
        c.action === "set"
          ? (c.preset ?? "standard")
          : PRESET_LADDER[
              Math.max(
                0,
                Math.min(PRESET_LADDER.length - 1, cur + (c.action === "enlarge" ? 1 : -1)),
              )
            ];
      if (next === presetOf(o)) continue;
      const m = p.modules.find((x) => x.id === o.moduleId)!;
      const w = placeWindow({ ...p, openings }, m, c.side, next, o.roomId, o.id, [o.id]);
      if (!w) return reject("Окно такого размера здесь не помещается.");
      // Сохраняем позицию, если новый размер в неё влезает; иначе ставим в лучший свободный отрезок.
      openings = openings.map((x) => (x.id === o.id ? { ...w, userSet: true } : x));
      changed++;
    }
    if (!changed)
      return reject(
        c.action === "enlarge" ? "Больше уже некуда: это панорама в пол." : "Меньше уже некуда.",
      );
  }
  const after: Project = { ...p, openings };
  return commit(
    p,
    after,
    `Окна на стороне ${c.side}: ${c.action}${c.preset ? ` (${WINDOW_PRESETS[c.preset].label})` : ""}.`,
  );
}

export function applyCommand(p: Project, c: EditorCommand): CommandResult {
  switch (c.op) {
    case "add_room": {
      const tier = c.tier ?? 1;
      if (tier > GRAMMAR.tiers.maxTiers || tier < 1)
        return reject(
          `Ярусов не больше ${GRAMMAR.tiers.maxTiers}: третий ярус модули не держат по конструктиву.`,
        );
      const anchor =
        tier === 1
          ? p.rooms.find((r) => r.type === "kitchen-living")
          : p.rooms.find((r) => r.type === "hall" && r.tier === 2);
      if (!anchor)
        return reject(
          tier === 2
            ? "Второго яруса пока нет — сначала соберите вариант с двумя ярусами."
            : "Нет общей комнаты.",
        );
      const roomId = newId(p, c.room);
      const next = tryAttach(p, anchor, tier, (m, proj) => ({
        ...proj,
        modules: [...proj.modules, { ...m, roomId }],
        rooms: [
          ...proj.rooms,
          {
            id: roomId,
            type: c.room,
            tier,
            moduleIds: [m.id],
            subRooms: c.room === "wet-core" ? ["санузел"] : undefined,
          },
        ],
      }));
      return next
        ? commit(p, next, "Помещение добавлено.")
        : reject("Пристроить так, чтобы дом остался реализуемым, не получилось.", [
            c.room === "wet-core" && tier === 2
              ? "Санузел второго яруса должен стоять над санузлом первого."
              : "Нет места со стыком ≥ 1,5 м к общей комнате или холлу.",
          ]);
    }
    case "remove_room": {
      const r = p.rooms.find((x) => x.id === c.roomId);
      if (!r) return reject("Нет такого помещения.");
      const after = rederive(
        {
          ...p,
          modules: p.modules.filter((m) => !r.moduleIds.includes(m.id)),
          rooms: p.rooms.filter((x) => x.id !== r.id),
          openings: p.openings.filter((o) => !r.moduleIds.includes(o.moduleId)),
        },
        p.terrace.side,
      );
      return commit(p, after, "Помещение убрано.");
    }
    case "resize_room": {
      const r = p.rooms.find((x) => x.id === c.roomId);
      if (!r) return reject("Нет такого помещения.");
      const cur = r.moduleIds.length;
      if (c.modules === cur) return reject("Размер и так такой.");
      if (c.modules > cur) {
        let proj: Project | null = p;
        for (let i = cur; i < c.modules && proj; i++) {
          const room = proj.rooms.find((x) => x.id === r.id)!;
          proj = tryAttach(proj, room, r.tier, (m, pp) => ({
            ...pp,
            modules: [...pp.modules, { ...m, roomId: r.id }],
            rooms: pp.rooms.map((x) =>
              x.id === r.id ? { ...x, moduleIds: [...x.moduleIds, m.id] } : x,
            ),
          }));
        }
        return proj
          ? commit(p, proj, "Помещение увеличено.")
          : reject("Увеличить и остаться в правилах не получилось.");
      }
      for (const mid of [...r.moduleIds].reverse()) {
        const after = rederive(
          {
            ...p,
            modules: p.modules.filter((m) => m.id !== mid),
            rooms: p.rooms.map((x) =>
              x.id === r.id ? { ...x, moduleIds: x.moduleIds.filter((i) => i !== mid) } : x,
            ),
            openings: p.openings.filter((o) => o.moduleId !== mid),
          },
          p.terrace.side,
        );
        if (evaluate(after).valid) return commit(p, after, "Помещение уменьшено.");
      }
      return reject("Уменьшить и остаться в правилах не получилось.", explain(evaluate(p)));
    }
    case "move_terrace":
      return commit(p, rederive(p, c.side), `Терраса перенесена на сторону ${c.side}.`);
    case "set_overhang": {
      const upper = modulesOnTier(p, 2);
      if (!upper.length) return reject("Второго яруса нет — свешивать нечего.");
      const t1 = modulesOnTier(p, 1);
      const current = Math.max(...upper.map((u) => supportOf(u, t1).overhangMm[c.side]));
      const delta = Math.round((c.mm - current) / 10) * 10;
      const dx = c.side === "E" ? delta : c.side === "W" ? -delta : 0;
      const dy = c.side === "N" ? delta : c.side === "S" ? -delta : 0;
      return commit(
        p,
        shiftUpper(p, dx, dy),
        `Свес второго яруса на стороне ${c.side}: ${(c.mm / 1000).toFixed(2)} м.`,
      );
    }
    case "shift_upper_tier": {
      if (!modulesOnTier(p, 2).length) return reject("Второго яруса нет.");
      const step = GRAMMAR.tiers.upperSnapMm;
      return commit(
        p,
        shiftUpper(p, Math.round(c.dxMm / step) * step, Math.round(c.dyMm / step) * step),
        "Второй ярус сдвинут.",
      );
    }
    case "set_style": {
      const s = findStyle(c.style);
      if (!s)
        return reject(
          `Не знаю стиль «${c.style}». Есть: ${FINISHES.styles.map((x) => x.label).join(", ")}.`,
        );
      return commit(
        p,
        {
          ...p,
          finishes: {
            styleId: s.id,
            facade: s.facade,
            roof: s.roof,
            windowFrames: s.windowFrames,
            interior: s.interior,
          },
        },
        `Стиль: ${s.label}.`,
      );
    }
    case "set_finish": {
      const f = findFinish(c.category, c.finishId);
      if (!f) return reject("Такой отделки в каталоге нет.");
      return commit(p, { ...p, finishes: { ...p.finishes, [c.category]: f.id } }, `${f.label}.`);
    }
    case "describe_style": {
      const prof = styleProfileFromText(c.text);
      if (prof.confidence < 0.34)
        return reject(
          "Не понял стиль по описанию. Пришлите референсы или скриншоты — можно вставить прямо сюда.",
        );
      return commit(
        p,
        { ...p, finishes: applyStyleProfile(p.finishes, prof), styleProfile: prof },
        "Стиль понял, отделки подобраны.",
      );
    }
    case "window":
      return applyWindow(p, c);
  }
}

// ── Инструменты для голоса и чата (function calling) ────────────────────

const side = {
  type: "string",
  enum: SIDES,
  description: "Сторона дома: N, E, S, W (север, восток, юг, запад)",
};

/** Описания инструментов в формате function-calling (InWorld realtime / OpenAI-совместимый). */
export const COMMAND_TOOLS = [
  {
    type: "function",
    name: "add_room",
    description: "Добавить помещение: спальню, кабинет или санузел. tier 2 — на второй ярус.",
    parameters: {
      type: "object",
      properties: {
        room: { type: "string", enum: ["bedroom", "study", "wet-core"] },
        tier: { type: "integer", enum: [1, 2] },
      },
      required: ["room"],
    },
  },
  {
    type: "function",
    name: "remove_room",
    description: "Убрать помещение по id.",
    parameters: {
      type: "object",
      properties: { roomId: { type: "string" } },
      required: ["roomId"],
    },
  },
  {
    type: "function",
    name: "resize_room",
    description: "Сделать помещение больше или меньше (число модулей). Кухня-гостиная 2–5.",
    parameters: {
      type: "object",
      properties: {
        roomId: { type: "string" },
        modules: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["roomId", "modules"],
    },
  },
  {
    type: "function",
    name: "move_terrace",
    description: "Перенести террасу на сторону дома.",
    parameters: { type: "object", properties: { side }, required: ["side"] },
  },
  {
    type: "function",
    name: "set_overhang",
    description: "Свес второго яруса на стороне, мм. Без колонны не больше 1500.",
    parameters: {
      type: "object",
      properties: { side, mm: { type: "integer", minimum: 0 } },
      required: ["side", "mm"],
    },
  },
  {
    type: "function",
    name: "shift_upper_tier",
    description: "Сдвинуть весь второй ярус, мм (шаг 100).",
    parameters: {
      type: "object",
      properties: { dxMm: { type: "integer" }, dyMm: { type: "integer" } },
      required: ["dxMm", "dyMm"],
    },
  },
  {
    type: "function",
    name: "set_style",
    description:
      "Выбрать готовый стиль: скандинавский, японский минимализм, рижский, дерево, бетон, хай-тек.",
    parameters: { type: "object", properties: { style: { type: "string" } }, required: ["style"] },
  },
  {
    type: "function",
    name: "set_finish",
    description: "Выбрать отделку из каталога по категории.",
    parameters: {
      type: "object",
      properties: { category: { type: "string", enum: CATS }, finishId: { type: "string" } },
      required: ["category", "finishId"],
    },
  },
  {
    type: "function",
    name: "describe_style",
    description:
      "Передать описание внешнего вида словами человека: цвет фасада, облицовка, окна, общий вид.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    type: "function",
    name: "edit_window",
    description:
      "Окна: add — добавить, remove — убрать, enlarge/shrink — больше/меньше, set — задать размер. preset: slot, small, standard, large, floor-to-ceiling (панорама в пол).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "enlarge", "shrink", "set"] },
        side,
        roomId: { type: "string" },
        moduleId: { type: "string" },
        preset: { type: "string", enum: Object.keys(WINDOW_PRESETS) },
      },
      required: ["action", "side"],
    },
  },
] as const;

/** Вызов инструмента от модели → команда редактора. */
export function toolCallToCommand(name: string, args: unknown): ReturnType<typeof parseCommand> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  return parseCommand(name === "edit_window" ? { ...a, op: "window" } : { ...a, op: name });
}
