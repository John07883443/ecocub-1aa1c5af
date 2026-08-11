import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_MODULE } from "../catalog.ts";
import { editorReducer, type EditorAction, type EditorState } from "../editor.ts";
import { createProject } from "../factory.ts";
import type { HouseProject, ModuleInstance } from "../types.ts";

/**
 * Запрет наложения на уровне редуктора.
 *
 * Проверять его в интерфейсе бессмысленно: способов сдвинуть модуль много —
 * перетаскивание, ввод координаты числом, поворот, дублирование, перенос на
 * этаж, — и запрет, который действует «почти всегда», не запрет вовсе. Здесь
 * каждый способ проверяется отдельно, потому что забыть один из них проще
 * всего.
 */

const W = BASE_MODULE.externalWidthMm; // 3200
const D = BASE_MODULE.externalDepthMm; // 3420

function mod(id: string, x: number, y = 0, floor = 0): ModuleInstance {
  return { id, moduleTypeId: BASE_MODULE.id, floor, positionMm: { x, y }, rotationDeg: 0 };
}

/** Два модуля вплотную по X — законное состояние, от него всё и пляшет. */
function start(modules: ModuleInstance[] = [mod("A", 0), mod("B", W)]): EditorState {
  const project: HouseProject = createProject("Проверка");
  return {
    project: { ...project, model: { ...project.model, modules, openings: [] } },
    past: [],
    future: [],
    selection: [],
    selectedOpeningId: null,
    activeFloor: 0,
    dirty: false,
    rejection: null,
  };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function positions(state: EditorState): Record<string, { x: number; y: number }> {
  return Object.fromEntries(state.project.model.modules.map((m) => [m.id, m.positionMm]));
}

test("перетаскивание в наложение отклоняется, модуль остаётся на месте", () => {
  const before = start();
  const after = run(before, { type: "move-modules", moves: [{ id: "B", x: 100, y: 0 }] });

  assert.deepEqual(positions(after).B, { x: W, y: 0 }, "модуль не сдвинулся");
  assert.equal(after.dirty, false, "отклонённое действие не помечает проект изменённым");
  assert.equal(after.past.length, 0, "и не попадает в историю отмены");
  assert.ok(after.rejection, "причина отказа должна быть названа");
});

test("ввод координаты числом тоже отклоняется", () => {
  const after = run(start(), {
    type: "patch-module",
    id: "B",
    patch: { positionMm: { x: 100, y: 0 } },
  });
  assert.deepEqual(positions(after).B, { x: W, y: 0 });
  assert.ok(after.rejection);
});

test("новый модуль поверх существующего не ставится", () => {
  const after = run(start(), { type: "add-module", x: 500, y: 500 });
  assert.equal(after.project.model.modules.length, 2, "третьего модуля не появилось");
  assert.ok(after.rejection);
});

test("поворот, от которого модуль въедет в соседа, отклоняется", () => {
  // Поворот на 90° меняет габарит 3200 × 3420 на 3420 × 3200: модуль A
  // вырастет вправо на 220 мм и налезет на B.
  const after = run(start(), { type: "rotate", ids: ["A"], direction: 1 });
  assert.equal(after.project.model.modules[0].rotationDeg, 0, "поворот не применён");
  assert.ok(after.rejection);
});

test("перенос на занятый этаж отклоняется", () => {
  const before = start([mod("A", 0, 0, 0), mod("B", 0, 0, 1)]);
  const after = run(before, { type: "move-to-floor", ids: ["B"], floor: 0 });
  assert.equal(after.project.model.modules[1].floor, 1, "модуль остался на своём этаже");
  assert.ok(after.rejection);
});

test("копия обходит занятое место, а не встаёт в наложение", () => {
  const after = run(start(), { type: "duplicate-modules", ids: ["A"] });
  assert.equal(after.project.model.modules.length, 3);
  assert.equal(after.rejection, null, "дублирование не должно отклоняться из-за тесноты");

  const copy = after.project.model.modules[2];
  // Справа от A стоит B — значит копия там встать не могла.
  assert.notDeepEqual(copy.positionMm, { x: W, y: 0 });
  for (const other of after.project.model.modules.slice(0, 2)) {
    const dx = Math.abs(copy.positionMm.x - other.positionMm.x);
    const dy = Math.abs(copy.positionMm.y - other.positionMm.y);
    assert.ok(
      dx >= W || dy >= D,
      `копия ${JSON.stringify(copy.positionMm)} налезла на ${other.id}`,
    );
  }
});

test("законные действия по-прежнему проходят", () => {
  const after = run(start(), { type: "move-modules", moves: [{ id: "B", x: W, y: D }] });
  assert.deepEqual(positions(after).B, { x: W, y: D });
  assert.equal(after.dirty, true);
  assert.equal(after.rejection, null, "успешное действие снимает прежний отказ");
});

test("общая стена разрешена — это стык, а не наложение", () => {
  const wall = BASE_MODULE.wallThicknessMm;
  const after = run(start(), { type: "move-modules", moves: [{ id: "B", x: W - wall, y: 0 }] });
  assert.deepEqual(positions(after).B, { x: W - wall, y: 0 });
  assert.equal(after.rejection, null);
});

test("уже лежащее в проекте наложение не запирает редактор", () => {
  // Так выглядит старая запись или чужой импорт: A и B стоят внахлёст.
  const broken = start([mod("A", 0), mod("B", 500)]);
  // Двигаем B прочь — действие обязано пройти, иначе чинить нечем.
  const fixed = run(broken, { type: "move-modules", moves: [{ id: "B", x: W, y: 0 }] });
  assert.deepEqual(positions(fixed).B, { x: W, y: 0 });
  assert.equal(fixed.rejection, null);
});

test("каждый следующий отказ — отдельное событие", () => {
  const one = run(start(), { type: "move-modules", moves: [{ id: "B", x: 100, y: 0 }] });
  const two = run(one, { type: "move-modules", moves: [{ id: "B", x: 100, y: 0 }] });
  assert.ok(one.rejection && two.rejection);
  assert.notEqual(one.rejection!.seq, two.rejection!.seq);
});
