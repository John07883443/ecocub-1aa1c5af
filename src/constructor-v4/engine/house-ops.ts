/**
 * Правки ОДНОГО дома голосом и текстом: модули, кубики, комнаты, ярусы, размер,
 * разворот, вход, окна, терраса, навес, опоры под свесом. Каждая правка — через
 * правила (commit), с диффом. Не получилось с этой стороны — ищем ближайшую
 * допустимую альтернативу, Лев предлагает её кнопкой.
 */
import { GRAMMAR, roomSpec } from "../grammar/index.ts";
import { SIDES, footprint, supportOf } from "./geometry.ts";
import {
  PRESET_LADDER,
  WINDOW_PRESETS,
  faceStart,
  freeSegments,
  placeWindow,
  presetOf,
  rederive,
  type WindowPreset,
} from "./derive.ts";
import { compassOf, evaluate, modulesOnTier, roomOf } from "./rules.ts";
import { factoryModules } from "./factory.ts";
import {
  SIDE_FROM,
  SIDE_ON,
  SIDE_TO,
  attachCubes,
  commit,
  cubesRu,
  facesOut,
  houseRect,
  newId,
  outward,
  reject,
  roomLabel,
  type CommandResult,
} from "./edit-core.ts";
import type { ModulePlacement, Opening, Project, Room, RoomPurpose, Side } from "./types.ts";

/** Что можно поставить в кубик голосом. bath = санузел; living — расширить кухню-гостиную. */
export type RoomKind = "bedroom" | "study" | "bath" | "sauna" | "storage" | "living";
export const ROOM_KINDS: RoomKind[] = ["bedroom", "study", "bath", "sauna", "storage", "living"];
export const ROOM_KIND_RU: Record<RoomKind, string> = {
  bedroom: "спальня",
  study: "кабинет",
  bath: "санузел",
  sauna: "сауна",
  storage: "кладовая-постирочная",
  living: "кухня-гостиная",
};

/** Старое имя wet-core и синонимы — к виду комнаты. */
export function toKind(x: unknown): RoomKind | null {
  if (typeof x !== "string") return null;
  const s = x.trim().toLowerCase();
  if ((ROOM_KINDS as string[]).includes(s)) return s as RoomKind;
  if (s === "wet-core" || s === "bathroom") return "bath";
  if (s === "kitchen-living" || s === "kitchen") return "living";
  if (s === "office") return "study";
  if (s === "utility" || s === "laundry") return "storage";
  return null;
}

export function makeRoom(
  kind: Exclude<RoomKind, "living">,
  id: string,
  tier: number,
  moduleIds: string[],
  purpose?: RoomPurpose,
): Room {
  switch (kind) {
    case "bedroom":
      return { id, type: "bedroom", tier, moduleIds, purpose };
    case "study":
      return { id, type: "study", tier, moduleIds };
    case "storage":
      return { id, type: "storage", tier, moduleIds, subRooms: ["постирочная", "кладовая"] };
    case "sauna":
      return { id, type: "wet-core", tier, moduleIds, subRooms: ["сауна", "душ"] };
    case "bath":
      return { id, type: "wet-core", tier, moduleIds, subRooms: ["санузел"] };
  }
}

/** Комната совпадает с видом (санузел ≠ сауна). */
export function roomIsKind(r: Room, kind: RoomKind): boolean {
  switch (kind) {
    case "bath":
      return r.type === "wet-core" && !r.subRooms?.includes("сауна");
    case "sauna":
      return r.type === "wet-core" && !!r.subRooms?.includes("сауна");
    case "living":
      return r.type === "kitchen-living";
    default:
      return r.type === kind;
  }
}

const HUBS = new Set(["kitchen-living", "hall", "corridor"]);
const hubModules = (p: Project, tier: number) =>
  p.modules.filter((m) => m.tier === tier && HUBS.has(roomOf(p, m.id)?.type ?? ""));

/** Расставить новые кубики по видам комнат (living — в общую комнату). */
function assignKinds(kinds: RoomKind[], tier: number, purpose?: RoomPurpose) {
  return (proj: Project, cubes: ModulePlacement[]): Project => {
    let rooms = [...proj.rooms];
    const modules = proj.modules.map((m) => ({ ...m }));
    cubes.forEach((c, i) => {
      const kind = kinds[i] ?? kinds[kinds.length - 1];
      const m = modules.find((x) => x.id === c.id)!;
      if (kind === "living") {
        const k = rooms.find((r) => r.type === "kitchen-living");
        if (k) {
          rooms = rooms.map((r) =>
            r.id === k.id ? { ...r, moduleIds: [...r.moduleIds, c.id] } : r,
          );
          m.roomId = k.id;
          return;
        }
      }
      const real = kind === "living" ? "bedroom" : kind;
      // Две соседние спальни одного запроса — по одной в кубик (спальня = кубик).
      const id = newId(proj, real);
      rooms.push(makeRoom(real, id, tier, [c.id], purpose));
      m.roomId = id;
    });
    return { ...proj, modules, rooms };
  };
}

const sidesByCloseness = (s: Side): Side[] => {
  const i = SIDES.indexOf(s);
  return [SIDES[(i + 1) % 4], SIDES[(i + 3) % 4], SIDES[(i + 2) % 4]];
};

/** Не вышло с этой стороны — пробуем остальные; первая удачная — альтернатива (не применяется). */
function withAlternative(
  res: CommandResult,
  side: Side | undefined,
  retry: (s: Side) => CommandResult,
  command: (s: Side) => unknown,
  what: string | ((s: Side) => string),
): CommandResult {
  if (res.ok || !side) return res;
  const say = (s: Side) => (typeof what === "string" ? `${what} ${SIDE_FROM[s]}` : what(s));
  for (const s of sidesByCloseness(side)) {
    const alt = retry(s);
    if (alt.ok)
      return {
        ...res,
        suggestion: res.suggestion ?? `${say(s)} — получится: ${alt.diff.summary}.`,
        alternative: { text: `${say(s)}?`, command: command(s) },
      };
  }
  return res;
}

// ── Комнаты ─────────────────────────────────────────────────────────────

export function addRoom(
  p: Project,
  c: { room: RoomKind; tier?: number; side?: Side; purpose?: RoomPurpose },
): CommandResult {
  const tier = c.tier ?? 1;
  if (tier > GRAMMAR.tiers.maxTiers || tier < 1)
    return reject(
      `Ярусов не больше ${GRAMMAR.tiers.maxTiers}: третий ярус модули не держат по конструктиву.`,
    );
  if (tier === 2 && !modulesOnTier(p, 2).length)
    return {
      ...reject("Второго яруса пока нет."),
      suggestion: "Могу сначала добавить второй ярус с холлом и спальнями.",
      alternative: {
        text: "Добавить второй ярус?",
        command: { op: "add_second_tier", bedrooms: 1 },
      },
    };
  if (c.room === "living") return extendRoom(p, { room: "living", side: c.side });
  const once = (side?: Side): CommandResult => {
    const anchorIds = hubModules(p, tier).map((m) => m.id);
    const next = attachCubes(p, {
      count: 1,
      tier,
      side,
      anchorIds,
      assign: assignKinds([c.room], tier, c.purpose),
    });
    if (!next)
      return reject(
        `${cap(ROOM_KIND_RU[c.room])} ${side ? SIDE_FROM[side] : ""} не встаёт по правилам.`.replace(
          "  ",
          " ",
        ),
        [
          c.room !== "storage" && c.room !== "bedroom" && c.room !== "study" && tier === 2
            ? "Санузел и сауна второго яруса — только над мокрым модулем первого."
            : "Нужен стык ≥ 1,5 м с общей комнатой или холлом, на участке и без пересечений.",
        ],
      );
    return commit(
      p,
      next,
      `Добавлено: ${ROOM_KIND_RU[c.room]}${side ? ` ${SIDE_FROM[side]}` : ""}${tier === 2 ? " на втором ярусе" : ""}.`,
    );
  };
  return withAlternative(
    once(c.side),
    c.side,
    (s) => once(s),
    (s) => ({ op: "add_room", room: c.room, tier, side: s }),
    cap(ROOM_KIND_RU[c.room]),
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Найти комнату по id, виду и стороне (самую выдвинутую в эту сторону). */
export function findRoom(
  p: Project,
  t: { roomId?: string; room?: RoomKind; side?: Side; tier?: number },
): Room | null {
  if (t.roomId) return p.rooms.find((r) => r.id === t.roomId) ?? null;
  if (!t.room) return null;
  const list = p.rooms.filter((r) => roomIsKind(r, t.room!) && (!t.tier || r.tier === t.tier));
  if (!list.length) return null;
  if (!t.side) return list[list.length - 1];
  const house = houseRect(p);
  const out = (r: Room) =>
    Math.max(
      ...p.modules
        .filter((m) => r.moduleIds.includes(m.id))
        .map((m) => outward(footprint(m), house, t.side!)),
    );
  return [...list].sort((a, b) => out(b) - out(a))[0];
}

export function removeRoomGuard(
  p: Project,
  roomId: string,
): { reason: string; suggestion?: string } | null {
  const r = p.rooms.find((x) => x.id === roomId);
  if (!r) return { reason: "Нет такого помещения." };
  if (r.type === "kitchen-living" && p.rooms.filter((x) => x.type === "kitchen-living").length <= 1)
    return {
      reason: "Кухня-гостиная — ядро дома, последнюю убрать нельзя",
      suggestion: "Её можно уменьшить (не меньше 2 кубиков).",
    };
  if (r.type === "hall" && p.rooms.some((x) => x.tier === 2 && x.id !== r.id))
    return {
      reason: "Холл с лестницей нельзя убрать, пока на втором ярусе есть комнаты",
      suggestion: "Скажите «убери второй этаж» — спальни переедут вниз.",
    };
  if (r.type === "wet-core" && r.tier === 1 && !r.subRooms?.includes("сауна")) {
    const left = p.rooms.filter(
      (x) =>
        x.type === "wet-core" && x.tier === 1 && x.id !== r.id && !x.subRooms?.includes("сауна"),
    );
    if (!left.length)
      return {
        reason:
          "Это единственный санузел первого яруса — в нём стояк и бойлер, без него дом не сдать",
        suggestion: "Уберите другой санузел, если их несколько.",
      };
  }
  return null;
}

function dropModules(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return {
    ...p,
    modules: p.modules.filter((m) => !set.has(m.id)),
    rooms: p.rooms
      .map((r) => ({ ...r, moduleIds: r.moduleIds.filter((id) => !set.has(id)) }))
      .filter((r) => r.moduleIds.length > 0),
    openings: p.openings.filter((o) => !set.has(o.moduleId)),
  };
}

export function removeRoom(
  p: Project,
  t: { roomId?: string; room?: RoomKind; side?: Side; tier?: number },
): CommandResult {
  const r = findRoom(p, t);
  if (!r)
    return reject(t.room ? `${cap(ROOM_KIND_RU[t.room])} в доме нет.` : "Нет такого помещения.");
  const guard = removeRoomGuard(p, r.id);
  if (guard) return reject(guard.reason, [], guard.suggestion);
  const after = rederive(dropModules(p, r.moduleIds), p.terrace.side);
  const res = commit(p, after, `${roomLabel(r)} убрана.`);
  // Не вышло с выбранной — попробовать такую же другую.
  if (!res.ok && !t.roomId && t.room) {
    for (const other of p.rooms.filter((x) => x.id !== r.id && roomIsKind(x, t.room!))) {
      const alt = commit(p, rederive(dropModules(p, other.moduleIds), p.terrace.side), "");
      if (alt.ok)
        return {
          ...res,
          alternative: {
            text: `Убрать другую: ${roomLabel(other).toLowerCase()} ${other.id}?`,
            command: { op: "remove_room", roomId: other.id },
          },
        };
    }
  }
  return res;
}

/** Перенести комнату на другую сторону дома (те же кубики, тот же тип и назначение). */
export function moveRoom(
  p: Project,
  t: { roomId?: string; room?: RoomKind; side: Side; tier?: number },
): CommandResult {
  const r = findRoom(p, { roomId: t.roomId, room: t.room });
  if (!r) return reject("Не понял, какую комнату перенести.");
  if (r.type === "kitchen-living" || r.type === "hall")
    return reject(
      `${roomLabel(r)} — ядро дома, её не переносим; переносим комнаты вокруг неё.`,
      [],
      "Можно развернуть дом целиком.",
    );
  const tier = t.tier ?? r.tier;
  const without = dropModules(p, r.moduleIds);
  const house = houseRect(p, tier);
  const centre = (q: Project, side: Side) => {
    const ms = q.modules.filter((m) => roomOf(q, m.id)?.id === r.id);
    return Math.max(...ms.map((m) => outward(footprint(m), house, side)));
  };
  const once = (side: Side): CommandResult => {
    const now0 = centre(p, side);
    const cands: Project[] = [];
    // 1) Пересадить кубики комнаты к нужной стороне дома.
    const moved = attachCubes(without, {
      count: Math.min(2, r.moduleIds.length) as 1 | 2,
      tier,
      side,
      anchorIds: hubModules(without, tier).map((m) => m.id),
      assign: (proj, cubes) => ({
        ...proj,
        modules: proj.modules.map((m) =>
          cubes.some((c) => c.id === m.id) ? { ...m, roomId: r.id } : m,
        ),
        rooms: [...proj.rooms, { ...r, tier, moduleIds: cubes.map((c) => c.id) }],
      }),
    });
    if (moved) cands.push(moved);
    // 2) Поменяться местами с комнатой, которая стоит с этой стороны (компактный дом не ломается).
    if (r.moduleIds.length === 1) {
      const mr = p.modules.find((m) => m.id === r.moduleIds[0])!;
      for (const mo of p.modules) {
        if (mo.id === mr.id || mo.tier !== mr.tier) continue;
        const o = roomOf(p, mo.id);
        if (!o || o.type === "hall") continue;
        if (
          o.type === r.type &&
          (o.subRooms ?? []).join() === (r.subRooms ?? []).join() &&
          o.purpose === r.purpose
        )
          continue;
        if (outward(footprint(mo), house, side) <= outward(footprint(mr), house, side)) continue;
        const swapped: Project = rederive(
          {
            ...p,
            modules: p.modules.map((m) =>
              m.id === mr.id ? { ...m, roomId: o.id } : m.id === mo.id ? { ...m, roomId: r.id } : m,
            ),
            rooms: p.rooms.map((x) =>
              x.id === r.id
                ? { ...x, moduleIds: [mo.id] }
                : x.id === o.id
                  ? { ...x, moduleIds: x.moduleIds.map((id) => (id === mo.id ? mr.id : id)) }
                  : x,
            ),
            openings: p.openings.filter((x) => x.moduleId !== mr.id && x.moduleId !== mo.id),
          },
          p.terrace.side,
        );
        if (evaluate(swapped).valid) cands.push(swapped);
      }
    }
    const best = cands
      .filter((q) => centre(q, side) > now0 + 1)
      .sort(
        (a, b) =>
          centre(b, side) - centre(a, side) || evaluate(b).softScore - evaluate(a).softScore,
      )[0];
    if (!best)
      return cands.length || now0 >= 0
        ? reject(
            `${roomLabel(r)} и так ${SIDE_ON[side]} — ближе к этой стороне по правилам не встаёт.`,
          )
        : reject(`${roomLabel(r)} ${SIDE_TO[side]} не встаёт по правилам.`);
    const swappedWith = best.rooms.find(
      (x) =>
        x.id !== r.id &&
        p.rooms.find((y) => y.id === x.id)?.moduleIds.join() !== x.moduleIds.join(),
    );
    return commit(
      p,
      best,
      `${roomLabel(r)} перенесена ${SIDE_TO[side]}${swappedWith ? ` (поменялась местами: ${roomLabel(swappedWith).toLowerCase()})` : ""}.`,
    );
  };
  return withAlternative(
    once(t.side),
    t.side,
    once,
    (s) => ({ op: "move_room", roomId: r.id, side: s }),
    (s) => `${roomLabel(r)} — ${SIDE_TO[s]}`,
  );
}

/** Комната больше на один кубик с нужной стороны (кухня-гостиная по умолчанию). */
export function extendRoom(
  p: Project,
  t: { roomId?: string; room?: RoomKind; side?: Side },
): CommandResult {
  const r = findRoom(p, { roomId: t.roomId, room: t.room ?? "living", side: t.side });
  if (!r) return reject("Не понял, какую комнату увеличить.");
  const spec = roomSpec(r.type);
  if (r.moduleIds.length >= spec.modules.max)
    return reject(`${roomLabel(r)} и так максимальная: ${cubesRu(spec.modules.max)}.`);
  const once = (side?: Side): CommandResult => {
    const next = attachCubes(p, {
      count: 1,
      tier: r.tier,
      side,
      anchorIds: r.moduleIds,
      assign: (proj, cubes) => ({
        ...proj,
        modules: proj.modules.map((m) => (m.id === cubes[0].id ? { ...m, roomId: r.id } : m)),
        rooms: proj.rooms.map((x) =>
          x.id === r.id
            ? {
                ...x,
                moduleIds: [...x.moduleIds, cubes[0].id],
                subRooms: x.type === "bedroom" ? ["гардеробная"] : x.subRooms,
              }
            : x,
        ),
      }),
    });
    if (!next)
      return reject(
        `${roomLabel(r)}: увеличить ${side ? SIDE_FROM[side] : ""} не получается по правилам.`,
      );
    return commit(p, next, `${roomLabel(r)} больше на кубик${side ? ` ${SIDE_FROM[side]}` : ""}.`);
  };
  return withAlternative(
    once(t.side),
    t.side,
    once,
    (s) => ({ op: "add_cube", roomId: r.id, side: s }),
    `${roomLabel(r)} больше`,
  );
}

/** Убрать один кубик: самый выдвинутый в сторону side или указанный. */
export function removeCube(
  p: Project,
  t: { side?: Side; moduleId?: string; roomId?: string; room?: RoomKind },
): CommandResult {
  const house = houseRect(p);
  let cands = p.modules;
  if (t.moduleId) cands = cands.filter((m) => m.id === t.moduleId);
  const room =
    t.roomId || t.room ? findRoom(p, { roomId: t.roomId, room: t.room, side: t.side }) : null;
  if (room) cands = cands.filter((m) => room.moduleIds.includes(m.id));
  if (!cands.length) return reject("Не нашёл такой кубик.");
  const order = [...cands].sort((a, b) =>
    t.side
      ? outward(footprint(b), house, t.side) - outward(footprint(a), house, t.side)
      : b.tier - a.tier,
  );
  let first: CommandResult | null = null;
  for (const m of order.slice(0, 8)) {
    const r = roomOf(p, m.id);
    if (r && r.moduleIds.length === 1) {
      const g = removeRoomGuard(p, r.id);
      if (g) {
        first ??= reject(g.reason, [], g.suggestion);
        continue;
      }
    }
    const res = commit(
      p,
      rederive(dropModules(p, [m.id]), p.terrace.side),
      r && r.moduleIds.length === 1
        ? `${roomLabel(r)} убрана вместе с кубиком.`
        : `${roomLabel(r ?? { type: "bedroom" })} меньше на кубик.`,
    );
    if (res.ok) return res;
    first ??= res;
  }
  return first ?? reject("Убрать кубик так, чтобы дом остался в правилах, не получилось.");
}

// ── Модули (пары кубиков) ───────────────────────────────────────────────

export function addModule(
  p: Project,
  c: { side?: Side; rooms?: RoomKind[]; tier?: number },
): CommandResult {
  const tier = c.tier ?? 1;
  const kinds = (c.rooms?.length ? c.rooms : ["bedroom", "bedroom"]) as RoomKind[];
  if (tier === 2 && !modulesOnTier(p, 2).length) return addSecondTier(p, { bedrooms: 2 });
  const once = (side?: Side): CommandResult => {
    const anchorIds = kinds.every((k) => k === "living")
      ? p.rooms.find((r) => r.type === "kitchen-living")?.moduleIds
      : hubModules(p, tier).map((m) => m.id);
    const next = attachCubes(p, {
      count: 2,
      tier,
      side,
      anchorIds,
      assign: assignKinds(kinds, tier),
    });
    if (!next)
      return reject(`Модуль (2 кубика) ${side ? SIDE_FROM[side] : ""} не встаёт по правилам.`);
    return commit(
      p,
      next,
      `Модуль из 2 кубиков добавлен${side ? ` ${SIDE_FROM[side]}` : ""}: ${kinds.map((k) => ROOM_KIND_RU[k]).join(" + ")}.`,
    );
  };
  return withAlternative(
    once(c.side),
    c.side,
    once,
    (s) => ({ op: "add_module", side: s, rooms: kinds, tier }),
    "Модуль",
  );
}

export function removeModule(p: Project, t: { side?: Side; moduleId?: string }): CommandResult {
  const fm = factoryModules(p);
  const house = houseRect(p);
  const pairs = fm.modules
    .map((x) => x.cubeIds as string[])
    .filter((ids) => !t.moduleId || ids.includes(t.moduleId));
  if (!pairs.length) return removeCube(p, t);
  const out = (ids: string[]) =>
    t.side
      ? Math.max(
          ...ids.map((id) =>
            outward(footprint(p.modules.find((m) => m.id === id)!), house, t.side!),
          ),
        )
      : Math.max(...ids.map((id) => p.modules.find((m) => m.id === id)!.tier));
  let first: CommandResult | null = null;
  for (const ids of [...pairs].sort((a, b) => out(b) - out(a))) {
    const blocked = p.rooms.find(
      (r) => r.moduleIds.every((id) => ids.includes(id)) && removeRoomGuard(p, r.id),
    );
    if (blocked) {
      const g = removeRoomGuard(p, blocked.id)!;
      first ??= reject(g.reason, [], g.suggestion);
      continue;
    }
    const labels = [
      ...new Set(ids.map((id) => roomLabel(roomOf(p, id) ?? { type: "bedroom" }).toLowerCase())),
    ];
    const res = commit(
      p,
      rederive(dropModules(p, ids), p.terrace.side),
      `Модуль из 2 кубиков убран (${labels.join(", ")}).`,
    );
    if (res.ok) return res;
    first ??= res;
  }
  return first ?? reject("Убрать модуль и остаться в правилах не получилось.");
}

// ── Второй ярус ─────────────────────────────────────────────────────────

export function addSecondTier(
  p: Project,
  c: { bedrooms?: number; whole?: boolean; moveBedrooms?: boolean },
): CommandResult {
  if (modulesOnTier(p, 2).length)
    return reject("Второй ярус уже есть. Можно добавить на него спальню.");
  const kitchen = p.rooms.find((r) => r.type === "kitchen-living" && r.tier === 1);
  if (!kitchen) return reject("Нет общей комнаты — лестнице не на что опереться.");
  const t1 = modulesOnTier(p, 1);
  const moving = c.moveBedrooms
    ? p.rooms.filter((r) => r.type === "bedroom" && r.tier === 1 && !r.purpose)
    : [];
  const want = c.whole
    ? Math.max(1, t1.length - 1)
    : Math.max(1, Math.min(6, c.bedrooms ?? (moving.length || 2)));
  let best: { proj: Project; n: number; score: number } | null = null;
  for (const km of p.modules.filter((m) => kitchen.moduleIds.includes(m.id))) {
    const hallId = newId(p, "hall");
    const hm: ModulePlacement = {
      id: newId(p, "u"),
      xMm: km.xMm,
      yMm: km.yMm,
      rot: km.rot,
      tier: 2,
      roomId: hallId,
    };
    let proj: Project = rederive(
      {
        ...p,
        modules: [...p.modules, hm],
        rooms: [...p.rooms, { id: hallId, type: "hall", tier: 2, moduleIds: [hm.id] }],
      },
      p.terrace.side,
    );
    let n = 0;
    const queue = [...moving];
    for (let i = 0; i < want; i++) {
      const mover = queue.shift();
      const base: Project = mover
        ? rederive(dropModules(proj, mover.moduleIds), proj.terrace.side)
        : proj;
      const next = attachCubes(base, {
        count: 1,
        tier: 2,
        anchorIds: base.modules.filter((m) => m.tier === 2).map((m) => m.id),
        assign: mover
          ? (pp, cubes) => ({
              ...pp,
              modules: pp.modules.map((m) =>
                m.id === cubes[0].id ? { ...m, roomId: mover.id } : m,
              ),
              rooms: [
                ...pp.rooms,
                { ...mover, tier: 2, moduleIds: [cubes[0].id], subRooms: undefined },
              ],
            })
          : assignKinds(["bedroom"], 2),
      });
      if (!next) break;
      proj = next;
      n++;
    }
    if (!n) continue;
    const ev = evaluate(proj);
    if (!ev.valid) continue;
    const score = n * 10 + ev.softScore;
    if (!best || score > best.score) best = { proj, n, score };
  }
  if (!best)
    return reject(
      "Второй ярус на этот дом не встаёт: верхним модулям не на что опереться без свеса больше 1,5 м.",
      [],
      "Сначала сделайте первый ярус компактнее (два ряда кубиков) или добавьте кубик к общей комнате.",
    );
  return commit(
    p,
    best.proj,
    `Второй ярус: холл с лестницей над общей комнатой и ${best.n} ${c.moveBedrooms ? "спальни переехали наверх" : best.n === 1 ? "спальня" : "спальни"}${best.n < want ? ` (больше ${best.n} не встаёт)` : ""}.`,
  );
}

export function removeSecondTier(
  p: Project,
  c: { cubes?: number; keepRooms?: boolean },
): CommandResult {
  const upper = modulesOnTier(p, 2);
  if (!upper.length) return reject("Второго яруса нет.");
  const partial = c.cubes && c.cubes < upper.length;
  if (partial) {
    // Частично: убираем самые выдвинутые кубики, кроме холла.
    const house = houseRect(p, 1);
    const order = upper
      .filter((m) => roomOf(p, m.id)?.type !== "hall")
      .sort((a, b) => {
        const fa = footprint(a);
        const fb = footprint(b);
        return (
          Math.max(...SIDES.map((s) => outward(fb, house, s))) -
          Math.max(...SIDES.map((s) => outward(fa, house, s)))
        );
      })
      .slice(0, c.cubes);
    return commit(
      p,
      rederive(
        dropModules(
          p,
          order.map((m) => m.id),
        ),
        p.terrace.side,
      ),
      `Второй ярус меньше на ${cubesRu(order.length)}.`,
    );
  }
  const upRooms = p.rooms.filter((r) => r.tier === 2);
  let proj: Project = rederive(
    dropModules(
      p,
      upper.map((m) => m.id),
    ),
    p.terrace.side,
  );
  const moved: string[] = [];
  const lost: string[] = [];
  if (c.keepRooms !== false)
    for (const r of upRooms) {
      if (r.type === "hall") continue;
      if (r.type === "wet-core") {
        lost.push("санузел второго яруса");
        continue;
      }
      const next = attachCubes(proj, {
        count: 1,
        tier: 1,
        anchorIds: hubModules(proj, 1).map((m) => m.id),
        assign: (pp, cubes) => ({
          ...pp,
          modules: pp.modules.map((m) => (m.id === cubes[0].id ? { ...m, roomId: r.id } : m)),
          rooms: [...pp.rooms, { ...r, tier: 1, moduleIds: [cubes[0].id], subRooms: undefined }],
        }),
      });
      if (next) {
        proj = next;
        moved.push(roomLabel(r).toLowerCase());
      } else lost.push(roomLabel(r).toLowerCase());
    }
  return commit(
    p,
    proj,
    `Второй ярус убран.${moved.length ? ` Вниз переехали: ${moved.join(", ")}.` : ""}${lost.length ? ` Не поместились внизу: ${lost.join(", ")}.` : ""}`,
  );
}

// ── Размер дома ─────────────────────────────────────────────────────────

/** Больше/меньше на N м²: решатель сам выбирает, что пристроить или убрать. */
export function resizeHouse(p: Project, c: { deltaM2: number; side?: Side }): CommandResult {
  const per = GRAMMAR.module.warmContourAreaM2;
  const n = Math.max(1, Math.min(6, Math.round(Math.abs(c.deltaM2) / per)));
  let proj = p;
  const steps: string[] = [];
  let done = 0;
  for (let i = 0; done < n && i < n + 2; i++) {
    const cands: { res: CommandResult; bias: number; cubes: number }[] = [];
    const add = (res: CommandResult, bias: number, cubes = 1) => cands.push({ res, bias, cubes });
    if (c.deltaM2 > 0) {
      // Заводской модуль целиком (2 кубика) — когда нужно ещё два и больше; компактный
      // дом часто принимает пару, но не одиночный кубик.
      if (n - done >= 2) {
        add(addModule(proj, { side: c.side, rooms: ["bedroom", "study"] }), 0.035, 2);
        add(addModule(proj, { side: c.side, rooms: ["living", "bedroom"] }), 0.03, 2);
      }
      const k = proj.rooms.find((r) => r.type === "kitchen-living");
      if (k && k.moduleIds.length < 4)
        add(extendRoom(proj, { room: "living", side: c.side }), 0.03);
      add(addRoom(proj, { room: "bedroom", side: c.side }), 0.02);
      add(addRoom(proj, { room: "study", side: c.side }), 0);
      if (modulesOnTier(proj, 2).length) add(addRoom(proj, { room: "bedroom", tier: 2 }), 0.025);
    } else {
      const house = houseRect(proj);
      for (const m of proj.modules) {
        const r = roomOf(proj, m.id);
        if (!r) continue;
        if (r.moduleIds.length === 1 && removeRoomGuard(proj, r.id)) continue;
        if (r.type === "hall") continue;
        const res = commit(proj, rederive(dropModules(proj, [m.id]), proj.terrace.side), "");
        // Меньше всего жалко: кладовую, кабинет, лишний кубик кухни, верхний ярус; спальню — в последнюю очередь.
        const bias =
          (r.type === "storage"
            ? 0.03
            : r.type === "study"
              ? 0.02
              : r.type === "kitchen-living" && r.moduleIds.length > 3
                ? 0.025
                : r.purpose
                  ? -0.2
                  : r.type === "bedroom" && r.moduleIds.length === 1
                    ? -0.01
                    : 0) + (c.side ? outward(footprint(m), house, c.side) / 1e5 : 0);
        add(res, bias);
      }
    }
    const ok = cands
      .filter(
        (x): x is { res: Extract<CommandResult, { ok: true }>; bias: number; cubes: number } =>
          x.res.ok,
      )
      .sort((a, b) => b.res.evaluation.softScore + b.bias - (a.res.evaluation.softScore + a.bias));
    if (!ok.length) break;
    proj = ok[0].res.project;
    done += ok[0].cubes;
    steps.push(ok[0].res.message || ok[0].res.diff.summary);
  }
  if (proj === p)
    return {
      ...reject(
        c.deltaM2 > 0
          ? "Увеличить дом и остаться в правилах не получилось: каждая пристройка ломает компактность пятна или не встаёт на участок."
          : "Уменьшить дом и остаться в правилах не получилось.",
      ),
      ...(c.deltaM2 > 0 && !modulesOnTier(p, 2).length
        ? {
            suggestion: "Можно добавить второй ярус — площадь вырастет без нового пятна.",
            alternative: {
              text: "Добавить второй ярус?",
              command: { op: "add_second_tier", bedrooms: 1 },
            },
          }
        : {}),
    };
  return commit(
    p,
    proj,
    `Дом ${c.deltaM2 > 0 ? "больше" : "меньше"} на ${cubesRu(done)} (≈${Math.round(done * per)} м²)${done < n ? `, больше не встаёт` : ""}.`,
  );
}

// ── Разворот ─────────────────────────────────────────────────────────────

/** Поворот на 90° против часовой: координаты, грани и отступы ручных проёмов. */
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
    {
      ...p,
      modules,
      openings,
      rotationDeg,
      placementLocked: false,
      carportSide: p.carportSide ? turnFace[p.carportSide] : undefined,
      overhangSupports: p.overhangSupports?.map((s) => turnFace[s]),
    },
    turnFace[p.terrace.side],
  );
}

export function rotateHouse(p: Project, deg: 90 | 180 | 270): CommandResult {
  let q = p;
  for (let i = 0; i < deg / 90; i++) q = rotateHouse90(q);
  return commit(p, q, `Дом повёрнут на ${deg}°.`);
}

/** Развернуть дом так, чтобы остекление общей комнаты смотрело на юг (с учётом севера участка). */
export function orientLivingSouth(p: Project): CommandResult {
  const north = p.plot?.northDeg ?? 0;
  const k = p.rooms.find((r) => r.type === "kitchen-living");
  if (!k) return reject("Нет общей комнаты.");
  const southGlass = (q: Project) =>
    q.openings
      .filter((o) => o.roomId === k.id && o.kind === "window" && compassOf(o.face, north) === "S")
      .reduce((a, o) => a + o.widthMm * o.heightMm, 0);
  let best: { q: Project; deg: number; g: number } = { q: p, deg: 0, g: southGlass(p) };
  let q = p;
  for (const deg of [90, 180, 270]) {
    q = rotateHouse90(q);
    if (!evaluate(q).valid) continue;
    const g = southGlass(q);
    if (g > best.g) best = { q, deg, g };
  }
  if (best.deg === 0)
    return reject("Общая комната уже смотрит на юг лучше всего из четырёх разворотов.");
  return commit(p, best.q, `Дом развёрнут на ${best.deg}°: остекление гостиной на юг.`);
}

// ── Окна и двери ────────────────────────────────────────────────────────

export interface OpeningTarget {
  side?: Side;
  roomId?: string;
  room?: RoomKind;
  moduleId?: string;
}

const NEEDS_WINDOW = new Set(["bedroom", "kitchen-living", "study"]);

function targetModules(
  p: Project,
  t: OpeningTarget,
): { mods: ModulePlacement[]; explicit: boolean } {
  if (t.moduleId) return { mods: p.modules.filter((m) => m.id === t.moduleId), explicit: true };
  if (t.roomId || t.room) {
    const rooms = t.roomId
      ? p.rooms.filter((r) => r.id === t.roomId)
      : p.rooms.filter((r) => roomIsKind(r, t.room!));
    const ids = new Set(rooms.flatMap((r) => r.moduleIds));
    return { mods: p.modules.filter((m) => ids.has(m.id)), explicit: true };
  }
  // Весь фасад: все кубики, у которых эта грань наружная.
  return {
    mods: t.side ? p.modules.filter((m) => facesOut(p, m, t.side!)) : p.modules,
    explicit: false,
  };
}

let wseq = 0;

export function editWindows(
  p: Project,
  c: OpeningTarget & {
    action: "add" | "remove" | "enlarge" | "shrink" | "set";
    preset?: WindowPreset;
  },
): CommandResult {
  const { mods, explicit } = targetModules(p, c);
  if (!mods.length)
    return reject(
      c.side
        ? `${SIDE_ON[c.side]} у этого помещения нет наружной стены.`
        : "Не понял, о каком помещении речь — назовите комнату или сторону.",
    );
  const faces = c.side ? [c.side] : SIDES;
  const roomIdOf = (m: ModulePlacement) => roomOf(p, m.id)?.id ?? "";
  const where =
    `${c.side ? SIDE_ON[c.side] : ""}${c.roomId || c.room ? ` (${c.room ? ROOM_KIND_RU[c.room] : roomLabel(p.rooms.find((r) => r.id === c.roomId) ?? { type: "bedroom" }).toLowerCase()})` : ""}`.trim();
  let openings: Opening[] = [...p.openings];
  const onTargets = (o: Opening) =>
    o.kind === "window" && faces.includes(o.face) && mods.some((m) => m.id === o.moduleId);

  if (c.action === "add") {
    const preset = c.preset ?? "standard";
    // По комнатам: в каждую нужную комнату — одно окно на этой стороне.
    const rooms = [...new Set(mods.map(roomIdOf))].filter((id) => {
      const r = p.rooms.find((x) => x.id === id);
      return r && (explicit || NEEDS_WINDOW.has(r.type));
    });
    let added = 0;
    for (const rid of rooms) {
      const rmods = mods.filter((m) => roomIdOf(m) === rid);
      const has = openings.some(
        (o) => o.roomId === rid && o.kind === "window" && faces.includes(o.face),
      );
      if (!explicit && has) continue;
      done: for (const m of rmods)
        for (const f of faces) {
          const w = placeWindow({ ...p, openings }, m, f, preset, rid, `w-u${++wseq}`);
          if (!w) continue;
          openings.push({ ...w, userSet: true });
          added++;
          break done;
        }
      if (explicit && added) break;
    }
    // Фасад целиком, а все комнаты уже с окнами — добавим туда, где больше всего свободной стены.
    if (!added && !explicit && c.side) {
      let bestM: { m: ModulePlacement; len: number } | null = null;
      for (const m of mods) {
        const len = Math.max(
          0,
          ...freeSegments({ ...p, openings }, m, c.side).map(([a, b]) => b - a),
        );
        if (!bestM || len > bestM.len) bestM = { m, len };
      }
      const w = bestM
        ? placeWindow(
            { ...p, openings },
            bestM.m,
            c.side,
            preset,
            roomIdOf(bestM.m),
            `w-u${++wseq}`,
          )
        : null;
      if (w) {
        openings.push({ ...w, userSet: true });
        added++;
      }
    }
    if (!added)
      return {
        ...reject(
          `${where || "Здесь"} нет свободной наружной стены под окно: стык с соседним кубиком или простенки ${GRAMMAR.openings.cornerPierMm} мм заняты.`,
        ),
        ...(() => {
          const free = SIDES.filter(
            (f) =>
              f !== c.side &&
              mods.some((m) => freeSegments(p, m, f).some(([a, b]) => b - a >= 900)),
          );
          return free.length
            ? {
                suggestion: `Можно ${SIDE_ON[free[0]]} — там есть свободная стена.`,
                alternative: {
                  text: `Окно ${SIDE_ON[free[0]]}?`,
                  command: {
                    op: "window",
                    action: "add",
                    side: free[0],
                    roomId: c.roomId,
                    room: c.room,
                    moduleId: c.moduleId,
                    preset,
                  },
                },
              }
            : {};
        })(),
      };
  } else if (c.action === "remove") {
    const ids = new Set(openings.filter(onTargets).map((o) => o.id));
    if (!ids.size) return reject(`${cap(where) || "Здесь"} окон нет.`);
    openings = openings
      .filter((o) => !ids.has(o.id))
      // Человек убрал окно — авто-окна этих помещений больше не досоздаём.
      .map((o) =>
        mods.some((m) => m.id === o.moduleId) && o.kind === "window" ? { ...o, userSet: true } : o,
      );
  } else {
    const targets = openings.filter(onTargets);
    if (!targets.length) {
      if (c.action === "set" || c.action === "enlarge")
        return editWindows(p, { ...c, action: "add", preset: c.preset ?? "large" });
      return reject(`${cap(where) || "Здесь"} окон нет — уменьшать нечего.`);
    }
    let changed = 0;
    let blocked = "";
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
      const w = placeWindow({ ...p, openings }, m, o.face, next, o.roomId, o.id, [o.id]);
      if (!w) {
        blocked = "Окно такого размера здесь не помещается.";
        continue;
      }
      openings = openings.map((x) => (x.id === o.id ? { ...w, userSet: true } : x));
      changed++;
    }
    if (!changed)
      return reject(
        blocked ||
          (c.action === "enlarge"
            ? "Больше уже некуда: это панорама в пол."
            : c.action === "shrink"
              ? "Меньше уже некуда: это узкая щель."
              : "Окна уже такого размера."),
      );
  }
  const verb = {
    add: "добавлено",
    remove: "убраны",
    enlarge: "больше",
    shrink: "меньше",
    set: "заданы",
  }[c.action];
  const res = commit(
    p,
    { ...p, openings },
    `Окна ${where}: ${verb}${c.preset ? ` (${WINDOW_PRESETS[c.preset].label})` : ""}.`.replace(
      "Окна :",
      "Окна:",
    ),
  );
  // Панорама под опорой второго яруса не проходит — предложим большое окно 2800.
  if (!res.ok && (c.preset === "floor-to-ceiling" || c.action === "enlarge"))
    return {
      ...res,
      alternative: {
        text: "Поставить большое окно 2800 вместо панорамы?",
        command: {
          op: "window",
          action: "set",
          side: c.side,
          roomId: c.roomId,
          room: c.room,
          moduleId: c.moduleId,
          preset: "large",
        },
      },
    };
  if (!res.ok && c.action === "remove")
    return {
      ...res,
      alternative: {
        text: "Уменьшить до узкой щели вместо того, чтобы убрать?",
        command: {
          op: "window",
          action: "set",
          side: c.side,
          roomId: c.roomId,
          room: c.room,
          moduleId: c.moduleId,
          preset: "slot",
        },
      },
    };
  return res;
}

const ENTRY_ORDER = ["corridor", "wet-core", "kitchen-living"];

/** Модули первого яруса для двери на стороне: тамбур/холл первыми. */
export function doorModules(p: Project, t: OpeningTarget): ModulePlacement[] {
  const { mods, explicit } = targetModules(p, t);
  const list = mods.filter((m) => m.tier === 1 && (!t.side || facesOut(p, m, t.side)));
  if (explicit) return list;
  const rank = (m: ModulePlacement) => {
    const r = roomOf(p, m.id);
    const i = ENTRY_ORDER.indexOf(r?.type ?? "");
    return i < 0 ? 9 : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

export { faceStart };
