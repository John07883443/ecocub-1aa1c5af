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
  freeSegments,
  faceStart,
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

export type DoorAction = "add" | "move" | "remove" | "set";
export type DoorPreset = "single" | "wide" | "double";

/** Наружная дверь: вход или выход на террасу. «move» переносит главный вход на эту стену. */
export interface DoorCommand {
  op: "door";
  action: DoorAction;
  side: Side;
  roomId?: string;
  moduleId?: string;
  preset?: DoorPreset;
}

/** Любой проём, выбранный на стене в 3D или названный голосом. */
export type OpeningCommand = WindowCommand | DoorCommand;

export const DOOR_PRESETS: Record<
  DoorPreset,
  { widthMm: number; heightMm: number; label: string }
> = {
  single: { widthMm: 800, heightMm: 2100, label: "дверь 800" },
  wide: { widthMm: 1000, heightMm: 2100, label: "широкая дверь 1000" },
  double: { widthMm: 1200, heightMm: 2100, label: "двустворчатая 1200" },
};

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
  | { op: "place_house"; xMm: number; yMm: number }
  | { op: "rotate_house"; deg: 90 | 180 | 270 }
  | OpeningCommand;

export type CommandResult =
  | { ok: true; project: Project; evaluation: Evaluation; message: string }
  | { ok: false; reason: string; violations: string[]; suggestion?: string };

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
    case "door": {
      if (!["add", "move", "remove", "set"].includes(c.action as string)) return bad("action");
      if (!isSide(c.side)) return bad("side");
      if (c.preset !== undefined && !((c.preset as string) in DOOR_PRESETS)) return bad("preset");
      if (c.roomId !== undefined && !isStr(c.roomId)) return bad("roomId");
      if (c.moduleId !== undefined && !isStr(c.moduleId)) return bad("moduleId");
      return {
        ok: true,
        command: {
          op: "door",
          action: c.action as DoorAction,
          side: c.side,
          roomId: c.roomId as string | undefined,
          moduleId: c.moduleId as string | undefined,
          preset: c.preset as DoorPreset | undefined,
        },
      };
    }
    case "place_house":
      return isNum(c.xMm) && isNum(c.yMm)
        ? { ok: true, command: { op: "place_house", xMm: c.xMm, yMm: c.yMm } }
        : bad("xMm/yMm");
    case "rotate_house":
      return c.deg === 90 || c.deg === 180 || c.deg === 270
        ? { ok: true, command: { op: "rotate_house", deg: c.deg } }
        : bad("deg");
    default:
      return { ok: false, error: `Неизвестная команда ${String(c.op)}` };
  }
}

// ── Применение ──────────────────────────────────────────────────────────

/** Короткая подсказка исправления по первому нарушению. */
function suggestFix(ev: Evaluation): string | undefined {
  const v = ev.hardViolations[0];
  if (!v) return undefined;
  switch (v.ruleId) {
    case "overhang":
      return "Свес до 1,5 м — без колонны, до 3 м — с колонной (черновик); больше — сдвиньте второй ярус обратно.";
    case "upper-support":
      return "Сдвиньте модуль второго яруса так, чтобы он опирался на нижние хотя бы наполовину.";
    case "max-tiers":
      return "Поставьте модуль рядом на первый или второй ярус.";
    case "openings":
      return /перемычки/.test(v.message)
        ? "Поставьте большое окно 2800 — у него есть перемычка, или перенесите панораму на грань без второго яруса."
        : "Возьмите проём меньше или другую стену.";
    case "window-required":
      return "Оставьте хотя бы одно окно — можно уменьшить до узкой щели.";
    case "no-corridor":
      return "Поставьте помещение вплотную к общей комнате или холлу.";
    case "plot-fit":
      return "Поверните дом на участке или уберите модуль; можно перенести спальни на второй ярус.";
    case "connected":
      return "Пристыкуйте модуль к соседу гранью не меньше 1,5 м.";
    default:
      return undefined;
  }
}

function commit(before: Project, after: Project, message: string): CommandResult {
  const ev = evaluate(after);
  if (!ev.valid) {
    const was = new Set(evaluate(before).hardViolations.map((v) => v.message));
    const fresh = ev.hardViolations.filter((v) => !was.has(v.message));
    if (fresh.length || !evaluate(before).valid)
      return {
        ok: false,
        reason: "Так построить нельзя",
        violations: explain(ev),
        suggestion: suggestFix(ev),
      };
  }
  return { ok: true, project: after, evaluation: ev, message };
}

const reject = (reason: string, violations: string[] = [], suggestion?: string): CommandResult => ({
  ok: false,
  reason,
  violations,
  suggestion,
});

/** Подсказка исправления: на каких сторонах этого помещения есть свободная наружная стена нужной ширины. */
function freeSidesHint(
  p: Project,
  mods: ModulePlacement[],
  needMm: number,
  exclude?: Side,
): string {
  const sides = SIDES.filter(
    (f) =>
      f !== exclude && mods.some((m) => freeSegments(p, m, f).some(([a, b]) => b - a >= needMm)),
  );
  return sides.length
    ? `Можно на стороне ${sides.join(", ")} — там свободная наружная стена.`
    : "Свободной наружной стены у этого помещения нет — выберите соседнее.";
}

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

function windowTargets(p: Project, c: OpeningCommand): ModulePlacement[] {
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
        [],
        freeSidesHint(p, mods, 500, c.side),
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

function applyDoor(p: Project, c: DoorCommand): CommandResult {
  const mods = windowTargets(p, c).filter((m) => m.tier === 1);
  if (!mods.length)
    return reject("Наружная дверь бывает только на первом ярусе — покажите помещение внизу.");
  const preset = DOOR_PRESETS[c.preset ?? "single"];
  const roomIdOf = (m: ModulePlacement) =>
    p.rooms.find((r) => r.moduleIds.includes(m.id))?.id ?? "";
  const doorsHere = p.openings.filter(
    (o) => o.kind === "entrance" && o.face === c.side && mods.some((m) => m.id === o.moduleId),
  );
  let openings = [...p.openings];
  if (c.action === "remove" || c.action === "set") {
    if (!doorsHere.length) return reject(`На стороне ${c.side} двери нет.`);
    openings = openings.filter((o) => !doorsHere.some((d) => d.id === o.id));
    if (c.action === "remove") return commit(p, { ...p, openings }, "Дверь убрана.");
  }
  // Перенос входа: старый главный вход убирается.
  if (c.action === "move") openings = openings.filter((o) => o.kind !== "entrance");
  for (const m of mods) {
    let work: Project = { ...p, openings };
    let seg = freeSegments(work, m, c.side).find(([a, b]) => b - a >= preset.widthMm);
    // Стена занята окном — дверь встаёт в край пролёта, окно ужимается в остаток (дверь в панораме).
    const displaced = openings.filter(
      (o) => o.moduleId === m.id && o.face === c.side && o.kind === "window",
    );
    if (!seg && displaced.length) {
      const freed = openings.filter((o) => !displaced.includes(o));
      work = { ...p, openings: freed };
      seg = freeSegments(work, m, c.side).find(([a, b]) => b - a >= preset.widthMm);
      if (seg) {
        const door: Opening = {
          id: `door-${++seq}`,
          moduleId: m.id,
          roomId: roomIdOf(m),
          face: c.side,
          kind: "entrance",
          widthMm: preset.widthMm,
          heightMm: preset.heightMm,
          offsetMm: seg[0] - faceStart(m, c.side),
          userSet: true,
        };
        const withDoor = { ...p, openings: [...freed, door] };
        const height = Math.max(...displaced.map((o) => o.heightMm));
        const w = placeWindow(
          withDoor,
          m,
          c.side,
          height === 3150 ? "floor-to-ceiling" : presetOf(displaced[0]),
          roomIdOf(m),
          displaced[0].id,
        );
        const next =
          w && w.widthMm >= 600
            ? [...withDoor.openings, { ...w, userSet: true }]
            : withDoor.openings;
        return commit(
          p,
          { ...p, openings: next },
          `${preset.label} на стороне ${c.side}, окно рядом ужато.`,
        );
      }
    }
    if (!seg) continue;
    openings.push({
      id: `door-${++seq}`,
      moduleId: m.id,
      roomId: roomIdOf(m),
      face: c.side,
      kind: "entrance",
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      offsetMm: seg[0] - faceStart(m, c.side),
      userSet: true,
    });
    return commit(p, { ...p, openings }, `${preset.label} на стороне ${c.side}.`);
  }
  return reject(
    `Дверь ${preset.widthMm} мм на стороне ${c.side} не помещается: там стык или нет простенков.`,
    [],
    freeSidesHint({ ...p, openings }, mods, preset.widthMm, c.side),
  );
}

/** Поворот дома на 90° против часовой: координаты, грани и отступы ручных проёмов. */
export function rotateHouse90(p: Project): Project {
  const turnFace: Record<Side, Side> = { N: "W", E: "N", S: "E", W: "S" };
  const reversed: Side[] = ["E", "W"];
  const rects = new Map(p.modules.map((m) => [m.id, footprint(m)]));
  let modules = p.modules.map((m) => {
    const r = rects.get(m.id)!;
    return { ...m, xMm: -r.y1, yMm: r.x0, rot: ((m.rot + 90) % 360) as ModulePlacement["rot"] };
  });
  const minX = Math.min(...modules.map((m) => m.xMm));
  const minY = Math.min(...modules.map((m) => m.yMm));
  modules = modules.map((m) => ({ ...m, xMm: m.xMm - minX, yMm: m.yMm - minY }));
  const openings = p.openings
    .filter((o) => o.userSet)
    .map((o) => {
      const r = rects.get(o.moduleId)!;
      const len = o.face === "N" || o.face === "S" ? r.x1 - r.x0 : r.y1 - r.y0;
      return {
        ...o,
        face: turnFace[o.face],
        offsetMm: reversed.includes(o.face) ? len - o.offsetMm - o.widthMm : o.offsetMm,
      };
    });
  const rotationDeg = (((p.rotationDeg ?? 0) + 90) % 360) as NonNullable<Project["rotationDeg"]>;
  return rederive(
    { ...p, modules, openings, rotationDeg, placementLocked: false },
    turnFace[p.terrace.side],
  );
}

/**
 * Можно ли убрать помещение кнопкой «Удалить комнату»: заранее понятные запреты
 * со словами для человека. Остальное (маршрут от входа, связность, санузел на
 * первом ярусе) проверяет движок правил при применении команды.
 */
export function removeRoomGuard(
  p: Project,
  roomId: string,
): { reason: string; suggestion?: string } | null {
  const r = p.rooms.find((x) => x.id === roomId);
  if (!r) return { reason: "Нет такого помещения." };
  if (r.type === "kitchen-living" && p.rooms.filter((x) => x.type === "kitchen-living").length <= 1)
    return {
      reason: "Кухня-гостиная — ядро дома, последнюю убрать нельзя",
      suggestion: "Её можно уменьшить кнопкой «кухня меньше» (не меньше 2 кубиков).",
    };
  if (r.type === "hall" && p.rooms.some((x) => x.tier === 2 && x.id !== r.id))
    return {
      reason: "Холл с лестницей нельзя убрать, пока на втором ярусе есть комнаты",
      suggestion: "Сначала уберите комнаты второго яруса.",
    };
  if (r.type === "wet-core" && r.tier === 1) {
    const left = p.rooms.filter((x) => x.type === "wet-core" && x.tier === 1 && x.id !== r.id);
    if (!left.length)
      return {
        reason:
          "Это единственный санузел первого яруса — в нём стояк и бойлер, без него дом не сдать",
        suggestion: "Уберите другой санузел, если их несколько.",
      };
  }
  return null;
}

export function applyCommand(p: Project, c: EditorCommand): CommandResult {
  switch (c.op) {
    case "door":
      return applyDoor(p, c);
    case "place_house":
      if (!p.plot) return reject("Сначала задайте участок: размер и где север.");
      return commit(
        p,
        {
          ...p,
          placementMm: { xMm: Math.round(c.xMm / 10) * 10, yMm: Math.round(c.yMm / 10) * 10 },
          placementLocked: true,
        },
        "Дом поставлен на участке.",
      );
    case "rotate_house": {
      let q = p;
      for (let i = 0; i < c.deg / 90; i++) q = rotateHouse90(q);
      return commit(p, q, `Дом повёрнут на ${c.deg}°.`);
    }
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
      const guard = removeRoomGuard(p, r.id);
      if (guard) return reject(guard.reason, [], guard.suggestion);
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
  {
    type: "function",
    name: "edit_door",
    description:
      "Наружная дверь: add — добавить (выход на террасу), move — перенести главный вход на эту стену, remove — убрать, set — сменить размер. preset: single 800, wide 1000, double 1200.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "move", "remove", "set"] },
        side,
        roomId: { type: "string" },
        moduleId: { type: "string" },
        preset: { type: "string", enum: Object.keys(DOOR_PRESETS) },
      },
      required: ["action", "side"],
    },
  },
  {
    type: "function",
    name: "place_house",
    description: "Поставить дом на участке: смещение от юго-западного угла участка, мм.",
    parameters: {
      type: "object",
      properties: { xMm: { type: "integer" }, yMm: { type: "integer" } },
      required: ["xMm", "yMm"],
    },
  },
  {
    type: "function",
    name: "rotate_house",
    description: "Повернуть дом на участке на 90, 180 или 270 градусов.",
    parameters: {
      type: "object",
      properties: { deg: { type: "integer", enum: [90, 180, 270] } },
      required: ["deg"],
    },
  },
] as const;

/** Вызов инструмента от модели → команда редактора. */
export function toolCallToCommand(name: string, args: unknown): ReturnType<typeof parseCommand> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const op = name === "edit_window" ? "window" : name === "edit_door" ? "door" : name;
  return parseCommand({ ...a, op });
}
