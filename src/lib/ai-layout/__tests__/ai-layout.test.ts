import { test } from "node:test";
import assert from "node:assert/strict";

import { MIN_PASSAGE_M, describeNudges, findTightJoints, relaxJoints } from "../relax.ts";
import { isConnected } from "../../constructor/geometry.ts";

import { buildFootprint, entrancePoint } from "../footprint.ts";
import { isPng } from "../png.ts";
import { renderFootprintPng } from "../render.ts";
import { buildLayoutPrompt, clampProgram, PROMPT_VERSION, type LayoutProgram } from "../prompt.ts";
import { canonicalKeySource, normalizeRequest } from "../request.ts";
import { MODULE_SIDE_M } from "../../constructor/constants.ts";
import type { ModuleItem } from "../../constructor/types.ts";

const S = MODULE_SIDE_M;

/** Модуль конструктора: координаты в метрах, левый верхний угол секции. */
const mod = (id: string, x: number, z: number, floor = 0): ModuleItem => ({
  id,
  x,
  z,
  floor,
  role: "living",
});

/** L-образный дом из 6 секций — на нём видно и углы, и вырез. */
function lShaped(offset = 3): ModuleItem[] {
  const cells: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  return cells.map(([cx, cz], i) => mod(`m${i}`, offset + cx * S, offset + cz * S));
}

test("контур нормализуется к нулю независимо от места сборки на участке", () => {
  const a = buildFootprint(lShaped(3));
  const b = buildFootprint(lShaped(7.5));
  assert.deepEqual(a.walls, b.walls);
  assert.deepEqual(a.modules, b.modules);
  assert.equal(a.widthM, 9);
  assert.equal(a.depthM, 9);
  assert.equal(a.areaM2, 54);
});

test("общие грани не попадают в наружные стены и уходят в швы", () => {
  const fp = buildFootprint([mod("a", 3, 3), mod("b", 3 + S, 3)]);
  // Периметр 6x3 — это 18 м, а не 24 (две отдельные секции).
  const perimeter = fp.walls.reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0);
  assert.equal(round(perimeter), 18);
  const seam = fp.seams.reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0);
  assert.equal(round(seam), 3);
  // Ни один участок наружной стены не лежит на общей грани x = 3.
  assert.ok(!fp.walls.some((w) => w.x1 === S && w.x2 === S));
});

test("вход садится на середину самой длинной стены выбранной стороны", () => {
  const fp = buildFootprint(lShaped());
  const south = entrancePoint(fp, "south");
  assert.ok(south);
  assert.equal(south!.axis, "z");
  // Снизу сплошная стена только у левого крыла: 0..6 по X, значит середина — 3.
  assert.equal(south!.z, 9);
  assert.equal(south!.x, 3);
  assert.ok(south!.widthM > 0.4 && south!.widthM <= 1.2);

  const north = entrancePoint(fp, "north");
  assert.ok(north);
  assert.equal(north!.z, 0);
});

test("вход не рисуется, если на стороне нет достаточно длинной стены", () => {
  // Одна секция: любая сторона 3 м, проём влезает — проверяем обратный случай
  // через искусственно короткий контур.
  const fp = buildFootprint([mod("a", 3, 3)]);
  const point = entrancePoint(fp, "west");
  assert.ok(point, "у стены 3 м проём должен помещаться");
  const empty = buildFootprint([]);
  assert.equal(entrancePoint(empty, "west"), null);
});

test("этажи выше первого не меняют контур, но считаются в статистике", () => {
  const fp = buildFootprint([mod("a", 3, 3), mod("b", 3, 3, 1)]);
  assert.equal(fp.areaM2, 9);
  assert.equal(fp.moduleCount, 2);
  assert.equal(fp.floors, 2);
  assert.equal(fp.modules.length, 1);
});

test("исходный PNG валиден и побайтово воспроизводим", async () => {
  const fp = buildFootprint(lShaped());
  const first = await renderFootprintPng(fp, "south");
  const second = await renderFootprintPng(fp, "south");
  assert.ok(isPng(first.bytes));
  assert.equal(first.bytes.length, second.bytes.length);
  assert.ok(
    Buffer.from(first.bytes).equals(Buffer.from(second.bytes)),
    "PNG должен совпасть байт в байт",
  );
  assert.equal(first.size, 1024);
  assert.ok(first.scale > 0);
});

test("масштаб исходника одинаков по осям — пропорции дома не искажаются", async () => {
  const fp = buildFootprint([mod("a", 3, 3), mod("b", 3 + S, 3), mod("c", 3 + 2 * S, 3)]);
  const img = await renderFootprintPng(fp, null);
  // Широкий дом 9x3 вписан по большей стороне, поля сверху/снизу больше.
  assert.ok(img.offsetZpx > img.offsetXpx);
  assert.equal(round(fp.widthM * img.scale + img.offsetXpx * 2), img.size);
});

test("отметка входа меняет картинку", async () => {
  const fp = buildFootprint(lShaped());
  const withEntrance = await renderFootprintPng(fp, "south");
  const without = await renderFootprintPng(fp, null);
  assert.ok(!Buffer.from(withEntrance.bytes).equals(Buffer.from(without.bytes)));
});

test("программа помещений ограничивается площадью дома", () => {
  const small = buildFootprint([mod("a", 3, 3), mod("b", 3 + S, 3)]); // 18 м²
  const asked: LayoutProgram = {
    bedrooms: 6,
    bathrooms: 9,
    residents: 40,
    extraRooms: ["office", "utility", "pantry", "laundry", "wardrobe"],
    entrance: "south",
  };
  const clamped = clampProgram(asked, small);
  assert.equal(clamped.bedrooms, 1);
  assert.equal(clamped.bathrooms, 4);
  assert.equal(clamped.residents, 12);
  assert.equal(clamped.extraRooms.length, 3);
});

test("промпт содержит проверяемые габариты и запрет менять контур", () => {
  const fp = buildFootprint(lShaped());
  const prompt = buildLayoutPrompt(fp, {
    bedrooms: 3,
    bathrooms: 2,
    extraRooms: ["office"],
    entrance: "south",
  });
  assert.match(prompt, /9 x 9 m/);
  assert.match(prompt, /54 m2/);
  assert.match(prompt, /3 bedrooms/);
  assert.match(prompt, /home office/);
  assert.match(prompt, /bottom \(south\) side/);
  assert.match(prompt, /Do not change, crop, bend, expand, shrink or simplify/);
  assert.equal(PROMPT_VERSION, "v4-reference");
});

test("в промпт попадают паттерны построенных проектов", () => {
  // До v3 модель держала контур, но внутри рисовала абстрактную квартиру:
  // мокрые зоны разъезжались по дому, остекление было случайным. Разбор
  // Weekend One и Weekend Mini уходит в промпт целиком.
  const prompt = buildLayoutPrompt(buildFootprint(lShaped()), {
    bedrooms: 2,
    bathrooms: 1,
    extraRooms: [],
    entrance: null,
  });
  assert.match(prompt, /ECOCUB DESIGN PATTERNS/);
  assert.match(prompt, /single riser/);
  assert.match(prompt, /Allowed opening heights: 2100, 2500, 2800, 3150 mm/);
  assert.match(prompt, /floor-to-ceiling glazing/);
  assert.match(prompt, /blank facade is a valid/);
  // Терраса не должна выползти за контур — иначе паттерны сломают то
  // единственное, что раньше работало.
  assert.match(prompt, /must stay strictly inside the given footprint/);
  // Габарит модуля в тексте обязан совпадать с тем, что нарисовано на PNG.
  assert.match(prompt, /Module: external 3000 x 3000 mm/);
});

test("к собранному дому подбирается ближайший построенный проект", () => {
  // Дом на шесть кубиков и 54 м² ближе всего к Family One: столько же
  // объёмов и сопоставимая площадь.
  const prompt = buildLayoutPrompt(buildFootprint(lShaped()), {
    bedrooms: 2,
    bathrooms: 1,
    extraRooms: [],
    entrance: null,
  });
  assert.match(prompt, /CLOSEST BUILT PROJECT/);
  assert.match(prompt, /Family One/);
  // Образец не должен перебивать контур — это единственное жёсткое правило.
  assert.match(prompt, /Do NOT copy its outline/);

  // Дом на один кубик не похож ни на что из библиотеки: образца быть не должно.
  const tiny = buildLayoutPrompt(
    buildFootprint([{ id: "a", x: 0, z: 0, floor: 0, role: "living" }]),
    {
      bedrooms: 1,
      bathrooms: 1,
      extraRooms: [],
      entrance: null,
    },
  );
  assert.ok(!tiny.includes("CLOSEST BUILT PROJECT"));
});

test("нормализация отбивает мусор и подделанную геометрию", () => {
  assert.equal(normalizeRequest(null).ok, false);
  assert.equal(expectFail(normalizeRequest({ modules: [] })), "no_modules");
  assert.equal(expectFail(normalizeRequest({ modules: [{ x: 3.3, z: 3, floor: 0 }] })), "off_grid");
  assert.equal(expectFail(normalizeRequest({ modules: [{ x: 3, z: 3, floor: 5 }] })), "bad_floor");
  assert.equal(
    expectFail(normalizeRequest({ modules: [{ x: 3, z: 3, floor: 1 }] })),
    "no_ground_floor",
  );
  assert.equal(
    expectFail(
      normalizeRequest({
        modules: [
          { x: 3, z: 3, floor: 0 },
          { x: 4, z: 3, floor: 0 },
        ],
      }),
    ),
    "overlapping_modules",
  );
  assert.equal(
    expectFail(
      normalizeRequest({
        modules: Array.from({ length: 61 }, (_, i) => ({ x: i * S + 3, z: 3, floor: 0 })),
      }),
    ),
    "too_many_modules",
  );
});

test("нормализация пропускает только известные комнаты и стороны входа", () => {
  const res = normalizeRequest({
    modules: [{ x: 3, z: 3, floor: 0 }],
    bedrooms: 2,
    bathrooms: 1,
    extraRooms: ["office", "swimming-pool", "<script>"],
    entrance: "northwest",
  });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepEqual(res.value.program.extraRooms, ["office"]);
  assert.equal(res.value.program.entrance, null);
  // Модули всегда универсальные — роль из запроса не принимается.
  assert.equal(res.value.modules[0].role, "living");
});

test("идемпотентный ключ не зависит от порядка модулей и лишних полей", () => {
  const a = normalizeRequest({
    modules: [
      { id: "z", x: 3, z: 3, floor: 0 },
      { id: "a", x: 3 + S, z: 3, floor: 0 },
    ],
    bedrooms: 2,
    bathrooms: 1,
    extraRooms: ["utility", "office"],
    entrance: "south",
  });
  const b = normalizeRequest({
    modules: [
      { id: "q", x: 3 + S, z: 3, floor: 0 },
      { id: "w", x: 3, z: 3, floor: 0 },
    ],
    bedrooms: 2,
    bathrooms: 1,
    extraRooms: ["office", "utility"],
    entrance: "south",
  });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  const key = (v: typeof a.value) => canonicalKeySource(v, "m", PROMPT_VERSION);
  assert.equal(key(a.value), key(b.value));

  // Другая версия промпта — другой ключ, иначе старый результат подменит новый.
  assert.notEqual(canonicalKeySource(a.value, "m", "v2"), key(a.value));
});

function expectFail(r: ReturnType<typeof normalizeRequest>): string {
  assert.equal(r.ok, false);
  return r.ok ? "" : r.reason;
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ */
/* Хранилище готовых планировок                                        */
/* ------------------------------------------------------------------ */

test("хранилище принимает только PNG и только безопасный ключ", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  process.env.LEADS_DB_PATH = `${mkdtempSync(`${tmpdir()}/ecocub-`)}/leads.db`;
  const { saveImage, readImage } = await import("../store.server.ts");

  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const key = "a".repeat(40);

  const url = await saveImage(key, png);
  assert.equal(url, `/api/ai-layout/result?key=${key}`);
  const back = await readImage(key);
  assert.ok(back && Buffer.from(back).equals(Buffer.from(png)));

  // Не PNG — не сохраняем: раздавать чужой тип со своего домена незачем.
  assert.equal(await saveImage("b".repeat(40), new Uint8Array([1, 2, 3])), null);
  // Пустой ответ провайдера.
  assert.equal(await saveImage("c".repeat(40), new Uint8Array(0)), null);
  // Ключ участвует в пути к файлу — обход каталогов должен отсекаться.
  assert.equal(await saveImage("../../etc/passwd", png), null);
  assert.equal(await readImage("../../etc/passwd"), null);
  assert.equal(await readImage("d".repeat(40)), null);
});

test("тесный стык разжимается минимальным сдвигом, а не пересборкой", () => {
  // Дверь 800 плюс перегородки по 210 не встают в метровый стык: конструктор
  // такую раскладку разрешает, а построить её нельзя.
  assert.equal(MIN_PASSAGE_M, 1.5);

  const tight = [
    { id: "a", x: 0, z: 0, floor: 0, role: "living" as const },
    { id: "b", x: 3, z: 2, floor: 0, role: "bedroom" as const },
  ];
  assert.equal(findTightJoints(tight).length, 1);

  const relaxed = relaxJoints(tight);
  assert.equal(relaxed.unresolved.length, 0);
  assert.equal(relaxed.nudges.length, 1);
  // Сдвиг ровно на недостающие полметра — не больше.
  const nudge = relaxed.nudges[0];
  assert.equal(Math.abs(nudge.dxM) + Math.abs(nudge.dzM), 0.5);
  assert.ok(nudge.reason.includes("800"));
  // Дом остался связным и не потерял модулей.
  assert.equal(relaxed.modules.length, tight.length);
  assert.ok(isConnected(relaxed.modules));
});

test("нормальная геометрия не трогается вовсе", () => {
  const fine = lShaped();
  const relaxed = relaxJoints(fine);
  assert.deepEqual(relaxed.nudges, []);
  assert.deepEqual(
    relaxed.modules.map((m) => `${m.x},${m.z}`),
    fine.map((m) => `${m.x},${m.z}`),
  );
  assert.equal(describeNudges([]), "");
});

test("правка не отрывает модуль от соседей", () => {
  // Три в линию, последний пристыкован уголком. Сдвиг обязан открыть проход,
  // не потеряв ни одного стыка: иначе дом развалится на части.
  const chain = [
    { id: "a", x: 0, z: 0, floor: 0, role: "living" as const },
    { id: "b", x: 3, z: 0, floor: 0, role: "living" as const },
    { id: "c", x: 6, z: 2.5, floor: 0, role: "bedroom" as const },
  ];
  const relaxed = relaxJoints(chain);
  assert.equal(relaxed.unresolved.length, 0);
  assert.ok(isConnected(relaxed.modules));
  assert.equal(relaxed.modules.length, 3);
  assert.match(describeNudges(relaxed.nudges), /дверь между ними не помещалась/);
});
