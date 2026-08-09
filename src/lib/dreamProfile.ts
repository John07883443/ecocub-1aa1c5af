/**
 * Память профиля «Дом мечты» — мост между быстрым квизом (HouseQuiz) и
 * конфигуратором (DreamHouseBuilder).
 *
 * Задача: пройдя быстрый квиз, человек не начинает конфигуратор с нуля — базовые
 * ответы (назначение, масштаб, этажность) уже захвачены и подставлены. При этом
 * конфигуратор открыт и без квиза: тогда профиль просто пустой.
 *
 * Хранилище — localStorage (как в attribution.ts), плюс мгновенная передача в
 * уже смонтированный конфигуратор через CustomEvent, чтобы не связывать
 * компоненты общим стейтом.
 */

const KEY = "ec_dream_profile";
export const DREAM_PROFILE_EVENT = "ec:dreamprofile";

export type DreamAnswers = Record<string, string | string[]>;

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* приватный режим — профиль живёт только в рамках сессии страницы */
  }
}

/** Ответы быстрого квиза → ответы конфигуратора (совпадающие поля). */
const PURPOSE_MAP: Record<string, string> = {
  "Круглогодичное проживание (ПМЖ)": "ПМЖ — живём круглый год",
  "Загородная дача": "Дача — сезон и выходные",
  "Аренда / инвестиция": "Сдача в аренду",
  "Гостевой дом / баня": "Гостевой дом",
};
const SIZE_MAP: Record<string, string> = {
  "1–2 человека · компактный": "Компактный",
  "3–4 человека · семейный": "Семейный",
  "5+ или два поколения · просторный": "Просторный",
};

/** Преобразует ответы квиза в частичный профиль конфигуратора. */
export function mapQuizToDream(quiz: Record<string, string>): DreamAnswers {
  const out: DreamAnswers = {};
  if (quiz.purpose && PURPOSE_MAP[quiz.purpose]) out.purpose = PURPOSE_MAP[quiz.purpose];
  if (quiz.size && SIZE_MAP[quiz.size]) out.size = SIZE_MAP[quiz.size];
  if (quiz.floors) out.floors = quiz.floors; // значения совпадают («1 этаж» и т.д.)
  return out;
}

/** Тихо записать профиль в хранилище (без оповещения) — для автосейва прогресса. */
export function persistDreamProfile(answers: DreamAnswers) {
  if (typeof window === "undefined") return;
  safeSet(KEY, JSON.stringify(answers));
}

/** Сохранить профиль (полный или частичный) и оповестить конфигуратор. */
export function saveDreamProfile(answers: DreamAnswers) {
  if (typeof window === "undefined") return;
  persistDreamProfile(answers);
  try {
    window.dispatchEvent(new CustomEvent(DREAM_PROFILE_EVENT, { detail: answers }));
  } catch {
    /* CustomEvent недоступен — конфигуратор подхватит профиль при монтировании */
  }
}

/** Записать базовые ответы из квиза (мержит поверх уже сохранённого профиля). */
export function seedFromQuiz(quiz: Record<string, string>) {
  const seeded = mapQuizToDream(quiz);
  const existing = loadDreamProfile();
  saveDreamProfile({ ...existing, ...seeded });
}

export function loadDreamProfile(): DreamAnswers {
  if (typeof window === "undefined") return {};
  const raw = safeGet(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as DreamAnswers;
  } catch {
    return {};
  }
}
