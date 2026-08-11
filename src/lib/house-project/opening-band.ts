// .ts в относительных импортах — чтобы доменные тесты гонялись через
// `node --experimental-strip-types --test`, как остальная логика проекта.
import { worldFace } from "./geometry.ts";
import type { HouseModel, Mm, ModuleInstance, OpeningInstance } from "./types.ts";

/**
 * Лента остекления: два окна соседних модулей, слитые в одно.
 *
 * Зачем это нужно. Два модуля, стоящие бок о бок, дают два окна во всю стену,
 * между которыми остаются два простенка по 210 мм — на фасаде это читается
 * как узкая перемычка посреди сплошного остекления. Обычно так и не делают:
 * либо перемычку оставляют осознанно, либо остекление ведут лентой через
 * стык. Редактор не решает за проектировщика, но обязан заметить случай и
 * предложить второй вариант — сам человек соотношение 2780 + 420 + 2780 в
 * уме не считает.
 *
 * Что делает объединение. Ровно одно: убирает простенок У СТЫКА с каждой
 * стороны, растягивая оба окна до края своей грани. Наружные простенки не
 * трогаются, габарит модуля не меняется, новых сущностей в модели не заводится.
 * После этого отрезки окон смыкаются встык, и на фасаде получается одно
 * остекление.
 *
 * Почему не «одно окно на два модуля». Проём принадлежит модулю — это не
 * условность формата, а факт производства: изделие отливается с проёмом.
 * Окно, не принадлежащее ни одному модулю, невозможно изготовить, и хранить
 * такое в модели значило бы описывать несуществующий предмет. Поэтому лента —
 * это два проёма с общим `bandId`, а не один проём на двоих.
 *
 * ВНИМАНИЕ. Снятый у стыка простенок альбомом не подтверждён: на всех
 * развёртках, где проём выходит к углу, размерная цепочка начинается отрезком
 * 210. Поэтому объединение — решение проектировщика, а проверка проекта
 * продолжает помечать такой проём как требующий подтверждения конструктором.
 */

/** Насколько точно грани должны лежать на одной прямой, мм. */
const COLLINEAR_TOLERANCE_MM: Mm = 1;

/**
 * Наибольший простенок, который объединение согласно убрать, мм.
 *
 * Ограничение по смыслу: сливать можно то, что и так почти сомкнулось. Если
 * между окнами метр стены, «объединение» означало бы расширить каждое на
 * полметра — это уже не подсказка, а переделка проекта за человека.
 */
const MAX_PIER_MM: Mm = 500;

export interface BandCandidate {
  /** Проём, от которого спрашивают. */
  openingId: string;
  /** Сосед через стык. */
  neighbourId: string;
  /** Сколько стены между окнами сейчас, мм. */
  gapMm: Mm;
  /** Насколько вырастет каждое окно и в какую сторону своей грани. */
  grow: {
    openingMm: Mm;
    /** true — окно растёт к концу своей грани, false — к началу. */
    openingToEnd: boolean;
    neighbourMm: Mm;
    neighbourToEnd: boolean;
  };
  /** Ширина получившейся ленты, мм. */
  bandWidthMm: Mm;
}

interface Placed {
  opening: OpeningInstance;
  module: ModuleInstance;
  /** Единичный вектор грани в мировых координатах. */
  ux: number;
  uy: number;
  /** Начало грани. */
  ox: number;
  oy: number;
  spanMm: Mm;
}

function place(model: HouseModel, o: OpeningInstance | undefined): Placed | null {
  if (!o) return null;
  const module = model.modules.find((m) => m.id === o.moduleId);
  if (!module) return null;
  const face = worldFace(module, o.faceId);
  const len = Math.hypot(face.to.x - face.from.x, face.to.y - face.from.y);
  if (!len) return null;
  return {
    opening: o,
    module,
    ux: (face.to.x - face.from.x) / len,
    uy: (face.to.y - face.from.y) / len,
    ox: face.from.x,
    oy: face.from.y,
    spanMm: face.spanMm,
  };
}

/** Проекция точки на прямую грани `a`: вдоль грани и поперёк неё. */
function project(a: Placed, x: number, y: number): { along: number; across: number } {
  const dx = x - a.ox;
  const dy = y - a.oy;
  return { along: dx * a.ux + dy * a.uy, across: -dx * a.uy + dy * a.ux };
}

/** Стекло ли это. Двери и открытые проёмы в ленту не собираются. */
function isGlazing(o: OpeningInstance): boolean {
  return o.kind === "window" || o.kind === "panoramic";
}

/**
 * Соседи, с которыми проём можно слить в ленту.
 *
 * Условия намеренно строгие. Разные отметки низа и верха — это не лента, а два
 * разных окна рядом, и сливать их значило бы менять размер, который человек
 * ввёл осознанно. Разные модули — обязательно: два окна одной стены сливать
 * незачем, между ними нет стыка.
 */
export function bandCandidates(model: HouseModel, openingId: string): BandCandidate[] {
  const a = place(
    model,
    model.openings.find((o) => o.id === openingId),
  );
  if (!a || !isGlazing(a.opening)) return [];

  const out: BandCandidate[] = [];
  for (const other of model.openings) {
    if (other.id === a.opening.id || other.moduleId === a.opening.moduleId) continue;
    if (!isGlazing(other)) continue;
    if (other.sillMm !== a.opening.sillMm || other.heightMm !== a.opening.heightMm) continue;
    // Уже в одной ленте — предлагать нечего.
    if (a.opening.bandId && other.bandId === a.opening.bandId) continue;

    const b = place(model, other);
    if (!b || b.module.floor !== a.module.floor) continue;

    // Грани должны лежать на одной прямой и смотреть в одну сторону.
    const start = project(a, b.ox, b.oy);
    const end = project(a, b.ox + b.ux * b.spanMm, b.oy + b.uy * b.spanMm);
    if (Math.abs(start.across) > COLLINEAR_TOLERANCE_MM) continue;
    if (Math.abs(end.across) > COLLINEAR_TOLERANCE_MM) continue;
    if (end.along <= start.along) continue; // грань соседа смотрит в другую сторону

    // Отрезки окон в единой системе координат — вдоль грани `a`.
    const aFrom = a.opening.offsetMm;
    const aTo = aFrom + a.opening.widthMm;
    const bFrom = start.along + other.offsetMm;
    const bTo = bFrom + other.widthMm;

    // Сосед справа или слева. Перекрывающиеся окна не сливаем: это не стык.
    const neighbourAfter = bFrom >= aTo;
    const neighbourBefore = bTo <= aFrom;
    if (!neighbourAfter && !neighbourBefore) continue;

    const gapMm = Math.round(neighbourAfter ? bFrom - aTo : aFrom - bTo);
    if (gapMm < 0) continue;

    // Каждое окно растягивается до края своей грани — только в сторону стыка.
    const openingToEnd = neighbourAfter;
    const neighbourToEnd = !neighbourAfter;
    const openingMm = Math.round(openingToEnd ? a.spanMm - aTo : aFrom);
    const neighbourMm = Math.round(
      neighbourToEnd ? b.spanMm - (other.offsetMm + other.widthMm) : other.offsetMm,
    );
    if (openingMm > MAX_PIER_MM || neighbourMm > MAX_PIER_MM) continue;
    // Объединение должно сомкнуть окна, а не просто немного их расширить.
    if (openingMm + neighbourMm < gapMm) continue;

    out.push({
      openingId: a.opening.id,
      neighbourId: other.id,
      gapMm,
      grow: { openingMm, openingToEnd, neighbourMm, neighbourToEnd },
      bandWidthMm: Math.round(a.opening.widthMm + other.widthMm + gapMm),
    });
  }
  return out;
}

export interface BandPatch {
  id: string;
  offsetMm: Mm;
  widthMm: Mm;
  bandId: string;
}

/**
 * Как изменятся оба проёма при объединении.
 *
 * Возвращаются готовые значения, а не «сдвинь на столько»: редактор применяет
 * их обычной правкой проёма, и объединение попадает в историю отмены одним
 * шагом, как всё остальное.
 */
export function mergeBand(
  model: HouseModel,
  candidate: BandCandidate,
  bandId: string,
): BandPatch[] {
  const a = model.openings.find((o) => o.id === candidate.openingId);
  const b = model.openings.find((o) => o.id === candidate.neighbourId);
  if (!a || !b) return [];
  const g = candidate.grow;

  return [
    {
      id: a.id,
      // Растёт к концу грани — левый край на месте; к началу — край уезжает влево.
      offsetMm: g.openingToEnd ? a.offsetMm : a.offsetMm - g.openingMm,
      widthMm: a.widthMm + g.openingMm,
      bandId,
    },
    {
      id: b.id,
      offsetMm: g.neighbourToEnd ? b.offsetMm : b.offsetMm - g.neighbourMm,
      widthMm: b.widthMm + g.neighbourMm,
      bandId,
    },
  ];
}

/** Все проёмы ленты. Пустой список, если проём в ленту не входит. */
export function bandMembers(model: HouseModel, openingId: string): OpeningInstance[] {
  const o = model.openings.find((x) => x.id === openingId);
  if (!o?.bandId) return [];
  return model.openings.filter((x) => x.bandId === o.bandId);
}
