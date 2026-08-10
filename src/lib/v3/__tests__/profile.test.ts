import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_QUESTIONS,
  extractNeeds,
  MAX_LIFESTYLE_QUESTIONS,
  normalizeProfile,
  pickLifestyleQuestions,
  seedAnswersFromDreamProfile,
} from "../profile.ts";

test("нормализация: семья с двумя детьми и частыми гостями получает +1 спальню", () => {
  const p = normalizeProfile({
    household: "Семья с двумя и более детьми",
    guests: "Часто",
    floors: "1 этаж",
    budget: "7–11 млн ₽",
  });
  assert.equal(p.bedrooms, 4); // 3 базовых + гостевая
  assert.deepEqual(p.preferredFloors, [1]);
  assert.equal(p.budget?.max, 11_000_000);
  assert.equal(p.guestNeed, "frequent");
});

test("адаптивность: вопрос про детские не задаётся паре без детей", () => {
  const solo = pickLifestyleQuestions({ household: "Один или вдвоём" });
  assert.ok(!solo.some((q) => q.id === "kids-near"));
  assert.ok(solo.length <= MAX_LIFESTYLE_QUESTIONS);

  const family = pickLifestyleQuestions({
    household: "Семья с ребёнком",
    purpose: "Круглогодичное проживание (ПМЖ)",
  });
  assert.ok(family.some((q) => q.id === "kids-near"));
  assert.ok(family.some((q) => q.id === "office"));
  assert.ok(family.length <= MAX_LIFESTYLE_QUESTIONS);
});

test("вопрос про кабинет не задаётся для дачи", () => {
  const dacha = pickLifestyleQuestions({ purpose: "Загородная дача" });
  assert.ok(!dacha.some((q) => q.id === "office"));
});

test("свободный текст извлекает потребности словарём, но не рисует геометрию", () => {
  const needs = extractNeeds("Хотим баню, камин и панорамные окна, и место для собаки");
  assert.ok(needs.includes("sauna"));
  assert.ok(needs.includes("fireplace"));
  assert.ok(needs.includes("panorama"));
  assert.ok(needs.includes("pets"));
  const p = normalizeProfile({ household: "Один или вдвоём" }, "живём с собакой");
  assert.equal(p.dog, true);
});

test("ответы главного квиза сайта переносятся и не спрашиваются повторно", () => {
  const seeded = seedAnswersFromDreamProfile({
    purpose: "ПМЖ — живём круглый год",
    size: "Семейный",
    floors: "1 этаж",
  });
  assert.equal(seeded.purpose, "Круглогодичное проживание (ПМЖ)");
  assert.equal(seeded.household, "Семья с ребёнком");
  assert.equal(seeded.floors, "1 этаж");
  // Перенесённые ответы соответствуют реальным вариантам вопросов.
  for (const [id, value] of Object.entries(seeded)) {
    const q = BASE_QUESTIONS.find((question) => question.id === id)!;
    assert.ok(
      q.choices.some((c) => c.value === value),
      id,
    );
  }
});
