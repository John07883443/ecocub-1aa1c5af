/**
 * Ядро правок: применить → проверить правилами → посчитать дифф. Дифф — это
 * правда о том, что поменялось: по нему подсвечиваются кубики, по нему Лев
 * говорит «что сделал». Нет диффа — правки не было (и сказать «сделал» нельзя).
 */
import { GRAMMAR, roomSpec } from "../grammar/index.ts";
import { SIDES, bbox, contact, footprint, type Rect } from "./geometry.ts";
import { rederive } from "./derive.ts";
import { evaluate, explain, warmContourM2, type Evaluation } from "./rules.ts";
import { budgetFor } from "./price.ts";
import { carportPlace } from "./site.ts";
import { houseLook } from "./house-look.ts";
import type { ModulePlacement, Project, Room, Side } from "./types.ts";

export const SIDE_FROM: Record<Side, string> = {
  N: "с севера",
  E: "с востока",
  S: "с юга",
  W: "с запада",
};
export const SIDE_ON: Record<Side, string> = {
  N: "на севере",
  E: "на востоке",
  S: "на юге",
  W: "на западе",
};

export const SIDE_TO: Record<Side, string> = {
  N: "на северную сторону",
  E: "на восточную сторону",
  S: "на южную сторону",
  W: "на западную сторону",
};

export interface ChangeDiff {
  changed: boolean;
  /** Кубики, которых не было, и сдвинутые — их подсвечиваем. */
  added: string[];
  moved: string[];
  removed: string[];
  /** Кубики, у которых поменялись окна или двери. */
  openings: string[];
  /** Что подсветить на сцене (новые, сдвинутые, с новыми проёмами; при удалении — соседи). */
  highlight: string[];
  /** Конкретно и коротко, по-русски: это Лев обязан пересказать. */
  summary: string;
  /** Строки диффа по отдельности (для тестов и журнала). */
  lines: string[];
}

export type CommandResult =
  | {
      ok: true;
      project: Project;
      evaluation: Evaluation;
      message: string;
      diff: ChangeDiff;
    }
  | {
      ok: false;
      reason: string;
      violations: string[];
      suggestion?: string;
      /** Ближайшая допустимая альтернатива: Лев предлагает её кнопкой. */
      alternative?: { text: string; command: unknown };
    };

export type CommandFail = Extract<CommandResult, { ok: false }>;

export const reject = (
  reason: string,
  violations: string[] = [],
  suggestion?: string,
): CommandFail => ({
  ok: false,
  reason,
  violations,
  suggestion,
});

const fmt1 = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const mln = (n: number) => fmt1(n / 1e6);

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};
export const cubesRu = (n: number) => `${n} ${plural(n, "кубик", "кубика", "кубиков")}`;

export function roomLabel(r: Pick<Room, "type" | "subRooms" | "purpose">): string {
  if (r.type === "wet-core") {
    if (r.subRooms?.includes("сауна")) return "Сауна";
    return "Санузел";
  }
  if (r.type === "bedroom" && r.purpose) return "Спальня родителей";
  return roomSpec(r.type).label;
}

const key = (m: ModulePlacement) => `${m.tier}:${m.xMm}:${m.yMm}:${m.rot}`;

/** Сравнить два состояния дома: что именно поменялось. */
export function diffProjects(before: Project, after: Project): ChangeDiff {
  const lines: string[] = [];
  const bMods = new Map(before.modules.map((m) => [m.id, m]));
  const aMods = new Map(after.modules.map((m) => [m.id, m]));
  const bKeys = new Set(before.modules.map(key));
  const added = after.modules
    .filter((m) => !bMods.has(m.id) && !bKeys.has(key(m)))
    .map((m) => m.id);
  const removed = before.modules.filter((m) => !aMods.has(m.id)).map((m) => m.id);
  const rotated = (before.rotationDeg ?? 0) !== (after.rotationDeg ?? 0);
  const moved = rotated
    ? []
    : after.modules
        .filter((m) => {
          const b = bMods.get(m.id);
          return b && key(b) !== key(m);
        })
        .map((m) => m.id);

  // Кубики и ярусы.
  const nb = before.modules.length;
  const na = after.modules.length;
  if (nb !== na) {
    const d = na - nb;
    lines.push(
      `${d > 0 ? "+" : "−"}${cubesRu(Math.abs(d))} (было ${nb}, стало ${na}; ${Math.round(warmContourM2(before))} → ${Math.round(warmContourM2(after))} м²)`,
    );
  } else if (moved.length) lines.push(`${cubesRu(moved.length)} передвинуто`);
  const tb = Math.max(1, ...before.modules.map((m) => m.tier));
  const ta = Math.max(1, ...after.modules.map((m) => m.tier));
  if (tb !== ta) lines.push(ta === 2 ? "появился второй ярус" : "второго яруса больше нет");

  // Помещения: по типам.
  const count = (p: Project) => {
    const c = new Map<string, number>();
    for (const r of p.rooms) c.set(roomLabel(r), (c.get(roomLabel(r)) ?? 0) + 1);
    return c;
  };
  const cb = count(before);
  const ca = count(after);
  for (const label of new Set([...cb.keys(), ...ca.keys()])) {
    const x = cb.get(label) ?? 0;
    const y = ca.get(label) ?? 0;
    if (x !== y) lines.push(`${label.toLowerCase()}: ${x} → ${y}`);
  }
  // Переехавшие и изменённые по размеру помещения.
  for (const r of after.rooms) {
    const o = before.rooms.find((x) => x.id === r.id);
    if (!o) continue;
    if (o.moduleIds.length !== r.moduleIds.length)
      lines.push(
        `${roomLabel(r).toLowerCase()}: ${o.moduleIds.length} → ${cubesRu(r.moduleIds.length)}`,
      );
    else if (o.tier !== r.tier)
      lines.push(`на ${r.tier}-й ярус переехало: ${roomLabel(r).toLowerCase()}`);
    else if (
      r.moduleIds.some((id) => moved.includes(id) || added.includes(id)) ||
      [...r.moduleIds].sort().join() !== [...o.moduleIds].sort().join()
    )
      lines.push(`переставлено: ${roomLabel(r).toLowerCase()}`);
  }

  // Проёмы: окна по сторонам, вход.
  const winBy = (p: Project, s: Side) =>
    p.openings.filter((o) => o.kind === "window" && o.face === s);
  const glass = (p: Project, s: Side) =>
    winBy(p, s).reduce((a, o) => a + o.widthMm * o.heightMm, 0);
  if (!rotated)
    for (const s of SIDES) {
      const x = winBy(before, s).length;
      const y = winBy(after, s).length;
      if (x !== y) lines.push(`окна ${SIDE_ON[s]}: ${x} → ${y}`);
      else if (x && glass(before, s) !== glass(after, s))
        lines.push(
          `окна ${SIDE_ON[s]} ${glass(after, s) > glass(before, s) ? "больше" : "меньше"} (остекление ${fmt1(glass(before, s) / 1e6)} → ${fmt1(glass(after, s) / 1e6)} м²)`,
        );
    }
  const ent = (p: Project) =>
    p.openings
      .filter((o) => o.kind === "entrance")
      .map((o) => `${o.face}:${o.moduleId}:${o.offsetMm}:${o.widthMm}`)
      .sort()
      .join("|");
  const entFaces = (p: Project) =>
    [...new Set(p.openings.filter((o) => o.kind === "entrance").map((o) => o.face))].sort();
  if (!rotated && ent(before) !== ent(after)) {
    const fb = entFaces(before);
    const fa = entFaces(after);
    if (fb.length !== fa.length) lines.push(`наружных дверей: ${fb.length} → ${fa.length}`);
    else if (fb.join() !== fa.join())
      lines.push(
        `вход: ${fb.map((s) => SIDE_ON[s as Side]).join(", ")} → ${fa.map((s) => SIDE_ON[s as Side]).join(", ")}`,
      );
    else lines.push("двери поменялись");
  }
  const openKey = (p: Project, id: string) =>
    p.openings
      .filter((o) => o.moduleId === id && o.kind !== "internal-door")
      .map((o) => `${o.kind}:${o.face}:${o.offsetMm}:${o.widthMm}:${o.heightMm}`)
      .sort()
      .join("|");
  const openings = after.modules
    .filter((m) => bMods.has(m.id) && openKey(before, m.id) !== openKey(after, m.id))
    .map((m) => m.id);

  // Терраса, навес, колонны, отделка, поворот.
  if (before.terrace.side !== after.terrace.side)
    lines.push(`терраса: ${SIDE_ON[before.terrace.side]} → ${SIDE_ON[after.terrace.side]}`);
  if (Math.abs(before.terrace.totalM2 - after.terrace.totalM2) >= 1)
    lines.push(`терраса ${fmt1(before.terrace.totalM2)} → ${fmt1(after.terrace.totalM2)} м²`);
  const cpB = carportPlace(before);
  const cpA = carportPlace(after);
  if (!!cpB !== !!cpA)
    lines.push(cpA ? `навес для машины ${SIDE_FROM[cpA.side]}` : "навеса для машины больше нет");
  else if (cpB && cpA && cpB.side !== cpA.side)
    lines.push(`навес для машины перенесён ${SIDE_FROM[cpA.side]}`);
  const supB = (before.overhangSupports ?? []).join();
  const supA = (after.overhangSupports ?? []).join();
  if (supB !== supA)
    lines.push(
      `опоры под свесом: ${supA ? (after.overhangSupports ?? []).map((s) => SIDE_ON[s]).join(", ") : "нет"}`,
    );
  const lb = houseLook(before);
  const la = houseLook(after);
  if (lb.facadeId !== la.facadeId) lines.push(`фасад: ${lb.facadeLabel} → ${la.facadeLabel}`);
  if (lb.roofId !== la.roofId) lines.push(`кровля: ${lb.roofLabel} → ${la.roofLabel}`);
  if (lb.framesLabel !== la.framesLabel) lines.push(`рамы: ${lb.framesLabel} → ${la.framesLabel}`);
  if (lb.interiorLabel !== la.interiorLabel)
    lines.push(`интерьер: ${lb.interiorLabel} → ${la.interiorLabel}`);
  if (before.finishes.styleId !== after.finishes.styleId && lines.length === 0)
    lines.push("стиль поменялся");
  if (rotated) lines.push(`дом повёрнут: ${before.rotationDeg ?? 0}° → ${after.rotationDeg ?? 0}°`);
  if (
    !rotated &&
    (before.placementMm.xMm !== after.placementMm.xMm ||
      before.placementMm.yMm !== after.placementMm.yMm) &&
    after.placementLocked
  )
    lines.push("дом передвинут на участке");
  if ((before.finishingMaterials ?? "included") !== (after.finishingMaterials ?? "included"))
    lines.push(
      "материалы чистовой отделки: " + (after.finishingMaterials === "own" ? "свои" : "включены"),
    );

  const changed = lines.length > 0 || added.length > 0 || removed.length > 0 || openings.length > 0;
  // Деньги — только если дом реально поменялся.
  if (changed) {
    const bb = budgetFor(before).total;
    const ba = budgetFor(after).total;
    const d = (ba.min + ba.max - bb.min - bb.max) / 2;
    if (Math.abs(d) >= 50_000)
      lines.push(`${d > 0 ? "+" : "−"}${mln(Math.abs(d))} млн ₽ к середине вилки`);
  }
  // При удалении подсвечиваем соседей удалённых кубиков.
  const neighbours = removed.length
    ? after.modules
        .filter((m) =>
          removed.some((id) => {
            const r = bMods.get(id);
            const c = r ? contact(footprint(r), footprint(m)) : null;
            return !!c || (r && r.xMm === m.xMm && r.yMm === m.yMm);
          }),
        )
        .map((m) => m.id)
    : [];
  const highlight = rotated
    ? after.modules.map((m) => m.id)
    : [...new Set([...added, ...moved, ...openings, ...neighbours])];
  return {
    changed,
    added,
    moved,
    removed,
    openings,
    highlight,
    summary: lines.length
      ? lines.join("; ")
      : changed
        ? "поменялись проёмы"
        : "ничего не поменялось",
    lines,
  };
}

/** Короткая подсказка исправления по первому нарушению. */
export function suggestFix(ev: Evaluation): string | undefined {
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
    case "room-doors":
      return /кухонную/.test(v.message)
        ? "Поставьте спальню к холлу или к гостиной части, а не к кухне."
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Принять правку: правила без новых hard-нарушений и реальный дифф.
 * Нет диффа — это не успех: человеку нечего показать, Льву нечего говорить.
 */
export function commit(before: Project, after: Project, message: string): CommandResult {
  const ev = evaluate(after);
  if (!ev.valid) {
    const evB = evaluate(before);
    const was = new Set(evB.hardViolations.map((v) => v.message));
    const fresh = ev.hardViolations.filter((v) => !was.has(v.message));
    if (fresh.length || !evB.valid)
      return {
        ok: false,
        reason: "Так построить нельзя",
        violations: fresh.length ? fresh.map((v) => v.message) : explain(ev),
        suggestion: suggestFix({ ...ev, hardViolations: fresh.length ? fresh : ev.hardViolations }),
      };
  }
  const diff = diffProjects(before, after);
  if (!diff.changed) return reject("Так уже есть — дом не изменился.");
  return { ok: true, project: after, evaluation: ev, message, diff };
}

// ── Пристройка кубиков ───────────────────────────────────────────────────

let seq = 0;
export const newId = (p: Project, prefix: string) => {
  let id: string;
  do id = `${prefix}-${++seq}`;
  while (p.modules.some((m) => m.id === id) || p.rooms.some((r) => r.id === id));
  return id;
};

const OFF_Y = [0, 1710, -1710];
const OFF_X = [0, 1600, -1600];

/** Позиции вплотную к модулю с одной стороны (стыки со смещением 0 / ±1710 / ±1600). */
export function slotsOnSide(m: ModulePlacement, side: Side): { xMm: number; yMm: number }[] {
  const r = footprint(m);
  const { w, d } = GRAMMAR.module.externalMm;
  switch (side) {
    case "E":
      return OFF_Y.map((o) => ({ xMm: r.x1, yMm: r.y0 + o }));
    case "W":
      return OFF_Y.map((o) => ({ xMm: r.x0 - w, yMm: r.y0 + o }));
    case "N":
      return OFF_X.map((o) => ({ xMm: r.x0 + o, yMm: r.y1 }));
    case "S":
      return OFF_X.map((o) => ({ xMm: r.x0 + o, yMm: r.y0 - d }));
  }
}

export function slotsAround(m: ModulePlacement): { xMm: number; yMm: number }[] {
  return SIDES.flatMap((s) => slotsOnSide(m, s));
}

/** Насколько прямоугольник выдвинут в сторону side относительно центра дома (мм). */
export function outward(r: Rect, house: Rect, side: Side): number {
  const cx = (r.x0 + r.x1) / 2 - (house.x0 + house.x1) / 2;
  const cy = (r.y0 + r.y1) / 2 - (house.y0 + house.y1) / 2;
  return side === "E" ? cx : side === "W" ? -cx : side === "N" ? cy : -cy;
}

export function houseRect(p: Project, tier?: number): Rect {
  const mods = tier ? p.modules.filter((m) => m.tier === tier) : p.modules;
  return bbox((mods.length ? mods : p.modules).map(footprint));
}

export interface AttachOptions {
  /** Сколько кубиков (1 или 2 — заводской модуль). */
  count: 1 | 2;
  tier: number;
  /** С какой стороны дома пристраивать; нет — с любой. */
  side?: Side;
  /** К каким кубикам пристыковать первый кубик; нет — к любым на этом ярусе. */
  anchorIds?: string[];
  /** Расставить комнаты: получает id новых кубиков. */
  assign: (proj: Project, cubes: ModulePlacement[]) => Project;
  /** Сторона террасы после пересборки. */
  terraceSide?: Side;
}

/**
 * Перебирает места вплотную к дому и берёт лучший по мягким правилам вариант,
 * который проходит все hard-правила. Для двух кубиков сначала пробует пару,
 * которую завод делает одним модулем.
 */
export function attachCubes(p: Project, o: AttachOptions): Project | null {
  const anchors = p.modules.filter(
    (m) => m.tier === o.tier && (!o.anchorIds || o.anchorIds.includes(m.id)),
  );
  const house = houseRect(p, o.tier === 2 ? 1 : undefined);
  const sides = o.side ? [o.side] : SIDES;
  const { w, d } = GRAMMAR.module.externalMm;
  const seen = new Set<string>();
  let best: { proj: Project; score: number } | null = null;
  const tryCells = (cells: { xMm: number; yMm: number }[], bonus: number) => {
    const k = cells
      .map((c) => `${c.xMm}:${c.yMm}`)
      .sort()
      .join("|");
    if (seen.has(k)) return;
    seen.add(k);
    const cubes: ModulePlacement[] = cells.map((c, i) => ({
      id: newId(p, i ? "n" : "m"),
      xMm: c.xMm,
      yMm: c.yMm,
      rot: 0,
      tier: o.tier,
      roomId: "",
    }));
    // Пересечение с существующими — сразу мимо (быстрее, чем через правила).
    const all = [...p.modules.filter((m) => m.tier === o.tier), ...cubes];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = footprint(all[i]);
        const b = footprint(all[j]);
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) return;
      }
    const cand = rederive(
      o.assign({ ...p, modules: [...p.modules, ...cubes] }, cubes),
      o.terraceSide ?? p.terrace.side,
    );
    const ev = evaluate(cand);
    if (!ev.valid) return;
    const r = bbox(cubes.map(footprint));
    // Чуть ценим выдвинутость в нужную сторону и компактность (меньшее пятно).
    const out = o.side ? outward(r, house, o.side) / 1e5 : 0;
    const hb = houseRect(cand);
    const compact = -((hb.x1 - hb.x0) * (hb.y1 - hb.y0)) / 1e10;
    const score = ev.softScore + bonus + out + compact;
    if (!best || score > best.score) best = { proj: cand, score };
  };
  for (const a of anchors)
    for (const s of sides)
      for (const c1 of slotsOnSide(a, s)) {
        if (o.count === 1) {
          tryCells([c1], 0);
          continue;
        }
        // Пара: соседний кубик по длинной грани (заводской модуль) или вдоль фасада.
        const pairs: [{ xMm: number; yMm: number }, number][] = [
          [{ xMm: c1.xMm + w, yMm: c1.yMm }, 0.02],
          [{ xMm: c1.xMm - w, yMm: c1.yMm }, 0.02],
          [{ xMm: c1.xMm, yMm: c1.yMm + d }, 0],
          [{ xMm: c1.xMm, yMm: c1.yMm - d }, 0],
        ];
        for (const [c2, bonus] of pairs) tryCells([c1, c2], bonus);
      }
  return (best as { proj: Project } | null)?.proj ?? null;
}

/** Есть ли у модуля наружная грань с этой стороны (не закрыта соседом того же яруса). */
export function facesOut(p: Project, m: ModulePlacement, side: Side): boolean {
  const r = footprint(m);
  return !p.modules.some((x) => {
    if (x.id === m.id || x.tier !== m.tier) return false;
    const c = contact(r, footprint(x));
    return !!c && c.faceA === side && c.lengthMm >= GRAMMAR.placement.minContactMm;
  });
}
