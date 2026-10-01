/**
 * Сценарий жизни → программа помещений → минимальная площадь → честная проверка.
 *
 * Человек говорит «нас четверо, собака, я работаю из дома», а не «3 спальни и
 * кухня на 3 модуля». Здесь это переводится в программу из модулей, считается
 * минимум, и если желаемая площадь или бюджет меньше — система говорит прямо и
 * предлагает варианты с причинами.
 */
import { GRAMMAR } from "../grammar/index.ts";
import { quickBudgetRange } from "./price.ts";
import type { Brief, Plot, Range, RoomPurpose } from "./types.ts";

export interface LifeScenario {
  adults: number;
  kids: number;
  /** Дети делят комнату (до школы — часто так). */
  kidsShareRoom?: boolean;
  pets?: { dogs?: number; cats?: number; other?: number };
  /** Пожилые родители: живут с нами или приезжают в гости, 1 или 2 человека. */
  elderly?: { mode: "live" | "visit"; count: 1 | 2 };
  /** Сколько человек работает из дома. */
  workFromHome?: number;
  guestsOften?: boolean;
  sauna?: boolean;
  storage?: "little" | "normal" | "lots";
  car?: boolean;
  terrace?: boolean;
  yearRound?: boolean;
  tiers?: 1 | 2 | "any";
  /** Сколько хочет площади, м² тёплого контура. */
  desiredAreaM2?: Range;
  budgetRub?: Range;
  plot?: Plot;
  styleHints?: string[];
}

export interface ProgramItem {
  room: "bedroom" | "kitchen-living" | "wet-core" | "study" | "utility";
  modules: number;
  label: string;
  /** Почему это помещение появилось — из сценария. */
  why: string;
  /** Без этого можно обойтись (комфорт, а не минимум). */
  optional: boolean;
  review?: string;
  /** Назначение комнаты (родители) — солвер ставит её только на 1-й ярус. */
  purpose?: RoomPurpose;
}

export interface RoomProgram {
  items: ProgramItem[];
  minModules: number;
  recommendedModules: number;
  /** Вне модулей: навес для машины, вольер, дровник — посадка на участке. */
  plotItems: string[];
  notes: string[];
  /** Что учесть в доме: питомцы, доступность для родителей. Уходит в паспорт. */
  recommendations: string[];
}

export interface AreaOption {
  id:
    | "bigger"
    | "kids-share"
    | "combine-study-guest"
    | "compact-kitchen"
    | "second-tier"
    | "drop-optional";
  label: string;
  reason: string;
  deltaModules: number;
  /** Решает ли этот вариант проблему сам по себе. */
  solves: boolean;
}

export interface AreaCheck {
  fits: boolean;
  minAreaM2: number;
  recommendedAreaM2: Range;
  /** Оценка бюджета под минимальную программу, вилкой. */
  minBudgetRub: Range;
  limitedBy: ("area" | "budget" | "plot")[];
  message: string;
  options: AreaOption[];
}

const M2 = () => GRAMMAR.module.warmContourAreaM2;
const floor5 = (x: number) => Math.floor(x / 5) * 5;
const round5 = (x: number) => Math.round(x / 5) * 5;

export function programFromScenario(s: LifeScenario): RoomProgram {
  const items: ProgramItem[] = [];
  const people = s.adults + s.kids;
  const plotItems: string[] = [];
  const notes: string[] = [];

  const couples = Math.ceil(Math.max(1, s.adults) / 2);
  items.push({
    room: "bedroom",
    modules: couples,
    label: couples > 1 ? "Спальни взрослых" : "Спальня родителей",
    why: `${s.adults} взросл.`,
    optional: false,
  });
  if (s.kids > 0) {
    const kidsRooms = s.kidsShareRoom ? Math.ceil(s.kids / 2) : s.kids;
    items.push({
      room: "bedroom",
      modules: kidsRooms,
      label: "Детские",
      why: s.kidsShareRoom
        ? `${s.kids} детей, по двое в комнате`
        : `${s.kids} детей, у каждого своя`,
      optional: false,
    });
  }
  const kitchen =
    people <= 2 && !s.guestsOften ? 2 : people >= 5 || (s.guestsOften && people >= 3) ? 4 : 3;
  items.push({
    room: "kitchen-living",
    modules: kitchen,
    label: "Кухня-гостиная",
    why: s.guestsOften ? `${people} чел. и гости` : `${people} чел.`,
    optional: false,
  });
  const dogs = s.pets?.dogs ?? 0;
  items.push({
    room: "wet-core",
    modules: 1,
    label: "Санузел и техблок",
    why: dogs
      ? "Санузел, бойлер и тамбур-грязевая с местом помыть лапы"
      : "Санузел, бойлер, техшкаф",
    optional: false,
  });
  if (people >= 4)
    items.push({
      room: "wet-core",
      modules: 1,
      label: "Второй санузел",
      why: `${people} чел.: утром без очереди`,
      optional: true,
    });
  if (s.workFromHome) {
    items.push({
      room: "study",
      modules: 1,
      label: "Кабинет",
      why:
        s.workFromHome > 1
          ? `${s.workFromHome} работают из дома — кабинет на двоих`
          : "Работа из дома",
      optional: false,
    });
  }
  const elderly = s.elderly;
  if (elderly?.mode === "live") {
    items.push({
      room: "bedroom",
      modules: 1,
      label: "Спальня родителей (1-й ярус)",
      why: `${elderly.count === 2 ? "Двое пожилых родителей" : "Пожилой родитель"} живут с вами: без лестницы, рядом свой санузел`,
      optional: false,
      purpose: "elderly",
    });
    items.push({
      room: "wet-core",
      modules: 1,
      label: "Санузел у спальни родителей",
      why: "Свой санузел рядом: душ без поддона, поручни",
      optional: false,
    });
  } else if (elderly?.mode === "visit") {
    items.push({
      room: "bedroom",
      modules: 1,
      label: "Гостевая для родителей (1-й ярус)",
      why: `Родители приезжают в гости (${elderly.count} чел.): комната на 1-м ярусе, можно трансформируемая`,
      optional: false,
      purpose: "elderly-guest",
    });
  }
  if (s.guestsOften && !s.workFromHome && elderly?.mode !== "visit")
    items.push({
      room: "bedroom",
      modules: 1,
      label: "Гостевая",
      why: "Гости часто",
      optional: true,
    });
  if (s.guestsOften && s.workFromHome)
    notes.push("Гостевую можно совместить с кабинетом: диван-кровать.");
  if (s.sauna)
    items.push({
      room: "wet-core",
      modules: 1,
      label: "Сауна",
      why: "Сауна в отдельном мокром модуле на общем стояке",
      optional: true,
      review:
        "Сауна в модуле в построенных проектах не встречалась — требует проверки проектировщиком",
    });
  if (s.storage === "lots" || dogs >= 2)
    items.push({
      room: "utility",
      modules: 1,
      label: "Постирочная и кладовая",
      why: s.storage === "lots" ? "Много хранения" : "Несколько собак: отдельная грязевая",
      optional: true,
    });
  if (items.some((i) => i.room === "utility"))
    notes.push(
      "Постирочная-кладовая: тип помещения в солвере появится на неделе 2, пока учтена в площади.",
    );
  if (s.car) plotItems.push("Навес для машины — на участке, вне модулей");
  if (dogs) plotItems.push("Огороженная площадка для собаки — на участке");
  const recommendations: string[] = [];
  const cats = s.pets?.cats ?? 0;
  const other = s.pets?.other ?? 0;
  if (dogs)
    recommendations.push(
      `Собака${dogs > 1 ? ` (${dogs})` : ""}: тамбур-грязевая с мойкой лап у входа; место под лежанку в общей комнате у глухой стены, не на проходе; дверца для собаки в тамбуре; огороженная площадка на участке.`,
    );
  if (cats)
    recommendations.push(
      `Кошка${cats > 1 ? ` (${cats})` : ""}: ниша под лоток в техблоке или кладовой с вытяжкой; зона кормления у кухни, подальше от лотка; когтеточка у входа в общую комнату.`,
    );
  if (other)
    recommendations.push(
      `Другие питомцы (${other}): место под клетку или террариум в общей комнате, не у окна на юг и не у отопления.`,
    );
  if (elderly?.mode === "live")
    recommendations.push(
      "Родители живут с вами: спальня только на 1-м ярусе рядом со своим санузлом; без порогов; поручни в санузле и у входа; двери 1000 мм; душ без поддона; вход без ступеней или с пандусом.",
    );
  if (elderly?.mode === "visit")
    recommendations.push(
      "Родители в гостях: гостевая на 1-м ярусе — можно трансформируемая (кабинет или гостиная со складной кроватью); санузел рядом; без порогов.",
    );
  if (s.terrace !== false) notes.push("Терраса — настил вне модулей, считается отдельно.");

  const minModules = items.filter((i) => !i.optional).reduce((s2, i) => s2 + i.modules, 0);
  const recommendedModules = items.reduce((s2, i) => s2 + i.modules, 0);
  return { items, minModules, recommendedModules, plotItems, notes, recommendations };
}

/** Минимальная программа → бриф для солвера. Помещения utility пока не строим — пометка. */
export function briefFromScenario(
  s: LifeScenario,
  program = programFromScenario(s),
  comfort = true,
): Brief {
  const use = program.items.filter((i) => comfort || !i.optional);
  const count = (room: ProgramItem["room"]) =>
    use.filter((i) => i.room === room).reduce((a, i) => a + i.modules, 0);
  const kitchen = use.find((i) => i.room === "kitchen-living")!.modules;
  return {
    bedrooms: count("bedroom"),
    bathrooms: count("wet-core"),
    study: count("study") > 0,
    kitchenLiving: kitchen <= 2 ? "compact" : "large",
    tiers: s.tiers ?? "any",
    yearRound: s.yearRound ?? true,
    plot: s.plot,
    styleHints: s.styleHints,
    bedroomPurposes: use.filter((i) => i.purpose).map((i) => i.purpose!),
    recommendations: [...program.recommendations, ...program.plotItems],
  };
}

export function checkArea(s: LifeScenario, program = programFromScenario(s)): AreaCheck {
  const minArea = Math.round(program.minModules * M2() * 10) / 10;
  const rec = program.recommendedModules * M2();
  const recommended: Range = { min: floor5(rec), max: round5(rec + 0.75 * M2()) };
  const minBudget = quickBudgetRange(program.minModules);
  const limitedBy: AreaCheck["limitedBy"] = [];
  if (s.desiredAreaM2 && s.desiredAreaM2.max < minArea) limitedBy.push("area");
  if (s.budgetRub && s.budgetRub.max < minBudget.min) limitedBy.push("budget");
  if (s.plot) {
    const sb = s.plot.setbackMm ?? GRAMMAR.site.setbackMm;
    const buildable =
      Math.max(0, s.plot.widthM - (2 * sb) / 1000) * Math.max(0, s.plot.depthM - (2 * sb) / 1000);
    const modulesOnTwoTiers = Math.ceil(program.minModules / 2) + 1;
    if (buildable < modulesOnTwoTiers * M2()) limitedBy.push("plot");
  }
  const fits = limitedBy.length === 0;

  const options: AreaOption[] = [];
  const target = s.desiredAreaM2?.max;
  const solvesBy = (delta: number) =>
    target !== undefined && (program.minModules + delta) * M2() <= target;
  if (!fits) {
    options.push({
      id: "bigger",
      label: `Площадь ${recommended.min}–${recommended.max} м²`,
      reason:
        "Под ваш сценарий в наших проектах столько и получается: спальни по 8,34 м², общая комната растёт с семьёй.",
      deltaModules: program.recommendedModules - program.minModules,
      solves: true,
    });
    if (s.kids >= 2 && !s.kidsShareRoom)
      options.push({
        id: "kids-share",
        label: "Одна детская на двоих",
        reason: "Пока дети маленькие, общая детская экономит кубик; позже дом можно дорастить.",
        deltaModules: -Math.floor(s.kids / 2),
        solves: solvesBy(-Math.floor(s.kids / 2)),
      });
    const kitchenItem = program.items.find((i) => i.room === "kitchen-living")!;
    if (kitchenItem.modules > 2)
      options.push({
        id: "compact-kitchen",
        label: "Кухня-гостиная поменьше",
        reason: "Общая комната на 2 кубика (17,3 м²) — как в Weekend One; тесновато для гостей.",
        deltaModules: -(kitchenItem.modules - 2),
        solves: solvesBy(-(kitchenItem.modules - 2)),
      });
    if (s.workFromHome && s.guestsOften)
      options.push({
        id: "combine-study-guest",
        label: "Кабинет = гостевая",
        reason: "Диван-кровать в кабинете вместо отдельной гостевой.",
        deltaModules: 0,
        solves: false,
      });
    if (limitedBy.includes("plot") || s.tiers !== 1)
      options.push({
        id: "second-tier",
        label: "Второй ярус",
        reason:
          "Площадь та же, пятно застройки меньше: спальни наверху, участок свободнее. Дороже на лестницу и монтаж.",
        deltaModules: 0,
        solves: limitedBy.length === 1 && limitedBy[0] === "plot",
      });
  }
  const fmtRub = (n: number) =>
    `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₽`;
  const message = fits
    ? `Под ваш сценарий нужно от ${minArea} м² (${program.minModules} кубиков), комфортно — ${recommended.min}–${recommended.max} м².`
    : [
        limitedBy.includes("area") &&
          `${s.desiredAreaM2!.max} м² — не помещается: под ваш сценарий минимум ${minArea} м² (${program.minModules} кубиков), рекомендуем ${recommended.min}–${recommended.max} м².`,
        limitedBy.includes("budget") &&
          `Бюджет до ${fmtRub(s.budgetRub!.max)} меньше минимальной оценки ${fmtRub(minBudget.min)}–${fmtRub(minBudget.max)} (предварительно).`,
        limitedBy.includes("plot") &&
          "Участок мал для одноярусного дома такого состава с отступами — нужен второй ярус или меньше комнат.",
      ]
        .filter(Boolean)
        .join(" ");
  return {
    fits,
    minAreaM2: minArea,
    recommendedAreaM2: recommended,
    minBudgetRub: minBudget,
    limitedBy,
    message,
    options,
  };
}
