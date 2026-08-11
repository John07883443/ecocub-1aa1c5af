import * as wo from "../standards/weekend-one.ts";
import * as wm from "../standards/weekend-mini.ts";
import { DOOR_OPENING, MODULE } from "../standards/ecocub.ts";
import type { ModuleInstance as StandardModule } from "../standards/types.ts";
import { DEFAULT_MODULE_TYPE_ID } from "./catalog.ts";
import type { HouseProject, ModuleInstance, OpeningInstance } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

/**
 * Эталонные дома в каноническом формате.
 *
 * Это не «примеры для витрины», а приёмочные тесты редактора: если формат не
 * способен выразить построенный дом, формат ещё не готов. Поэтому координаты
 * здесь не набираются заново, а берутся прямо из `src/lib/standards` — из тех
 * же констант, что проверяются тестами против чисел архитектурного альбома.
 * Скопировать их вручную значило бы завести второй источник правды, который
 * однажды разойдётся с первым.
 *
 * Воспроизведены два дома — Weekend One и Weekend Mini. Остальные пять
 * (Family One, Family Two, Super Family, Nasledie, Dinastiya) разобраны в
 * стандарте по помещениям и габаритам, но раскладки модулей в их исходниках
 * нет: планы CUBAX показывают перегородки и площади, а границ объёмов на них
 * не проставлено. Придумывать раскладку нельзя, поэтому эти дома ждут
 * размерных планов с разбивкой по модулям — см. `PENDING_REFERENCES`.
 */

/**
 * Модуль стандарта → модуль канонической модели.
 *
 * Единственное содержательное преобразование — `rotated`. В стандарте это
 * признак «длинная сторона 3420 идёт вдоль X», в канонической модели то же
 * состояние выражается поворотом на 90°: габарит становится 3420 × 3200.
 */
function toCanonical(m: StandardModule, floor = 0): ModuleInstance {
  return {
    id: m.id,
    moduleTypeId: DEFAULT_MODULE_TYPE_ID,
    floor,
    positionMm: { x: m.xMm, y: m.yMm },
    rotationDeg: m.rotated ? 90 : 0,
    note: m.source.sheet ? `Лист ${m.source.sheet}: ${m.source.title ?? m.id}` : m.source.title,
  };
}

const WALL = MODULE.wallThicknessMm;

/**
 * Проёмы Weekend One, которые читаются с альбома однозначно.
 *
 * Их два, и это не скупость, а прямое следствие документа. Размерные цепочки
 * развёрток дают отрезки, но не говорят, какой из них проём, а какой
 * простенок, — стандарт фиксирует это отдельным абзацем и отказывается
 * гадать. Здесь то же правило: переносится только то, что подтверждено.
 *
 * 1. Входная дверь. Единственный проём, у которого в альбоме подтверждены оба
 *    габарита (800 × 2100, лист 15), и цепочка грани Р-4 модуля D читается
 *    без остатка: 600 | 800 | 2020 = 3420.
 * 2. Открытый проём между B и C. Прямо не обмерян, но выводится из площади:
 *    кухня-гостиная подписана как 17,35 м², а два модуля в чистоте дают
 *    16,68 — разница 0,63 ровно равна полосе снятой стены 210 × 3000.
 *    Значит стена между B и C убрана на всю чистую глубину.
 *
 * Остальные проёмы дома в модель не переносятся: они есть на фасадах, но их
 * положение с имеющихся листов не восстанавливается. Список висит в
 * `unresolvedQuestions` проекта, а не растворяется в интерфейсе.
 */
function weekendOneOpenings(): OpeningInstance[] {
  return [
    {
      id: "wo-door-d",
      moduleId: "D",
      faceId: "Р-4",
      kind: "door",
      offsetMm: 600,
      widthMm: DOOR_OPENING.widthMm,
      heightMm: DOOR_OPENING.heightMm,
      sillMm: 0,
      variantId: "h2100",
      note:
        "Лист 15, развёртка Р-4 модуля D: цепочка 600 | 800 | 2020. Сторона света у обозначений " +
        "Р-1…Р-4 в альбоме не зафиксирована — привязка грани требует подтверждения архитектором.",
    },
    {
      id: "wo-passage-bc",
      moduleId: "C",
      faceId: "Р-4",
      kind: "passage",
      // Стена снята на всю чистую глубину модуля: по 210 мм простенка с краёв.
      offsetMm: WALL,
      widthMm: MODULE.clearDepthMm,
      heightMm: MODULE.clearHeightMm,
      sillMm: 0,
      variantId: "h3150",
      note:
        "Выведен из площади: кухня-гостиная 17,35 м² против 16,68 у двух модулей в чистоте. " +
        "Разница 0,63 м² = снятая общая стена 210 × 3000 (openedJointGainM2).",
    },
  ];
}

function baseProject(
  id: string,
  title: string,
  slug: string,
  modules: ModuleInstance[],
  openings: OpeningInstance[],
  extra: Partial<HouseProject> = {},
): HouseProject {
  // Даты у эталонов фиксированные: файл-фикстура не должен меняться от того,
  // в какой день его прочитали, иначе тест на круговое сохранение плавает.
  const stamp = "2026-08-11T00:00:00.000Z";
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    status: "draft",
    title,
    slug,
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    model: {
      units: "mm",
      modules,
      openings,
      foundation: {
        kind: "piles",
        // Отметка −0.500 «низ конструкции основания» с фасадов альбома.
        clearanceMm: 500,
        visible: true,
      },
      groundOffsetMm: 0,
    },
    publication: {
      gallery: [],
      highlights: [],
      tags: [],
      currency: "RUB",
      isFeatured: false,
    },
    source: {
      referenceDocumentIds: [],
      unresolvedQuestions: [],
    },
    ...extra,
  };
}

/** Weekend One — четыре модуля, единственный дом с рабочим альбомом. */
export function weekendOneProject(): HouseProject {
  return baseProject(
    "hp-weekend-one",
    "Weekend One",
    "weekend-one-cad",
    wo.MODULES.map((m) => toCanonical(m)),
    weekendOneOpenings(),
    {
      description:
        "Компактный дом из четырёх модулей EcoCub. Смещение соседних модулей на половину глубины " +
        "даёт вырезы под террасу и крыльцо, кухня-гостиная собрана из двух модулей со снятой общей стеной.",
      publication: {
        gallery: [],
        highlights: [
          "Высота помещений 3,15 м",
          "Кухня-гостиная из двух модулей со снятой стеной",
          "Терраса в вырезе габарита, без отдельного модуля",
        ],
        tags: ["4 модуля", "1 этаж", "терраса"],
        currency: "RUB",
        isFeatured: false,
      },
      source: {
        referenceHouseName: "Weekend One",
        referenceDocumentIds: ["weekend-one-album", "weekend-one-deck"],
        notes:
          "Раскладка модулей и стыки взяты из src/lib/standards/weekend-one.ts, то есть с листов 3, 4 и 12–15 альбома.",
        unresolvedQuestions: [
          "Габарит застройки в альбоме 12 590 × 6 920, а по наружным граням модулей выходит 12 590 × 5 130. " +
            "Разница 1 790 мм по глубине — зона террасы и крыльца между осями Г и Д; модулями она не занята.",
          "Положение окон на развёртках Р-1…Р-4 не восстанавливается: цепочка не различает проём и простенок. " +
            "В модель перенесены только входная дверь и открытый проём между B и C.",
          "Соответствие обозначений Р-1…Р-4 сторонам света альбомом не зафиксировано. " +
            "В модели принят обход контура против часовой стрелки, начиная с грани длиной 3 200.",
          "Шаг и раскладка свай в альбоме отсутствуют.",
        ],
      },
    },
  );
}

/** Weekend Mini — три модуля, развёрнутые длинной стороной по X. */
export function weekendMiniProject(): HouseProject {
  return baseProject(
    "hp-weekend-mini",
    "Weekend Mini",
    "weekend-mini-cad",
    wm.MODULES.map((m) => toCanonical(m)),
    [],
    {
      description:
        "Три модуля EcoCub углом: спальня, санузел и общая комната. Терраса занимает свободный угол габарита.",
      publication: {
        gallery: [],
        highlights: ["Высота помещений 3,15 м", "Три модуля", "Терраса в вырезе габарита"],
        tags: ["3 модуля", "1 этаж"],
        currency: "RUB",
        isFeatured: false,
      },
      source: {
        referenceHouseName: "Weekend Mini",
        referenceDocumentIds: ["weekend-mini-factory-plan"],
        notes:
          "Раскладка восстановлена по заводской планировке и перенесена из src/lib/standards/weekend-mini.ts.",
        unresolvedQuestions: [
          "Ориентация модулей (3 420 вдоль длинной стороны дома) следует из пропорций плана, но чертежом не подтверждена.",
          "Где именно сняты стены в стыках — на плане не показано, проёмы в модель не переносились.",
          "Габарит террасы и вылет навеса за габарит дома неизвестны.",
        ],
      },
    },
  );
}

export function referenceProjects(): HouseProject[] {
  return [weekendOneProject(), weekendMiniProject()];
}

/**
 * Дома, ждущие исходников с раскладкой модулей.
 *
 * Причина у всех одна: планы CUBAX показывают перегородки, двери и площади
 * помещений, но не показывают границы объёмов. Восстановить по ним, где
 * кончается один модуль и начинается другой, нельзя — а угадать значит
 * подсунуть в приёмочный тест выдумку.
 */
export const PENDING_REFERENCES = [
  { id: "family-one", name: "Family One", need: "размерный план с разбивкой по модулям" },
  { id: "family-two", name: "Family Two", need: "размерный план с разбивкой по модулям" },
  { id: "super-family", name: "Super Family", need: "размерный план с разбивкой по модулям" },
  { id: "nasledie", name: "Nasledie", need: "размерный план с разбивкой по модулям" },
  { id: "dinastiya", name: "Dinastiya", need: "размерный план с разбивкой по модулям" },
];
