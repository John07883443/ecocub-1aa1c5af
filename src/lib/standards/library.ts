import * as wo from "./weekend-one.ts";
import * as wm from "./weekend-mini.ts";
import * as f1 from "./family-one.ts";
import * as f2 from "./family-two.ts";
import { moduleFootprintM2 } from "./derive.ts";

/**
 * Библиотека типовых решений и подбор ближайшего.
 *
 * Идея простая. Паттерны говорят модели, «как принято» вообще; этого мало,
 * когда у клиента на экране конкретный дом. Здесь мы находим тот из
 * построенных проектов, который ближе всего к собранному, и передаём в промпт
 * его решение целиком: где оказалась общая комната, куда встал мокрый блок,
 * как посажены спальни. Модель дальше не изобретает планировку с нуля, а
 * пересаживает готовую на новый контур.
 *
 * Почему подбор, а не «взять лучший». Дом на три кубика и дом на восемь
 * решаются по-разному: в первом общая комната — это весь дом, во втором она
 * ядро, вокруг которого спальни. Подсунуть модели решение не того масштаба
 * хуже, чем не подсунуть никакого, поэтому при низкой похожести образец не
 * передаётся вовсе и остаются одни паттерны.
 */

export interface ReferenceLayout {
  id: string;
  name: string;
  /** Площадь застройки по наружным граням, м². С ней сравнивается собранный дом. */
  footprintM2: number;
  /** Сколько объёмов-модулей (или пролётов сетки) в проекте. */
  moduleCount: number;
  bedrooms: number;
  bathrooms: number;
  /** Габарит по наружным граням, м. */
  widthM: number;
  depthM: number;
  /**
   * Плотность: доля описанного прямоугольника, занятая домом. Единица —
   * прямоугольный дом, 0,7 — форма с глубоким вырезом под террасу.
   */
  compactness: number;
  /** Решение проекта — уходит в промпт как образец. */
  solutionEn: string;
  /** То же по-русски: для документации и объяснения клиенту. */
  solutionRu: string;
}

const M = moduleFootprintM2(); // 10,944

export const REFERENCE_LAYOUTS: ReferenceLayout[] = [
  {
    id: "weekend-mini",
    name: "Weekend Mini",
    footprintM2: Math.round(M * wm.MODULES.length * 100) / 100,
    moduleCount: wm.MODULES.length,
    bedrooms: 1,
    bathrooms: 1,
    widthM: 6.84,
    depthM: 6.4,
    compactness: 0.75,
    solutionRu:
      "Три модуля буквой Г. Спальня — целый модуль в дальнем углу, санузел с техшкафом — в модуле у входа, общая комната с кухонной зоной занимает оставшийся модуль и служит проходом. Терраса лежит в вырезе буквы Г и примыкает к остеклению общей комнаты.",
    solutionEn:
      "Three modules in an L. One whole module is the bedroom in the far corner. The bathroom shares a module with a technical closet next to the entrance. The remaining module is the common room with a kitchen zone, and it also serves as the circulation space. The terrace fills the notch of the L and adjoins the glazing of the common room.",
  },
  {
    id: "weekend-one",
    name: "Weekend One",
    footprintM2: Math.round(M * wo.MODULES.length * 100) / 100,
    moduleCount: wo.MODULES.length,
    bedrooms: 2,
    bathrooms: 1,
    widthM: 12.59,
    depthM: 5.13,
    compactness: 0.68,
    solutionRu:
      "Четыре модуля в линию, средняя пара смещена на половину глубины. Два средних модуля со снятой стеной образуют кухню-гостиную с панорамным остеклением. Крайний модуль справа — спальня целиком. Крайний слева поделён перегородками на тамбур, санузел и маленькую детскую. Терраса и крыльцо занимают вырезы, оставшиеся от смещения.",
    solutionEn:
      "Four modules in a row, the middle pair offset by half a module depth. The two middle modules, with the wall between them removed, form the kitchen-living room with floor-to-ceiling glazing. The module at one end is a bedroom occupying it entirely. The module at the other end is divided by partitions into a vestibule, a bathroom and a small child room. The terrace and the porch occupy the notches left by the offset.",
  },
  {
    id: "family-one",
    name: "Family One",
    footprintM2: 71.7,
    moduleCount: 6,
    bedrooms: 2,
    bathrooms: 1,
    widthM: 10.18,
    depthM: 7.05,
    compactness: 1,
    solutionRu:
      "Шесть пролётов, три на два, дом прямоугольный. Кухня и гостиная-столовая объединены в один Г-образный объём на два пролёта. Спальни угловые, каждая со своим окном, открываются прямо в общую зону. У входа собран блок: прихожая, санузел и котельная рядом. Две террасы — большая у общей зоны и малая у спален.",
    solutionEn:
      "Six bays, three by two, rectangular plan. Kitchen and living-dining are merged into one L-shaped volume spanning two bays. Bedrooms are in the corners, each with its own window, opening directly into the common zone. A service block sits at the entrance: hallway, bathroom and boiler room side by side. Two terraces: a large one at the common zone and a small one by the bedrooms.",
  },
  {
    id: "family-two",
    name: "Family Two",
    footprintM2: 95.65,
    moduleCount: 8,
    bedrooms: 3,
    bathrooms: 1,
    widthM: 13.57,
    depthM: 7.05,
    compactness: 1,
    solutionRu:
      "Восемь пролётов, четыре на два. Кухня-гостиная 35 м² занимает два средних пролёта на всю глубину дома и работает распределителем: все три спальни открываются прямо в неё. Спальни угловые, по 9,1–9,6 м². Мокрый блок с прихожей и котельной вдвинут в общую комнату с южной стороны. Две террасы под вылетом кровли.",
    solutionEn:
      "Eight bays, four by two. The 35 m2 kitchen-living room occupies the two middle bays across the full depth and works as the distributor: all three bedrooms open directly into it. Bedrooms are in the corners, 9.1 to 9.6 m2 each. The wet block with the hallway and boiler room is pushed into the common room from the south side. Two terraces sit under the roof overhang.",
  },
];

/** То, что известно о собранном доме к моменту подбора. */
export interface HouseSignature {
  footprintM2: number;
  moduleCount: number;
  widthM: number;
  depthM: number;
  bedrooms: number;
}

export interface ReferenceMatch {
  layout: ReferenceLayout;
  /** Похожесть 0…1. Ниже порога образец не используется. */
  similarity: number;
  /** Почему выбран именно он — для лога и для объяснения клиенту. */
  why: string;
}

/** Ниже этого образец скорее собьёт модель, чем поможет. */
export const MIN_SIMILARITY = 0.55;

function closeness(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

/**
 * Ближайший типовой проект.
 *
 * Считаем четыре независимые близости и взвешиваем. Площадь весит больше
 * остального: решение на 27 м² и решение на 96 м² не переносятся друг в
 * друга, сколько бы ни совпадали пропорции. Плотность отделяет
 * прямоугольный дом от формы с вырезом под террасу — это разные приёмы
 * планировки, а не разная эстетика.
 */
export function matchReference(house: HouseSignature): ReferenceMatch | null {
  const houseCompactness =
    house.widthM > 0 && house.depthM > 0
      ? Math.min(1, house.footprintM2 / (house.widthM * house.depthM))
      : 1;
  const houseAspect = house.depthM > 0 ? house.widthM / house.depthM : 1;

  let best: ReferenceMatch | null = null;
  for (const layout of REFERENCE_LAYOUTS) {
    const byArea = closeness(house.footprintM2, layout.footprintM2);
    const byModules = closeness(house.moduleCount, layout.moduleCount);
    const byCompactness = closeness(houseCompactness, layout.compactness);
    const byAspect = closeness(houseAspect, layout.widthM / layout.depthM);
    const similarity = byArea * 0.45 + byModules * 0.2 + byCompactness * 0.2 + byAspect * 0.15;

    if (!best || similarity > best.similarity) {
      best = {
        layout,
        similarity: Math.round(similarity * 100) / 100,
        why: `площадь ${house.footprintM2} против ${layout.footprintM2} м², модулей ${house.moduleCount} против ${layout.moduleCount}, плотность ${houseCompactness.toFixed(2)} против ${layout.compactness}`,
      };
    }
  }
  return best && best.similarity >= MIN_SIMILARITY ? best : null;
}

/**
 * Блок промпта с образцом.
 *
 * Формулировка намеренно жёсткая в части контура и мягкая в части решения:
 * пересаживать надо приём, а не обводку. Модель, которой сказали «повтори
 * проект», начинает подгонять под него геометрию — а геометрия у нас
 * неприкосновенна.
 */
export function referenceBriefing(match: ReferenceMatch): string {
  return [
    `CLOSEST BUILT PROJECT (${match.layout.name}, ${match.layout.footprintM2} m2, ${match.layout.bedrooms} bedrooms):`,
    match.layout.solutionEn,
    "",
    "Adapt this proven solution to the given footprint: keep the same reasoning about where the common room, the wet block and the bedrooms go. Do NOT copy its outline — the footprint in the reference image always wins.",
  ].join("\n");
}
