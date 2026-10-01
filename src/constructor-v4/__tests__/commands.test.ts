import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  parseCommand,
  toolCallToCommand,
  COMMAND_TOOLS,
} from "../engine/commands.ts";
import { WINDOW_PRESETS } from "../engine/derive.ts";
import { GRAMMAR } from "../grammar/index.ts";
import { evaluate, modulesOnTier } from "../engine/rules.ts";
import { supportOf } from "../engine/geometry.ts";
import { singleTier, twoTier } from "./fixtures.ts";
import { buildProject } from "../engine/derive.ts";

test("пресеты окон дают только высоты из каталога", () => {
  for (const p of Object.values(WINDOW_PRESETS))
    assert.ok(GRAMMAR.openings.heightsMm.includes(p.heightMm));
  assert.equal(WINDOW_PRESETS["floor-to-ceiling"].heightMm, 3150);
});

test("«сделай второй этаж со свесом 1,2 м» применяется, 3,1 м — нет", () => {
  const ok = applyCommand(twoTier(), { op: "set_overhang", side: "W", mm: 1200 });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    const t1 = modulesOnTier(ok.project, 1);
    assert.equal(
      Math.max(...modulesOnTier(ok.project, 2).map((u) => supportOf(u, t1).overhangMm.W)),
      1200,
    );
  }
  const bad = applyCommand(twoTier(), { op: "set_overhang", side: "W", mm: 3100 });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.violations.some((v) => /колонн/.test(v)));
});

test("третий ярус командой не добавить", () => {
  const r = applyCommand(twoTier(), { op: "add_room", room: "bedroom", tier: 3 });
  assert.equal(r.ok, false);
});

test("«добавь спальню» пристраивает модуль к общей комнате и остаётся в правилах", () => {
  // Квадрат 2×2: кухня-гостиная парой, спальня и санузел — новая спальня встаёт Г-формой.
  const square = buildProject({
    id: "sq",
    modules: [
      { id: "a", xMm: 0, yMm: 0, rot: 0, tier: 1, roomId: "kitchen" },
      { id: "b", xMm: 3200, yMm: 0, rot: 0, tier: 1, roomId: "kitchen" },
      { id: "c", xMm: 0, yMm: 3420, rot: 0, tier: 1, roomId: "bed1" },
      { id: "d", xMm: 3200, yMm: 3420, rot: 0, tier: 1, roomId: "wet" },
    ],
    rooms: [
      { id: "kitchen", type: "kitchen-living", tier: 1, moduleIds: ["a", "b"] },
      { id: "bed1", type: "bedroom", tier: 1, moduleIds: ["c"] },
      { id: "wet", type: "wet-core", tier: 1, moduleIds: ["d"] },
    ],
    plot: { widthM: 30, depthM: 30 },
  });
  const r = applyCommand(square, { op: "add_room", room: "bedroom" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.project.rooms.filter((x) => x.type === "bedroom").length, 2);
    assert.ok(evaluate(r.project).valid);
  }
});

test("«перенеси террасу на юг» и стиль словами", () => {
  const p0 = singleTier();
  const to = p0.terrace.side === "S" ? "N" : "S";
  const t = applyCommand(p0, { op: "move_terrace", side: to });
  assert.ok(t.ok && t.project.terrace.side === to);
  // Туда, где она уже есть, — не «сделано», а честное «так уже есть».
  const same = applyCommand(p0, { op: "move_terrace", side: p0.terrace.side });
  assert.equal(same.ok, false);
  const s = applyCommand(singleTier(), { op: "set_style", style: "японский" });
  assert.ok(s.ok && s.project.finishes.styleId === "japandi");
  // Фирменный ЭкоКуб — белая штукатурка, а не тёмный планкен.
  const e = applyCommand(singleTier(), { op: "set_style", style: "светлый фирменный" });
  assert.ok(e.ok && e.project.finishes.facade === "plaster-white");
  assert.equal(applyCommand(singleTier(), { op: "set_style", style: "барокко" }).ok, false);
});

test("окно: панорама в пол под опорой второго яруса отклоняется", () => {
  const r = applyCommand(twoTier(), {
    op: "window",
    action: "set",
    side: "S",
    roomId: "kitchen",
    preset: "floor-to-ceiling",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.violations.some((v) => /перемычки/.test(v)));
});

test("окно: панорама в пол на одноярусном доме разрешена", () => {
  const r = applyCommand(singleTier(), {
    op: "window",
    action: "set",
    side: "N",
    roomId: "bed1",
    preset: "floor-to-ceiling",
  });
  assert.equal(r.ok, true);
  if (r.ok)
    assert.ok(
      r.project.openings.some((o) => o.roomId === "bed1" && o.heightMm === 3150 && o.userSet),
    );
});

test("окно на стороне стыка с соседним модулем не ставится", () => {
  // У спальни m3 восточная грань целиком примыкает к спальне m4.
  const r = applyCommand(singleTier(), {
    op: "window",
    action: "add",
    side: "E",
    roomId: "bed1",
    preset: "small",
  });
  assert.equal(r.ok, false);
});

test("окно: больше / меньше идут по лестнице пресетов", () => {
  const p = singleTier();
  const w = p.openings.find((o) => o.roomId === "bed1" && o.kind === "window")!;
  const up = applyCommand(p, { op: "window", action: "enlarge", side: w.face, roomId: "bed1" });
  assert.ok(up.ok);
  if (up.ok) assert.equal(up.project.openings.find((o) => o.id === w.id)!.heightMm, 2800);
  const down = applyCommand(p, { op: "window", action: "shrink", side: w.face, roomId: "bed1" });
  assert.ok(down.ok);
  if (down.ok) assert.equal(down.project.openings.find((o) => o.id === w.id)!.heightMm, 2100);
});

test("единственное окно спальни убрать нельзя", () => {
  const p = singleTier();
  const w = p.openings.find((o) => o.roomId === "bed1" && o.kind === "window")!;
  const r = applyCommand(p, { op: "window", action: "remove", side: w.face, roomId: "bed1" });
  assert.equal(r.ok, false);
});

test("разбор команд от модели: неверные значения не проходят", () => {
  assert.equal(parseCommand({ op: "set_overhang", side: "NE", mm: 100 }).ok, false);
  assert.equal(parseCommand({ op: "window", action: "explode", side: "S" }).ok, false);
  assert.equal(parseCommand({ op: "window", action: "set", side: "S", preset: "huge" }).ok, false);
  assert.equal(parseCommand({ op: "rm -rf" }).ok, false);
  const c = toolCallToCommand("edit_window", {
    action: "set",
    side: "S",
    roomId: "kitchen",
    preset: "floor-to-ceiling",
  });
  assert.ok(c.ok && c.command.op === "window");
  for (const t of COMMAND_TOOLS) {
    const r = toolCallToCommand(t.name, {});
    assert.ok(
      r.ok || !/Неизвестная команда/.test(r.error),
      `инструмент ${t.name} знает свою команду`,
    );
  }
});

test("описание стиля словами подбирает отделки", () => {
  const r = applyCommand(singleTier(), {
    op: "describe_style",
    text: "хочу тёмный фасад из термодерева, чёрные рамы и зелёную кровлю",
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.project.finishes.facade, "planken-thermo");
    assert.equal(r.project.finishes.windowFrames, "frame-black");
    assert.equal(r.project.finishes.roof, "flat-green");
    assert.ok(r.project.styleProfile);
  }
  assert.equal(
    applyCommand(singleTier(), { op: "describe_style", text: "ну как-нибудь" }).ok,
    false,
  );
});
