/**
 * Детерминированный планировщик примерной меблировки.
 *
 * Никакого внешнего ИИ: правила + оценка + валидатор. Планировщик получает
 * геометрию комнаты, её стены, проёмы и тип помещения, а возвращает
 * упорядоченный список допустимых вариантов. Один и тот же вход при одной
 * версии алгоритма всегда даёт один и тот же результат — старый проект
 * воспроизводится.
 *
 * Меблировка — предварительная концепция для понимания масштаба, а не
 * рабочая документация: интерфейс говорит об этом прямо.
 */

import {
  ENTRY_CLEARANCE_M,
  FURNITURE_CATALOG,
  LAYOUT_ALGORITHM_VERSION,
  MIN_CLEARANCE_M,
  MODULE_SIDE_M,
} from "./constants.ts";
import { computeJoints } from "./rooms.ts";
import type { Rect } from "./geometry.ts";
import { moduleRect, overlapArea } from "./geometry.ts";
import type {
  FurnitureItem,
  FurnitureKind,
  FurnitureLayout,
  HouseState,
  ModuleFootprint,
  RoomType,
} from "./types.ts";

/* ------------------------------------------------------------------ */
/* Геометрия комнаты                                                   */
/* ------------------------------------------------------------------ */

export interface RoomWall {
  axis: "x" | "z";
  /** Координата стены по нормали. */
  at: number;
  from: number;
  to: number;
  /** Направление «внутрь комнаты» по нормали: +1 или −1. */
  inside: 1 | -1;
  /** Наружная стена дома (значит, свет и вид) или внутренняя. */
  exterior: boolean;
  /** Есть ли в этой стене дверь/проём в соседнее помещение. */
  hasDoor: boolean;
  length: number;
}

export interface RoomGeometry {
  roomId: string;
  type: RoomType;
  floor: number;
  modules: ModuleFootprint[];
  rects: Rect[];
  bbox: { x: number; z: number; w: number; d: number };
  walls: RoomWall[];
  /** Зоны, которые нельзя занимать: проходы у дверей и входа. */
  blocked: Rect[];
}

type Interval = { from: number; to: number };

function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (cut.to <= p.from + 1e-9 || cut.from >= p.to - 1e-9) {
        next.push(p);
        continue;
      }
      if (cut.from > p.from + 1e-9) next.push({ from: p.from, to: cut.from });
      if (cut.to < p.to - 1e-9) next.push({ from: cut.to, to: p.to });
    }
    parts = next.filter((p) => p.to - p.from > 1e-9);
  }
  return parts;
}

/** Собрать геометрию комнаты: контур, стены и запретные зоны проходов. */
export function roomGeometry(house: HouseState, roomId: string): RoomGeometry | null {
  const room = house.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const modules = house.modules.filter((m) => m.roomId === roomId);
  if (!modules.length) return null;

  const floor = room.floor;
  const own = new Set(modules.map((m) => m.id));
  const sameFloor = house.modules.filter((m) => m.floor === floor);
  const joints = computeJoints(house).filter((j) => j.floor === floor);

  const walls: RoomWall[] = [];
  const blocked: Rect[] = [];

  for (const m of modules) {
    const others = sameFloor.filter((o) => o.id !== m.id);

    const sides = [
      {
        axis: "x" as const,
        at: m.x,
        inside: 1 as const,
        alongFrom: m.z,
        alongTo: m.z + MODULE_SIDE_M,
      },
      {
        axis: "x" as const,
        at: m.x + MODULE_SIDE_M,
        inside: -1 as const,
        alongFrom: m.z,
        alongTo: m.z + MODULE_SIDE_M,
      },
      {
        axis: "z" as const,
        at: m.z,
        inside: 1 as const,
        alongFrom: m.x,
        alongTo: m.x + MODULE_SIDE_M,
      },
      {
        axis: "z" as const,
        at: m.z + MODULE_SIDE_M,
        inside: -1 as const,
        alongFrom: m.x,
        alongTo: m.x + MODULE_SIDE_M,
      },
    ];

    for (const side of sides) {
      // Куски грани, закрытые соседями (любой комнаты).
      const cutsSameRoom: Interval[] = [];
      const cutsOther: Array<Interval & { neighbourId: string }> = [];
      for (const o of others) {
        const touching =
          side.axis === "x"
            ? Math.abs((side.inside === 1 ? o.x + MODULE_SIDE_M : o.x) - side.at) < 1e-9
            : Math.abs((side.inside === 1 ? o.z + MODULE_SIDE_M : o.z) - side.at) < 1e-9;
        if (!touching) continue;
        const from = side.axis === "x" ? Math.max(m.z, o.z) : Math.max(m.x, o.x);
        const to =
          side.axis === "x"
            ? Math.min(m.z + MODULE_SIDE_M, o.z + MODULE_SIDE_M)
            : Math.min(m.x + MODULE_SIDE_M, o.x + MODULE_SIDE_M);
        if (to - from <= 1e-9) continue;
        if (own.has(o.id)) cutsSameRoom.push({ from, to });
        else cutsOther.push({ from, to, neighbourId: o.id });
      }

      // Стены комнаты — всё, кроме кусков, закрытых своими же модулями.
      for (const part of subtract({ from: side.alongFrom, to: side.alongTo }, cutsSameRoom)) {
        const neighbour = cutsOther.find((c) => c.from < part.to - 1e-9 && c.to > part.from + 1e-9);
        const joint = neighbour
          ? joints.find(
              (j) =>
                (j.aId === m.id && j.bId === neighbour.neighbourId) ||
                (j.bId === m.id && j.aId === neighbour.neighbourId),
            )
          : undefined;
        const hasDoor = !!joint && joint.state !== "closed" && joint.state !== "unknown";
        walls.push({
          axis: side.axis,
          at: side.at,
          from: part.from,
          to: part.to,
          inside: side.inside,
          exterior: !neighbour,
          hasDoor,
          length: part.to - part.from,
        });

        // Перед дверью нужен свободный проход. Глубина зависит от того, что
        // за дверь: перед распахнутым проёмом в общую зону нужен полноценный
        // подход, а перед обычной межкомнатной дверью достаточно нормативного
        // прохода. Раньше и туда и туда закладывалось 0,9 м, и в спальне
        // 2,78 × 3,00 с двумя дверями кровать переставала помещаться.
        if (hasDoor) {
          const clearance =
            joint && (joint.state === "opening" || joint.state === "open")
              ? ENTRY_CLEARANCE_M
              : MIN_CLEARANCE_M;
          const c = (part.from + part.to) / 2;
          const halfW = Math.min(0.5, (part.to - part.from) / 2);
          if (side.axis === "x") {
            blocked.push({
              x: side.inside === 1 ? side.at : side.at - clearance,
              z: c - halfW,
              w: clearance,
              d: halfW * 2,
            });
          } else {
            blocked.push({
              x: c - halfW,
              z: side.inside === 1 ? side.at : side.at - clearance,
              w: halfW * 2,
              d: clearance,
            });
          }
        }
      }
    }
  }

  const rects = modules.map(moduleRect);
  const minX = Math.min(...rects.map((r) => r.x));
  const minZ = Math.min(...rects.map((r) => r.z));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxZ = Math.max(...rects.map((r) => r.z + r.d));

  return {
    roomId,
    type: room.type,
    floor,
    modules,
    rects,
    bbox: { x: minX, z: minZ, w: maxX - minX, d: maxZ - minZ },
    walls: mergeWalls(walls),
    blocked,
  };
}

/** Склеить соседние коллинеарные куски одной стены в один отрезок. */
function mergeWalls(walls: RoomWall[]): RoomWall[] {
  const out: RoomWall[] = [];
  const sorted = [...walls].sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.inside - b.inside || a.from - b.from,
  );
  for (const w of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.axis === w.axis &&
      Math.abs(prev.at - w.at) < 1e-9 &&
      prev.inside === w.inside &&
      prev.exterior === w.exterior &&
      prev.hasDoor === w.hasDoor &&
      Math.abs(prev.to - w.from) < 1e-9
    ) {
      prev.to = w.to;
      prev.length = prev.to - prev.from;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Размещение и проверки                                               */
/* ------------------------------------------------------------------ */

let seq = 0;
const nextId = () => `f${++seq}`;

/** Занимаемый предметом прямоугольник у стены. */
function placeAtWall(
  kind: FurnitureKind,
  wall: RoomWall,
  centerAlong: number,
  gapFromWall = 0,
): FurnitureItem {
  const spec = FURNITURE_CATALOG[kind];
  const along = spec.w;
  const deep = spec.d;
  if (wall.axis === "x") {
    // Вертикальная стена: глубина предмета идёт по X внутрь комнаты.
    const x = wall.inside === 1 ? wall.at + gapFromWall : wall.at - gapFromWall - deep;
    return {
      id: nextId(),
      kind,
      x,
      z: centerAlong - along / 2,
      w: deep,
      d: along,
      rotation: wall.inside === 1 ? 90 : 270,
      locked: false,
    };
  }
  const z = wall.inside === 1 ? wall.at + gapFromWall : wall.at - gapFromWall - deep;
  return {
    id: nextId(),
    kind,
    x: centerAlong - along / 2,
    z,
    w: along,
    d: deep,
    rotation: wall.inside === 1 ? 0 : 180,
    locked: false,
  };
}

/** Предмет по центру комнаты (стол, журнальный столик). */
function placeFree(
  kind: FurnitureKind,
  cx: number,
  cz: number,
  rotation: 0 | 90 = 0,
): FurnitureItem {
  const spec = FURNITURE_CATALOG[kind];
  const w = rotation === 0 ? spec.w : spec.d;
  const d = rotation === 0 ? spec.d : spec.w;
  return { id: nextId(), kind, x: cx - w / 2, z: cz - d / 2, w, d, rotation, locked: false };
}

const itemRect = (i: FurnitureItem): Rect => ({ x: i.x, z: i.z, w: i.w, d: i.d });

/** Полностью ли прямоугольник внутри контура комнаты. */
export function insideRoom(rect: Rect, geo: RoomGeometry): boolean {
  // Достаточно проверить, что суммарное перекрытие с модулями комнаты
  // равно площади прямоугольника: модули не пересекаются между собой.
  const area = rect.w * rect.d;
  if (area <= 0) return false;
  let covered = 0;
  for (const r of geo.rects) covered += overlapArea(rect, r);
  return covered >= area - 1e-6;
}

function overlapsAny(rect: Rect, rects: Rect[], tolerance = 1e-6): boolean {
  return rects.some((r) => overlapArea(rect, r) > tolerance);
}

/**
 * Оставить от варианта то, что действительно помещается.
 *
 * Предметы в кандидатах перечислены по убыванию важности: сначала кровать,
 * потом тумбы, потом шкаф. Обход в том же порядке гарантирует, что жертвуем
 * второстепенным.
 *
 * Первый предмет обязателен. Спальня без кровати, но с двумя тумбами — не
 * планировка, а насмешка; именно это и получилось, когда обрезка сохраняла
 * любой непустой остаток. Не влез главный предмет — вариант отбрасывается
 * целиком, и планировщик берёт следующий, с другой стеной.
 *
 * Счёт снижается пропорционально потерям: вариант, влезший целиком, обязан
 * выигрывать у обрезанного.
 */
function trimToFit(candidate: Candidate, geo: RoomGeometry): Candidate {
  const kept: FurnitureItem[] = [];
  const rects: Rect[] = [];
  for (const item of candidate.items) {
    const rect = itemRect(item);
    const fits =
      insideRoom(rect, geo) && !overlapsAny(rect, rects) && !overlapsAny(rect, geo.blocked, 0.05);
    if (!fits) {
      if (!kept.length) return { ...candidate, items: [], score: 0 };
      continue;
    }
    kept.push(item);
    rects.push(rect);
  }
  if (kept.length === candidate.items.length) return candidate;
  const ratio = kept.length / candidate.items.length;
  return { ...candidate, items: kept, score: candidate.score * (0.5 + 0.5 * ratio) };
}

/** Жёсткие ограничения: внутри комнаты, без пересечений и без блокировки проходов. */
export function validateItems(items: FurnitureItem[], geo: RoomGeometry): boolean {
  const placed: Rect[] = [];
  for (const item of items) {
    const rect = itemRect(item);
    if (!insideRoom(rect, geo)) return false;
    if (overlapsAny(rect, placed)) return false;
    if (overlapsAny(rect, geo.blocked, 0.05)) return false;
    placed.push(rect);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Пресеты по типам помещений                                          */
/* ------------------------------------------------------------------ */

interface Candidate {
  items: FurnitureItem[];
  score: number;
  warnings: string[];
}

const wallCenter = (w: RoomWall) => (w.from + w.to) / 2;

/** Стены, вдоль которых поместится предмет заданной ширины. */
function wallsFor(geo: RoomGeometry, minLength: number): RoomWall[] {
  return geo.walls
    .filter((w) => w.length >= minLength)
    .sort((a, b) => b.length - a.length || a.at - b.at || a.from - b.from);
}

function bedroomCandidates(geo: RoomGeometry): Candidate[] {
  const spec = FURNITURE_CATALOG.bed;
  const out: Candidate[] = [];
  for (const wall of wallsFor(geo, spec.w + 0.9)) {
    const items: FurnitureItem[] = [];
    const c = wallCenter(wall);
    const bed = placeAtWall("bed", wall, c);
    items.push(bed);

    // Тумбы по обе стороны изголовья.
    const nsSpec = FURNITURE_CATALOG.nightstand;
    for (const sign of [-1, 1]) {
      const ns = placeAtWall("nightstand", wall, c + sign * (spec.w / 2 + nsSpec.w / 2));
      if (insideRoom(itemRect(ns), geo) && !overlapsAny(itemRect(ns), geo.blocked, 0.05)) {
        items.push(ns);
      }
    }

    // Шкаф — у другой стены, желательно глухой и не напротив кровати вплотную.
    const wardrobeSpec = FURNITURE_CATALOG.wardrobe;
    const wardrobeWall = wallsFor(geo, wardrobeSpec.w).find(
      (w) => w !== wall && !w.exterior && !sameLine(w, wall),
    );
    if (wardrobeWall) {
      const wardrobe = placeAtWall("wardrobe", wardrobeWall, wallCenter(wardrobeWall));
      if (
        insideRoom(itemRect(wardrobe), geo) &&
        !overlapsAny(itemRect(wardrobe), items.map(itemRect)) &&
        !overlapsAny(itemRect(wardrobe), geo.blocked, 0.05)
      ) {
        items.push(wardrobe);
      }
    }

    // Мягкие предпочтения: изголовье к глухой стене и подальше от двери.
    let score = 1;
    if (!wall.exterior) score += 0.5; // кровать не под окном
    if (!wall.hasDoor) score += 0.6; // и не у двери
    score += Math.min(wall.length, 6) / 20;
    if (items.length >= 4) score += 0.3; // поместился шкаф

    out.push({ items, score, warnings: [] });
  }
  return out;
}

function sameLine(a: RoomWall, b: RoomWall): boolean {
  return a.axis === b.axis && Math.abs(a.at - b.at) < 1e-9;
}

function livingCandidates(geo: RoomGeometry, withKitchen: boolean): Candidate[] {
  const sofaSpec = FURNITURE_CATALOG.sofa;
  const out: Candidate[] = [];

  for (const sofaWall of wallsFor(geo, sofaSpec.w + 0.4)) {
    const items: FurnitureItem[] = [];
    const sofa = placeAtWall("sofa", sofaWall, wallCenter(sofaWall));
    items.push(sofa);

    // Журнальный стол перед диваном — на расстоянии прохода.
    const gap = 0.55;
    const coffee = (() => {
      const s = FURNITURE_CATALOG["coffee-table"];
      if (sofaWall.axis === "x") {
        const x =
          sofaWall.inside === 1
            ? sofaWall.at + sofaSpec.d + gap
            : sofaWall.at - sofaSpec.d - gap - s.d;
        return {
          id: nextId(),
          kind: "coffee-table" as const,
          x,
          z: wallCenter(sofaWall) - s.w / 2,
          w: s.d,
          d: s.w,
          rotation: 90 as const,
          locked: false,
        };
      }
      const z =
        sofaWall.inside === 1
          ? sofaWall.at + sofaSpec.d + gap
          : sofaWall.at - sofaSpec.d - gap - s.d;
      return {
        id: nextId(),
        kind: "coffee-table" as const,
        x: wallCenter(sofaWall) - s.w / 2,
        z,
        w: s.w,
        d: s.d,
        rotation: 0 as const,
        locked: false,
      };
    })();
    if (insideRoom(itemRect(coffee), geo)) items.push(coffee);

    // ТВ-зона — напротив дивана, но не на окне.
    const tvWall = geo.walls.find(
      (w) => sameLine(w, sofaWall) === false && oppositeOf(w, sofaWall) && !w.exterior,
    );
    if (tvWall) {
      const tv = placeAtWall("tv", tvWall, wallCenter(tvWall));
      if (insideRoom(itemRect(tv), geo) && !overlapsAny(itemRect(tv), items.map(itemRect))) {
        items.push(tv);
      }
    }

    if (withKitchen) {
      const kSpec = FURNITURE_CATALOG["kitchen-line"];
      const kitchenWall = wallsFor(geo, kSpec.w).find(
        (w) => w !== sofaWall && !overlapsWallOf(w, items, geo),
      );
      if (kitchenWall) {
        const line = placeAtWall("kitchen-line", kitchenWall, wallCenter(kitchenWall));
        if (
          insideRoom(itemRect(line), geo) &&
          !overlapsAny(itemRect(line), items.map(itemRect)) &&
          !overlapsAny(itemRect(line), geo.blocked, 0.05)
        ) {
          items.push(line);

          // Обеденный стол рядом с кухней, но не на проходе.
          const table = placeFree(
            "dining-table",
            kitchenWall.axis === "x"
              ? kitchenWall.at + (kitchenWall.inside === 1 ? 1.9 : -1.9)
              : wallCenter(kitchenWall),
            kitchenWall.axis === "x"
              ? wallCenter(kitchenWall)
              : kitchenWall.at + (kitchenWall.inside === 1 ? 1.9 : -1.9),
            kitchenWall.axis === "x" ? 90 : 0,
          );
          if (
            insideRoom(itemRect(table), geo) &&
            !overlapsAny(itemRect(table), items.map(itemRect)) &&
            !overlapsAny(itemRect(table), geo.blocked, 0.05)
          ) {
            items.push(table);
            for (const chair of chairsAround(table)) {
              if (
                insideRoom(itemRect(chair), geo) &&
                !overlapsAny(itemRect(chair), items.map(itemRect)) &&
                !overlapsAny(itemRect(chair), geo.blocked, 0.05)
              ) {
                items.push(chair);
              }
            }
          }
        }
      }
    }

    let score = 1 + items.length / 10;
    if (!sofaWall.hasDoor) score += 0.4;
    if (!sofaWall.exterior) score += 0.3; // диван спиной к глухой стене
    out.push({ items, score, warnings: [] });
  }
  return out;
}

function oppositeOf(a: RoomWall, b: RoomWall): boolean {
  return a.axis === b.axis && a.inside !== b.inside;
}

function overlapsWallOf(wall: RoomWall, items: FurnitureItem[], geo: RoomGeometry): boolean {
  const probe = placeAtWall("kitchen-line", wall, wallCenter(wall));
  return overlapsAny(itemRect(probe), items.map(itemRect)) || !insideRoom(itemRect(probe), geo);
}

/** Четыре стула вокруг стола — каждый лицом к столешнице. */
function chairsAround(table: FurnitureItem): FurnitureItem[] {
  const s = FURNITURE_CATALOG.chair;
  const gap = 0.05;
  const cx = table.x + table.w / 2;
  const cz = table.z + table.d / 2;
  const chair = (x: number, z: number, rotation: 0 | 90 | 180 | 270): FurnitureItem => ({
    id: nextId(),
    kind: "chair",
    x,
    z,
    w: s.w,
    d: s.d,
    rotation,
    locked: false,
  });
  return [
    chair(table.x - s.w - gap, cz - s.d / 2, 90),
    chair(table.x + table.w + gap, cz - s.d / 2, 270),
    chair(cx - s.w / 2, table.z - s.d - gap, 0),
    chair(cx - s.w / 2, table.z + table.d + gap, 180),
  ];
}

function diningCandidates(geo: RoomGeometry): Candidate[] {
  const cx = geo.bbox.x + geo.bbox.w / 2;
  const cz = geo.bbox.z + geo.bbox.d / 2;
  const out: Candidate[] = [];
  for (const rotation of [0, 90] as const) {
    const table = placeFree("dining-table", cx, cz, rotation);
    const items = [table, ...chairsAround(table)].filter(
      (i) => insideRoom(itemRect(i), geo) && !overlapsAny(itemRect(i), geo.blocked, 0.05),
    );
    if (items.length) out.push({ items, score: 1 + items.length / 10, warnings: [] });
  }
  return out;
}

function kitchenCandidates(geo: RoomGeometry): Candidate[] {
  // Кухня-гостиная: линия + стол + диван, если позволяет площадь.
  const big = geo.modules.length > 1;
  return big ? livingCandidates(geo, true) : compactKitchenCandidates(geo);
}

function compactKitchenCandidates(geo: RoomGeometry): Candidate[] {
  const spec = FURNITURE_CATALOG["kitchen-line"];
  const out: Candidate[] = [];
  for (const wall of wallsFor(geo, spec.w)) {
    const items: FurnitureItem[] = [placeAtWall("kitchen-line", wall, wallCenter(wall))];
    const table = placeFree(
      "dining-table",
      wall.axis === "x" ? wall.at + (wall.inside === 1 ? 1.9 : -1.9) : wallCenter(wall),
      wall.axis === "x" ? wallCenter(wall) : wall.at + (wall.inside === 1 ? 1.9 : -1.9),
      wall.axis === "x" ? 90 : 0,
    );
    if (insideRoom(itemRect(table), geo) && !overlapsAny(itemRect(table), items.map(itemRect))) {
      items.push(table);
      for (const chair of chairsAround(table)) {
        if (
          insideRoom(itemRect(chair), geo) &&
          !overlapsAny(itemRect(chair), items.map(itemRect)) &&
          !overlapsAny(itemRect(chair), geo.blocked, 0.05)
        ) {
          items.push(chair);
        }
      }
    }
    let score = 1 + items.length / 10;
    if (!wall.hasDoor) score += 0.4;
    out.push({ items, score, warnings: [] });
  }
  return out;
}

function officeCandidates(geo: RoomGeometry): Candidate[] {
  const spec = FURNITURE_CATALOG.desk;
  const out: Candidate[] = [];
  for (const wall of wallsFor(geo, spec.w)) {
    const desk = placeAtWall("desk", wall, wallCenter(wall));
    const items: FurnitureItem[] = [desk];
    const chair = placeFree(
      "office-chair",
      desk.x + desk.w / 2 + (wall.axis === "x" ? (wall.inside === 1 ? 0.8 : -0.8) : 0),
      desk.z + desk.d / 2 + (wall.axis === "z" ? (wall.inside === 1 ? 0.8 : -0.8) : 0),
    );
    if (insideRoom(itemRect(chair), geo) && !overlapsAny(itemRect(chair), items.map(itemRect))) {
      items.push(chair);
    }
    const shelfWall = wallsFor(geo, FURNITURE_CATALOG.shelf.w).find(
      (w) => w !== wall && !sameLine(w, wall),
    );
    if (shelfWall) {
      const shelf = placeAtWall("shelf", shelfWall, wallCenter(shelfWall));
      if (
        insideRoom(itemRect(shelf), geo) &&
        !overlapsAny(itemRect(shelf), items.map(itemRect)) &&
        !overlapsAny(itemRect(shelf), geo.blocked, 0.05)
      ) {
        items.push(shelf);
      }
    }
    // Мягкое предпочтение: боковой естественный свет — стол у наружной стены.
    const score = 1 + (wall.exterior ? 0.6 : 0) + (wall.hasDoor ? 0 : 0.3) + items.length / 20;
    out.push({ items, score, warnings: [] });
  }
  return out;
}

function bathroomCandidates(geo: RoomGeometry): Candidate[] {
  const out: Candidate[] = [];
  const bathSpec = FURNITURE_CATALOG.bath;
  for (const main of wallsFor(geo, bathSpec.w)) {
    for (const kind of ["bath", "shower"] as const) {
      const items: FurnitureItem[] = [placeAtWall(kind, main, wallCenter(main))];
      const other = wallsFor(geo, FURNITURE_CATALOG.sink.w).find(
        (w) => w !== main && !sameLine(w, main),
      );
      if (other) {
        const sink = placeAtWall("sink", other, wallCenter(other) - 0.5);
        const toilet = placeAtWall("toilet", other, wallCenter(other) + 0.6);
        for (const it of [sink, toilet]) {
          if (
            insideRoom(itemRect(it), geo) &&
            !overlapsAny(itemRect(it), items.map(itemRect)) &&
            !overlapsAny(itemRect(it), geo.blocked, 0.05)
          ) {
            items.push(it);
          }
        }
      }
      out.push({
        items,
        score: 1 + items.length / 10 + (main.hasDoor ? 0 : 0.4),
        warnings: [],
      });
    }
  }
  return out;
}

function storageCandidates(geo: RoomGeometry): Candidate[] {
  const out: Candidate[] = [];
  for (const wall of wallsFor(geo, FURNITURE_CATALOG.wardrobe.w)) {
    const items: FurnitureItem[] = [placeAtWall("wardrobe", wall, wallCenter(wall))];
    const other = wallsFor(geo, FURNITURE_CATALOG.washer.w).find(
      (w) => w !== wall && !sameLine(w, wall),
    );
    if (other) {
      const washer = placeAtWall("washer", other, wallCenter(other) - 0.4);
      const shelf = placeAtWall("shelf", other, wallCenter(other) + 0.9);
      for (const it of [washer, shelf]) {
        if (
          insideRoom(itemRect(it), geo) &&
          !overlapsAny(itemRect(it), items.map(itemRect)) &&
          !overlapsAny(itemRect(it), geo.blocked, 0.05)
        ) {
          items.push(it);
        }
      }
    }
    out.push({ items, score: 1 + items.length / 10, warnings: [] });
  }
  return out;
}

function entrywayCandidates(geo: RoomGeometry): Candidate[] {
  const out: Candidate[] = [];
  // Вход — по наружной стене; шкаф и банкетка по бокам, проход внутрь свободен.
  const exteriorWalls = geo.walls.filter((w) => w.exterior && w.length >= 2);
  const walls = exteriorWalls.length ? exteriorWalls : wallsFor(geo, 2);
  for (const entryWall of walls) {
    const items: FurnitureItem[] = [];
    const wardrobeWall = wallsFor(geo, FURNITURE_CATALOG.wardrobe.w).find(
      (w) => w !== entryWall && !sameLine(w, entryWall) && !w.hasDoor,
    );
    if (wardrobeWall) {
      const wardrobe = placeAtWall("wardrobe", wardrobeWall, wallCenter(wardrobeWall));
      if (
        insideRoom(itemRect(wardrobe), geo) &&
        !overlapsAny(itemRect(wardrobe), geo.blocked, 0.05)
      ) {
        items.push(wardrobe);
      }
    }
    const benchWall = wallsFor(geo, FURNITURE_CATALOG.bench.w).find(
      (w) => w !== entryWall && w !== wardrobeWall && !w.hasDoor,
    );
    if (benchWall) {
      const bench = placeAtWall("bench", benchWall, wallCenter(benchWall));
      if (
        insideRoom(itemRect(bench), geo) &&
        !overlapsAny(itemRect(bench), items.map(itemRect)) &&
        !overlapsAny(itemRect(bench), geo.blocked, 0.05)
      ) {
        items.push(bench);
      }
    }
    if (items.length) out.push({ items, score: 1 + items.length / 10, warnings: [] });
  }
  return out;
}

function stairsCandidates(geo: RoomGeometry): Candidate[] {
  const out: Candidate[] = [];
  for (const wall of wallsFor(geo, FURNITURE_CATALOG["stairs-run"].w)) {
    const run = placeAtWall("stairs-run", wall, wallCenter(wall));
    if (insideRoom(itemRect(run), geo)) {
      out.push({ items: [run], score: 1 + (wall.exterior ? 0 : 0.4), warnings: [] });
    }
  }
  return out;
}

function terraceCandidates(geo: RoomGeometry): Candidate[] {
  const cx = geo.bbox.x + geo.bbox.w / 2;
  const cz = geo.bbox.z + geo.bbox.d / 2;
  const out: Candidate[] = [];
  for (const rotation of [0, 90] as const) {
    const lounge = placeFree("lounge", cx, cz - 0.6, rotation);
    const table = placeFree("outdoor-table", cx, cz + 0.9, rotation);
    const items = [lounge, table].filter((i) => insideRoom(itemRect(i), geo));
    if (items.length) out.push({ items, score: 1 + items.length / 10, warnings: [] });
  }
  return out;
}

const PLANNERS: Partial<Record<RoomType, (geo: RoomGeometry) => Candidate[]>> = {
  bedroom: bedroomCandidates,
  living: (geo) => livingCandidates(geo, false),
  kitchen: kitchenCandidates,
  dining: diningCandidates,
  office: officeCandidates,
  bathroom: bathroomCandidates,
  storage: storageCandidates,
  entryway: entrywayCandidates,
  stairs: stairsCandidates,
  terrace: terraceCandidates,
};

/* ------------------------------------------------------------------ */
/* Публичный интерфейс                                                 */
/* ------------------------------------------------------------------ */

/**
 * Разложить мебель в комнате. presetIndex выбирает вариант из
 * детерминированно отсортированного списка допустимых («Другой вариант»).
 * Если ни один вариант не проходит валидатор — возвращается честный
 * пустой fallback, а не мебель с пересечениями.
 */
export function planRoom(house: HouseState, roomId: string, presetIndex = 0): FurnitureLayout {
  const geo = roomGeometry(house, roomId);
  const base: FurnitureLayout = {
    roomId,
    items: [],
    algorithmVersion: LAYOUT_ALGORITHM_VERSION,
    presetId: "empty",
    presetCount: 0,
    score: 0,
    source: "rule-template",
    fallback: true,
    warnings: [],
  };
  if (!geo) return base;

  const planner = PLANNERS[geo.type];
  if (!planner) {
    return { ...base, warnings: ["Тип помещения пока без автоматической расстановки"] };
  }

  // Кандидат больше не отбрасывается целиком из-за одного не влезшего
  // предмета. Раньше было именно так, и комната оставалась пустой, хотя
  // кровать или кухонная линия помещались прекрасно — не проходил стул.
  // Теперь предметы добавляются по порядку важности, а конфликтующие
  // отбрасываются: главное остаётся, лишнее уходит.
  const valid = planner(geo)
    .map((c) => trimToFit(c, geo))
    .filter((c) => c.items.length > 0)
    .sort((a, b) => b.score - a.score);

  if (!valid.length) {
    return {
      ...base,
      warnings: ["Нужно уточнить планировку: мебель не помещается без пересечений"],
    };
  }

  const index = ((presetIndex % valid.length) + valid.length) % valid.length;
  const chosen = valid[index];
  return {
    roomId,
    items: chosen.items,
    algorithmVersion: LAYOUT_ALGORITHM_VERSION,
    presetId: `${geo.type}-${index}`,
    presetCount: valid.length,
    score: chosen.score,
    source: "rule-template",
    fallback: false,
    warnings: chosen.warnings,
  };
}

/** Пересчитать меблировку только затронутых комнат, остальные оставить как есть. */
export function relayoutRooms(house: HouseState, roomIds: string[]): HouseState {
  const layouts = { ...house.layouts };
  for (const roomId of roomIds) {
    if (!house.rooms.some((r) => r.id === roomId)) {
      delete layouts[roomId];
      continue;
    }
    layouts[roomId] = planRoom(house, roomId);
  }
  return { ...house, layouts };
}

/** Полный пересчёт (загрузка плана, восстановление проекта). */
export function relayoutAll(house: HouseState): HouseState {
  return relayoutRooms(
    house,
    house.rooms.map((r) => r.id),
  );
}

/** Минимальный проход — экспорт для тестов и панели предупреждений. */
export const CLEARANCE_M = MIN_CLEARANCE_M;
