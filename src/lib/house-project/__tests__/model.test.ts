import { test } from "node:test";
import assert from "node:assert/strict";

import { MODULE, OPENING_HEIGHTS } from "../../standards/ecocub.ts";
import * as wo from "../../standards/weekend-one.ts";
import { BASE_MODULE, OPENING_PRESETS } from "../catalog.ts";
import {
  boundsOf,
  computeMetrics,
  footprintOf,
  jointsOf,
  localFace,
  localToWorld,
  openingSegment,
  rectOf,
  supportAreaMm2,
  worldFace,
} from "../geometry.ts";
import { createModule, createProject, duplicateProject, slugify, uniqueSlug } from "../factory.ts";
import {
  exportProjectJson,
  importProjectJson,
  parseProject,
  roundTripEquals,
  serializeProject,
} from "../serialize.ts";
import { hasErrors, validateModel, validateProject } from "../validate.ts";
import { modelFromConstructor, seedsFromModel } from "../adapters.ts";
import { weekendMiniProject, weekendOneProject } from "../reference.ts";
import type { ModuleInstance } from "../types.ts";

function mod(
  id: string,
  x: number,
  y: number,
  floor = 0,
  rotationDeg: 0 | 90 | 180 | 270 = 0,
): ModuleInstance {
  return {
    id,
    moduleTypeId: BASE_MODULE.id,
    floor,
    positionMm: { x, y },
    rotationDeg,
  };
}

/* ------------------------------------------------------------------ */
/* Справочник и грани                                                  */
/* ------------------------------------------------------------------ */

test("справочник модулей повторяет стандарт, а не заводит свои числа", () => {
  assert.equal(BASE_MODULE.externalWidthMm, MODULE.externalWidthMm);
  assert.equal(BASE_MODULE.externalDepthMm, MODULE.externalDepthMm);
  assert.equal(BASE_MODULE.clearHeightMm, 3150);
  assert.equal(
    BASE_MODULE.totalHeightMm,
    MODULE.floorSlabMm + MODULE.clearHeightMm + MODULE.roofSlabMm,
  );
});

test("длины граней Р-1…Р-4 совпадают с развёртками альбома", () => {
  // На листах 12–15 Р-1 и Р-3 подписаны длиной 3200, Р-2 и Р-4 — 3420.
  assert.equal(localFace(BASE_MODULE, "Р-1").spanMm, 3200);
  assert.equal(localFace(BASE_MODULE, "Р-2").spanMm, 3420);
  assert.equal(localFace(BASE_MODULE, "Р-3").spanMm, 3200);
  assert.equal(localFace(BASE_MODULE, "Р-4").spanMm, 3420);

  for (const m of wo.MODULES) {
    for (const face of m.faces) {
      const span = localFace(BASE_MODULE, face.id as "Р-1").spanMm;
      assert.equal(face.spanMm, span, `${m.id}/${face.id}`);
      const sum = face.chainMm.reduce((a, b) => a + b, 0);
      assert.equal(sum, span, `цепочка ${m.id}/${face.id} должна складываться в габарит грани`);
    }
  }
});

test("высоты проёмов в пресетах взяты из стандарта", () => {
  for (const preset of OPENING_PRESETS) {
    const variant = OPENING_HEIGHTS.find((h) => h.id === preset.variantId);
    assert.ok(variant, `нет варианта ${preset.variantId}`);
    // В стандарте heightMm варианта — отметка ВЕРХА проёма от пола,
    // в модели проём описан парой «низ + собственная высота».
    assert.equal(preset.sillMm + preset.heightMm, variant!.heightMm);
    assert.ok(preset.sillMm + preset.heightMm <= BASE_MODULE.clearHeightMm);
  }
});

/* ------------------------------------------------------------------ */
/* Повороты и отражение                                                */
/* ------------------------------------------------------------------ */

test("поворот меняет габарит местами, а левый нижний угол остаётся на месте", () => {
  const straight = mod("a", 1000, 2000);
  assert.deepEqual(footprintOf(straight), { widthMm: 3200, depthMm: 3420 });

  for (const deg of [90, 270] as const) {
    const turned = mod("a", 1000, 2000, 0, deg);
    assert.deepEqual(footprintOf(turned), { widthMm: 3420, depthMm: 3200 });
    const r = rectOf(turned);
    assert.equal(r.x, 1000);
    assert.equal(r.y, 2000);
  }

  const half = mod("a", 1000, 2000, 0, 180);
  assert.deepEqual(footprintOf(half), { widthMm: 3200, depthMm: 3420 });
});

test("поворот на 360° возвращает каждую точку грани на место", () => {
  const p = { x: 800, y: 1200 };
  let point = p;
  for (const deg of [90, 90, 90, 90] as const) {
    const m = mod("a", 0, 0, 0, deg);
    point = localToWorld(m, point);
    // После каждого поворота приводим точку обратно в локальные оси,
    // иначе накапливается смещение начала координат.
    const f = footprintOf(m);
    point = { x: point.x, y: point.y };
    assert.ok(point.x >= 0 && point.x <= f.widthMm);
    assert.ok(point.y >= 0 && point.y <= f.depthMm);
    point = deg === 90 ? { x: point.y, y: f.widthMm - point.x } : point;
  }
});

test("отражение переставляет грани Р-2 и Р-4 местами", () => {
  const plain = mod("a", 0, 0);
  const mirrored: ModuleInstance = { ...plain, id: "b", mirrored: true };

  const plainR2 = worldFace(plain, "Р-2");
  const mirroredR4 = worldFace(mirrored, "Р-4");
  // Р-2 стояла у x = 3200; после отражения там оказывается Р-4.
  assert.equal(plainR2.from.x, BASE_MODULE.externalWidthMm);
  assert.equal(mirroredR4.from.x, BASE_MODULE.externalWidthMm);
});

test("проём остаётся на своей грани и не выходит за её длину", () => {
  const m = mod("a", 5000, 7000, 0, 90);
  const seg = openingSegment(m, {
    id: "o1",
    moduleId: "a",
    faceId: "Р-1",
    kind: "window",
    offsetMm: 1000,
    widthMm: 1200,
    heightMm: 2500,
    sillMm: 700,
  })!;
  const r = rectOf(m);
  for (const p of [seg.from, seg.to]) {
    assert.ok(p.x >= r.x && p.x <= r.x + r.w);
    assert.ok(p.y >= r.y && p.y <= r.y + r.h);
  }
  const len = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
  assert.equal(Math.round(len), 1200);
});

/* ------------------------------------------------------------------ */
/* Характеристики                                                      */
/* ------------------------------------------------------------------ */

test("площадь и габарит считаются, а не хранятся", () => {
  const project = createProject("Тест");
  project.model.modules = [mod("a", 0, 0), mod("b", 3200, 0)];
  const metrics = computeMetrics(project.model);

  assert.equal(metrics.moduleCount, 2);
  assert.equal(metrics.floors, 1);
  // Тёплый контур: 2 × 3,2 × 3,42 = 21,888
  assert.equal(metrics.warmAreaM2, 21.888);
  assert.equal(metrics.livingAreaM2, 21.9);
  assert.deepEqual(metrics.boundsMm, { widthMm: 6400, depthMm: 3420 });
  // Один этаж: от чистого пола до верха плиты кровли — 3150 + 300.
  assert.equal(metrics.heightMm, 3450);
});

test("второй этаж поднимает высоту дома на полную высоту изделия", () => {
  const project = createProject("Два этажа");
  project.model.modules = [mod("a", 0, 0, 0), mod("b", 0, 0, 1)];
  const metrics = computeMetrics(project.model);
  assert.equal(metrics.floors, 2);
  assert.equal(metrics.heightMm, BASE_MODULE.totalHeightMm + 3450);
  // Площадь застройки считает только первый этаж.
  assert.equal(metrics.footprintAreaM2, 10.944);
});

test("опирание считается площадью пересечения с этажом ниже", () => {
  const ground = mod("a", 0, 0, 0);
  const upper = mod("b", 1600, 0, 1);
  const support = supportAreaMm2(upper, [ground, upper]);
  assert.equal(support, 1600 * 3420);
});

/* ------------------------------------------------------------------ */
/* Валидация                                                           */
/* ------------------------------------------------------------------ */

test("пересечение модулей — ошибка, наложение на толщину стены — нет", () => {
  const overlapping = createProject("x");
  overlapping.model.modules = [mod("a", 0, 0), mod("b", 1000, 0)];
  assert.ok(
    validateModel(overlapping.model).some((i) => i.code === "modules-intersect"),
    "грубое пересечение должно быть ошибкой",
  );

  const sharedWall = createProject("y");
  // Общая стена: второй модуль заходит ровно на 210 мм.
  sharedWall.model.modules = [mod("a", 0, 0), mod("b", 3200 - 210, 0)];
  const issues = validateModel(sharedWall.model);
  assert.ok(!issues.some((i) => i.code === "modules-intersect"));
  assert.equal(jointsOf(sharedWall.model.modules)[0].kind, "shared-wall");
});

test("проём за пределами стены и слишком высокий — ошибки", () => {
  const p = createProject("z");
  const m = p.model.modules[0];
  p.model.openings = [
    {
      id: "o1",
      moduleId: m.id,
      faceId: "Р-1",
      kind: "window",
      offsetMm: 2800,
      widthMm: 1000,
      heightMm: 1500,
      sillMm: 800,
      variantId: "manual",
    },
    {
      id: "o2",
      moduleId: m.id,
      faceId: "Р-2",
      kind: "window",
      offsetMm: 500,
      widthMm: 1000,
      heightMm: 3000,
      sillMm: 400,
      variantId: "manual",
    },
  ];
  const codes = validateModel(p.model).map((i) => i.code);
  assert.ok(codes.includes("opening-out-of-wall"));
  assert.ok(codes.includes("opening-too-tall"));
});

test("проёмы на одной грани не должны накладываться", () => {
  const p = createProject("z");
  const m = p.model.modules[0];
  const base = {
    moduleId: m.id,
    faceId: "Р-1" as const,
    kind: "window" as const,
    heightMm: 1500,
    sillMm: 800,
    variantId: "manual",
  };
  p.model.openings = [
    { ...base, id: "o1", offsetMm: 400, widthMm: 1000 },
    { ...base, id: "o2", offsetMm: 1200, widthMm: 1000 },
  ];
  assert.ok(validateModel(p.model).some((i) => i.code === "openings-overlap"));
});

test("модуль верхнего этажа без опоры — ошибка, малая опора — предупреждение", () => {
  const floating = createProject("f");
  floating.model.modules = [mod("a", 0, 0, 0), mod("b", 20000, 0, 1)];
  assert.ok(validateModel(floating.model).some((i) => i.code === "no-support"));

  const cantilever = createProject("c");
  cantilever.model.modules = [mod("a", 0, 0, 0), mod("b", 2400, 0, 1)];
  const issues = validateModel(cantilever.model);
  assert.ok(issues.some((i) => i.code === "weak-support" && i.level === "warning"));
  assert.ok(!hasErrors(issues.filter((i) => i.code === "weak-support")));
});

test("проём вплотную к углу — предупреждение, а не запрет", () => {
  const p = createProject("corner");
  const m = p.model.modules[0];
  p.model.openings = [
    {
      id: "o1",
      moduleId: m.id,
      faceId: "Р-1",
      kind: "window",
      offsetMm: 50,
      widthMm: 1000,
      heightMm: 1500,
      sillMm: 800,
      variantId: "h2100",
    },
  ];
  const issues = validateModel(p.model);
  const corner = issues.filter((i) => i.code === "opening-corner-pier");
  assert.equal(corner.length, 1);
  assert.equal(corner[0].level, "warning");
});

test("публикация требует обложку и описание, черновик — нет", () => {
  const p = createProject("Дом");
  p.publication.coverImage = undefined;
  assert.ok(!hasErrors(validateProject(p)));
  assert.ok(validateProject(p, { forPublication: true }).some((i) => i.code === "no-cover"));
});

/* ------------------------------------------------------------------ */
/* Сериализация                                                        */
/* ------------------------------------------------------------------ */

test("сохранение и повторное открытие не меняют геометрию", () => {
  const p = weekendOneProject();
  assert.ok(roundTripEquals(p));

  const again = importProjectJson(exportProjectJson(p));
  assert.deepEqual(again.model.modules, p.model.modules);
  assert.deepEqual(again.model.openings, p.model.openings);
  assert.deepEqual(computeMetrics(again.model), computeMetrics(p.model));
});

test("проект из будущей версии схемы не открывается молча", () => {
  const raw = serializeProject(createProject("Из будущего"));
  raw.schemaVersion = 99;
  assert.throws(() => parseProject(raw), /схемой версии 99/);
});

test("разбор отбрасывает мусор, но не портит геометрию", () => {
  const raw = serializeProject(weekendOneProject()) as Record<string, unknown>;
  (raw as Record<string, unknown>).somethingElse = { a: 1 };
  const parsed = parseProject(raw)!;
  assert.ok(parsed);
  assert.equal(
    Object.prototype.hasOwnProperty.call(serializeProject(parsed), "somethingElse"),
    false,
  );
  assert.equal(parsed.model.modules.length, 4);
});

test("проём-сирота не переживает разбор", () => {
  const raw = serializeProject(createProject("s")) as Record<string, unknown>;
  const model = raw.model as Record<string, unknown>;
  model.openings = [
    {
      id: "o1",
      moduleId: "нет-такого",
      faceId: "Р-1",
      kind: "window",
      widthMm: 100,
      heightMm: 100,
    },
  ];
  assert.equal(parseProject(raw)!.model.openings.length, 0);
});

/* ------------------------------------------------------------------ */
/* Копирование и адреса                                                */
/* ------------------------------------------------------------------ */

test("копия независима: свои идентификаторы у проекта, модулей и проёмов", () => {
  const original = weekendOneProject();
  const copy = duplicateProject(original, { takenSlugs: [original.slug] });

  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.slug, original.slug);
  assert.equal(copy.status, "draft");
  assert.equal(copy.model.modules.length, original.model.modules.length);

  const originalIds = new Set(original.model.modules.map((m) => m.id));
  for (const m of copy.model.modules) assert.ok(!originalIds.has(m.id));
  for (const o of copy.model.openings) {
    assert.ok(
      copy.model.modules.some((m) => m.id === o.moduleId),
      "проём должен ссылаться на копию",
    );
  }

  copy.model.modules[0].positionMm.x = 999999;
  assert.notEqual(original.model.modules[0].positionMm.x, 999999);
});

test("адрес страницы получается латиницей и остаётся уникальным", () => {
  assert.equal(slugify("Дом мечты 2"), "dom-mechty-2");
  assert.equal(uniqueSlug("Weekend One", ["weekend-one"]), "weekend-one-2");
});

/* ------------------------------------------------------------------ */
/* Мост с публичным конструктором                                      */
/* ------------------------------------------------------------------ */

test("перенос в конструктор сохраняет число модулей и этажность", () => {
  const p = weekendOneProject();
  const seeds = seedsFromModel(p.model);
  assert.equal(seeds.length, 4);
  for (const s of seeds) {
    assert.equal(s.x % 0.5, 0);
    assert.equal(s.z % 0.5, 0);
    assert.equal(s.floor, 0);
  }
});

test("обратный перенос ставит модули вплотную по заводскому габариту", () => {
  const { modules } = modelFromConstructor([
    { x: 0, z: 0, floor: 0 },
    { x: 3, z: 0, floor: 0 },
  ]);
  assert.equal(modules.length, 2);
  const xs = modules.map((m) => m.positionMm.x).sort((a, b) => a - b);
  assert.equal(xs[1] - xs[0], BASE_MODULE.externalWidthMm);
  assert.ok(
    !validateModel({ ...createProject("t").model, modules }).some((i) => i.level === "error"),
  );
});

/* ------------------------------------------------------------------ */
/* Приёмка: реальные дома                                              */
/* ------------------------------------------------------------------ */

test("Weekend One воспроизведён: габарит, площадь и стыки сходятся с альбомом", () => {
  const p = weekendOneProject();
  const metrics = computeMetrics(p.model);

  assert.equal(metrics.moduleCount, wo.MODULES.length);
  assert.equal(metrics.floors, 1);

  // Ширина застройки по осям 1–7 — 12 590 мм, лист 3.
  assert.equal(metrics.boundsMm.widthMm, wo.OVERALL.widthMm);

  // Глубина по наружным граням модулей меньше габарита застройки: между
  // осями Г и Д лежит терраса, модулями она не занята. Расхождение
  // задокументировано в unresolvedQuestions проекта.
  assert.equal(metrics.boundsMm.depthMm, 5130);
  assert.equal(wo.OVERALL.depthMm - metrics.boundsMm.depthMm, 1790);
  assert.ok(
    p.source.unresolvedQuestions.some((q) => q.includes("6 920")),
    "расхождение по глубине обязано быть зафиксировано, а не спрятано",
  );

  // Тёплый контур: 4 × 3,2 × 3,42 = 43,78; в альбоме подписано 43,8.
  assert.equal(metrics.warmAreaM2, 43.776);
  assert.equal(metrics.livingAreaM2, 43.8);

  // Смещение B и C относительно A и D — ровно половина глубины модуля.
  const a = p.model.modules.find((m) => m.id === "A")!;
  const b = p.model.modules.find((m) => m.id === "B")!;
  assert.equal(b.positionMm.y - a.positionMm.y, wo.OFFSET_MM);

  // Стыки: B и C делят стену, остальные пары стоят спина к спине.
  const joints = jointsOf(p.model.modules);
  const bc = joints.find((j) => (j.a === "B" && j.b === "C") || (j.a === "C" && j.b === "B"));
  assert.equal(bc?.kind, "shared-wall");
  for (const standard of wo.JOINTS) {
    const found = joints.find(
      (j) =>
        (j.a === standard.a && j.b === standard.b) || (j.a === standard.b && j.b === standard.a),
    );
    assert.ok(found, `стык ${standard.a}—${standard.b} должен воспроизводиться геометрией`);
    assert.equal(found!.kind, standard.kind);
  }

  // Модель должна проходить проверку без единой ошибки.
  const issues = validateModel(p.model);
  assert.ok(!hasErrors(issues), JSON.stringify(issues.filter((i) => i.level === "error")));
});

test("входная дверь Weekend One стоит там, где её показывает лист 15", () => {
  const p = weekendOneProject();
  const door = p.model.openings.find((o) => o.kind === "door")!;
  const d = wo.MODULES.find((m) => m.id === "D")!;
  const face = d.faces.find((f) => f.id === "Р-4")!;

  // Цепочка 600 | 800 | 2020: дверь — средний отрезок.
  assert.deepEqual(face.chainMm, [600, 800, 2020]);
  assert.equal(door.offsetMm, 600);
  assert.equal(door.widthMm, 800);
  assert.equal(door.heightMm, face.openingHeightMm);
});

test("Weekend Mini воспроизведён: три модуля, габарит 6840 × 6400", () => {
  const p = weekendMiniProject();
  const metrics = computeMetrics(p.model);
  assert.equal(metrics.moduleCount, 3);
  assert.deepEqual(metrics.boundsMm, { widthMm: 6840, depthMm: 6400 });
  assert.ok(!hasErrors(validateModel(p.model)));

  // Все три модуля развёрнуты длинной стороной по X — как в стандарте.
  for (const m of p.model.modules) assert.equal(m.rotationDeg, 90);
  const b = boundsOf(p.model.modules);
  assert.equal(b.minX, 0);
});

test("новый пустой проект сразу валиден и сохраняем", () => {
  const p = createProject("Пустой");
  assert.ok(!hasErrors(validateProject(p)));
  assert.ok(roundTripEquals(p));
  assert.equal(createModule(0, 0, 0).rotationDeg, 0);
});
