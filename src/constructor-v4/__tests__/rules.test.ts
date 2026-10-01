import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, roomClearAreaM2 } from "../engine/rules.ts";
import { buildProject } from "../engine/derive.ts";
import type { Project } from "../engine/types.ts";
import { singleTier, twoTier } from "./fixtures.ts";

const hardIds = (p: Project) => evaluate(p).hardViolations.map((v) => v.ruleId);

test("фикстуры проходят все hard-правила", () => {
  assert.deepEqual(evaluate(singleTier()).hardViolations, []);
  assert.deepEqual(evaluate(twoTier()).hardViolations, []);
});

test("кухня-гостиная на двух модулях = 2 × 8,34 + 0,63 (Weekend One: 17,35)", () => {
  const p = singleTier();
  assert.equal(
    roomClearAreaM2(
      p,
      p.rooms.find((r) => r.id === "kitchen")!,
    ),
    17.31,
  );
  assert.equal(
    roomClearAreaM2(
      p,
      p.rooms.find((r) => r.id === "bed1")!,
    ),
    8.34,
  );
});

test("свес 1,6 м без колонны отклоняется, 1,2 м проходит", () => {
  const bad = evaluate(twoTier(-1600)).hardViolations.find((v) => v.ruleId === "overhang");
  assert.ok(bad, "свес 1,6 м должен быть запрещён");
  assert.match(bad.message, /1,6 м больше 1,5 м/);
  assert.equal(bad.review, true);
  assert.deepEqual(evaluate(twoTier(-1200)).hardViolations, []);
});

test("три яруса отклоняются", () => {
  const p = twoTier(
    0,
    [{ id: "t3", xMm: 0, yMm: 0, rot: 0, tier: 3, roomId: "bed3" }],
    [{ id: "bed3", type: "bedroom", tier: 3, moduleIds: ["t3"] }],
  );
  assert.ok(hardIds(p).includes("max-tiers"));
});

test("второй ярус без опоры отклоняется", () => {
  assert.ok(hardIds(twoTier(9000)).includes("upper-support"));
});

test("разорванный дом и пересечение модулей отклоняются", () => {
  const p = singleTier();
  const shiftM5 = (x: number) =>
    buildProject({
      id: "x",
      modules: p.modules.map((m) => (m.id === "m5" ? { ...m, xMm: x } : m)),
      rooms: p.rooms,
      plot: p.plot,
    });
  assert.ok(hardIds(shiftM5(9000)).includes("connected"));
  assert.ok(hardIds(shiftM5(5000)).includes("no-overlap"));
});

test("спальня не открывается в общую комнату — отклоняется (коридоров нет)", () => {
  const p = singleTier();
  const q = buildProject({
    id: "z",
    modules: [
      ...p.modules.filter((m) => m.id !== "m3"),
      { id: "m3", xMm: 9600, yMm: 0, rot: 0, tier: 1, roomId: "bed1" },
    ],
    rooms: p.rooms,
    plot: p.plot,
  });
  assert.ok(hardIds(q).includes("no-corridor"));
});

test("второй ярус без холла с лестницей отклоняется", () => {
  const p = twoTier();
  const q = buildProject({
    id: "h",
    modules: p.modules.map((m) => (m.id === "u1" ? { ...m, roomId: "bed2" } : m)),
    rooms: [
      ...p.rooms.filter((r) => r.id !== "hall"),
      { id: "bed2", type: "bedroom", tier: 2, moduleIds: ["u1"] },
    ],
    plot: p.plot,
  });
  assert.ok(hardIds(q).includes("stairs"));
});

test("дом не встаёт на участок — отклоняется", () => {
  assert.ok(hardIds({ ...singleTier(), plot: { widthM: 12, depthM: 12 } }).includes("plot-fit"));
});

test("проём нестандартной высоты отклоняется", () => {
  const p = singleTier();
  const w = p.openings.find((o) => o.kind === "window")!;
  const q = {
    ...p,
    openings: p.openings.map((o) => (o.id === w.id ? { ...o, heightMm: 2600 } : o)),
  };
  assert.ok(
    evaluate(q).hardViolations.some((v) => v.ruleId === "openings" && /2600/.test(v.message)),
  );
});

test("неизвестное помещение отклоняется", () => {
  const p = singleTier();
  const q = {
    ...p,
    rooms: p.rooms.map((r) => (r.id === "bed2" ? { ...r, type: "sauna" as never } : r)),
  };
  assert.ok(hardIds(q).includes("room-integrity"));
});

test("у каждого результата есть объяснение и источник", () => {
  for (const r of evaluate(twoTier(-1600)).results) {
    assert.ok(r.message.length > 5);
    assert.ok(r.source.length > 0);
  }
});
