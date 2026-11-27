import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRelated, relatedScore, titleStems, type RelatedCandidate } from "../related.ts";

const post = (
  slug: string,
  title: string,
  extra: Partial<RelatedCandidate> = {},
): RelatedCandidate => ({
  slug,
  title,
  category: "tech",
  tags: [],
  date: "2026-01-01",
  ...extra,
});

const a = post("a", "Подготовка участка под модульный дом", {
  category: "guides",
  tags: ["участок", "фундамент"],
  keywords: ["Подготовка  участка", "фундамент модульного дома"],
});

test("баллы формулы: 3·keywords + 3·теги + 1·слова тем + 1·основы заголовка + 1·рубрика", () => {
  const kw = post("kw", "Другое", { keywords: ["подготовка участка"] });
  assert.equal(relatedScore(a, kw), 3);
  const tag = post("tag", "Другое", { tags: ["участок"] });
  assert.equal(relatedScore(a, tag), 3 + 1);
  const title = post("t", "Как выбрать участок");
  assert.equal(relatedScore(a, title), 1);
  const kind = post("k", "Другое", { category: "guides" });
  assert.equal(relatedScore(a, kind), 1);
  const full = post("f", "Модульный дом: участок", {
    category: "guides",
    tags: ["участок"],
    keywords: ["фундамент модульного дома"],
  });
  // keywords 3 + тег 3 + слово темы 1 + основы «модул», «участ» 2 + рубрика 1
  assert.equal(relatedScore(a, full), 10);
});

test("порядок по баллу, при равном — свежее; одна рубрика — не тема, добор свежими", () => {
  const pool = [
    a,
    post("old-match", "Участок у реки", { date: "2025-01-01", tags: ["участок"] }),
    post("new-match", "Участок на склоне", { date: "2026-05-01", tags: ["участок"] }),
    post("same-kind-only", "Новостройки", { category: "guides", date: "2026-11-01" }),
    post("freshest", "Совсем другое", { date: "2026-12-01" }),
  ];
  const picked = pickRelated(a, pool, 3).map((p) => p.slug);
  assert.deepEqual(picked, ["new-match", "old-match", "freshest"]);
  assert.ok(!picked.includes("a"));
});

test("без общего признака — самые свежие", () => {
  const pool = [
    a,
    post("x", "Бетон", { date: "2026-02-01" }),
    post("y", "Кирпич", { date: "2026-03-01" }),
  ];
  assert.deepEqual(
    pickRelated(a, pool, 2).map((p) => p.slug),
    ["y", "x"],
  );
});

test("стоп-слова и короткие слова не считаются; ё = е", () => {
  assert.deepEqual([...titleStems(post("s", "Почему это лучше и как дом"))], []);
  assert.deepEqual([...titleStems(post("s", "Ёлки"))], ["елки"]);
  assert.equal(
    relatedScore(
      post("p", "Сколько стоит дом"),
      post("q", "Сколько стоит баня", { category: "news" }),
    ),
    0,
  );
});
