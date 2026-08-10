/**
 * Движок подбора: жёсткая фильтрация → прозрачный скоринг → до трёх
 * вариантов (компактный / сбалансированный / просторный) с объяснениями.
 *
 * Никакого LLM внутри: выбор детерминированный, веса вынесены в
 * SCORING_WEIGHTS и настраиваются без правки логики. Если подходящих
 * планов меньше трёх — честно возвращаем сколько есть.
 */

import type {
  ClientHomeProfile,
  EcoCubPlan,
  Recommendation,
  ScoreBreakdown,
  VariantKind,
} from "./types.ts";
import { estimatePlan } from "./pricing.ts";

/* ------------------------------------------------------------------ */
/* Жёсткая фильтрация                                                   */
/* ------------------------------------------------------------------ */

export interface RejectedPlan {
  plan: EcoCubPlan;
  reasons: string[];
}

export function hardFilter(
  plans: EcoCubPlan[],
  profile: ClientHomeProfile,
): { passed: EcoCubPlan[]; rejected: RejectedPlan[] } {
  const passed: EcoCubPlan[] = [];
  const rejected: RejectedPlan[] = [];

  for (const plan of plans) {
    const reasons: string[] = [];

    if (plan.metrics.bedrooms < profile.bedrooms) {
      reasons.push(`спален ${plan.metrics.bedrooms}, нужно минимум ${profile.bedrooms}`);
    }

    if (profile.preferredFloors?.length && !profile.preferredFloors.includes(plan.metrics.floors)) {
      reasons.push(`этажность ${plan.metrics.floors} вне выбранной`);
    }

    // Бюджет отсекает только по подтверждённой цене карточки: расчётную
    // оценку используем в скоринге, но не как жёсткую границу.
    if (
      profile.budget?.max &&
      plan.metrics.confirmedPriceFrom &&
      plan.metrics.confirmedPriceFrom > profile.budget.max * 1.1
    ) {
      reasons.push("подтверждённая цена выше бюджета");
    }

    // Физическое размещение: если размеры участка известны, след дома
    // обязан помещаться с учётом отступов.
    const plot = profile.plot;
    if (plot?.widthM && plot?.depthM) {
      const setback = 3;
      const w = plot.widthM - setback * 2;
      const d = plot.depthM - setback * 2;
      const bbox = planFootprint(plan);
      const fits = (bbox.w <= w && bbox.d <= d) || (bbox.d <= w && bbox.w <= d);
      if (!fits) reasons.push("не помещается на участке с отступами 3 м");
    }

    if (reasons.length) rejected.push({ plan, reasons });
    else passed.push(plan);
  }

  return { passed, rejected };
}

/** Габарит первого этажа плана, м. */
export function planFootprint(plan: EcoCubPlan): { w: number; d: number } {
  const ground = plan.cells.filter((c) => c.floor === 0);
  if (!ground.length) return { w: 0, d: 0 };
  const minX = Math.min(...ground.map((c) => c.x));
  const maxX = Math.max(...ground.map((c) => c.x + 3));
  const minZ = Math.min(...ground.map((c) => c.z));
  const maxZ = Math.max(...ground.map((c) => c.z + 3));
  return { w: maxX - minX, d: maxZ - minZ };
}

/* ------------------------------------------------------------------ */
/* Скоринг                                                              */
/* ------------------------------------------------------------------ */

/** Веса компонентов — правятся здесь, интерфейс их не знает. */
export const SCORING_WEIGHTS: Record<string, { label: string; weight: number }> = {
  bedrooms: { label: "Состав семьи и спальни", weight: 3 },
  area: { label: "Целевая площадь", weight: 3 },
  budget: { label: "Близость к бюджету", weight: 2.5 },
  shared: { label: "Общее пространство", weight: 1.5 },
  privacy: { label: "Приватность", weight: 1.5 },
  office: { label: "Кабинет / работа из дома", weight: 1.5 },
  guests: { label: "Гостевой сценарий", weight: 1 },
  storage: { label: "Хранение", weight: 1 },
  terrace: { label: "Террасы и жизнь на воздухе", weight: 1 },
  future: { label: "Запас на будущее", weight: 1 },
  dataStatus: { label: "Статус данных плана", weight: 0.5 },
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function scorePlan(plan: EcoCubPlan, profile: ClientHomeProfile): ScoreBreakdown[] {
  const m = plan.metrics;
  const tags = plan.fit.lifestyleTags;
  const target = profile.targetArea ?? { min: 60, max: 200 };
  const gross = m.grossAreaM2;

  const parts: Record<string, number> = {};

  // Спальни: точное попадание лучше избытка (лишние спальни — лишние деньги).
  const extra = m.bedrooms - profile.bedrooms;
  parts.bedrooms = extra === 0 ? 1 : extra === 1 ? 0.8 : extra >= 2 ? 0.55 : 0;

  // Площадь: 1 внутри целевого диапазона, линейный спад за границами.
  if (gross >= (target.min ?? 0) && gross <= (target.max ?? Infinity)) parts.area = 1;
  else if (target.min && gross < target.min) parts.area = clamp01(gross / target.min);
  else parts.area = clamp01((target.max ?? gross) / gross);

  // Бюджет: по подтверждённой цене или расчётной оценке.
  const price =
    m.confirmedPriceFrom ?? estimatePlan(m.heatedAreaM2 ?? gross, m.terraceAreaM2 ?? 0).price;
  const bmax = profile.budget?.max;
  const bmin = profile.budget?.min;
  if (!bmax && !bmin)
    parts.budget = 0.7; // бюджет не задан — нейтрально
  else if (bmax && price > bmax) parts.budget = clamp01(1 - (price - bmax) / bmax);
  else if (bmin && price < bmin * 0.6)
    parts.budget = 0.6; // сильно дешевле запроса
  else parts.budget = 1;

  // Сценарии жизни — по тегам плана.
  const shared = profile.sharedSpacePriority ?? 0.5;
  const livingShare = plan.cells.filter((c) => c.role === "living").length / plan.cells.length;
  parts.shared = clamp01(0.4 + livingShare) * shared + (1 - shared) * 0.6;

  const privacy = profile.privacyPriority ?? 0.4;
  const privacyScore = tags.includes("privacy") ? 1 : m.bedrooms >= 3 ? 0.7 : 0.5;
  parts.privacy = privacyScore * privacy + (1 - privacy) * 0.6;

  parts.office =
    profile.officeNeed === "separate_room"
      ? tags.includes("office")
        ? 1
        : m.bedrooms > profile.bedrooms
          ? 0.7 // лишняя спальня может стать кабинетом
          : 0.2
      : profile.officeNeed === "occasional"
        ? tags.includes("office") || gross >= (target.min ?? 60)
          ? 0.9
          : 0.6
        : 0.7;

  parts.guests =
    profile.guestNeed === "frequent"
      ? m.bedrooms > profile.bedrooms || tags.includes("guests")
        ? 1
        : 0.4
      : 0.8;

  parts.storage =
    profile.storageNeed === "extended" ? (tags.includes("storage") || gross >= 120 ? 1 : 0.5) : 0.8;

  const terraceCells = plan.cells.filter((c) => c.role === "terrace").length;
  parts.terrace =
    profile.plot?.terracePreference || tags.includes("terrace")
      ? clamp01(terraceCells / 2)
      : terraceCells > 0
        ? 0.8
        : 0.6;

  parts.future = profile.futureProofing?.length
    ? m.bedrooms > profile.bedrooms || gross > (target.min ?? 0) * 1.2
      ? 1
      : 0.5
    : 0.8;

  // Подтверждённые данные чуть выигрывают у концептов и needsReview.
  parts.dataStatus = plan.status === "built" ? 1 : plan.status === "approved" ? 0.9 : 0.7;

  return Object.entries(SCORING_WEIGHTS).map(([key, def]) => ({
    key,
    label: def.label,
    value: clamp01(parts[key] ?? 0.5),
    weight: def.weight,
  }));
}

export function totalScore(breakdown: ScoreBreakdown[]): number {
  const sum = breakdown.reduce((acc, b) => acc + b.value * b.weight, 0);
  const weightSum = breakdown.reduce((acc, b) => acc + b.weight, 0);
  return weightSum ? sum / weightSum : 0;
}

/* ------------------------------------------------------------------ */
/* Объяснения                                                           */
/* ------------------------------------------------------------------ */

function buildReasons(plan: EcoCubPlan, profile: ClientHomeProfile): string[] {
  const reasons: string[] = [];
  const m = plan.metrics;

  if (m.bedrooms === profile.bedrooms)
    reasons.push(`${m.bedrooms} спальни — ровно под ваш состав семьи`);
  else if (m.bedrooms > profile.bedrooms)
    reasons.push(
      `${m.bedrooms} спален: есть запас под ${
        profile.guestNeed === "frequent" ? "гостевую" : "кабинет или гостевую"
      }`,
    );

  if (m.floors === 1 && profile.preferredFloors?.includes(1))
    reasons.push("всё на одном уровне — как вы и хотели");
  if (m.floors === 2)
    reasons.push("два этажа — компактный след на участке, спальни в приватной зоне");

  if (profile.officeNeed === "separate_room" && plan.fit.lifestyleTags.includes("office"))
    reasons.push("есть отдельный кабинет для работы из дома");

  const terraces = plan.cells.filter((c) => c.role === "terrace").length;
  if (terraces && profile.plot?.terracePreference)
    reasons.push(`терраса ${terraces * 9} м² — под ваш сценарий жизни на воздухе`);

  if (profile.storageNeed === "extended" && plan.fit.lifestyleTags.includes("storage"))
    reasons.push("предусмотрены гардеробные и хозяйственные зоны");

  if (!reasons.length) reasons.push("лучшее соответствие площади и бюджету среди планов EcoCub");
  return reasons;
}

function buildTradeoffs(plan: EcoCubPlan, profile: ClientHomeProfile): string[] {
  const out: string[] = [];
  const m = plan.metrics;
  const target = profile.targetArea;

  if (target?.min && m.grossAreaM2 < target.min)
    out.push(`площадь ${m.grossAreaM2} м² ниже целевой — теснее, зато экономичнее`);
  if (target?.max && m.grossAreaM2 > target.max)
    out.push(`площадь ${m.grossAreaM2} м² больше целевой — дороже в стройке и эксплуатации`);
  if (profile.officeNeed === "separate_room" && !plan.fit.lifestyleTags.includes("office"))
    out.push("отдельного кабинета нет — потребуется выделить комнату или добавить модуль");
  if (profile.guestNeed === "frequent" && m.bedrooms <= profile.bedrooms)
    out.push("частым гостям будет негде ночевать без добавления спальни");
  if (profile.budget?.max && m.confirmedPriceFrom && m.confirmedPriceFrom > profile.budget.max)
    out.push("цена выше названного бюджета");
  if (plan.needsReview)
    out.push("схема планировки условная — точную раскладку подтверждает инженер EcoCub");
  return out;
}

/* ------------------------------------------------------------------ */
/* Итоговый подбор                                                      */
/* ------------------------------------------------------------------ */

const KIND_LABELS: Record<VariantKind, string> = {
  compact: "Компактный",
  balanced: "Сбалансированный",
  spacious: "Просторный",
};

export function kindLabel(kind: VariantKind): string {
  return KIND_LABELS[kind];
}

/**
 * До трёх рекомендаций. Роли вариантов раздаются по площади среди лучших
 * по скорингу: меньший — «компактный», средний — «сбалансированный»
 * (он же лучший по скору), больший — «просторный».
 */
export function recommend(
  plans: EcoCubPlan[],
  profile: ClientHomeProfile,
): {
  recommendations: Recommendation[];
  rejected: RejectedPlan[];
} {
  const { passed, rejected } = hardFilter(plans, profile);

  const scored = passed
    .map((plan) => {
      const breakdown = scorePlan(plan, profile);
      return { plan, breakdown, score: totalScore(breakdown) };
    })
    .sort((a, b) => b.score - a.score);

  // Берём до трёх лучших, но избегаем трёх почти одинаковых площадей:
  // из пары планов с близкой площадью (±15 %) остаётся тот, что выше по скору.
  const top: typeof scored = [];
  for (const item of scored) {
    if (top.length >= 3) break;
    const similar = top.some(
      (t) =>
        Math.abs(t.plan.metrics.grossAreaM2 - item.plan.metrics.grossAreaM2) /
          t.plan.metrics.grossAreaM2 <
        0.15,
    );
    if (!similar) top.push(item);
  }
  // Если из-за фильтра похожести осталось меньше трёх — добираем лучшими.
  for (const item of scored) {
    if (top.length >= 3) break;
    if (!top.includes(item)) top.push(item);
  }

  const byArea = [...top].sort((a, b) => a.plan.metrics.grossAreaM2 - b.plan.metrics.grossAreaM2);
  const kinds: VariantKind[] =
    byArea.length === 3
      ? ["compact", "balanced", "spacious"]
      : byArea.length === 2
        ? ["compact", "spacious"]
        : ["balanced"];

  const recommendations = byArea.map((item, i) => {
    const m = item.plan.metrics;
    return {
      plan: item.plan,
      kind: kinds[i],
      score: item.score,
      breakdown: item.breakdown,
      reasons: buildReasons(item.plan, profile),
      tradeoffs: buildTradeoffs(item.plan, profile),
      allowedChanges: [
        "Добавить спальню, кабинет, санузел, хранение или террасу",
        "Увеличить кухню-гостиную",
        "Передвинуть модули с шагом 1 м, зеркально развернуть дом",
        ...(item.plan.constraints.forbiddenTransformations.length
          ? [
              `Нельзя без инженера: ${item.plan.constraints.forbiddenTransformations.join("; ").toLowerCase()}`,
            ]
          : []),
      ],
      estimate: estimatePlan(
        m.heatedAreaM2 ?? m.grossAreaM2,
        m.terraceAreaM2 ?? 0,
        m.confirmedPriceFrom,
      ),
    } satisfies Recommendation;
  });

  // «Сбалансированный» показываем первым — он в центре внимания интерфейса.
  recommendations.sort((a, b) => {
    const order: Record<VariantKind, number> = { balanced: 0, compact: 1, spacious: 2 };
    return order[a.kind] - order[b.kind];
  });

  return { recommendations, rejected };
}
