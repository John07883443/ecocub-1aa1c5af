import { test } from "node:test";
import assert from "node:assert/strict";

import { auditModules, errors } from "../audit.ts";
import { polyominoes, toModules } from "../shapes.ts";
import { TEMPLATES } from "../../constructor/constants.ts";

/**
 * Полный перебор форм дома.
 *
 * Отдельные правила планировщика проверять поштучно бесполезно: каждый
 * найденный дефект вылезал не внутри функции, а на стыке правил. Правило
 * одной двери замуровало кухню. Выбор санузла разорвал общую зону. Требование
 * соседа из общей зоны само по себе верное — но санузел, вставший в центр
 * креста, разом лишал выхода три уже назначенные спальни.
 *
 * Поэтому проверяем не правила, а результат, и не на выборке, а на всех
 * связных формах: при семи кубиках их 760, при восьми — 2725. Найденный
 * контрпример становится поправкой к правилу, поправка — строкой здесь.
 */

test("любая форма дома до семи кубиков даёт пригодную планировку", () => {
  let checked = 0;
  for (let n = 2; n <= 7; n += 1) {
    for (const shape of polyominoes(n)) {
      const found = errors(auditModules(toModules(shape)));
      assert.deepEqual(
        found.map((f) => `${f.code}: ${f.message}`),
        [],
        `форма ${JSON.stringify(shape)}`,
      );
      checked += 1;
    }
  }
  // 2 + 6 + 19 + 63 + 216 + 760 — это все формы, а не выборка.
  assert.equal(checked, 1066);
});

test("готовые раскладки тоже проходят аудит", () => {
  for (const template of TEMPLATES) {
    const modules = template.seeds.map((s, i) => ({ id: `m${i}`, ...s }));
    const found = errors(auditModules(modules));
    assert.deepEqual(
      found.map((f) => `${f.code}: ${f.message}`),
      [],
      template.id,
    );
  }
});

test("аудит ловит подделку: дом без общей зоны и с запертой комнатой", async () => {
  // Проверка самого аудита. Инвариант, который ничего не ловит, опаснее
  // отсутствующего: он создаёт ложное спокойствие.
  const { houseFromModules } = await importZoning();
  const house = houseFromModules(
    (
      [
        [0, 0],
        [3, 0],
      ] as Array<[number, number]>
    ).map(([x, z], i) => ({
      id: `m${i}`,
      x,
      z,
      floor: 0,
      role: "living" as const,
    })),
  );
  // Ломаем руками: закрываем комнате единственный выход и убираем общую зону.
  const broken = {
    ...house,
    rooms: house.rooms.map((r) => ({ ...r, type: "storage" as const })),
    jointOverrides: Object.fromEntries(
      house.modules.flatMap((a) =>
        house.modules.filter((b) => b.id > a.id).map((b) => [`${a.id}|${b.id}`, "closed" as const]),
      ),
    ),
  };
  const codes = errors(auditHouseRef(broken)).map((f) => f.code);
  assert.ok(codes.includes("no-common-room"), `коды: ${codes.join(",")}`);
});

// Импорты вынесены вниз: тест выше читается как история, а не как список.
import { auditHouse as auditHouseRef } from "../audit.ts";
async function importZoning() {
  return import("../zoning.ts");
}
