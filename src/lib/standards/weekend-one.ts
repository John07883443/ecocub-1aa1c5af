import type { Joint, ModuleInstance, RoomEntry } from "./types.ts";

/**
 * Weekend One — эталонный разбор проекта.
 *
 * Это не «ещё один дом в каталоге», а образец, по которому сверяется всё
 * остальное: единственный проект, у которого есть рабочий альбом, и потому
 * единственный, чью геометрию можно восстановить до миллиметра и проверить
 * тестом.
 *
 * Система координат. Начало — левый нижний угол наружного габарита модуля A,
 * ось X вправо вдоль длинной стороны дома, ось Y вверх. Оси альбома (1…7 и
 * А…Д) пересчитаны в эту же систему, чтобы цепочки с листов можно было
 * сложить и сравнить с положением модулей.
 */

/** Оси альбома по X, мм от начала координат. Цепочка листа 3: 2990|210|3095|3095|210|2990. */
export const AXES_X: Record<string, number> = {
  "1": 0,
  "2": 2990,
  "3": 3200,
  "4": 6295,
  "5": 9390,
  "6": 9600,
  "7": 12590,
};

/** Оси альбома по Y, мм. Цепочка листа 3: 2000|1710|1500|1710 сверху вниз. */
export const AXES_Y: Record<string, number> = {
  А: 105,
  Б: 1815,
  В: 3315,
  Г: 5025,
  Д: 7025,
};

/** Экспликация листа 4, без изменений. */
export const ROOMS: RoomEntry[] = [
  { id: "r1", no: 1, name: "Кухня-гостиная", areaM2: 17.35 },
  { id: "r2", no: 2, name: "Тамбур", areaM2: 1.34 },
  { id: "r3", no: 3, name: "С/У", areaM2: 2.26 },
  { id: "r4", no: 4, name: "Спальня", areaM2: 8.34 },
  { id: "r5", no: 5, name: "Детская", areaM2: 4.31 },
  { id: "r6", no: 6, name: "Бойлер", areaM2: 0.57 },
];

/**
 * Четыре модуля проекта.
 *
 * Раскладка снята с листа 4 и ключевой схемы листов 12–15: A и D стоят внизу,
 * B и C подняты на 1710 мм. Пары A—B и C—D соприкасаются стенами, B и C делят
 * одну стену — поэтому C начинается на 210 мм левее, чем кончается B.
 *
 * Размерные цепочки граней (`faces`) сохранены дословно с развёрток Р-1…Р-4.
 * Разбор «где здесь проём, а где простенок» не делается: с одной цепочки это
 * не следует. Где высота проёма прочитана с чертежа — она проставлена.
 */
export const MODULES: ModuleInstance[] = [
  {
    id: "A",
    xMm: 0,
    yMm: 0,
    roomIds: ["r2", "r3", "r5"],
    source: { doc: "weekend-one-album", sheet: 12, title: "Модуль A" },
    faces: [
      {
        id: "Р-1",
        spanMm: 3200,
        chainMm: [210, 1980, 800, 210],
        openingHeightMm: 2100,
        confidence: "album",
      },
      {
        id: "Р-2",
        spanMm: 3420,
        chainMm: [1920, 1290, 210],
        openingHeightMm: 2800,
        confidence: "album",
      },
      {
        id: "Р-3",
        spanMm: 3200,
        chainMm: [210, 900, 2090],
        openingHeightMm: 2500,
        confidence: "album",
      },
      {
        id: "Р-4",
        spanMm: 3420,
        chainMm: [700, 500, 1320, 500, 400],
        openingHeightMm: 2100,
        confidence: "album",
      },
    ],
  },
  {
    id: "B",
    xMm: 3200,
    yMm: 1710,
    roomIds: ["r1"],
    source: { doc: "weekend-one-album", sheet: 13, title: "Модуль B" },
    faces: [
      {
        id: "Р-1",
        spanMm: 3200,
        chainMm: [210, 2200, 790],
        openingHeightMm: 3150,
        confidence: "album",
      },
      {
        id: "Р-2",
        spanMm: 3420,
        chainMm: [210, 600, 100, 2300, 210],
        openingHeightMm: 3150,
        confidence: "album",
      },
      {
        id: "Р-3",
        spanMm: 3200,
        chainMm: [760, 490, 1950],
        openingHeightMm: 3150,
        confidence: "album",
      },
      {
        id: "Р-4",
        spanMm: 3420,
        chainMm: [1920, 1290, 210],
        openingHeightMm: 2800,
        confidence: "album",
      },
    ],
  },
  {
    id: "C",
    xMm: 6190,
    yMm: 1710,
    roomIds: ["r1", "r6"],
    source: { doc: "weekend-one-album", sheet: 14, title: "Модуль C" },
    faces: [
      {
        id: "Р-1",
        spanMm: 3200,
        chainMm: [790, 2200, 210],
        openingHeightMm: 3150,
        confidence: "needs-review",
      },
      {
        id: "Р-2",
        spanMm: 3420,
        chainMm: [210, 2300, 100, 600, 210],
        openingHeightMm: 3150,
        confidence: "needs-review",
      },
      {
        id: "Р-3",
        spanMm: 3200,
        chainMm: [1950, 460, 790],
        openingHeightMm: 3150,
        confidence: "needs-review",
      },
      {
        id: "Р-4",
        spanMm: 3420,
        chainMm: [210, 800, 2410],
        openingHeightMm: 2100,
        confidence: "needs-review",
      },
    ],
  },
  {
    id: "D",
    xMm: 9390,
    yMm: 0,
    roomIds: ["r4"],
    source: { doc: "weekend-one-album", sheet: 15, title: "Модуль D" },
    faces: [
      { id: "Р-1", spanMm: 3200, chainMm: [210, 2780, 210], confidence: "album" },
      {
        id: "Р-2",
        spanMm: 3420,
        chainMm: [400, 500, 1320, 500, 700],
        openingHeightMm: 2100,
        confidence: "album",
      },
      { id: "Р-3", spanMm: 3200, chainMm: [3200], confidence: "album" },
      {
        id: "Р-4",
        spanMm: 3420,
        chainMm: [600, 800, 2020],
        openingHeightMm: 2100,
        confidence: "album",
      },
    ],
  },
];

/** Как модули соединены между собой. */
export const JOINTS: Joint[] = [
  { a: "A", b: "B", kind: "back-to-back", thicknessMm: 420 },
  { a: "B", b: "C", kind: "shared-wall", thicknessMm: 210 },
  { a: "C", b: "D", kind: "back-to-back", thicknessMm: 420 },
];

/** Габарит застройки по осям 1–7 и А–Д, лист 3. */
export const OVERALL = { widthMm: 12590, depthMm: 6920 };

/** Смещение модулей B и C относительно A и D — половина глубины модуля. */
export const OFFSET_MM = 1710;
