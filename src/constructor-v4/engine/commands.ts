/**
 * Типизированные команды редактора. Голос и текст (InWorld realtime / чат LLM)
 * вызывают инструменты из COMMAND_TOOLS, вызов превращается в EditorCommand,
 * команда применяется детерминированно и проверяется правилами. Нарушает
 * hard-правило — не применяется, человек слышит объяснение и, если есть,
 * ближайшую допустимую альтернативу. Успех всегда несёт дифф (edit-core.ts).
 */
import { FINISHES, GRAMMAR, findFinish, findStyle } from "../grammar/index.ts";
import type { FinishCategory } from "../grammar/index.ts";
import { SIDES, footprint, supportOf } from "./geometry.ts";
import {
  WINDOW_PRESETS,
  faceStart,
  freeSegments,
  placeWindow,
  presetOf,
  rederive,
  type WindowPreset,
} from "./derive.ts";
import { compassOf, modulesOnTier, roomOf } from "./rules.ts";
import { applyStyleProfile, styleProfileFromText } from "./style.ts";
import { carportPlace } from "./site.ts";
import {
  SIDE_FROM,
  SIDE_ON,
  attachCubes,
  commit,
  reject,
  type CommandResult,
} from "./edit-core.ts";
import {
  ROOM_KINDS,
  addModule,
  addRoom,
  addSecondTier,
  doorModules,
  editWindows,
  extendRoom,
  moveRoom,
  orientLivingSouth,
  removeCube,
  removeModule,
  removeRoom,
  removeRoomGuard,
  removeSecondTier,
  resizeHouse,
  rotateHouse,
  rotateHouse90,
  toKind,
  type RoomKind,
} from "./house-ops.ts";
import type { ModulePlacement, Opening, Project, RoomPurpose, Side } from "./types.ts";

export type { CommandResult } from "./edit-core.ts";
export { diffProjects, type ChangeDiff } from "./edit-core.ts";
export { removeRoomGuard, rotateHouse90 };
export type { RoomKind };

export type WindowAction = "add" | "remove" | "enlarge" | "shrink" | "set";

export interface WindowCommand {
  op: "window";
  action: WindowAction;
  /** Сторона дома (N/E/S/W). Нет стороны — все стены комнаты. */
  side?: Side;
  roomId?: string;
  /** Вид комнаты вместо id: «в спальне» — все спальни. */
  room?: RoomKind;
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
  room?: RoomKind;
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

export type TerraceAction = "add" | "extend" | "shrink" | "remove" | "move";
export type SupportMethod = "column" | "terrace" | "cube";

export type EditorCommand =
  | {
      op: "add_room";
      room: RoomKind | "wet-core";
      tier?: number;
      side?: Side;
      purpose?: RoomPurpose;
    }
  | { op: "remove_room"; roomId?: string; room?: RoomKind; side?: Side; tier?: number }
  | { op: "move_room"; roomId?: string; room?: RoomKind; side: Side; tier?: number }
  | { op: "resize_room"; roomId: string; modules: number }
  | { op: "add_cube"; side?: Side; roomId?: string; room?: RoomKind }
  | { op: "remove_cube"; side?: Side; moduleId?: string; roomId?: string; room?: RoomKind }
  | { op: "add_module"; side?: Side; rooms?: RoomKind[]; tier?: number }
  | { op: "remove_module"; side?: Side; moduleId?: string }
  | { op: "add_second_tier"; bedrooms?: number; whole?: boolean; moveBedrooms?: boolean }
  | { op: "remove_second_tier"; cubes?: number; keepRooms?: boolean }
  | { op: "resize_house"; deltaM2: number; side?: Side }
  | { op: "orient_house"; target: "living-south" }
  | { op: "terrace"; action: TerraceAction; side?: Side; m2?: number }
  | { op: "carport"; action: "add" | "remove"; side?: Side }
  | { op: "support_overhang"; method: SupportMethod; side?: Side }
  | { op: "move_terrace"; side: Side }
  | { op: "set_overhang"; side: Side; mm: number }
  | { op: "shift_upper_tier"; dxMm: number; dyMm: number }
  | { op: "set_style"; style: string }
  | { op: "set_finish"; category: FinishCategory; finishId: string }
  | { op: "describe_style"; text: string }
  | { op: "place_house"; xMm: number; yMm: number }
  | { op: "rotate_house"; deg: 90 | 180 | 270 }
  | OpeningCommand;

// ── Разбор входа ─────────────────────────────────────────────────────────

const isSide = (x: unknown): x is Side => typeof x === "string" && (SIDES as string[]).includes(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 500;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const CATS: FinishCategory[] = ["facade", "roof", "windowFrames", "interior"];
const optSide = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : x);
const PURPOSES: RoomPurpose[] = ["elderly", "elderly-guest"];

type Parsed = { ok: true; command: EditorCommand } | { ok: false; error: string };

/** Проверка формы команды от LLM: значения enum провайдер не валидирует сам. */
export function parseCommand(input: unknown): Parsed {
  if (!input || typeof input !== "object") return { ok: false, error: "Команда — не объект" };
  const c = input as Record<string, unknown>;
  const bad = (f: string) => ({ ok: false as const, error: `Неверное поле ${f}` });
  const ok = (command: EditorCommand): Parsed => ({ ok: true, command });
  // Общие необязательные поля: сторона, комната (id или вид), кубик.
  const side = optSide(c.side);
  if (side !== undefined && !isSide(side)) return bad("side");
  const room =
    c.room === undefined || c.room === null || c.room === ""
      ? undefined
      : (toKind(c.room) ?? undefined);
  if (c.room !== undefined && c.room !== null && c.room !== "" && !room) return bad("room");
  for (const f of ["roomId", "moduleId"] as const)
    if (c[f] !== undefined && c[f] !== null && c[f] !== "" && !isStr(c[f])) return bad(f);
  const roomId = isStr(c.roomId) ? c.roomId : undefined;
  const moduleId = isStr(c.moduleId) ? c.moduleId : undefined;
  const tier = c.tier === undefined || c.tier === null ? undefined : Number(c.tier);
  if (tier !== undefined && !Number.isFinite(tier)) return bad("tier");

  switch (c.op) {
    case "add_room":
      if (!room) return bad("room");
      if (c.purpose !== undefined && !PURPOSES.includes(c.purpose as RoomPurpose))
        return bad("purpose");
      return ok({
        op: "add_room",
        room,
        tier,
        side,
        purpose: c.purpose as RoomPurpose | undefined,
      });
    case "remove_room":
      if (!roomId && !room) return bad("roomId/room");
      return ok({ op: "remove_room", roomId, room, side, tier });
    case "move_room":
      if (!roomId && !room) return bad("roomId/room");
      if (!side) return bad("side");
      return ok({ op: "move_room", roomId, room, side, tier });
    case "resize_room":
      if (!roomId) return bad("roomId");
      return isNum(c.modules)
        ? ok({ op: "resize_room", roomId, modules: c.modules })
        : bad("modules");
    case "add_cube":
      return ok({ op: "add_cube", side, roomId, room });
    case "remove_cube":
      return ok({ op: "remove_cube", side, moduleId, roomId, room });
    case "add_module": {
      const rooms = Array.isArray(c.rooms) ? c.rooms.map(toKind) : undefined;
      if (rooms && rooms.some((r) => !r)) return bad("rooms");
      if (tier !== undefined && tier !== 1 && tier !== 2) return bad("tier");
      return ok({ op: "add_module", side, rooms: rooms as RoomKind[] | undefined, tier });
    }
    case "remove_module":
      return ok({ op: "remove_module", side, moduleId });
    case "add_second_tier":
      if (c.bedrooms !== undefined && !isNum(c.bedrooms)) return bad("bedrooms");
      return ok({
        op: "add_second_tier",
        bedrooms: c.bedrooms as number | undefined,
        whole: c.whole === true,
        moveBedrooms: c.moveBedrooms === true,
      });
    case "remove_second_tier":
      if (c.cubes !== undefined && !isNum(c.cubes)) return bad("cubes");
      return ok({
        op: "remove_second_tier",
        cubes: c.cubes as number | undefined,
        keepRooms: c.keepRooms !== false,
      });
    case "resize_house": {
      const d = Number(c.deltaM2);
      if (!Number.isFinite(d) || d === 0) return bad("deltaM2");
      return ok({ op: "resize_house", deltaM2: Math.max(-80, Math.min(80, d)), side });
    }
    case "orient_house":
      return ok({ op: "orient_house", target: "living-south" });
    case "terrace": {
      if (!["add", "extend", "shrink", "remove", "move"].includes(c.action as string))
        return bad("action");
      if (c.action === "move" && !side) return bad("side");
      if (c.m2 !== undefined && !isNum(c.m2)) return bad("m2");
      return ok({
        op: "terrace",
        action: c.action as TerraceAction,
        side,
        m2: c.m2 as number | undefined,
      });
    }
    case "carport":
      if (c.action !== "add" && c.action !== "remove") return bad("action");
      return ok({ op: "carport", action: c.action, side });
    case "support_overhang":
      if (!["column", "terrace", "cube"].includes(c.method as string)) return bad("method");
      return ok({ op: "support_overhang", method: c.method as SupportMethod, side });
    case "move_terrace":
      return side ? ok({ op: "move_terrace", side }) : bad("side");
    case "set_overhang":
      if (!side) return bad("side");
      return isNum(c.mm) ? ok({ op: "set_overhang", side, mm: c.mm }) : bad("mm");
    case "shift_upper_tier":
      return isNum(c.dxMm) && isNum(c.dyMm)
        ? ok({ op: "shift_upper_tier", dxMm: c.dxMm, dyMm: c.dyMm })
        : bad("dxMm/dyMm");
    case "set_style":
      return isStr(c.style) ? ok({ op: "set_style", style: c.style }) : bad("style");
    case "set_finish":
      if (!CATS.includes(c.category as FinishCategory)) return bad("category");
      return isStr(c.finishId)
        ? ok({ op: "set_finish", category: c.category as FinishCategory, finishId: c.finishId })
        : bad("finishId");
    case "describe_style":
      return isStr(c.text) ? ok({ op: "describe_style", text: c.text }) : bad("text");
    case "window": {
      if (!["add", "remove", "enlarge", "shrink", "set"].includes(c.action as string))
        return bad("action");
      if (c.preset !== undefined && c.preset !== null && !((c.preset as string) in WINDOW_PRESETS))
        return bad("preset");
      if (!side && !roomId && !room && !moduleId) return bad("side/room");
      return ok({
        op: "window",
        action: c.action as WindowAction,
        side,
        roomId,
        room,
        moduleId,
        preset: (c.preset ?? undefined) as WindowPreset | undefined,
      });
    }
    case "door": {
      if (!["add", "move", "remove", "set"].includes(c.action as string)) return bad("action");
      if (!side) return bad("side");
      if (c.preset !== undefined && c.preset !== null && !((c.preset as string) in DOOR_PRESETS))
        return bad("preset");
      return ok({
        op: "door",
        action: c.action as DoorAction,
        side,
        roomId,
        room,
        moduleId,
        preset: (c.preset ?? undefined) as DoorPreset | undefined,
      });
    }
    case "place_house":
      return isNum(c.xMm) && isNum(c.yMm)
        ? ok({ op: "place_house", xMm: c.xMm, yMm: c.yMm })
        : bad("xMm/yMm");
    case "rotate_house":
      return c.deg === 90 || c.deg === 180 || c.deg === 270
        ? ok({ op: "rotate_house", deg: c.deg })
        : bad("deg");
    default:
      return { ok: false, error: `Неизвестная команда ${String(c.op)}` };
  }
}

// ── Применение ──────────────────────────────────────────────────────────

let seq = 0;

/** Где ещё у этой цели есть место под дверь: подсказка и кнопка-альтернатива. */
function doorAlternative(p: Project, c: DoorCommand, widthMm: number) {
  const free = SIDES.filter(
    (f) =>
      f !== c.side &&
      doorModules(p, { ...c, side: f }).some((m) =>
        freeSegments(p, m, f).some(([a, b]) => b - a >= widthMm),
      ),
  );
  return free.length
    ? {
        suggestion: `${SIDE_ON[free[0]].charAt(0).toUpperCase()}${SIDE_ON[free[0]].slice(1)} получится.`,
        alternative: {
          text: `${c.action === "move" ? "Вход" : "Дверь"} ${SIDE_ON[free[0]]}?`,
          command: { ...c, side: free[0] },
        },
      }
    : {};
}

function applyDoor(p: Project, c: DoorCommand): CommandResult {
  const mods = doorModules(p, c);
  const preset = DOOR_PRESETS[c.preset ?? "single"];
  if (!mods.length)
    return {
      ...reject(
        c.roomId || c.room || c.moduleId
          ? `Наружная дверь — только в наружной стене первого яруса; ${SIDE_ON[c.side]} у этого помещения такой стены нет.`
          : `${SIDE_ON[c.side]} на первом ярусе нет наружной стены.`,
      ),
      ...doorAlternative(p, c, preset.widthMm),
    };
  const roomIdOf = (m: ModulePlacement) => roomOf(p, m.id)?.id ?? "";
  const doorsHere = p.openings.filter(
    (o) => o.kind === "entrance" && o.face === c.side && mods.some((m) => m.id === o.moduleId),
  );
  let openings = [...p.openings];
  if (c.action === "remove" || c.action === "set") {
    if (!doorsHere.length) return reject(`${SIDE_ON[c.side]} наружной двери нет.`);
    openings = openings.filter((o) => !doorsHere.some((d) => d.id === o.id));
    if (c.action === "remove")
      return commit(p, { ...p, openings }, `Дверь ${SIDE_ON[c.side]} убрана.`);
  }
  // Перенос входа: старый главный вход убирается.
  if (c.action === "move") {
    if (
      p.openings.some((o) => o.kind === "entrance" && o.face === c.side) &&
      !c.roomId &&
      !c.room &&
      !c.moduleId
    )
      return reject(`Вход и так ${SIDE_ON[c.side]}.`);
    openings = openings.filter((o) => o.kind !== "entrance");
  }
  const label =
    c.action === "move" ? "Вход" : preset.label.charAt(0).toUpperCase() + preset.label.slice(1);
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
        const res = commit(
          p,
          { ...p, openings: next },
          `${label} ${SIDE_ON[c.side]}, окно рядом ужато.`,
        );
        if (res.ok) return res;
        continue;
      }
    }
    if (!seg) continue;
    const res = commit(
      p,
      {
        ...p,
        openings: [
          ...openings,
          {
            id: `door-${++seq}`,
            moduleId: m.id,
            roomId: roomIdOf(m),
            face: c.side,
            kind: "entrance",
            widthMm: preset.widthMm,
            heightMm: preset.heightMm,
            offsetMm: seg[0] - faceStart(m, c.side),
            userSet: true,
          },
        ],
      },
      `${label} ${SIDE_ON[c.side]}.`,
    );
    if (res.ok) return res;
  }
  return {
    ...reject(
      `Дверь ${preset.widthMm} мм ${SIDE_ON[c.side]} не помещается: там стык с соседним кубиком или нет простенков.`,
    ),
    ...doorAlternative(p, c, preset.widthMm),
  };
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

function applyTerrace(
  p: Project,
  c: { action: TerraceAction; side?: Side; m2?: number },
): CommandResult {
  const side = c.side ?? p.terrace.side;
  const deck = p.terraceOff ? 0 : p.terrace.deckM2;
  const step = Math.max(2, Math.min(60, c.m2 ?? 10));
  switch (c.action) {
    case "remove":
      if (p.terraceOff || p.terrace.totalM2 === 0) return reject("Террасы и так нет.");
      return commit(p, rederive({ ...p, terraceOff: true }, side), "Терраса убрана.");
    case "add":
      return commit(
        p,
        rederive({ ...p, terraceOff: false, terraceDeckM2: c.m2 ?? p.terraceDeckM2 }, side),
        `Терраса ${SIDE_ON[side]}.`,
      );
    case "move":
      return commit(
        p,
        rederive({ ...p, terraceOff: false }, side),
        `Терраса перенесена ${SIDE_ON[side]}.`,
      );
    case "extend":
      return commit(
        p,
        rederive({ ...p, terraceOff: false, terraceDeckM2: Math.round(deck + step) }, side),
        `Терраса больше на ${step} м².`,
      );
    case "shrink": {
      const next = Math.max(0, Math.round(deck - step));
      return commit(
        p,
        rederive({ ...p, terraceDeckM2: next }, side),
        `Терраса меньше на ${Math.min(step, deck)} м².`,
      );
    }
  }
}

function applyCarport(p: Project, c: { action: "add" | "remove"; side?: Side }): CommandResult {
  if (c.action === "remove") {
    if (!p.household?.car) return reject("Навеса для машины и так нет.");
    return commit(
      p,
      { ...p, household: { ...p.household, car: false }, carportSide: undefined },
      "Навес для машины убран.",
    );
  }
  const next: Project = {
    ...p,
    household: { ...(p.household ?? {}), car: true },
    carportSide: c.side ?? p.carportSide,
  };
  const place = carportPlace(next);
  if (!place)
    return reject(
      "Навес 3,5 × 6 м на участке не помещается — участок мал или дом стоит вплотную к отступам.",
    );
  if (c.side && place.side !== c.side)
    return {
      ...reject(`${SIDE_FROM[c.side]} навес на участке не помещается.`),
      suggestion: `Помещается ${SIDE_FROM[place.side]}.`,
      alternative: {
        text: `Навес ${SIDE_FROM[place.side]}?`,
        command: { op: "carport", action: "add", side: place.side },
      },
    };
  return commit(p, next, `Навес для машины ${SIDE_FROM[place.side]}.`);
}

/** Опора под свесом второго яруса: колонны, терраса с колоннами или кубик первого яруса под свесом. */
function applySupport(p: Project, c: { method: SupportMethod; side?: Side }): CommandResult {
  const upper = modulesOnTier(p, 2);
  if (!upper.length) return reject("Второго яруса нет — подпирать нечего.");
  const t1 = modulesOnTier(p, 1);
  const over: Record<Side, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const u of upper) {
    const s = supportOf(u, t1);
    for (const f of SIDES) over[f] = Math.max(over[f], s.overhangMm[f]);
  }
  const worst = [...SIDES].sort((a, b) => over[b] - over[a])[0];
  const side = c.side ?? worst;
  if (over[side] <= 0)
    return over[worst] > 0
      ? {
          ...reject(`${SIDE_FROM[side]} второй ярус не нависает.`),
          suggestion: `Нависает ${SIDE_FROM[worst]} на ${(over[worst] / 1000).toFixed(1)} м.`,
          alternative: {
            text: `Подпереть свес ${SIDE_FROM[worst]}?`,
            command: { op: "support_overhang", method: c.method, side: worst },
          },
        }
      : reject("Второй ярус целиком стоит на первом — свеса нет, подпирать нечего.");
  const supports = [...new Set([...(p.overhangSupports ?? []), side])];
  if (c.method === "column")
    return commit(
      p,
      { ...p, overhangSupports: supports },
      `Под свесом ${SIDE_FROM[side]} — колонны.`,
    );
  if (c.method === "terrace") {
    const len = (() => {
      const r = upper.map(footprint);
      return side === "N" || side === "S"
        ? (Math.max(...r.map((x) => x.x1)) - Math.min(...r.map((x) => x.x0))) / 1000
        : (Math.max(...r.map((x) => x.y1)) - Math.min(...r.map((x) => x.y0))) / 1000;
    })();
    const need = Math.ceil((over[side] / 1000) * len + 6);
    const deck = Math.max(p.terraceOff ? 0 : p.terrace.deckM2, need);
    return commit(
      p,
      rederive({ ...p, terraceOff: false, terraceDeckM2: deck, overhangSupports: supports }, side),
      `Терраса ${SIDE_ON[side]} под свесом второго яруса, свес стоит на колоннах по террасе.`,
    );
  }
  // Кубик первого яруса прямо под нависающим модулем.
  const hanging = upper.filter((u) => supportOf(u, t1).overhangMm[side] > 0);
  let best: Project | null = null;
  for (const u of hanging) {
    const k = p.rooms.find((r) => r.type === "kitchen-living");
    const next = attachCubes(p, {
      count: 1,
      tier: 1,
      side,
      assign: (proj, cubes) => {
        const cube = cubes[0];
        const kitchenTouch =
          k &&
          proj.modules.some(
            (m) =>
              k.moduleIds.includes(m.id) &&
              Math.abs(m.yMm - cube.yMm) + Math.abs(m.xMm - cube.xMm) <=
                GRAMMAR.module.externalMm.w + GRAMMAR.module.externalMm.d,
          );
        if (kitchenTouch && k)
          return {
            ...proj,
            modules: proj.modules.map((m) => (m.id === cube.id ? { ...m, roomId: k.id } : m)),
            rooms: proj.rooms.map((r) =>
              r.id === k.id ? { ...r, moduleIds: [...r.moduleIds, cube.id] } : r,
            ),
          };
        const id = `storage-${++seq}`;
        return {
          ...proj,
          modules: proj.modules.map((m) => (m.id === cube.id ? { ...m, roomId: id } : m)),
          rooms: [
            ...proj.rooms,
            {
              id,
              type: "storage",
              tier: 1,
              moduleIds: [cube.id],
              subRooms: ["постирочная", "кладовая"],
            },
          ],
        };
      },
    });
    if (!next) continue;
    // Кубик должен реально подпереть свес.
    const uu = next.modules.find((m) => m.id === u.id)!;
    if (supportOf(uu, modulesOnTier(next, 1)).overhangMm[side] >= over[side]) continue;
    best = next;
    break;
  }
  if (!best)
    return {
      ...reject(`Кубик под свесом ${SIDE_FROM[side]} не встаёт по правилам.`),
      suggestion: "Можно поставить колонны или террасу под свес.",
      alternative: {
        text: `Поставить колонны под свес ${SIDE_FROM[side]}?`,
        command: { op: "support_overhang", method: "column", side },
      },
    };
  return commit(
    p,
    best,
    `Под свесом ${SIDE_FROM[side]} — кубик первого яруса, второй ярус опирается на него.`,
  );
}

export function applyCommand(p: Project, c: EditorCommand): CommandResult {
  switch (c.op) {
    case "door":
      return applyDoor(p, c);
    case "window":
      return editWindows(p, c);
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
    case "rotate_house":
      return rotateHouse(p, c.deg);
    case "orient_house":
      return orientLivingSouth(p);
    case "add_room": {
      const kind = toKind(c.room);
      if (!kind) return reject("Не знаю такого помещения.");
      return addRoom(p, { room: kind, tier: c.tier, side: c.side, purpose: c.purpose });
    }
    case "remove_room":
      return removeRoom(p, c);
    case "move_room":
      return moveRoom(p, c);
    case "add_cube":
      return extendRoom(p, c);
    case "remove_cube":
      return removeCube(p, c);
    case "add_module":
      return addModule(p, c);
    case "remove_module":
      return removeModule(p, c);
    case "add_second_tier":
      return addSecondTier(p, c);
    case "remove_second_tier":
      return removeSecondTier(p, c);
    case "resize_house":
      return resizeHouse(p, c);
    case "terrace":
      return applyTerrace(p, c);
    case "carport":
      return applyCarport(p, c);
    case "support_overhang":
      return applySupport(p, c);
    case "resize_room": {
      const r = p.rooms.find((x) => x.id === c.roomId);
      if (!r) return reject("Нет такого помещения.");
      const cur = r.moduleIds.length;
      if (c.modules === cur) return reject("Размер и так такой.");
      if (c.modules > cur) {
        let proj: Project = p;
        for (let i = cur; i < c.modules; i++) {
          const res = extendRoom(proj, { roomId: r.id });
          if (!res.ok)
            return i === cur
              ? res
              : commit(p, proj, "Помещение увеличено, но не на столько, сколько просили.");
          proj = res.project;
        }
        return commit(p, proj, "Помещение увеличено.");
      }
      let proj: Project = p;
      for (let i = cur; i > c.modules; i--) {
        const res = removeCube(proj, { roomId: r.id });
        if (!res.ok)
          return i === cur
            ? res
            : commit(p, proj, "Помещение уменьшено, но не на столько, сколько просили.");
        proj = res.project;
      }
      return commit(p, proj, "Помещение уменьшено.");
    }
    case "move_terrace":
      return commit(
        p,
        rederive({ ...p, terraceOff: false }, c.side),
        `Терраса перенесена ${SIDE_ON[c.side]}.`,
      );
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
        `Свес второго яруса ${SIDE_FROM[c.side]}: ${(c.mm / 1000).toFixed(2)} м.`,
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
          // Профиль из слов больше не правит цвет — стиль выбран целиком.
          styleProfile: undefined,
        },
        `Стиль: ${s.label}.`,
      );
    }
    case "set_finish": {
      const f = findFinish(c.category, c.finishId);
      if (!f) return reject("Такой отделки в каталоге нет.");
      return commit(
        p,
        {
          ...p,
          finishes: { ...p.finishes, [c.category]: f.id },
          styleProfile: c.category === "facade" ? undefined : p.styleProfile,
        },
        `${f.label}.`,
      );
    }
    case "describe_style": {
      const prof = styleProfileFromText(c.text);
      const hasNamed = Object.values(prof.finishes).some(Boolean);
      if (!hasNamed && prof.confidence < 0.34)
        return reject(
          "Не понял стиль по описанию. Назовите материал фасада (штукатурка, дерево, бетон, металл) или цвет.",
        );
      // Минимальная правка: меняем только названные отделки («фасад светлее» — только фасад).
      // Стиль целиком — только если человек назвал стиль и ни одной отделки.
      const named = Object.entries(prof.finishes).filter(([, v]) => !!v) as [
        FinishCategory,
        string,
      ][];
      const finishes = named.length
        ? named.reduce((f, [k, v]) => (findFinish(k, v) ? { ...f, [k]: v } : f), { ...p.finishes })
        : applyStyleProfile(p.finishes, prof);
      const what = named.map(([k, v]) => findFinish(k, v)?.label ?? v).join(", ");
      return commit(
        p,
        { ...p, finishes, styleProfile: prof },
        named.length
          ? `Отделка: ${what}.`
          : `Стиль: ${findStyle(prof.matchedStyleId ?? "")?.label ?? "по описанию"}.`,
      );
    }
  }
}

// ── Инструменты для голоса и чата (function calling) ────────────────────

const side = {
  type: "string",
  enum: SIDES,
  description: "Сторона света: N север, E восток, S юг, W запад",
};
const roomKind = {
  type: "string",
  enum: ROOM_KINDS,
  description:
    "bedroom спальня, study кабинет, bath санузел, sauna сауна, storage кладовая-постирочная, living кухня-гостиная",
};
const roomId = {
  type: "string",
  description: "id комнаты из «Помещения» в контексте (если назвали конкретную)",
};

/** Описания инструментов в формате function-calling (InWorld realtime / OpenAI-совместимый). */
export const COMMAND_TOOLS = [
  {
    type: "function",
    name: "add_room",
    description:
      "Добавить комнату в один кубик (3,2×3,4 м): спальню, кабинет, санузел, сауну, кладовую. side — с какой стороны дома пристроить, tier 2 — на второй ярус. living — то же, что сделать кухню-гостиную больше.",
    parameters: {
      type: "object",
      properties: { room: roomKind, side, tier: { type: "integer", enum: [1, 2] } },
      required: ["room"],
    },
  },
  {
    type: "function",
    name: "remove_room",
    description:
      "Удалить комнату: по id или по виду (room) — «убери спальню», «удали сауну». side — какую именно (самую южную и т. п.).",
    parameters: { type: "object", properties: { roomId, room: roomKind, side }, required: [] },
  },
  {
    type: "function",
    name: "move_room",
    description: "Перенести комнату на другую сторону дома: «перенеси спальню на север».",
    parameters: {
      type: "object",
      properties: { roomId, room: roomKind, side },
      required: ["side"],
    },
  },
  {
    type: "function",
    name: "resize_room",
    description:
      "Сделать комнату больше или меньше: число кубиков. Кухня-гостиная 2–5, спальня 1–2 (2 — с гардеробной).",
    parameters: {
      type: "object",
      properties: { roomId, modules: { type: "integer", minimum: 1, maximum: 5 } },
      required: ["roomId", "modules"],
    },
  },
  {
    type: "function",
    name: "add_cube",
    description:
      "Добавить один кубик к комнате (по умолчанию к кухне-гостиной) с нужной стороны: «гостиную больше на кубик с юга».",
    parameters: { type: "object", properties: { side, roomId, room: roomKind }, required: [] },
  },
  {
    type: "function",
    name: "remove_cube",
    description:
      "Убрать один кубик: самый выдвинутый в сторону side, или кубик комнаты (roomId/room).",
    parameters: {
      type: "object",
      properties: { side, roomId, room: roomKind, moduleId: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    name: "add_module",
    description:
      'Добавить заводской модуль — два кубика (≈22 м²) с нужной стороны. rooms — что в двух кубиках, по умолчанию две спальни; ["living","living"] — расширить гостиную.',
    parameters: {
      type: "object",
      properties: {
        side,
        rooms: { type: "array", items: roomKind, maxItems: 2 },
        tier: { type: "integer", enum: [1, 2] },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "remove_module",
    description: "Убрать заводской модуль (два кубика) — самый выдвинутый в сторону side.",
    parameters: { type: "object", properties: { side }, required: [] },
  },
  {
    type: "function",
    name: "add_second_tier",
    description:
      "Добавить второй этаж: холл с лестницей над гостиной и спальни наверху. bedrooms — сколько спален (по умолчанию 2); whole — на весь дом; moveBedrooms — перенести спальни первого этажа наверх (дом станет компактнее).",
    parameters: {
      type: "object",
      properties: {
        bedrooms: { type: "integer", minimum: 1, maximum: 6 },
        whole: { type: "boolean" },
        moveBedrooms: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "remove_second_tier",
    description:
      "Убрать второй этаж: спальни переезжают вниз. cubes — убрать только часть (столько кубиков).",
    parameters: {
      type: "object",
      properties: { cubes: { type: "integer", minimum: 1 } },
      required: [],
    },
  },
  {
    type: "function",
    name: "resize_house",
    description:
      "Сделать весь дом больше или меньше на deltaM2 м² (плюс — больше, минус — меньше; кубик ≈ 11 м²). Решатель сам выбирает, что пристроить или убрать. Без числа: ±22.",
    parameters: {
      type: "object",
      properties: { deltaM2: { type: "number" }, side },
      required: ["deltaM2"],
    },
  },
  {
    type: "function",
    name: "rotate_house",
    description: "Развернуть дом на участке на 90, 180 или 270 градусов.",
    parameters: {
      type: "object",
      properties: { deg: { type: "integer", enum: [90, 180, 270] } },
      required: ["deg"],
    },
  },
  {
    type: "function",
    name: "orient_house",
    description: "Развернуть дом так, чтобы гостиная и её окна смотрели на юг.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "edit_window",
    description:
      "Окна. action: add добавить, remove убрать, enlarge больше, shrink меньше, set задать размер (preset). Цель: side — весь фасад с этой стороны; room/roomId — окна этой комнаты (side можно не указывать — все её окна). preset: slot щель, small небольшое, standard обычное, large большое 2800, floor-to-ceiling панорама в пол.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "enlarge", "shrink", "set"] },
        side,
        room: roomKind,
        roomId,
        moduleId: { type: "string" },
        preset: { type: "string", enum: Object.keys(WINDOW_PRESETS) },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "edit_door",
    description:
      "Наружная дверь: move — перенести главный вход на эту сторону, add — добавить дверь (выход на террасу), remove — убрать, set — сменить размер. preset: single 800, wide 1000, double 1200.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "move", "remove", "set"] },
        side,
        room: roomKind,
        roomId,
        preset: { type: "string", enum: Object.keys(DOOR_PRESETS) },
      },
      required: ["action", "side"],
    },
  },
  {
    type: "function",
    name: "edit_terrace",
    description:
      "Терраса: add добавить, extend больше (m2), shrink меньше (m2), remove убрать, move перенести на side.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "extend", "shrink", "remove", "move"] },
        side,
        m2: { type: "number" },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "carport",
    description:
      "Навес для машины на участке: add поставить (side — с какой стороны дома), remove убрать.",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["add", "remove"] }, side },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "support_overhang",
    description:
      "Подпереть нависающий второй ярус, чтобы не висел в воздухе: column — колонны, terrace — терраса под свесом с колоннами, cube — кубик первого яруса под свесом. side — с какой стороны свес (по умолчанию самый большой).",
    parameters: {
      type: "object",
      properties: { method: { type: "string", enum: ["column", "terrace", "cube"] }, side },
      required: ["method"],
    },
  },
  {
    type: "function",
    name: "set_overhang",
    description:
      "Свес второго яруса на стороне, мм. Без колонны не больше 1500, с колонной до 3000.",
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
      "Выбрать готовый стиль целиком: фирменный ЭкоКуб (белая штукатурка, ламели, графит), скандинавский, японский, рижский, дерево, бетон, хай-тек, минимализм, шале, американский, средиземноморский.",
    parameters: { type: "object", properties: { style: { type: "string" } }, required: ["style"] },
  },
  {
    type: "function",
    name: "set_finish",
    description:
      "Сменить одну отделку. facade: plaster-white, plaster-warm, planken-larch, planken-thermo, fiber-cement, metal-panel, siding-light, planken-dark-stone; roof: flat-membrane, flat-green, flat-exploitable-deck; windowFrames: frame-graphite, frame-black, frame-wood-alu.",
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
      "Описание внешнего вида словами человека: цвет фасада, облицовка, окна, общий вид («фасад светлее, белая штукатурка»).",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
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
] as const;

const TOOL_TO_OP: Record<string, string> = {
  edit_window: "window",
  edit_door: "door",
  edit_terrace: "terrace",
};

/** Сторона света → грань дома (участок может быть повёрнут). */
export function faceForCompass(compass: Side, northDeg = 0): Side {
  return SIDES.find((f) => compassOf(f, northDeg) === compass) ?? compass;
}

/** Вызов инструмента от модели → команда редактора. Стороны — по сторонам света. */
export function toolCallToCommand(name: string, args: unknown, northDeg = 0): Parsed {
  const a = { ...((args && typeof args === "object" ? args : {}) as Record<string, unknown>) };
  if (isSide(a.side) && northDeg) a.side = faceForCompass(a.side, northDeg);
  const op = TOOL_TO_OP[name] ?? name;
  // Голос часто зовёт resize_house без числа — «сделай дом больше».
  if (op === "resize_house" && (a.deltaM2 === undefined || a.deltaM2 === null)) a.deltaM2 = 22;
  return parseCommand({ ...a, op });
}

/** Имена инструментов-команд (для журнала и проверки «сказал — сделал»). */
export const COMMAND_TOOL_NAMES = new Set(COMMAND_TOOLS.map((t) => t.name as string));

export { SIDE_FROM, SIDE_ON };
