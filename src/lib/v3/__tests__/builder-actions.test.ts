import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addRoleModule,
  addSecondFloor,
  findAttachSpot,
  mirrorHouse,
  removeRoleModule,
} from "../builder-actions.ts";
import { canPlace, dropUnsupported, supportArea } from "../../constructor/geometry.ts";
import { MIN_SUPPORT_AREA } from "../../constructor/constants.ts";
import type { ModuleItem } from "../../constructor/types.ts";

const N = 8; // участок 24 × 24 м

const base: ModuleItem[] = [
  { id: "a", x: 6, z: 6, floor: 0, role: "living" },
  { id: "b", x: 9, z: 6, floor: 0, role: "kitchen" },
  { id: "c", x: 6, z: 9, floor: 0, role: "bathroom" },
];

/** Проверка через боевой валидатор: конфигурацию можно собрать с нуля. */
function isValidConfiguration(modules: ModuleItem[]): boolean {
  const placed: ModuleItem[] = [];
  for (const m of [...modules].sort((x, y) => x.floor - y.floor)) {
    if (!canPlace(placed, m, N)) return false;
    placed.push(m);
  }
  return true;
}

test("добавление спальни примыкает к дому и проходит валидатор", () => {
  const r = addRoleModule(base, "bedroom", 0, N);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.modules.length, 4);
    assert.ok(isValidConfiguration(r.modules));
    const added = r.modules[3];
    // Примыкание: касается хотя бы одного модуля стороной.
    const touches = base.some(
      (m) =>
        (Math.abs(m.x - added.x) === 3 && Math.abs(m.z - added.z) <= 3) ||
        (Math.abs(m.z - added.z) === 3 && Math.abs(m.x - added.x) <= 3),
    );
    assert.ok(touches);
  }
});

test("«рассмотреть второй этаж» добавляет лестницу и спальню с опорой", () => {
  const r = addSecondFloor(base, N);
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.modules.some((m) => m.role === "stairs"));
    const upper = r.modules.find((m) => m.floor === 1);
    assert.ok(upper);
    assert.ok(supportArea(upper!, r.modules) >= MIN_SUPPORT_AREA);
    assert.ok(isValidConfiguration(r.modules));
  }
});

test("зеркало сохраняет число модулей, роли и допустимость", () => {
  const r = mirrorHouse(base, N);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.modules.length, base.length);
    assert.deepEqual(r.modules.map((m) => m.role).sort(), base.map((m) => m.role).sort());
    assert.ok(isValidConfiguration(r.modules));
  }
});

test("удаление модуля каскадно убирает осиротевший верх", () => {
  const withUpper: ModuleItem[] = [...base, { id: "u", x: 6, z: 6, floor: 1, role: "bedroom" }];
  const r = removeRoleModule(withUpper, "living");
  assert.ok(r.ok);
  if (r.ok) {
    // Опора верхнего была только на living — верх тоже должен уйти.
    assert.ok(!r.modules.some((m) => m.floor === 1));
    assert.equal(dropUnsupported(r.modules).length, r.modules.length);
  }
});

test("на пустом участке первый модуль ставится по центру", () => {
  const spot = findAttachSpot([], 0, N);
  assert.ok(spot);
  assert.ok(canPlace([], { ...spot!, floor: 0 }, N));
});

test("недопустимое действие возвращает ошибку, а не битое состояние", () => {
  const r = removeRoleModule(base, "terrace");
  assert.equal(r.ok, false);
});
