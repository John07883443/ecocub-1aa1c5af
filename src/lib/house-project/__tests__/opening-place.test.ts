import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_MODULE, OPENING_PRESETS } from "../catalog.ts";
import {
  OPENING_TOOLS,
  WALL_MM,
  clearSpanMm,
  heightOptions,
  nearestFace,
  placeOnFace,
  presetWidthOn,
  widthOptions,
} from "../opening-place.ts";
import type { ModuleInstance } from "../types.ts";

/**
 * Постановка проёма мышью и предлагаемые размеры.
 *
 * Проверяется главным образом одно: проём никогда не залезает на угловой
 * простенок. Толщина стены 210 мм — константа продукта, и «во всю стену» для
 * грани 3200 означает 2780, а не 3200. Ошибка здесь не видна на экране, зато
 * прекрасно видна на заводе.
 */

function mod(id: string, x = 0, y = 0, floor = 0): ModuleInstance {
  return { id, moduleTypeId: BASE_MODULE.id, floor, positionMm: { x, y }, rotationDeg: 0 };
}

const W = BASE_MODULE.externalWidthMm; // 3200
const D = BASE_MODULE.externalDepthMm; // 3420

test("толщина стены берётся из стандарта и равна 210", () => {
  assert.equal(WALL_MM, 210);
  assert.equal(clearSpanMm(W), W - 420);
  assert.equal(clearSpanMm(D), D - 420);
});

test("все инструменты панели ссылаются на существующие пресеты", () => {
  for (const t of OPENING_TOOLS) {
    const preset = OPENING_PRESETS.find((p) => p.id === t.presetId);
    assert.ok(preset, `нет пресета ${t.presetId}`);
    assert.equal(preset!.kind, t.kind, `тип ${t.presetId} разошёлся со справочником`);
  }
});

test("ближайшая стена ищется по расстоянию, а не по попаданию в полоску", () => {
  const m = mod("A");
  // Точка снаружи, в 300 мм под нижней гранью Р-1 и посередине её длины.
  const hit = nearestFace([m], 0, { x: W / 2, y: -300 }, 800);
  assert.ok(hit);
  assert.equal(hit!.moduleId, "A");
  assert.equal(hit!.faceId, "Р-1");
  assert.equal(hit!.distanceMm, 300);
  assert.equal(hit!.alongMm, W / 2);
});

test("за порогом стена не находится, и на чужом этаже тоже", () => {
  const m = mod("A");
  assert.equal(nearestFace([m], 0, { x: W / 2, y: -900 }, 800), null);
  assert.equal(nearestFace([m], 1, { x: W / 2, y: -100 }, 800), null);
});

test("из двух стен выбирается действительно ближняя", () => {
  const a = mod("A", 0, 0);
  const b = mod("B", W, 0); // стоит справа вплотную
  // Точка у стыка, но на 40 мм внутри A — ближе грань Р-2 модуля A.
  const hit = nearestFace([a, b], 0, { x: W - 40, y: D / 2 }, 600);
  assert.ok(hit);
  assert.equal(hit!.moduleId, "A");
  assert.equal(hit!.faceId, "Р-2");
});

test("проём центрируется по курсору и не наезжает на простенок", () => {
  // Курсор у самого угла: проём обязан отойти на толщину стены.
  const left = placeOnFace(W, 0, 1500);
  assert.equal(left.offsetMm, WALL_MM);
  assert.equal(left.widthMm, 1500);

  const right = placeOnFace(W, W, 1500);
  assert.equal(right.offsetMm, W - WALL_MM - 1500);

  // Курсор посередине — проём тоже посередине.
  const mid = placeOnFace(W, W / 2, 1000);
  assert.equal(mid.offsetMm, W / 2 - 500);
});

test("ширина шире чистой стены ужимается, а не выходит за угол", () => {
  const p = placeOnFace(W, W / 2, 9999);
  assert.equal(p.widthMm, clearSpanMm(W)); // 2780
  assert.equal(p.offsetMm, WALL_MM);
  assert.equal(p.offsetMm + p.widthMm, W - WALL_MM, "правый край упирается в простенок");
});

test("предлагаемые ширины — доли чистой стены, кратные десяти", () => {
  const options = widthOptions(W);
  assert.equal(options[0].widthMm, 2780, "«во всю стену» — это чистая длина");
  assert.deepEqual(
    options.map((o) => o.widthMm),
    [2780, 2090, 1390, 930, 700],
  );
  for (const o of options) {
    assert.equal(o.widthMm % 10, 0, `${o.widthMm} не кратно 10`);
    assert.ok(o.widthMm <= clearSpanMm(W), `${o.widthMm} не помещается в чистую стену`);
  }
});

test("предлагаемые высоты не превышают высоту помещения", () => {
  for (const h of heightOptions(BASE_MODULE.clearHeightMm)) {
    assert.ok(
      h.sillMm + h.heightMm <= BASE_MODULE.clearHeightMm,
      `${h.id}: верх ${h.sillMm + h.heightMm} выше потолка`,
    );
    assert.ok(h.heightMm > 0);
  }
  // Потолок ниже отсекает варианты, а не выдаёт отрицательную высоту.
  const low = heightOptions(2500);
  assert.ok(low.every((h) => h.sillMm + h.heightMm <= 2500));
  assert.ok(low.length > 0);
});

test("ширина считается по конкретной грани, а не берётся числом", () => {
  const m = mod("A");
  // Инструменты «во всю стену» дают чистую длину именно этой грани:
  // 2780 у короткой и 3000 у длинной. Одного числа для обеих не существует.
  assert.equal(presetWidthOn(m, "Р-1", "window-full"), clearSpanMm(W));
  assert.equal(presetWidthOn(m, "Р-2", "window-full"), clearSpanMm(D));
  assert.equal(presetWidthOn(m, "Р-1", "panoramic-3150"), clearSpanMm(W));

  // Входная дверь 800 остаётся 800 — это подтверждённый чертежом габарит.
  assert.equal(presetWidthOn(m, "Р-4", "entrance-door"), 800);
  // Пресет не из панели берёт своё число из справочника.
  assert.equal(presetWidthOn(m, "Р-1", "window-2500"), 1500);
});

test("окно по умолчанию — в пол и во всю стену", () => {
  const tool = OPENING_TOOLS[0];
  assert.equal(tool.label, "Окно");
  assert.equal(tool.widthMode, "full");
  const preset = OPENING_PRESETS.find((p) => p.id === tool.presetId)!;
  assert.equal(preset.sillMm, 0, "низ проёма — чистый пол");
  assert.equal(preset.heightMm, BASE_MODULE.clearHeightMm, "верх — потолок 3150");
});
