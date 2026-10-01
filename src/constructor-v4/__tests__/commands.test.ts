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

test("пресеты окон дают только высоты из каталога", () => {
  for (const p of Object.values(WINDOW_PRESETS))
    assert.ok(GRAMMAR.openings.heightsMm.includes(p.heightMm));
  assert.equal(WINDOW_PRESETS["floor-to-ceiling"].heightMm, 3150);
});

test("«сделай второй этаж со свесом 1,2 м» применяется, 1,6 м — нет", () => {
  const ok = applyCommand(twoTier(), { op: "set_overhang", side: "W", mm: 1200 });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    const t1 = modulesOnTier(ok.project, 1);
    assert.equal(
      Math.max(...modulesOnTier(ok.project, 2).map((u) => supportOf(u, t1).overhangMm.W)),
      1200,
    );
  }
  const bad = applyCommand(twoTier(), { op: "set_overhang", side: "W", mm: 1600 });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.violations.some((v) => /колонн/.test(v)));
});

test("третий ярус командой не добавить", () => {
  const r = applyCommand(twoTier(), { op: "add_room", room: "bedroom", tier: 3 });
  assert.equal(r.ok, false);
});

test("«добавь спальню» пристраивает модуль к общей комнате и остаётся в правилах", () => {
  const r = applyCommand(singleTier(), { op: "add_room", room: "bedroom" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.project.rooms.filter((x) => x.type === "bedroom").length, 3);
    assert.ok(evaluate(r.project).valid);
  }
});

test("«перенеси террасу на юг» и стиль словами", () => {
  const t = applyCommand(singleTier(), { op: "move_terrace", side: "S" });
  assert.ok(t.ok && t.project.terrace.side === "S");
  const s = applyCommand(singleTier(), { op: "set_style", style: "скандинавский" });
  assert.ok(s.ok && s.project.finishes.styleId === "scandi");
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
