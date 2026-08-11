// .ts в относительных импортах — чтобы доменные тесты гонялись через
// `node --experimental-strip-types --test`, как остальная логика проекта.
import { BASE_MODULE, OPENING_PRESETS } from "./catalog.ts";
import { defOf, localFace, worldFace } from "./geometry.ts";
import type { FaceId, Mm, ModuleInstance, OpeningKind } from "./types.ts";
import { FACE_IDS } from "./types.ts";

/**
 * Постановка проёма на стену: куда попал курсор и какие размеры предложить.
 *
 * Раньше проём ставился только через клик по шестипиксельной полоске грани, а
 * потом сдвигался числом. Полоску надо было найти мышью, и промах по ней ничем
 * не отличался от клика по пустому месту. Здесь грань ищется геометрически —
 * по расстоянию от курсора до отрезка стены, — поэтому проём можно бросить
 * рядом со стеной и попасть в неё.
 *
 * Второе, что делает этот файл: предлагает готовые размеры. Проектировщик
 * почти никогда не хочет произвольную ширину — он хочет «во всю стену»,
 * «половина», «треть». Эти доли считаются от ЧИСТОЙ длины стены, то есть за
 * вычетом двух простенков по 210 мм: проём во всю грань физически невозможен,
 * потому что по краям стоит стена.
 */

/** Ширина стены — константа продукта, 210 мм. Берётся из стандарта. */
export const WALL_MM: Mm = BASE_MODULE.wallThicknessMm;

/** Уже этого проём не бывает: 300 мм — это уже не проём, а щель в кладке. */
const MIN_WIDTH_MM: Mm = 300;

export interface OpeningTool {
  presetId: string;
  label: string;
  kind: OpeningKind;
  /**
   * Ширина при постановке: вся чистая длина стены или число из справочника.
   *
   * «Вся стена» не может быть числом в справочнике: у короткой грани это
   * 2780, у длинной 3000, и записать одно из них значило бы поставить не тот
   * размер на половине стен.
   */
  widthMode: "full" | "preset";
}

/**
 * Инструменты верхней панели.
 *
 * Каждый ссылается на пресет из справочника: собственных чисел здесь нет и
 * быть не может, иначе панель и каталог разъедутся. Тест проверяет, что все
 * четыре идентификатора существуют.
 *
 * Окно по умолчанию — в пол и во всю стену. Это не вкусовое решение: так
 * выглядит почти всё, что сегодня строится из модулей, и первое, что человек
 * ставит, должно попадать в частый случай. Подоконник и половинная ширина
 * никуда не делись — они в готовых вариантах рядом с полем ширины.
 */
export const OPENING_TOOLS: OpeningTool[] = [
  { presetId: "window-full", label: "Окно", kind: "window", widthMode: "full" },
  { presetId: "entrance-door", label: "Дверь", kind: "door", widthMode: "preset" },
  { presetId: "panoramic-3150", label: "Витраж", kind: "panoramic", widthMode: "full" },
  { presetId: "passage-open", label: "Проём", kind: "passage", widthMode: "full" },
];

export function findOpeningTool(presetId: string): OpeningTool | undefined {
  return OPENING_TOOLS.find((t) => t.presetId === presetId);
}

export interface FaceHit {
  moduleId: string;
  faceId: FaceId;
  /** Расстояние от точки до стены, мм. */
  distanceMm: Mm;
  /** Сколько миллиметров от начала грани до проекции точки. */
  alongMm: Mm;
  spanMm: Mm;
}

/** Расстояние от точки до отрезка и положение проекции вдоль него. */
function projectOnSegment(
  p: { x: Mm; y: Mm },
  from: { x: Mm; y: Mm },
  to: { x: Mm; y: Mm },
): { distanceMm: Mm; alongMm: Mm } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { distanceMm: Math.hypot(p.x - from.x, p.y - from.y), alongMm: 0 };
  const raw = ((p.x - from.x) * dx + (p.y - from.y) * dy) / len;
  const along = Math.max(0, Math.min(len, raw));
  const cx = from.x + (dx / len) * along;
  const cy = from.y + (dy / len) * along;
  return { distanceMm: Math.hypot(p.x - cx, p.y - cy), alongMm: along };
}

/**
 * Ближайшая к точке стена среди модулей активного этажа.
 *
 * Порог задаётся вызывающим в миллиметрах модели, а не в пикселях: на разном
 * масштабе «рядом со стеной» — это разное количество миллиметров, и считать
 * порог должен тот, кто знает масштаб.
 */
export function nearestFace(
  modules: ModuleInstance[],
  floor: number,
  point: { x: Mm; y: Mm },
  maxDistanceMm: Mm,
): FaceHit | null {
  let best: FaceHit | null = null;
  for (const m of modules) {
    if (m.floor !== floor) continue;
    for (const faceId of FACE_IDS) {
      const face = worldFace(m, faceId);
      const { distanceMm, alongMm } = projectOnSegment(point, face.from, face.to);
      if (distanceMm > maxDistanceMm) continue;
      if (best && distanceMm >= best.distanceMm) continue;
      best = { moduleId: m.id, faceId, distanceMm, alongMm, spanMm: face.spanMm };
    }
  }
  return best;
}

/** Чистая длина стены: грань за вычетом двух простенков по толщине стены. */
export function clearSpanMm(spanMm: Mm, wallMm: Mm = WALL_MM): Mm {
  return Math.max(0, spanMm - wallMm * 2);
}

export interface Placement {
  offsetMm: Mm;
  widthMm: Mm;
}

/**
 * Проём заданной ширины по курсору.
 *
 * Курсор — это середина проёма, а не его край: человек целится в то место
 * стены, где проём должен оказаться. Дальше проём держится в пределах чистой
 * длины стены, то есть не наезжает на угловые простенки. Именно из-за этого
 * ограничения ширина «во всю стену» равна 2780 при грани 3200, а не 3200.
 */
export function placeOnFace(spanMm: Mm, alongMm: Mm, widthMm: Mm, wallMm: Mm = WALL_MM): Placement {
  const clear = clearSpanMm(spanMm, wallMm);
  const width = Math.max(MIN_WIDTH_MM, Math.min(Math.round(widthMm), clear || spanMm));
  const min = clear > 0 ? wallMm : 0;
  const max = Math.max(min, spanMm - (clear > 0 ? wallMm : 0) - width);
  return {
    offsetMm: Math.round(Math.max(min, Math.min(max, alongMm - width / 2))),
    widthMm: width,
  };
}

export interface WidthOption {
  id: string;
  label: string;
  widthMm: Mm;
}

/**
 * Предсказуемые ширины: во всю стену и доли от неё.
 *
 * Округление до 10 мм — потому что размерные цепочки альбома кратны десяти, и
 * ширина 926 мм в проекте выглядела бы как ошибка ввода. Кому нужна ровно
 * такая — вводит её числом в поле рядом.
 */
export function widthOptions(spanMm: Mm, wallMm: Mm = WALL_MM): WidthOption[] {
  const clear = clearSpanMm(spanMm, wallMm);
  const fractions: { id: string; label: string; k: number }[] = [
    { id: "full", label: "Во всю стену", k: 1 },
    { id: "three-quarters", label: "¾", k: 3 / 4 },
    { id: "half", label: "½", k: 1 / 2 },
    { id: "third", label: "⅓", k: 1 / 3 },
    { id: "quarter", label: "¼", k: 1 / 4 },
  ];
  const seen = new Set<Mm>();
  const out: WidthOption[] = [];
  for (const f of fractions) {
    const widthMm = Math.round((clear * f.k) / 10) * 10;
    if (widthMm < MIN_WIDTH_MM || seen.has(widthMm)) continue;
    seen.add(widthMm);
    out.push({ id: f.id, label: `${f.label} · ${widthMm}`, widthMm });
  }
  return out;
}

export interface HeightOption {
  id: string;
  label: string;
  sillMm: Mm;
  heightMm: Mm;
}

/**
 * Предсказуемые высоты — все из подтверждённых отметок альбома.
 *
 * Пара «низ + высота», а не одна цифра: в модели проём описан именно так, и
 * переводить отметку верха в высоту в каждом месте интерфейса заново значит
 * рано или поздно ошибиться знаком. Варианты выше потолка отбрасываются — на
 * модуле с меньшей высотой помещения их просто не будет в списке.
 */
export function heightOptions(clearHeightMm: Mm = BASE_MODULE.clearHeightMm): HeightOption[] {
  const variants: { id: string; label: string; sillMm: Mm; topMm: Mm }[] = [
    { id: "floor-3150", label: "В пол · до 3150", sillMm: 0, topMm: 3150 },
    { id: "floor-2800", label: "В пол · до 2800", sillMm: 0, topMm: 2800 },
    { id: "door-2100", label: "Дверь · до 2100", sillMm: 0, topMm: 2100 },
    { id: "sill-2800", label: "От 700 · до 2800", sillMm: 700, topMm: 2800 },
    { id: "sill-2500", label: "От 700 · до 2500", sillMm: 700, topMm: 2500 },
    { id: "sill-2100", label: "От 700 · до 2100", sillMm: 700, topMm: 2100 },
  ];
  return variants
    .filter((v) => v.topMm <= clearHeightMm && v.topMm > v.sillMm)
    .map((v) => ({ id: v.id, label: v.label, sillMm: v.sillMm, heightMm: v.topMm - v.sillMm }));
}

/** Длина грани модуля с учётом его типа. */
export function faceSpanMm(module: ModuleInstance, faceId: FaceId): Mm {
  return localFace(defOf(module), faceId).spanMm;
}

/** Толщина стены модуля. Продуктовая константа, но берётся у типа. */
export function wallOf(module: ModuleInstance): Mm {
  return defOf(module).wallThicknessMm;
}

/**
 * Ширина проёма по пресету на конкретной грани.
 *
 * Инструменты с `widthMode: "full"` растягиваются на всю чистую длину стены —
 * на короткой грани это 2780, на длинной 3000. Остальные берут число из
 * справочника, ужатое до той же чистой длины: входная дверь 800 остаётся 800.
 */
export function presetWidthOn(module: ModuleInstance, faceId: FaceId, presetId: string): Mm {
  const preset = OPENING_PRESETS.find((p) => p.id === presetId) ?? OPENING_PRESETS[0];
  const clear = clearSpanMm(faceSpanMm(module, faceId), wallOf(module));
  if (findOpeningTool(presetId)?.widthMode === "full") return Math.max(MIN_WIDTH_MM, clear);
  return Math.max(MIN_WIDTH_MM, Math.min(preset.widthMm, clear));
}
