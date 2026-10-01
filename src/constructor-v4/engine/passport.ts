/**
 * Паспорт проекта — то, с чем клиент приходит к проектировщику EcoCub:
 * модули с позициями и свесами, экспликация помещений, проёмы, отделки,
 * посадка на участок, допущения, пункты на проверку и бюджет вилкой.
 */
import { FINISHES, GRAMMAR, findFinish, roomSpec } from "../grammar/index.ts";
import type { FinishCategory } from "../grammar/index.ts";
import { bbox, footprint, supportOf } from "./geometry.ts";
import { budgetFor, type Budget, type BudgetOptions } from "./price.ts";
import { PRICE_CONFIG } from "./price-config.ts";
import {
  evaluate,
  modulesOnTier,
  roomClearAreaM2,
  warmContourM2,
  type Evaluation,
} from "./rules.ts";
import type { Opening, Project, RuleResult, Side } from "./types.ts";

export interface PassportModule {
  id: string;
  tier: number;
  xMm: number;
  yMm: number;
  rot: number;
  roomId: string;
  roomLabel: string;
  /** Только для второго яруса: свес по сторонам и доля опоры. */
  overhangMm: Record<Side, number> | null;
  supportFraction: number | null;
  column: boolean;
}

export interface PassportRoom {
  id: string;
  type: string;
  label: string;
  tier: number;
  modules: number;
  /** В чистоте: 2780 × 3000 = 8,34 м² на модуль плюс снятые общие стены. */
  clearAreaM2: number;
  subRooms: string[];
}

export interface ProjectPassport {
  schemaVersion: 1;
  projectId: string;
  module: { externalMm: string; clearMm: string; source: string };
  summary: {
    modules: number;
    tiers: number;
    warmContourM2: number;
    clearAreaM2: number;
    terraceM2: number;
    bedrooms: number;
    bathrooms: number;
    footprintMm: { w: number; d: number };
  };
  modules: PassportModule[];
  rooms: PassportRoom[];
  openings: Opening[];
  finishes: { category: FinishCategory; id: string; label: string; placeholder: boolean }[];
  styleId: string | null;
  plot: {
    widthM: number;
    depthM: number;
    northDeg: number | null;
    houseOffsetMm: { xMm: number; yMm: number };
    setbackMm: number;
  } | null;
  rules: { hardOk: boolean; soft: RuleResult[] };
  assumptions: string[];
  verifyByDesigner: string[];
  budget: Budget;
}

export function buildPassport(
  p: Project,
  ev: Evaluation = evaluate(p),
  budgetOpts: BudgetOptions = {},
): ProjectPassport {
  const t1 = modulesOnTier(p, 1);
  const tiers = Math.max(...p.modules.map((m) => m.tier));
  const fp = bbox(p.modules.map(footprint));
  const rooms: PassportRoom[] = p.rooms.map((r) => ({
    id: r.id,
    type: r.type,
    label: roomSpec(r.type).label,
    tier: r.tier,
    modules: r.moduleIds.length,
    clearAreaM2: roomClearAreaM2(p, r),
    subRooms: r.subRooms ?? [],
  }));
  const modules: PassportModule[] = p.modules.map((m) => {
    const room = p.rooms.find((r) => r.moduleIds.includes(m.id));
    const s = m.tier === 2 ? supportOf(m, t1) : null;
    return {
      id: m.id,
      tier: m.tier,
      xMm: m.xMm,
      yMm: m.yMm,
      rot: m.rot,
      roomId: m.roomId,
      roomLabel: room ? roomSpec(room.type).label : "—",
      overhangMm: s?.overhangMm ?? null,
      supportFraction: s ? Math.round(s.supportFraction * 100) / 100 : null,
      column: false,
    };
  });
  const cats: FinishCategory[] = ["facade", "roof", "windowFrames", "interior"];
  const finishes = cats.map((c) => {
    const f = findFinish(c, p.finishes[c]);
    return {
      category: c,
      id: p.finishes[c],
      label: f?.label ?? "не выбрано",
      placeholder: f?.placeholder ?? true,
    };
  });

  const assumptions = [
    `Модуль ${GRAMMAR.module.externalMm.w} × ${GRAMMAR.module.externalMm.d} × ${GRAMMAR.module.externalMm.h}, в чистоте ${GRAMMAR.module.clearMm.w} × ${GRAMMAR.module.clearMm.d}`,
    "Слитые помещения — через общую стену 210 (+0,63 м² на стык), раздельные — спина к спине 420",
    "Площадь для клиента — по тёплому контуру 10,944 м² на модуль",
    `Отступ от границ участка ${GRAMMAR.site.setbackMm / 1000} м — предварительно`,
    "Ширины окон — пресеты до привязки к пролётам каркаса",
    "Высоты проёмов только 2100 / 2500 / 2800 / 3150",
    ...(PRICE_CONFIG.status === "PLACEHOLDER"
      ? ["Ставки бюджета — PLACEHOLDER до прайса 2026"]
      : []),
    ...(FINISHES.status === "PLACEHOLDER" ? ["Каталог отделок и надбавки — PLACEHOLDER"] : []),
  ];
  const verify = [
    ...ev.review.map((r) => r.message),
    "Посадка на участок: ПЗЗ, красные линии, сети, подъезд трала и крана",
    "Геология и тип фундамента",
    "Окончательная раскладка проёмов по пролётам каркаса",
  ];

  return {
    schemaVersion: 1,
    projectId: p.id,
    module: {
      externalMm: `${GRAMMAR.module.externalMm.w} × ${GRAMMAR.module.externalMm.d} × ${GRAMMAR.module.externalMm.h}`,
      clearMm: `${GRAMMAR.module.clearMm.w} × ${GRAMMAR.module.clearMm.d} × ${GRAMMAR.module.clearMm.h}`,
      source: GRAMMAR.module.source,
    },
    summary: {
      modules: p.modules.length,
      tiers,
      warmContourM2: Math.round(warmContourM2(p) * 10) / 10,
      clearAreaM2: Math.round(rooms.reduce((s, r) => s + r.clearAreaM2, 0) * 10) / 10,
      terraceM2: p.terrace.totalM2,
      bedrooms: p.rooms.filter((r) => r.type === "bedroom").length,
      bathrooms: p.rooms.filter((r) => r.type === "wet-core").length,
      footprintMm: { w: fp.x1 - fp.x0, d: fp.y1 - fp.y0 },
    },
    modules,
    rooms,
    openings: p.openings,
    finishes,
    styleId: p.finishes.styleId,
    plot: p.plot
      ? {
          widthM: p.plot.widthM,
          depthM: p.plot.depthM,
          northDeg: p.plot.northDeg ?? null,
          houseOffsetMm: p.placementMm,
          setbackMm: GRAMMAR.site.setbackMm,
        }
      : null,
    rules: { hardOk: ev.valid, soft: ev.results.filter((r) => r.level === "soft") },
    assumptions,
    verifyByDesigner: [...new Set(verify)],
    budget: budgetFor(p, budgetOpts),
  };
}

/** Чего не хватает в паспорте для передачи проектировщику. Пусто — паспорт полный. */
export function passportGaps(pp: ProjectPassport): string[] {
  const gaps: string[] = [];
  if (!pp.rules.hardOk) gaps.push("есть нарушения конструктива");
  if (!pp.modules.length) gaps.push("нет модулей");
  if (pp.modules.some((m) => m.tier === 2 && (!m.overhangMm || m.supportFraction === null)))
    gaps.push("нет свесов второго яруса");
  if (!pp.rooms.length || pp.rooms.some((r) => !(r.clearAreaM2 > 0)))
    gaps.push("экспликация помещений неполная");
  if (!pp.openings.some((o) => o.kind === "entrance")) gaps.push("нет входной двери");
  if (!pp.openings.some((o) => o.kind === "window")) gaps.push("нет окон");
  if (pp.finishes.length !== 4 || pp.finishes.some((f) => !f.id)) gaps.push("не выбраны отделки");
  if (!pp.plot) gaps.push("нет посадки на участок");
  if (!pp.assumptions.length) gaps.push("нет списка допущений");
  if (!pp.verifyByDesigner.length) gaps.push("нет пунктов на проверку");
  const b = pp.budget;
  if (!(b.total.min > 0 && b.total.max > b.total.min)) gaps.push("бюджет не вилка");
  const need = [
    "modules",
    "finishes",
    "transport",
    "crane-montage",
    "foundation",
    "terrace",
    "options",
  ];
  if (!need.every((id) => b.lines.some((l) => l.id === id))) gaps.push("в бюджете нет всех статей");
  if (!b.whatCanChangePrice.length) gaps.push("нет списка «что может изменить цену»");
  return gaps;
}
