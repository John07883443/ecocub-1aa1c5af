/**
 * База знаний Льва в сжатом виде (retrieval-style): прецеденты мира, паттерны
 * CUBAX и наша библиотека — выжимки из
 *  - ECOCUB/docs/ARCHITECT_KNOWLEDGE_WORLD_2026-10-01.md (21 прецедент, правила A–H);
 *  - ECOCUB/docs/LAYOUT_PATTERNS_CUBAX_2026-10-01.md (архетипы пятна, смежность, фасад);
 *  - построенные проекты ЭкоКуба и рендеры слайдера (house-style.ts) — ранг выше всех.
 * В каждый запрос уходит не всё, а подходящее под бриф: размер, этажность, семья.
 */
import { houseStyleBrief } from "./house-style.ts";

export interface Precedent {
  name: string;
  /** Для каких домов уместно: число кубиков и ярусов. */
  cubes: [number, number];
  tiers: (1 | 2)[];
  idea: string;
}

export const WORLD_PRECEDENTS: Precedent[] = [
  {
    name: "Habitat 67 (Сафди)",
    cubes: [6, 16],
    tiers: [2],
    idea: "сдвиг яруса: крыша нижнего — терраса верхнего, консоль — навес",
  },
  {
    name: "Дом Азума (Андо)",
    cubes: [3, 8],
    tiers: [1],
    idea: "пустая ячейка-двор даёт свет и приватность глухому фасаду",
  },
  {
    name: "Дом Косино (Андо)",
    cubes: [6, 14],
    tiers: [1, 2],
    idea: "день и ночь в двух параллельных брусах, двор между",
  },
  {
    name: "Кабанон (Корбюзье)",
    cubes: [1, 3],
    tiers: [1],
    idea: "всё по Модулору, мебель встроена по периметру",
  },
  {
    name: "Sekisui Heim M1",
    cubes: [8, 12],
    tiers: [2],
    idea: "коробы рядом и стопкой, дробный модуль закрывает хвосты",
  },
  {
    name: "Max Bögl maxmodul",
    cubes: [3, 10],
    tiers: [1, 2],
    idea: "стыки модулей не режут комнату",
  },
  {
    name: "KODA (Kodasema)",
    cubes: [2, 3],
    tiers: [1],
    idea: "одна сторона стеклянная, три глухие, санблок компактным ядром",
  },
  {
    name: "Connect Homes",
    cubes: [3, 12],
    tiers: [1, 2],
    idea: "терраса как равноправный модуль, стекло в пол",
  },
  {
    name: "Plus House (CKR)",
    cubes: [8, 14],
    tiers: [2],
    idea: "внизу общее со стеклянными длинными стенами, наверху спальни",
  },
  {
    name: "Muji Hut",
    cubes: [1, 4],
    tiers: [1],
    idea: "веранда-энгава под общей крышей как продолжение комнаты",
  },
  {
    name: "Moriyama House (Нисидзава)",
    cubes: [6, 12],
    tiers: [1],
    idea: "пустоты — задуманные дворики, не обрезки",
  },
  {
    name: "weeHouse",
    cubes: [2, 6],
    tiers: [1],
    idea: "один модуль — одна функция, торцы стеклянные",
  },
  {
    name: "Dvele",
    cubes: [6, 14],
    tiers: [1, 2],
    idea: "большие планы — в 2 ряда модулей, не одной лентой",
  },
  {
    name: "Ray Kappe LivingHome",
    cubes: [8, 16],
    tiers: [1, 2],
    idea: "Г/П-план охватывает двор с юга",
  },
  {
    name: "Cabin One",
    cubes: [2, 4],
    tiers: [1],
    idea: "ширина 3,43 м как наш кубик: сон | санузел-кухня | жильё",
  },
  {
    name: "Контейнерный дом 2×40",
    cubes: [4, 8],
    tiers: [1],
    idea: "гостиная на два модуля с раскрытой стеной",
  },
];

export const CUBAX_PATTERNS: Precedent[] = [
  {
    name: "CUBAX 27 м²",
    cubes: [2, 3],
    tiers: [1],
    idea: "L, терраса в углу; вход прямо в общую комнату, одна мокрая стена",
  },
  {
    name: "CUBAX 56 м²",
    cubes: [5, 6],
    tiers: [1],
    idea: "3×2: центральная колонна — прихожая и холл, день справа, ночь слева, терраса во всю ширину",
  },
  {
    name: "CUBAX 74 м²",
    cubes: [7, 8],
    tiers: [1],
    idea: "4×2: две спальни спиной к спине, мастер-колонна (санузел, гардероб, спальня), вход по центру из врезанной террасы",
  },
  {
    name: "CUBAX 84 м²",
    cubes: [8, 9],
    tiers: [1],
    idea: "3×3: задний ряд целиком панорамный на террасу, мокрая колонна у прихожей",
  },
  {
    name: "CUBAX 133 м² (H-план)",
    cubes: [12, 16],
    tiers: [1],
    idea: "два крыла: детские слева, мастер справа, центр с нишами-террасами",
  },
  {
    name: "CUBAX 150 м²",
    cubes: [12, 16],
    tiers: [1],
    idea: "ряд из трёх спален вдоль фасада, общая зона в центре к террасе",
  },
  {
    name: "CUBAX 168 м²",
    cubes: [10, 16],
    tiers: [2],
    idea: "верх короче низа на ряд, крыша выступа — терраса 2-го этажа",
  },
  {
    name: "CUBAX 57 м² (таунхаус)",
    cubes: [4, 6],
    tiers: [2],
    idea: "консоль на ячейку над входной террасой",
  },
];

export const CUBAX_RULES = [
  "Пятно компактное, аспект ≤ 1,6:1; отклонение от прямоугольника — только сдвиг целой полосы на ряд или ниша на ряд под террасу/крыльцо.",
  "Вход через крыльцо или нишу под навесом; из прихожей не попасть прямо в спальню.",
  "Мокрые зоны в одной колонне или ряду, на двух ярусах — друг над другом; санузла на панорамном фасаде нет.",
  "Мастер-спальня 11–14 м² + гардероб; в домах от 90 м² гардероб обязателен.",
  "Фасад: одно панорамное окно на полосу, между окнами простенки с ламелями; глухой фасад у мокрых зон.",
  "Главная терраса 20–26 м², глубина ≈ ряд, врезана в нишу и прикрыта с 2–3 сторон.",
];

const fits = (p: Precedent, cubes: number, tiers: 1 | 2 | "any") =>
  cubes >= p.cubes[0] - 1 &&
  cubes <= p.cubes[1] + 1 &&
  (tiers === "any" || p.tiers.includes(tiers));

/** Блок знаний под конкретный дом: стиль ЭкоКуба + 3 паттерна CUBAX + 4 мировых прецедента + правила. */
export function knowledgeFor(cubes: number, tiers: 1 | 2 | "any" = "any"): string {
  const cubax = CUBAX_PATTERNS.filter((p) => fits(p, cubes, tiers)).slice(0, 3);
  const world = WORLD_PRECEDENTS.filter((p) => fits(p, cubes, tiers)).slice(0, 4);
  return [
    houseStyleBrief(4),
    `Паттерны CUBAX (ссылайся по имени): ${cubax.map((p) => `${p.name} — ${p.idea}`).join("; ") || "—"}.`,
    `Мировые прецеденты (ниже по рангу): ${world.map((p) => `${p.name} — ${p.idea}`).join("; ") || "—"}.`,
    `Правила CUBAX: ${CUBAX_RULES.join(" ")}`,
  ].join("\n");
}

/** Имена всех прецедентов — для проверки, что Лев на них ссылается. */
export const PRECEDENT_NAMES: string[] = [
  "Weekend One",
  "Weekend Two",
  "Sky River",
  "Family One",
  "Family Two",
  "слайдер",
  ...CUBAX_PATTERNS.map((p) => p.name.split(" (")[0]),
  ...WORLD_PRECEDENTS.map((p) => p.name.split(" (")[0]),
];

export function mentionsPrecedent(text: string): boolean {
  const t = text.toLowerCase();
  return PRECEDENT_NAMES.some((n) => t.includes(n.toLowerCase())) || /cubax|кубакс/.test(t);
}
