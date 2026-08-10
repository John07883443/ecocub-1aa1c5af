import { MODULE, OPENING_HEIGHTS, DOOR_OPENING } from "./ecocub.ts";
import * as wo from "./weekend-one.ts";
import * as wm from "./weekend-mini.ts";
import * as f1 from "./family-one.ts";
import * as f2 from "./family-two.ts";
import * as sf from "./super-family.ts";
import * as nas from "./nasledie.ts";
import * as din from "./dinastiya.ts";

/**
 * Паттерны проектирования EcoCub, выведенные из построенных проектов.
 *
 * Отличие от `PLANNING_RULES` в `ecocub.ts`: там правила про геометрию —
 * что с чем стыкуется и на сколько смещается. Здесь — про смысл: где обычно
 * оказывается мокрая зона, какое остекление получает общая комната, чем
 * терраса отличается от пристройки. Именно этого не хватало генерациям:
 * контур модель держала, а внутри рисовала абстрактную квартиру.
 *
 * Источник — два проекта: Weekend One (рабочий альбом, 4 модуля, линейная
 * раскладка) и Weekend Mini (заводская планировка, 3 модуля, Г-образная).
 * Паттерн попадает сюда, только если подтверждён хотя бы одним из них, и
 * несёт ссылку на подтверждение — чтобы через полгода не гадать, откуда
 * взялось «так принято».
 */

export type PatternGroup = "layout" | "openings" | "entrance" | "terrace" | "roof";

export interface DesignPattern {
  id: string;
  group: PatternGroup;
  /** Формулировка по-русски — для документации и разговора с архитектором. */
  rule: string;
  /** Формулировка по-английски — уходит в промпт генерации как есть. */
  en: string;
  /** Чем подтверждается. Без подтверждения паттерна здесь быть не должно. */
  evidence: string;
}

export const PATTERNS: DesignPattern[] = [
  // ── Планировка ────────────────────────────────────────────────────────
  {
    id: "bedroom-is-one-module",
    group: "layout",
    rule: "Спальня занимает ровно один модуль и не делится перегородками.",
    en: "A bedroom occupies exactly one module and is never subdivided: one door, no internal partitions.",
    evidence:
      "Weekend One: спальня 8,34 м² = чистый габарит модуля. Weekend Mini: спальная 9,3 м².",
  },
  {
    id: "living-spans-two-modules",
    group: "layout",
    rule: "Кухня-гостиная собирается из двух модулей со снятой стеной между ними и остаётся единым объёмом.",
    en: "The kitchen-living room spans two adjacent modules with the wall between them removed, forming one continuous space. Never split it with a partition.",
    evidence: "Weekend One: кухня-гостиная 17,35 м² на модулях B и C с общей стеной.",
  },
  {
    id: "wet-zone-single-module",
    group: "layout",
    rule: "Санузел, бойлер и технический шкаф стоят рядом в одном модуле: стояк один.",
    en: "Bathroom, boiler closet and technical storage sit side by side inside one module so that all plumbing shares a single riser. Never scatter wet rooms across the house.",
    evidence: "Weekend One: С/У 2,26 и бойлер 0,57. Weekend Mini: С/У 3,8 с тех. шкафом вплотную.",
  },
  {
    id: "service-rooms-share-a-module",
    group: "layout",
    rule: "Мелкие помещения — тамбур, кладовая, детская — делят один модуль с санузлом, а не занимают свой.",
    en: "Small service rooms (vestibule, pantry, boiler, small child room) share one module with the bathroom instead of taking a module each.",
    evidence: "Weekend One, модуль A: тамбур 1,34 + С/У 2,26 + детская 4,31 в одном модуле.",
  },
  {
    id: "no-dedicated-corridor",
    group: "layout",
    rule: "Отдельного коридора нет: проход идёт через раскрытые стыки модулей и через общую комнату.",
    en: "There is no dedicated corridor room. Circulation runs through the opened module joints and across the common room.",
    evidence:
      "Weekend Mini: оба стыка раскрыты. Family One и Family Two: все спальни открываются прямо в общую комнату, коридора нет ни в одном из четырёх проектов.",
  },
  {
    id: "rooms-align-to-modules",
    group: "layout",
    rule: "Границы помещений совпадают с гранями модулей; перегородка внутри модуля — исключение, а не приём.",
    en: "Room boundaries coincide with module edges. Partitions inside a module are the exception and are used only for the wet-zone module.",
    evidence: "Оба проекта: из семи помещений Weekend One шесть ограничены гранями модулей.",
  },

  // ── Приёмы, подтверждённые размерными планами Family One и Family Two ──
  {
    id: "common-room-is-the-core",
    group: "layout",
    rule: "Общая комната — ядро дома и распределитель: она занимает середину на всю глубину, спальни открываются прямо в неё.",
    en: "The common room is the core of the house: it occupies the middle bays across the full depth of the plan and doubles as the circulation hub. Every bedroom door opens directly into it.",
    evidence:
      "Family Two: кухня-гостиная 35 м² на два средних пролёта, 6406 × 6144, три спальни выходят в неё. Family One: то же на меньшем доме.",
  },
  {
    id: "bedrooms-in-corners",
    group: "layout",
    rule: "Спальни стоят по углам дома: у каждой две наружные стены и своё окно.",
    en: "Bedrooms sit in the corners of the plan, each with two exterior walls and its own window. Never place a bedroom in the middle without exterior wall access.",
    evidence: "Family One и Family Two: все спальни угловые, по 9,1–9,6 м².",
  },
  {
    id: "bedroom-size-is-stable",
    group: "layout",
    rule: "Спальня держит один размер независимо от площади дома: около 9–9,6 м². Дом растёт общей комнатой, а не спальнями.",
    en: "Bedroom size stays constant regardless of house size: about 9 to 9.6 m2. A larger house grows its common room, not its bedrooms.",
    evidence:
      "Family One 56 м²: спальни 9,6 и 8,0, общая зона 29,1. Family Two 74 м²: спальни те же 9,6 и 9,1, общая комната 35.",
  },
  {
    id: "entry-block",
    group: "layout",
    rule: "У входа собирается один блок: прихожая, санузел и котельная рядом, отделённые от общей комнаты перегородками.",
    en: "A single service block sits at the entrance: hallway, bathroom and boiler room next to each other, separated from the common room by partitions.",
    evidence:
      "Family One: прихожая 5,1 + С/У 3,2 + котельная 1,8. Family Two: прихожая 3,4 + С/У 4,3 + котельная 2,0 + кладовая 2,7.",
  },
  {
    id: "partition-thinner-than-wall",
    group: "openings",
    rule: "Перегородок две толщины: 190 мм между помещениями и 125 мм вокруг санузлов и гардеробных. Обе тоньше наружной стены модуля в 210 мм.",
    en: "Partitions come in two thicknesses: 190 mm between rooms and 125 mm around bathrooms and closets. Both are thinner than the 210 mm module wall — draw them visibly thinner.",
    evidence:
      "Family One, Family Two и Super Family: 190 и 125 проставлены на всех трёх размерных планах.",
  },
  {
    id: "door-widths-are-discrete",
    group: "openings",
    rule: "Ширины дверных проёмов дискретны: 800 в помещения, 1000–1200 в общие зоны. Промежуточных нет.",
    en: "Door widths are discrete: 800 mm into rooms, 1000 to 1200 mm into common zones. Never use any other width.",
    evidence: "Family One: 800 и 1000. Family Two: 800, 1000, 1200.",
  },
  {
    id: "recessed-entrance",
    group: "entrance",
    rule: "Вход утоплен в объём дома под вылет кровли и оформлен деревянными рейками — козырька-пристройки нет.",
    en: "The entrance is recessed into the building volume under the roof overhang and framed with vertical wood slats. There is no separate porch canopy attached to the facade.",
    evidence: "Family One и Family Two: на визуализациях вход в нише, реечный экран по бокам.",
  },
  {
    id: "two-covered-terraces",
    group: "terrace",
    rule: "Террас обычно две: главная у общей комнаты и вспомогательная у спален. Обе накрыты вылетом кровли.",
    en: "There are usually two terraces: a main one at the common room and a smaller one by the bedrooms. Both are covered by the roof overhang rather than by a separate canopy.",
    evidence: "Family One: 21,7 и 6,8. Family Two: 13,9 и 6,1, обе подписаны «терраса с навесом».",
  },
  {
    id: "dining-splits-at-90",
    group: "layout",
    rule: "Около 90 м² общая зона делится на кухню-гостиную и столовую — две зоны одного объёма без двери между ними.",
    en: "Around 90 m2 the common zone splits into a kitchen-living area and a separate dining area: two zones of one continuous volume, with no door between them.",
    evidence:
      "Super Family: кухня-гостиная 22,4 и столовая 11,4 при единой общей зоне 33,8. У Family Two те же 35 м² были одной комнатой.",
  },
  {
    id: "second-bathroom-at-90",
    group: "layout",
    rule: "Второй санузел и постирочная появляются около 90 м². До того — один санузел на дом.",
    en: "A second bathroom and a laundry room appear around 90 m2. Below that there is exactly one bathroom in the house.",
    evidence:
      "Weekend Mini, Weekend One, Family One, Family Two — по одному С/У. Super Family: 3,8 и 3,7 плюс постирочная 2,3.",
  },
  {
    id: "walk-in-closets-at-90",
    group: "layout",
    rule: "Гардеробные ставятся вплотную к спальням и появляются на крупных домах: у родителей и у детской.",
    en: "Walk-in closets are placed directly against the bedrooms they serve and appear only in larger houses: one for the main bedroom, one for the children.",
    evidence:
      "Super Family: гардероб 3,6 при спальне и 2,7 при детской. На домах до 74 м² гардеробных нет.",
  },
  {
    id: "wings-separate-generations",
    group: "layout",
    rule: "На крупном доме спальня родителей и детские разносятся по разным крыльям, общая зона между ними.",
    en: "In a larger house the main bedroom and the children rooms go into different wings, with the common zone between them.",
    evidence:
      "Super Family: спальня с гардеробом и своим С/У в одном крыле, две детские — в других, кухня-гостиная посередине.",
  },
  {
    id: "two-notches",
    group: "terrace",
    rule: "П-образный дом даёт два выреза: в одном терраса, во втором зелёный двор между крыльями.",
    en: "A U-shaped house creates two notches: one holds the terrace, the other a small green courtyard between the wings.",
    evidence: "Super Family: терраса 20,8 в одном вырезе, озеленённый двор во втором.",
  },
  {
    id: "master-suite",
    group: "layout",
    rule: "На домах от 110 м² спальня родителей превращается в блок: спальня, свой санузел и гардероб рядом, вход один.",
    en: "From about 110 m2 the main bedroom becomes a suite: bedroom, its own bathroom and a walk-in closet grouped together behind a single entrance.",
    evidence:
      "Nasledie: спальня 11,3 + гардероб 3,6 + С/У 3,8 = 18,7 м². Dinastiya: спальня 14,2 + ванная 9 + гардероб 3,3 = 26,5 м².",
  },
  {
    id: "bathrooms-scale-with-size",
    group: "layout",
    rule: "Число санузлов — мера масштаба: один до 75 м², два на 90–115, три на 130 и выше. Третий — гостевой у прихожей.",
    en: "The number of bathrooms scales with the house: one below 75 m2, two between 90 and 115, three above 130. The third one is a small guest toilet next to the hallway.",
    evidence:
      "Family Two 74 м² — один. Super Family 92 и Nasledie 113 — два. Dinastiya 133 — три: главная ванная 9, общая 3,7 и гостевой С/У 2.",
  },
  {
    id: "children-mirrored",
    group: "layout",
    rule: "Детские ставятся зеркально по краям одного торца, между ними — общая ванная и кладовые.",
    en: "Children rooms are placed symmetrically at the two corners of one end of the house, with the shared bathroom and storage between them.",
    evidence:
      "Dinastiya: детские по 13,1 по краям торца, между ними общая ванная 3,7 и С/У 2. Super Family: детские в разных крыльях от спальни родителей.",
  },
  {
    id: "service-block-grows",
    group: "layout",
    rule: "Технические помещения растут вместе с домом: котельная 2 м² на среднем доме превращается в блок прачечной с кладовой на 9,6 и котельной на 5.",
    en: "Technical rooms grow with the house: a 2 m2 boiler closet in a mid-size house becomes a service block with a 9.6 m2 laundry-storage and a 5 m2 boiler room.",
    evidence:
      "Family Two 74 м²: котельная 2. Nasledie 113 м²: прачечная 3,6 и кладовая. Dinastiya 133 м²: прачечная-кладовая 9,6 и котельная 5.",
  },

  // ── Проёмы и остекление ───────────────────────────────────────────────
  {
    id: "opening-heights",
    group: "openings",
    rule: "Проёмы бывают четырёх высот: 2100, 2500, 2800 и 3150 мм от чистого пола. Промежуточных нет.",
    en: "Openings come in four heights only, measured from the finished floor: 2100, 2500, 2800 and 3150 mm. Never draw an opening of any other height.",
    evidence:
      "Развёртки Р-1…Р-4 листов 12–15: каждая вертикальная цепочка даёт 300 + проём + простенок + 300 = 3750.",
  },
  {
    id: "panoramic-on-living",
    group: "openings",
    rule: "Общая комната получает панорамное остекление во всю высоту помещения — 3150 мм, без подоконника и простенка.",
    en: "The kitchen-living room gets floor-to-ceiling glazing, the full 3150 mm clear height, with no sill and no wall above. It runs across whole structural bays.",
    evidence: "Weekend One, модуль B: три наружные грани остеклены на всю высоту 3150.",
  },
  {
    id: "bedroom-window-is-lower",
    group: "openings",
    rule: "Спальня остекляется скромнее общей комнаты: проём 2500 или 2800 мм, часто плюс узкая щель 500 мм.",
    en: "Bedrooms are glazed more modestly than the living room: a 2500 or 2800 mm high opening, sometimes plus a narrow 500 mm wide slot window.",
    evidence: "Weekend One, модуль A: Р-3 высотой 2500 и Р-4 со щелью 500 мм высотой 2100.",
  },
  {
    id: "blank-face-exists",
    group: "openings",
    rule: "Глухая грань — нормальное решение: модуль, обращённый к соседнему или к границе участка, остаётся без проёмов.",
    en: "A completely blank facade is a valid and common solution. A module face turned towards a neighbouring module or towards the plot boundary carries no opening at all.",
    evidence: "Weekend One, модуль D: развёртки Р-1 и Р-3 без проёмов вовсе.",
  },
  {
    id: "openings-fill-bays",
    group: "openings",
    rule: "Проём занимает целый пролёт между колоннами каркаса, а не вырезается посреди стены.",
    en: "An opening fills a whole structural bay between columns; it is never a small hole punched in the middle of a wall. Openings start and end at the panel joints.",
    evidence:
      "Развёртки листов 12–15: границы белых проёмов совпадают с делениями размерных цепочек.",
  },
  {
    id: "door-size",
    group: "openings",
    rule: `Дверной проём — ${DOOR_OPENING.widthMm} × ${DOOR_OPENING.heightMm} мм.`,
    en: `Doors are ${DOOR_OPENING.widthMm} mm wide and ${DOOR_OPENING.heightMm} mm high.`,
    evidence:
      "Weekend One, модуль D, развёртка Р-4. Подтверждено размерными планами Family One и Family Two: 800 в обоих.",
  },

  // ── Вход ──────────────────────────────────────────────────────────────
  {
    id: "entrance-from-terrace",
    group: "entrance",
    rule: "Вход в дом — со стороны террасы или крыльца, а не с глухого торца.",
    en: "The main entrance opens onto the terrace or the porch deck, never from a blank end wall.",
    evidence:
      "Weekend One: крыльцо 10,95 м² перед входом. Weekend Mini: вход с террасы в общую комнату.",
  },
  {
    id: "vestibule-optional",
    group: "entrance",
    rule: "Тамбур ставят, когда дом рассчитан на круглогодичное проживание; в компактных домах входят прямо в общую комнату.",
    en: "A vestibule is added for year-round houses; in compact houses the entrance leads straight into the common room.",
    evidence: "Weekend One: тамбур 1,34 м². Weekend Mini: тамбура нет, вход в общую комнату.",
  },
  {
    id: "entrance-on-long-face",
    group: "entrance",
    rule: "Входная дверь ставится на длинной грани модуля (3420 мм), рядом с краем, а не по центру.",
    en: "The entrance door sits on the long 3420 mm face of a module, offset towards one end rather than centred.",
    evidence: "Weekend One, модуль D, Р-4: цепочка 600 | 800 | 2020.",
  },

  // ── Терраса ───────────────────────────────────────────────────────────
  {
    id: "terrace-fills-the-notch",
    group: "terrace",
    rule: "Терраса занимает вырез прямоугольника застройки, образованный смещением модулей. Отдельного модуля террасе не выделяют.",
    en: "The terrace occupies the notch in the building rectangle created by offsetting the modules. It is a deck, not a module: it has no walls and no roof slab of its own.",
    evidence: "Weekend One: 12590 × 6920 минус тёплый контур = терраса 27,10 и крыльцо 10,95.",
  },
  {
    id: "terrace-is-large",
    group: "terrace",
    rule: "Терраса сопоставима по площади с домом: от 60 % тёплого контура и выше.",
    en: "The terrace is large: comparable in area to the heated part of the house, from about 60 % of it upwards.",
    evidence: "Weekend One: 27,10 при 43,8 тёплого контура. Weekend Mini: 25,8 при 27 м² дома.",
  },
  {
    id: "terrace-meets-glazing",
    group: "terrace",
    rule: "Терраса примыкает к панорамным граням общей комнаты — из неё выходят на настил.",
    en: "The terrace adjoins the fully glazed faces of the common room, so the glazing opens directly onto the deck.",
    evidence: "Оба проекта: настил примыкает к остеклённым граням кухни-гостиной и общей комнаты.",
  },
  {
    id: "decking-and-canopy",
    group: "terrace",
    rule: "Настил рисуется досками вдоль длинной стороны; накрытая часть отделяется линией навеса.",
    en: "Deck boards run parallel to the long side of the house. The covered part of the deck is separated by a canopy line.",
    evidence: "Weekend Mini: подпись «линия навеса» на заводской планировке.",
  },

  // ── Кровля ────────────────────────────────────────────────────────────
  {
    id: "flat-exploitable-roof",
    group: "roof",
    rule: "Кровля плоская, эксплуатируемая, с вылетом за габарит стен и пазом 100 × 20 мм под LED-ленту.",
    en: "The roof is flat and exploitable, overhanging the walls, with a 100 x 20 mm groove for an LED strip along the perimeter. Never draw a pitched roof.",
    evidence: "Лист 6 «План кровли»: габарит 13600 × 10400 против 12590 × 6920 по стенам.",
  },
];

/** Паттерны одной группы. */
export function patternsOf(group: PatternGroup): DesignPattern[] {
  return PATTERNS.filter((p) => p.group === group);
}

/**
 * Блок для промпта генерации планировки.
 *
 * Английский — язык промпта, поэтому берутся поля `en`. Числа подставляются
 * из стандарта, а не пишутся руками: если габарит модуля когда-нибудь
 * уточнят по новому альбому, промпт поедет следом сам.
 */
export interface BriefingModule {
  externalWidthMm: number;
  externalDepthMm: number;
  wallThicknessMm: number;
  clearHeightMm: number;
}

export function patternBriefing(module: BriefingModule = MODULE): string {
  const line = (p: DesignPattern) => `- ${p.en}`;
  const heights = OPENING_HEIGHTS.map((h) => h.heightMm).join(", ");
  // Габарит берётся снаружи, а не из стандарта напрямую: промпт обязан
  // описывать тот модуль, который нарисован на исходном контуре. Иначе текст
  // спорит с картинкой, и модель верит тексту.
  const clearW = module.externalWidthMm - module.wallThicknessMm * 2;
  const clearD = module.externalDepthMm - module.wallThicknessMm * 2;

  return [
    "ECOCUB DESIGN PATTERNS (taken from built projects — follow them, they are not suggestions):",
    "",
    `Module: external ${module.externalWidthMm} x ${module.externalDepthMm} mm, walls ${module.wallThicknessMm} mm, clear inside ${clearW} x ${clearD} mm, clear height ${module.clearHeightMm} mm. Allowed opening heights: ${heights} mm.`,
    "",
    "PLAN:",
    ...patternsOf("layout").map(line),
    "",
    "WINDOWS AND OPENINGS:",
    ...patternsOf("openings").map(line),
    "",
    "ENTRANCE:",
    ...patternsOf("entrance").map(line),
    "",
    "TERRACE:",
    // Оговорка обязательна. Паттерны террасы описывают, как она устроена в
    // построенных домах, а на исходном контуре террасы не размечены — без
    // этой строки модель начнёт рисовать настил за пределами контура и
    // сломает единственное жёсткое правило генерации.
    "- Any deck or terrace must stay strictly inside the given footprint. Never draw decking, paving or landscape in the dark area outside the outline.",
    ...patternsOf("terrace").map(line),
    "",
    "ROOF AND SECTION:",
    ...patternsOf("roof").map(line),
  ].join("\n");
}

/** Опорные проекты, на которых держатся паттерны. Для документации и UI. */
export const REFERENCE_PROJECTS = [
  {
    id: "weekend-one",
    name: "Weekend One",
    areaM2: 43.8,
    modules: wo.MODULES.length,
    shape: "линейная",
    evidence: "рабочий архитектурный альбом, 25 листов",
  },
  {
    id: "weekend-mini",
    name: "Weekend Mini",
    areaM2: 27,
    modules: wm.MODULES.length,
    shape: "Г-образная",
    evidence: "заводская планировка и карточка каталога",
  },
  {
    id: "family-one",
    name: "Family One",
    areaM2: f1.CATALOG.houseAreaM2,
    modules: 6,
    shape: "прямоугольная, 3 × 2 пролёта",
    evidence: "размерный план и карточка каталога",
  },
  {
    id: "family-two",
    name: "Family Two",
    areaM2: f2.CATALOG.houseAreaM2,
    modules: 8,
    shape: "прямоугольная, 4 × 2 пролёта",
    evidence: "размерный план и карточка каталога",
  },
  {
    id: "super-family",
    name: "Super Family",
    areaM2: sf.CATALOG.houseAreaM2,
    modules: 11,
    shape: "П-образная, два выреза",
    evidence: "размерный план",
  },
  {
    id: "nasledie",
    name: "Nasledie",
    areaM2: nas.CATALOG.planSumM2,
    modules: 12,
    shape: "прямоугольная, 3 × 4 модуля",
    evidence: "размерный план, снял расхождение сеток",
  },
  {
    id: "dinastiya",
    name: "Dinastiya",
    areaM2: din.CATALOG.planSumM2,
    modules: 16,
    shape: "прямоугольная, 4 × 4 модуля",
    evidence: "размерный план, вторичное подтверждение модуля",
  },
];
