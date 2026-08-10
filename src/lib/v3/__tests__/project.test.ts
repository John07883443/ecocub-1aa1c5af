import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, parseProject, serializeProject } from "../project.ts";
import { buildRenderRequest, verifyRenderResult, ManualMcpRenderProvider } from "../render.ts";
import { DESIGN_PRESETS } from "../../constructor/constants.ts";
import type { ModuleItem } from "../../constructor/types.ts";

test("проект сериализуется и восстанавливается без потерь", () => {
  const p = createProject();
  p.answers = { household: "Семья с ребёнком" };
  p.basePlanId = "catalog-sky-river";
  p.modules = [{ id: "m1", x: 3, z: 3, floor: 0, role: "living" }];
  p.appliedActions = ["Спальня добавлена (+9 м²)"];

  const restored = parseProject(serializeProject(p));
  assert.ok(restored);
  assert.equal(restored!.id, p.id);
  assert.equal(restored!.basePlanId, "catalog-sky-river");
  assert.deepEqual(restored!.modules, p.modules);
  assert.deepEqual(restored!.appliedActions, p.appliedActions);
});

test("битое состояние не восстанавливается (возвращается null)", () => {
  assert.equal(parseProject("не json"), null);
  assert.equal(parseProject("{}"), null);
  assert.equal(parseProject(JSON.stringify({ schemaVersion: 99, id: "x", modules: [] })), null);
  assert.equal(
    parseProject(JSON.stringify({ schemaVersion: 1, id: "x", modules: [{ x: "не число" }] })),
    null,
  );
});

const modules: ModuleItem[] = [
  { id: "a", x: 0, z: 0, floor: 0, role: "living" },
  { id: "b", x: 3, z: 0, floor: 0, role: "bedroom" },
  { id: "c", x: 0, z: 0, floor: 1, role: "bedroom" },
];

test("задание на рендер фиксирует неизменяемые признаки конфигурации", () => {
  const req = buildRenderRequest("p1", modules, DESIGN_PRESETS[0], {
    lighting: "evening",
    season: "summer",
    environment: "Лесной участок",
  });
  assert.equal(req.invariants.floors, 2);
  assert.equal(req.invariants.moduleCount, 3);
  assert.deepEqual(req.invariants.footprint, ["0,0", "3,0"]);
  assert.ok(req.prompt.includes(DESIGN_PRESETS[0].name));
  assert.ok(req.prompt.includes("не менять"));
});

test("проверка результата ловит расхождение по этажности", () => {
  const req = buildRenderRequest("p1", modules, DESIGN_PRESETS[0], {
    lighting: "day",
    season: "summer",
    environment: "Лесной участок",
  });
  assert.equal(verifyRenderResult(req, { floors: 2, moduleCount: 3 }), true);
  assert.equal(verifyRenderResult(req, { floors: 1, moduleCount: 3 }), false);
});

test("manual-провайдер не притворяется автоматической генерацией", async () => {
  const provider = new ManualMcpRenderProvider();
  const req = buildRenderRequest("p1", modules, DESIGN_PRESETS[0], {
    lighting: "day",
    season: "winter",
    environment: "Семейный двор с газоном",
  });
  const job = await provider.createRender(req);
  assert.equal(job.state, "manual");
  assert.ok(job.manualTask);
  assert.ok(!job.resultUrl);
  const status = await provider.getRenderStatus(job.jobId);
  assert.equal(status.state, "manual");
});
