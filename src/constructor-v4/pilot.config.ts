/**
 * ПИЛОТ КОНСТРУКТОРА v4 — ЕДИНЫЙ РЕДАКТИРУЕМЫЙ КОНФИГ.
 *
 * Владелец 01.10.2026: «всю информацию, которой не хватает, придумай сам,
 * потом будем исправлять». Всё ниже — ЧЕРНОВИК. Поменяли цифру — перезапустили
 * `npm run pilot`, пересобирать ничего не нужно.
 *
 * Что где:
 *  - этот файл: цены, конструктив-допущения, архитектор и голос, модели, лимиты;
 *  - grammar/finishes.json: каталог отделок и стилей (надбавки — черновик);
 *  - grammar/modules.json: только подтверждённое альбомом и владельцем.
 * Список допущений для владельца: ECOCUB/docs/CONSTRUCTOR_V4_PILOT_ASSUMPTIONS.md
 */
import type { PriceConfig } from "./engine/price-config.ts";

export const PILOT = {
  architect: {
    name: "Архитектор Лев",
    /** Голос InWorld TTS-2 (русский, мужской) — тот же, что проверен в МедиаМашине. */
    voice: "Dmitry",
    ttsModel: "inworld-tts-2",
    sttModel: "soniox/stt-rt-v4",
    /** LLM внутри голосовой сессии InWorld. */
    realtimeModel: "openai/gpt-4o-mini",
    greeting:
      "Здравствуйте, я Лев, архитектор ЭкоКуба. Расскажите, кто будет жить в доме — соберу три варианта за минуту.",
  },
  models: {
    /** Текстовый чат через rgrouter.ru (рубли, с RU без релея). */
    chat: "rg-openai-gpt-5.6-luna",
    /** Разбор референсов (на неделе 3). */
    vision: "rg-google-gemini-3.8-flash",
    /** Рендеры по промпту: ~3,8 ₽ за кадр. images/edits у rgrouter закрыт (501). */
    image: "rg-gpt-image-2.5",
  },
  limits: {
    renderRunsPerSession: 2,
    framesPerRun: 3,
    chatMessagesPerSession: 60,
    voiceMinutesPerSession: 10,
  },
  structure: {
    /** Свес второго яруса с колонной — черновик, до подтверждения заводом. */
    overhangWithColumnMm: 3000,
    columnsPerOverhangSide: 2,
    stairType: "маршевая",
    defaultFoundation: "screw-piles" as const,
  },
};

/** Цены 2026 — ЧЕРНОВИК. Всегда вилка; клиенту показывается с пометкой «предварительно». */
export const PRICE_DRAFT: PriceConfig = {
  status: "PLACEHOLDER",
  version: "2026-pilot-draft-01.10",
  confirmedBy: null,
  confirmedAt: null,
  /**
   * Ориентир владельца 01.10.2026: ≈ 130 000 ₽/м² «всё включено» — модули, отделка, доставка,
   * кран и монтаж, фундамент — у типового дома (середина вилки). Чуть дешевле «Бенпан».
   * Терраса и опции (второй ярус, лестница, колонны, санузлы) — сверху. Ставки ниже
   * откалиброваны под этот ориентир (тест price-benchmark).
   */
  /**
   * Ориентир владельца (голос 01.10.2026, 13:45): ≈ 150 000 ₽/м² «всё под ключ» — модули,
   * чистовая отделка (работы), доставка, кран и монтаж, фундамент — у типового дома (середина
   * вилки). Он называет 145–150, пересчитаем позже. Чуть дешевле «Бенпан».
   * Материалы чистовой отделки — отдельной строкой ≈ +15 тыс./м² (включить или «свои»).
   * Терраса и опции — сверху. Ставки откалиброваны тестом price-benchmark.
   */
  benchmarkAllInPerM2: {
    min: 150_000,
    max: 150_000,
    placeholder: false,
    source:
      "Владелец 01.10.2026: ≈150 тыс. ₽/м² под ключ (модули + чистовая отделка работы + доставка + фундамент); 145–150, пересчитать позже",
  },
  /** Уровень «тёплый контур без чистовой» для сравнения: ≈ 130 тыс./м². */
  benchmarkWarmShellPerM2: {
    min: 130_000,
    max: 130_000,
    placeholder: false,
    source: "Владелец 01.10.2026: тёплый контур без чистовой ≈130 тыс. ₽/м²",
  },
  /** Чистовая отделка — работы, ₽/м² тёплого контура. Черновик: разница 150 − 130. */
  finishingWorksPerM2: {
    min: 16_000,
    max: 24_000,
    placeholder: true,
    source: "Черновик: ориентир 150 тыс. под ключ минус 130 тыс. тёплый контур",
  },
  /** Материалы чистовой отделки по рынку, ₽/м². Отдельная строка: «включить» или «свои». */
  finishingMaterialsPerM2: {
    min: 12_000,
    max: 18_000,
    placeholder: true,
    source: "Владелец 01.10.2026: материалы по рынку в среднем ≈ +15 тыс. ₽/м²",
  },
  warmContourPerM2: {
    min: 95_000,
    max: 115_000,
    placeholder: true,
    source: "Черновик под ориентир владельца 130 тыс./м² всё включено",
  },
  terracePerM2: {
    min: 25_000,
    max: 42_000,
    placeholder: true,
    source: "Черновик: 0,3–0,4 ставки дома",
  },
  cubesPerTruck: {
    min: 4,
    max: 4,
    placeholder: false,
    source: "Владелец 01.10.2026: трал 18 м везёт 4 кубика = 2 модуля; тралы 21 и 24 м — опция",
  },
  truckRub: {
    min: 300_000,
    max: 400_000,
    placeholder: true,
    source: "Договор и сметы: 300–400 тыс. за трал",
  },
  installPerModule: {
    min: 40_000,
    max: 90_000,
    placeholder: true,
    source: "Черновик на кубик; в документах 8 000 (смета) и 142 857 (договор) — расходятся",
  },
  craneRub: {
    min: 165_000,
    max: 250_000,
    placeholder: true,
    source: "Факт 165 тыс. на объект; кран 25–55 т",
  },
  foundationPerM2: {
    piles: { min: 4_000, max: 9_000, placeholder: true, source: "ЖБИ-сваи — черновик" },
    slab: { min: 9_000, max: 16_000, placeholder: true, source: "Плита — черновик" },
    "screw-piles": {
      min: 3_500,
      max: 7_000,
      placeholder: true,
      source: "Винтовые сваи по умолчанию — черновик",
    },
  },
  upperTierPerModule: { min: 0, max: 150_000, placeholder: true, source: "Черновик" },
  stairsRub: {
    min: 180_000,
    max: 350_000,
    placeholder: true,
    source: "Маршевая лестница — черновик",
  },
  columnRub: {
    min: 40_000,
    max: 120_000,
    placeholder: true,
    source: "Колонна под свесом — черновик",
  },
  extraBathroomRub: { min: 150_000, max: 400_000, placeholder: true, source: "Черновик" },
  panoramicWindowRub: { min: 0, max: 60_000, placeholder: true, source: "Черновик" },
};
