import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_MODULE } from "../catalog.ts";
import { rectOf, touching } from "../geometry.ts";
import { SNAP_STEPS, pickAnchor, snapAnchors } from "../snap.ts";
import type { ModuleInstance } from "../types.ts";

/**
 * Привязка при перетаскивании.
 *
 * Главная проверка — что ровная стыковка вообще существует. Это не
 * умозрительный случай: в первой версии смещения вдоль стыка отсчитывались от
 * дальнего края и шли шагом 1710, из-за чего ноль в набор не попадал ни разу.
 * Внешне это выглядело так, что модули «всегда встают ступенькой», и собрать
 * прямоугольный дом было нельзя вовсе.
 */

function mod(
  id: string,
  x: number,
  y: number,
  floor = 0,
  rotationDeg: 0 | 90 | 180 | 270 = 0,
): ModuleInstance {
  return { id, moduleTypeId: BASE_MODULE.id, floor, positionMm: { x, y }, rotationDeg };
}

const W = BASE_MODULE.externalWidthMm; // 3200
const D = BASE_MODULE.externalDepthMm; // 3420

test("ровная стыковка есть при любом шаге", () => {
  const anchor = mod("a", 0, 0);
  const moving = mod("b", 50_000, 50_000);

  for (const step of SNAP_STEPS) {
    const anchors = snapAnchors([anchor, moving], moving, step.value);

    // Справа вплотную, края вровень.
    assert.ok(
      anchors.some((p) => p.x === W && p.y === 0 && p.joint === "back-to-back"),
      `шаг ${step.value}: нет ровной стыковки справа`,
    );
    // Сверху вплотную, края вровень.
    assert.ok(
      anchors.some((p) => p.x === 0 && p.y === D && p.joint === "back-to-back"),
      `шаг ${step.value}: нет ровной стыковки сверху`,
    );
    // Слева и снизу — тоже.
    assert.ok(
      anchors.some((p) => p.x === -W && p.y === 0),
      `шаг ${step.value}: нет стыковки слева`,
    );
    assert.ok(
      anchors.some((p) => p.x === 0 && p.y === -D),
      `шаг ${step.value}: нет стыковки снизу`,
    );
  }
});

test("смещение на половину глубины тоже доступно — это приём из стандарта", () => {
  const anchor = mod("a", 0, 0);
  const moving = mod("b", 50_000, 50_000);
  const anchors = snapAnchors([anchor, moving], moving, D / 2);

  // Так смещены B и C относительно A и D в Weekend One.
  assert.ok(anchors.some((p) => p.x === W && p.y === D / 2));
  assert.ok(anchors.some((p) => p.x === W && p.y === -D / 2));
});

test("общая стена предлагается наравне со стыком спина к спине", () => {
  const anchor = mod("a", 0, 0);
  const moving = mod("b", 50_000, 50_000);
  const anchors = snapAnchors([anchor, moving], moving, D / 2);

  const wall = BASE_MODULE.wallThicknessMm;
  assert.ok(
    anchors.some((p) => p.x === W - wall && p.y === 0 && p.joint === "shared-wall"),
    "нет положения с общей стеной",
  );
});

test("выбранное положение действительно даёт стык без зазора", () => {
  const anchor = mod("a", 0, 0);
  const moving = mod("b", 50_000, 50_000);
  const anchors = snapAnchors([anchor, moving], moving, D / 2);

  // Курсор чуть правее и выше идеального положения — магнит обязан
  // притянуть к ровной стыковке, а не к ближайшей ступеньке.
  const picked = pickAnchor(anchors, W + 300, 200, 1500);
  assert.ok(picked);
  assert.equal(picked!.x, W);
  assert.equal(picked!.y, 0);

  const placed = { ...moving, positionMm: { x: picked!.x, y: picked!.y } };
  assert.ok(touching(anchor, placed), "модули должны стоять вплотную");
  const ra = rectOf(anchor);
  const rb = rectOf(placed);
  assert.equal(rb.x, ra.x + ra.w, "между модулями не должно быть зазора");
  assert.equal(rb.y, ra.y, "края по второй оси должны совпасть");
});

test("повёрнутый модуль стыкуется вровень со своим габаритом", () => {
  const anchor = mod("a", 0, 0, 0, 90); // габарит 3420 × 3200
  const moving = mod("b", 50_000, 50_000, 0, 90);
  const anchors = snapAnchors([anchor, moving], moving, D / 2);

  assert.ok(
    anchors.some((p) => p.x === D && p.y === 0),
    "справа вплотную для повёрнутого модуля",
  );
  assert.ok(
    anchors.some((p) => p.x === 0 && p.y === W),
    "сверху вплотную для повёрнутого модуля",
  );
});

test("слишком малое перекрытие граней не предлагается", () => {
  const anchor = mod("a", 0, 0);
  const moving = mod("b", 50_000, 50_000);
  const anchors = snapAnchors([anchor, moving], moving, 100);

  // Уголком, с перекрытием меньше метра, стыковаться нельзя: это не стык.
  for (const p of anchors.filter((c) => c.x === W)) {
    const overlap = Math.min(D, p.y + D) - Math.max(0, p.y);
    assert.ok(overlap >= 1000, `перекрытие ${overlap} мм слишком мало`);
  }
});
