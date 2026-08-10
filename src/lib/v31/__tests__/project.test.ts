import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addRoom,
  deleteImpact,
  deleteModule,
  emptyHouse,
  houseReadiness,
  mirrorHouse,
  moveModule,
} from "../actions.ts";
import { computeAreas } from "../rooms.ts";
import {
  createProject31,
  parseProject31,
  serializeProject31,
  PROJECT31_SCHEMA_VERSION,
} from "../project31.ts";
import { applyPreset, defaultSite, houseFitsSite, placementFits, setbacks } from "../site.ts";
import { buildRenderBrief, activeImageProvider, FACADE_STYLES } from "../facade.ts";
import { houseFromPlan } from "../plans31.ts";
import { PLAN_LIBRARY } from "../../v3/plans.ts";
import { CEILING_HEIGHT_M } from "../constants.ts";
import type { HouseState } from "../types.ts";

function sampleHouse(): HouseState {
  let house = emptyHouse();
  for (const t of ["kitchen", "bedroom", "bathroom"] as const) {
    const r = addRoom(house, t, 0);
    assert.ok(r.ok);
    if (r.ok) house = r.house;
  }
  return house;
}

/* ---------------- проект ---------------- */

test("проект с домом, участком и мебелью сериализуется и восстанавливается", () => {
  const project = createProject31();
  project.house = sampleHouse();
  project.basePlanId = "catalog-sky-river";
  project.facadeStyleId = FACADE_STYLES[0].id;

  const restored = parseProject31(serializeProject31(project));
  assert.ok(restored);
  assert.equal(restored!.schemaVersion, PROJECT31_SCHEMA_VERSION);
  assert.equal(restored!.house.modules.length, project.house.modules.length);
  assert.equal(restored!.house.rooms.length, project.house.rooms.length);
  assert.equal(Object.keys(restored!.house.layouts).length, project.house.rooms.length);
  assert.equal(restored!.site.widthM, project.site.widthM);
  assert.equal(restored!.ceilingHeightM, CEILING_HEIGHT_M);
});

test("проект без сохранённой мебели восстанавливает её пересчётом", () => {
  const project = createProject31();
  project.house = { ...sampleHouse(), layouts: {} };
  const restored = parseProject31(serializeProject31(project));
  assert.ok(restored);
  assert.ok(Object.keys(restored!.house.layouts).length > 0);
});

test("битое состояние не восстанавливается", () => {
  assert.equal(parseProject31("не json"), null);
  assert.equal(parseProject31("{}"), null);
  assert.equal(
    parseProject31(JSON.stringify({ schemaVersion: 1, id: "x", house: { modules: [] } })),
    null,
  );
});

/* ---------------- удаление и целостность ---------------- */

test("удаление модуля, разрывающего дом, требует подтверждения", () => {
  let house = emptyHouse();
  // Цепочка из трёх модулей: средний держит связность.
  for (const t of ["kitchen", "bedroom", "bathroom"] as const) {
    const r = addRoom(house, t, 0);
    assert.ok(r.ok);
    if (r.ok) house = r.house;
  }
  // Находим модуль, без которого этаж распадается (если такой есть).
  const risky = house.modules.find((m) => deleteImpact(house, m.id)?.breaksConnectivity);
  if (risky) {
    const blocked = deleteModule(house, risky.id, false);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.needsConfirm, true);
    const forced = deleteModule(house, risky.id, true);
    assert.equal(forced.ok, true);
  }
});

test("удаление модуля пересчитывает площадь и цену одной операцией", () => {
  const house = sampleHouse();
  const before = computeAreas(house);
  const target = house.modules[house.modules.length - 1];
  const result = deleteModule(house, target.id, true);
  assert.ok(result.ok);
  if (result.ok) {
    const after = computeAreas(result.house);
    assert.equal(after.moduleCount, before.moduleCount - 1);
    assert.equal(after.totalAreaM2, before.totalAreaM2 - 9);
    // Мебель удалённой комнаты тоже ушла.
    assert.equal(Object.keys(result.house.layouts).length, result.house.rooms.length);
  }
});

test("перемещение модуля не меняет назначение и число помещений", () => {
  const house = sampleHouse();
  const m = house.modules[0];
  const moved = moveModule(house, m.id, m.x, m.z + 3);
  if (moved.ok) {
    assert.equal(moved.house.rooms.length, house.rooms.length);
    assert.equal(moved.house.modules.length, house.modules.length);
  }
});

test("пустой дом не готов к фасаду, собранный — готов", () => {
  assert.equal(houseReadiness(emptyHouse()).ready, false);
  assert.equal(houseReadiness(sampleHouse()).ready, true);
});

test("зеркальный разворот сохраняет состав помещений", () => {
  const house = sampleHouse();
  const mirrored = mirrorHouse(house);
  assert.ok(mirrored.ok);
  if (mirrored.ok) {
    assert.equal(mirrored.house.modules.length, house.modules.length);
    assert.deepEqual(
      mirrored.house.rooms.map((r) => r.type).sort(),
      house.rooms.map((r) => r.type).sort(),
    );
  }
});

/* ---------------- участок ---------------- */

test("дом и участок живут в одном состоянии: посадка не дублирует геометрию", () => {
  const house = houseFromPlan(PLAN_LIBRARY.find((p) => p.slug === "sky-river")!);
  const site = defaultSite();
  assert.equal(houseFitsSite(house.modules, site), true);
  const centered = applyPreset(house.modules, site, "center");
  assert.equal(placementFits(house.modules, centered), true);

  const west = applyPreset(house.modules, site, "west");
  const east = applyPreset(house.modules, site, "east");
  assert.ok(west.houseX < east.houseX, "пресеты сдвигают дом предсказуемо");
  // Комнаты при этом не тронуты.
  assert.equal(
    house.modules.length,
    houseFromPlan(PLAN_LIBRARY.find((p) => p.slug === "sky-river")!).modules.length,
  );
});

test("отступы считаются от границ и ловят выход за участок", () => {
  const house = sampleHouse();
  const site = { ...defaultSite(), houseX: 3, houseZ: 3 };
  const marks = setbacks(house.modules, site);
  assert.equal(marks.west, 3);
  assert.equal(marks.north, 3);
  assert.equal(placementFits(house.modules, { ...site, houseX: 0 }), false);
});

test("узкий участок честно признаётся непригодным", () => {
  const house = houseFromPlan(PLAN_LIBRARY.find((p) => p.slug === "family-two")!);
  const tiny = { ...defaultSite(), widthM: 14, depthM: 14 };
  assert.equal(houseFitsSite(house.modules, tiny), false);
});

/* ---------------- фасад и рендер ---------------- */

test("бриф на рендер фиксирует геометрию и запрещает её менять", () => {
  const house = sampleHouse();
  const areas = computeAreas(house);
  const brief = buildRenderBrief({
    projectId: "p1",
    styleId: FACADE_STYLES[0].id,
    areas,
    footprint: house.modules.map((m) => `${m.x},${m.z}`).sort(),
    ceilingHeightM: CEILING_HEIGHT_M,
    site: defaultSite(),
    mood: { lighting: "day", season: "summer" },
  });
  assert.equal(brief.geometry.moduleCount, areas.moduleCount);
  assert.equal(brief.geometry.ceilingHeightM, 3.15);
  assert.ok(brief.invariants.some((i) => i.includes("floors")));
  assert.equal(brief.controlImage, undefined);
});

test("генерация не имитируется: провайдер честно недоступен", async () => {
  const provider = activeImageProvider();
  assert.equal(provider.available, false);
  const job = await provider.createJob(
    buildRenderBrief({
      projectId: "p1",
      styleId: FACADE_STYLES[0].id,
      areas: computeAreas(sampleHouse()),
      footprint: [],
      ceilingHeightM: CEILING_HEIGHT_M,
      site: defaultSite(),
      mood: { lighting: "day", season: "summer" },
    }),
  );
  assert.equal(job.state, "unavailable");
  assert.equal(job.resultUrl, undefined);
});

/* ---------------- библиотека проектов ---------------- */

test("демо-запись библиотеки проектов соответствует схеме и не выдана за реализованную", () => {
  const manifest = JSON.parse(
    readFileSync("data/reference-projects/demo-modular-01/manifest.json", "utf8"),
  );
  const schema = JSON.parse(
    readFileSync("data/reference-projects/schema/project-manifest.schema.json", "utf8"),
  );
  // Полноценного валидатора JSON Schema в проекте нет — проверяем ключевые
  // требования схемы вручную, чтобы тест не тянул новую зависимость.
  for (const field of schema.required as string[]) {
    assert.ok(field in manifest, `нет обязательного поля ${field}`);
  }
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.verified, false);
  assert.equal(manifest.status, "concept");
  assert.equal(manifest.metrics.ceilingHeightM, 3.15);
  assert.equal(manifest.metrics.moduleSideM, 3);
});
