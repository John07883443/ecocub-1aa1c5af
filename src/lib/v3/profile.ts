/**
 * Квиз и профиль клиента: определения вопросов, адаптивный выбор
 * lifestyle-вопросов и нормализация ответов в ClientHomeProfile.
 *
 * Правило из мастер-промпта: каждый вопрос обязан иметь машинную связь
 * с параметрами подбора — поэтому у каждого lifestyle-вопроса есть
 * `relevant` (кому задавать) и явное отражение в normalizeProfile.
 * Свободный текст разбирается детерминированным словарём NEED_KEYWORDS —
 * он извлекает требования, но не рисует геометрию.
 */

import type { ClientHomeProfile } from "./types.ts";

export type Answers = Record<string, string | string[]>;

export interface QuizChoice {
  value: string;
  hint?: string;
}

export interface QuizQuestion {
  id: string;
  eyebrow: string;
  title: string;
  choices: QuizChoice[];
  multi?: boolean;
  optional?: boolean;
}

/* ------------------------------------------------------------------ */
/* Короткий квиз — базовые данные                                       */
/* ------------------------------------------------------------------ */

export const BASE_QUESTIONS: QuizQuestion[] = [
  {
    id: "purpose",
    eyebrow: "Задача",
    title: "Для чего вы строите дом?",
    choices: [
      { value: "Круглогодичное проживание (ПМЖ)", hint: "тёплый дом на каждый день" },
      { value: "Загородная дача", hint: "отдых в сезон и на выходных" },
      { value: "Гостевой дом / баня", hint: "дополнительный блок на участке" },
      { value: "Аренда / инвестиция", hint: "дом, который зарабатывает" },
    ],
  },
  {
    id: "household",
    eyebrow: "Семья",
    title: "Кто будет жить в доме?",
    choices: [
      { value: "Один или вдвоём", hint: "1–2 спальни" },
      { value: "Семья с ребёнком", hint: "2–3 спальни" },
      { value: "Семья с двумя и более детьми", hint: "3–4 спальни" },
      { value: "Два поколения / большая семья", hint: "4+ спальни, автономные зоны" },
    ],
  },
  {
    id: "floors",
    eyebrow: "Этажность",
    title: "Сколько этажей вам ближе?",
    choices: [
      { value: "1 этаж", hint: "всё на одном уровне" },
      { value: "2 этажа", hint: "компактный след на участке" },
      { value: "Рассмотрю оба варианта", hint: "подберём по участку" },
    ],
  },
  {
    id: "plot",
    eyebrow: "Участок",
    title: "Как обстоят дела с участком?",
    choices: [
      { value: "Участок уже есть", hint: "посадим дом в масштабе" },
      { value: "Выбираю участок", hint: "поможем с требованиями" },
      { value: "Участка пока нет", hint: "подскажем, что искать" },
    ],
  },
  {
    id: "region",
    eyebrow: "География",
    title: "Где планируете строить?",
    choices: [
      { value: "Москва и Московская область" },
      { value: "Соседние с МО регионы" },
      { value: "Другой регион", hint: "уточним доставку" },
    ],
  },
  {
    id: "budget",
    eyebrow: "Бюджет",
    title: "Какой ориентир по бюджету?",
    choices: [
      { value: "До 7 млн ₽" },
      { value: "7–11 млн ₽" },
      { value: "11–15 млн ₽" },
      { value: "Больше 15 млн ₽" },
      { value: "Пока не определился" },
    ],
  },
  {
    id: "timing",
    eyebrow: "Сроки",
    title: "Когда планируете начать?",
    choices: [
      { value: "В ближайший сезон", hint: "готов приступить" },
      { value: "Через 3–6 месяцев", hint: "планирую заранее" },
      { value: "Пока изучаю варианты", hint: "собираю информацию" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Адаптивные lifestyle-вопросы                                         */
/* ------------------------------------------------------------------ */

export interface LifestyleQuestion extends QuizQuestion {
  /** Кому этот вопрос полезен. Нерелевантные вопросы не задаются. */
  relevant: (a: Answers) => boolean;
  /** Порядок важности: меньшие числа задаются первыми. */
  priority: number;
}

const hasChildren = (a: Answers) =>
  a.household === "Семья с ребёнком" || a.household === "Семья с двумя и более детьми";

const isPermanent = (a: Answers) => a.purpose === "Круглогодичное проживание (ПМЖ)";

const bigFamily = (a: Answers) =>
  a.household === "Семья с двумя и более детьми" || a.household === "Два поколения / большая семья";

export const LIFESTYLE_QUESTIONS: LifestyleQuestion[] = [
  {
    id: "gathering",
    eyebrow: "Сценарий жизни",
    title: "Где семья чаще всего будет собираться?",
    priority: 1,
    relevant: () => true,
    choices: [
      { value: "За большим столом", hint: "просторная кухня-столовая" },
      { value: "У дивана", hint: "большая гостиная" },
      { value: "На террасе", hint: "жизнь на воздухе" },
    ],
  },
  {
    id: "office",
    eyebrow: "Работа",
    title: "Нужно ли кому-то закрыть дверь и спокойно провести видеозвонок?",
    priority: 2,
    relevant: isPermanent,
    choices: [
      { value: "Да, нужен отдельный кабинет" },
      { value: "Иногда — хватит рабочего места" },
      { value: "Нет, дома не работаем" },
    ],
  },
  {
    id: "kids-near",
    eyebrow: "Дети",
    title: "Детские комнаты — рядом со спальней родителей или в отдельной части дома?",
    priority: 3,
    relevant: hasChildren,
    choices: [
      { value: "Рядом с родителями", hint: "дети ещё маленькие" },
      { value: "В отдельной части", hint: "у каждого своя зона" },
      { value: "Не принципиально" },
    ],
  },
  {
    id: "guests",
    eyebrow: "Гости",
    title: "Часто ли гости остаются у вас ночевать?",
    priority: 4,
    relevant: () => true,
    choices: [
      { value: "Часто", hint: "нужна гостевая комната" },
      { value: "Иногда", hint: "диван или трансформер" },
      { value: "Редко" },
    ],
  },
  {
    id: "shared-vs-private",
    eyebrow: "Приоритет",
    title: "Что важнее: просторное общее пространство или больше отдельных комнат?",
    priority: 5,
    relevant: () => true,
    choices: [
      { value: "Общее пространство", hint: "большая кухня-гостиная" },
      { value: "Отдельные комнаты", hint: "приватность каждому" },
      { value: "Баланс" },
    ],
  },
  {
    id: "storage",
    eyebrow: "Хранение",
    title: "Куда обычно убираете коляску, велосипеды, чемоданы и сезонные вещи?",
    priority: 6,
    relevant: () => true,
    choices: [
      { value: "Вещей много — нужна кладовая и гардеробные" },
      { value: "Хватит встроенных шкафов" },
    ],
  },
  {
    id: "dog",
    eyebrow: "Питомцы",
    title: "Есть ли собака — предусмотреть удобное место для мытья лап?",
    priority: 7,
    relevant: isPermanent,
    choices: [{ value: "Да" }, { value: "Нет" }],
  },
  {
    id: "garden-view",
    eyebrow: "Виды",
    title: "Хотите ли видеть сад из кухни?",
    priority: 8,
    relevant: (a) => !bigFamily(a), // большим семьям задаём вопросы важнее
    choices: [{ value: "Да, кухня к саду" }, { value: "Не принципиально" }],
  },
  {
    id: "bedroom-terrace",
    eyebrow: "Утро",
    title: "Хотели бы выходить из спальни прямо в сад или на террасу?",
    priority: 9,
    relevant: (a) => a.purpose !== "Аренда / инвестиция",
    choices: [{ value: "Да, это мечта" }, { value: "Не обязательно" }],
  },
  {
    id: "future",
    eyebrow: "Горизонт",
    title: "Дом должен быть удобен только сейчас или учитывать жизнь через 10–15 лет?",
    priority: 10,
    relevant: isPermanent,
    choices: [
      { value: "С запасом на будущее", hint: "дети вырастут, семья изменится" },
      { value: "Под текущие задачи" },
    ],
  },
  {
    id: "autonomous-zone",
    eyebrow: "Автономия",
    title: "Нужна ли автономная зона для родителей, взрослого ребёнка или гостей?",
    priority: 11,
    relevant: bigFamily,
    choices: [
      { value: "Да, отдельный блок со своим санузлом" },
      { value: "Нет, достаточно обычных спален" },
    ],
  },
];

/** Максимум lifestyle-вопросов за сессию (мастер-промпт: обычно 4–7, максимум 8). */
export const MAX_LIFESTYLE_QUESTIONS = 7;

/** Отобрать релевантные вопросы по уже известным базовым ответам. */
export function pickLifestyleQuestions(
  answers: Answers,
  max: number = MAX_LIFESTYLE_QUESTIONS,
): LifestyleQuestion[] {
  return LIFESTYLE_QUESTIONS.filter((q) => q.relevant(answers))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Свободный текст → извлечённые потребности                            */
/* ------------------------------------------------------------------ */

/** Детерминированный словарь: ключ потребности → триггеры в тексте. */
export const NEED_KEYWORDS: Record<string, { label: string; patterns: RegExp }> = {
  sauna: { label: "Баня / сауна", patterns: /бан[юяе]|саун/i },
  fireplace: { label: "Камин", patterns: /камин/i },
  panorama: { label: "Панорамные окна", patterns: /панорам|окна в пол|остеклен/i },
  garage: { label: "Гараж / навес", patterns: /гараж|навес|машин|парков/i },
  terrace: { label: "Терраса", patterns: /террас|веранд/i },
  office: { label: "Кабинет", patterns: /кабинет|удал[её]нк|работат/i },
  guests: { label: "Гостевая", patterns: /гостев|ночеват/i },
  pool: { label: "Бассейн", patterns: /бассейн/i },
  pets: { label: "Питомцы", patterns: /собак|кошк|питомц/i },
};

export function extractNeeds(freeText: string): string[] {
  if (!freeText.trim()) return [];
  const found: string[] = [];
  for (const [key, def] of Object.entries(NEED_KEYWORDS)) {
    if (def.patterns.test(freeText)) found.push(key);
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Нормализация профиля                                                 */
/* ------------------------------------------------------------------ */

const HOUSEHOLD_MAP: Record<string, { adults: number; children: number; bedrooms: number }> = {
  "Один или вдвоём": { adults: 2, children: 0, bedrooms: 1 },
  "Семья с ребёнком": { adults: 2, children: 1, bedrooms: 2 },
  "Семья с двумя и более детьми": { adults: 2, children: 2, bedrooms: 3 },
  "Два поколения / большая семья": { adults: 4, children: 1, bedrooms: 4 },
};

const BUDGET_MAP: Record<string, { min?: number; max?: number }> = {
  "До 7 млн ₽": { max: 7_000_000 },
  "7–11 млн ₽": { min: 7_000_000, max: 11_000_000 },
  "11–15 млн ₽": { min: 11_000_000, max: 15_000_000 },
  "Больше 15 млн ₽": { min: 15_000_000 },
  "Пока не определился": {},
};

/** Целевая площадь: базовые метры на состав семьи + запросы из lifestyle. */
function targetAreaFor(bedrooms: number, answers: Answers): { min: number; max: number } {
  // Ориентиры согласованы с картами размера боевого квиза:
  // 1–2 чел ≈ 54–72, семья ≈ 108–144, просторный ≈ 180–288.
  const base: Record<number, { min: number; max: number }> = {
    1: { min: 36, max: 80 },
    2: { min: 60, max: 110 },
    3: { min: 100, max: 170 },
    4: { min: 140, max: 300 },
  };
  const t = base[Math.min(4, Math.max(1, bedrooms))];
  let min = t.min;
  const max = t.max;
  if (answers.office === "Да, нужен отдельный кабинет") min += 9;
  if (answers.guests === "Часто") min += 9;
  if (answers["autonomous-zone"] === "Да, отдельный блок со своим санузлом") min += 18;
  return { min, max };
}

/** Ответы квиза + lifestyle + свободный текст → нормализованный профиль. */
export function normalizeProfile(answers: Answers, freeText = ""): ClientHomeProfile {
  const hh = HOUSEHOLD_MAP[String(answers.household ?? "")] ?? {
    adults: 2,
    children: 0,
    bedrooms: 2,
  };

  let bedrooms = hh.bedrooms;
  if (answers.guests === "Часто") bedrooms += 1;
  if (answers["autonomous-zone"] === "Да, отдельный блок со своим санузлом") bedrooms += 1;

  const preferredFloors =
    answers.floors === "1 этаж" ? [1] : answers.floors === "2 этажа" ? [2] : [1, 2, 3];

  const extractedNeeds = extractNeeds(freeText);
  if (extractedNeeds.includes("office") && answers.office === undefined) {
    answers = { ...answers, office: "Иногда — хватит рабочего места" };
  }

  const officeNeed =
    answers.office === "Да, нужен отдельный кабинет"
      ? "separate_room"
      : answers.office === "Иногда — хватит рабочего места"
        ? "occasional"
        : "none";

  const guestNeed =
    answers.guests === "Часто" ? "frequent" : answers.guests === "Иногда" ? "occasional" : "none";

  const sharedFirst = answers["shared-vs-private"] === "Общее пространство";
  const privateFirst = answers["shared-vs-private"] === "Отдельные комнаты";

  const futureProofing: string[] = [];
  if (answers.future === "С запасом на будущее") futureProofing.push("growing-family");
  if (answers["autonomous-zone"] === "Да, отдельный блок со своим санузлом")
    futureProofing.push("autonomous-suite");

  const terracePreference =
    answers.gathering === "На террасе"
      ? "main-gathering"
      : answers["bedroom-terrace"] === "Да, это мечта"
        ? "from-bedroom"
        : undefined;

  return {
    adults: hh.adults,
    children: hh.children,
    bedrooms,
    bathrooms: bedrooms >= 3 ? 2 : 1,
    officeNeed,
    guestNeed,
    dog: answers.dog === "Да" || extractedNeeds.includes("pets"),
    storageNeed:
      answers.storage === "Вещей много — нужна кладовая и гардеробные" ? "extended" : "basic",
    masterBedroom: bedrooms >= 3,
    privacyPriority: privateFirst ? 1 : answers["kids-near"] === "В отдельной части" ? 0.7 : 0.4,
    sharedSpacePriority: sharedFirst ? 1 : answers.gathering === "У дивана" ? 0.7 : 0.5,
    futureProofing,
    preferredFloors,
    targetArea: targetAreaFor(bedrooms, answers),
    budget: { ...BUDGET_MAP[String(answers.budget ?? "")], currency: "RUB" },
    region: typeof answers.region === "string" ? answers.region : undefined,
    desiredStart: typeof answers.timing === "string" ? answers.timing : undefined,
    purpose: typeof answers.purpose === "string" ? answers.purpose : undefined,
    plot: { exists: answers.plot === "Участок уже есть" },
    freeText: freeText || undefined,
    extractedNeeds,
  };
}

/* ------------------------------------------------------------------ */
/* Префилл из уже пройденных квизов сайта                               */
/* ------------------------------------------------------------------ */

/**
 * Профиль «Дом мечты» (localStorage ec_dream_profile) хранит ответы главного
 * квиза в словаре конфигуратора. Переносим совпадающие поля, чтобы не
 * спрашивать человека повторно. Ключи см. src/lib/dreamProfile.ts.
 */
export function seedAnswersFromDreamProfile(dream: Record<string, unknown>): Answers {
  const out: Answers = {};
  const purpose = dream.purpose;
  if (purpose === "ПМЖ — живём круглый год") out.purpose = "Круглогодичное проживание (ПМЖ)";
  else if (purpose === "Дача — сезон и выходные") out.purpose = "Загородная дача";
  else if (purpose === "Сдача в аренду") out.purpose = "Аренда / инвестиция";
  else if (purpose === "Гостевой дом") out.purpose = "Гостевой дом / баня";

  const size = dream.size;
  if (size === "Компактный") out.household = "Один или вдвоём";
  else if (size === "Семейный") out.household = "Семья с ребёнком";
  else if (size === "Просторный") out.household = "Семья с двумя и более детьми";

  const floors = dream.floors;
  if (floors === "1 этаж") out.floors = "1 этаж";
  else if (floors === "2 этажа" || floors === "3 этажа") out.floors = "2 этажа";

  return out;
}
