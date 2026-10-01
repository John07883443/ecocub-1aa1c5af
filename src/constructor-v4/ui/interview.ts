/**
 * Интервью Льва: по одному вопросу, факты из анкеты подтверждаются, а не
 * спрашиваются заново. Машина состояний на клиенте — формулировки за моделью.
 *
 * Порядок (владелец 01.10.2026): участок → кто живёт → питомцы → родители →
 * образ жизни → стиль (карточки A/B/C) → бюджет. После каждого ответа дом
 * пересобирается сразу, Лев коротко говорит, что поменялось.
 */
import type { LifeScenario } from "../engine/scenario.ts";

export type Step = "plot" | "people" | "pets" | "elderly" | "lifestyle" | "style" | "budget";
export const STEPS: Step[] = ["plot", "people", "pets", "elderly", "lifestyle", "style", "budget"];

export interface InterviewState {
  /** Шаги, по которым человек ответил или подтвердил. */
  confirmed: Step[];
  /** Шаги, которые человек сам заполнил в анкете (Лев их подтверждает, а не спрашивает). */
  formTouched: Step[];
  /** Текущий вопрос. null — интервью закончено. */
  current: Step | null;
}

/** Типовой участок по умолчанию, если своего нет: 10 соток, 27 × 37 м. */
export const DEFAULT_PLOT = { widthM: 27, depthM: 37, northDeg: 0 } as const;

export const QUESTION: Record<Step, string> = {
  plot: "Есть ли участок? Посёлок, примерный размер (сотки), где север и откуда въезд. Нет или не знаете — возьмём типовые 10 соток (27 × 37 м).",
  people: "Кто будет жить: сколько взрослых и детей, дети в одной комнате или в разных?",
  pets: "Есть ли питомцы — собака, кошки?",
  elderly: "Будут ли жить или приезжать пожилые родители?",
  lifestyle: "Как живёте: работаете из дома, часто гости, нужна ли сауна, есть ли машина?",
  style:
    "Какой дом по душе? Покажи карточки A, B, C и спроси, что ближе — можно смешивать («из А крышу, из Б окна»).",
  budget: "На какой бюджет ориентируетесь (вилкой, можно примерно)?",
};

/** Какие шаги закрывают поля set_scenario. */
const FIELD_STEP: Record<string, Step> = {
  plotSotki: "plot",
  plotWidthM: "plot",
  plotDepthM: "plot",
  adults: "people",
  kids: "people",
  kidsShareRoom: "people",
  dogs: "pets",
  cats: "pets",
  otherPets: "pets",
  elderly: "elderly",
  elderlyCount: "elderly",
  workFromHome: "lifestyle",
  guestsOften: "lifestyle",
  sauna: "lifestyle",
  storageLots: "lifestyle",
  car: "lifestyle",
  tiers: "lifestyle",
  desiredAreaMaxM2: "budget",
  budgetMaxRub: "budget",
  style: "style",
};

export function stepsForFields(keys: string[]): Step[] {
  return [...new Set(keys.map((k) => FIELD_STEP[k]).filter(Boolean))];
}

export function startInterview(formTouched: Step[] = []): InterviewState {
  return advance({ confirmed: [], formTouched: [...new Set(formTouched)], current: null });
}

function advance(s: InterviewState): InterviewState {
  return { ...s, current: STEPS.find((x) => !s.confirmed.includes(x)) ?? null };
}

/** Человек ответил (Лев записал поля) или подтвердил шаг. */
export function answer(s: InterviewState, steps: Step[]): InterviewState {
  if (!steps.length) return s;
  return advance({ ...s, confirmed: [...new Set([...s.confirmed, ...steps])] });
}

/** Человек сам поправил анкету — этот шаг Лев только подтверждает. */
export function touchForm(s: InterviewState, step: Step): InterviewState {
  return { ...s, formTouched: [...new Set([...s.formTouched, step])] };
}

/** Как задавать текущий вопрос: спросить или подтвердить уже известное из анкеты. */
export function currentMode(s: InterviewState): "ask" | "confirm" | "done" {
  if (!s.current) return "done";
  return s.formTouched.includes(s.current) ? "confirm" : "ask";
}

export function progress(s: InterviewState): { done: number; total: number } {
  return { done: s.confirmed.length, total: STEPS.length };
}

/** Блок для промпта Льва: где мы в интервью и что делать сейчас. */
export function interviewContext(s: InterviewState, sc?: LifeScenario | null): string {
  const mode = currentMode(s);
  if (mode === "done")
    return "Интервью: всё узнали. Предлагай улучшения карточками и вызывай design_variants / critic_review, когда уместно.";
  const step = s.current!;
  const p = progress(s);
  const known =
    mode === "confirm" && sc
      ? ` Человек уже указал это в анкете — одной фразой подтверди («вижу…, верно?») и переходи дальше (confirm_step).`
      : "";
  const plotHint =
    step === "plot" && !sc?.plot ? " Если участка нет — set_scenario с plotSotki: 10." : "";
  return `Интервью, шаг ${p.done + 1} из ${p.total} («${step}»): ${QUESTION[step]}${known}${plotHint} Один вопрос за раз. Ответ записывай set_scenario (дом пересоберётся сразу) или confirm_step, если человек подтвердил без изменений.`;
}
