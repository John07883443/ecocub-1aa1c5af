import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  AREA_DEFINITIONS,
  DOOR_OPENING,
  MODULE,
  OPENING_HEIGHTS,
  OUTDOOR_AREAS,
  AREA_POLICY,
  AREA_TOLERANCE,
  GRID_RECONCILIATION,
  PLANNING_RULES,
} from "../ecocub.ts";
import { PATTERNS, REFERENCE_PROJECTS, patternBriefing } from "../patterns.ts";
import {
  MIN_SIMILARITY,
  REFERENCE_LAYOUTS,
  matchReference,
  referenceBriefing,
} from "../library.ts";
import {
  bounds,
  chainSumMm,
  conformance,
  livingAreaM2,
  moduleClearM2,
  moduleFootprintM2,
  offsetStepMm,
  openedJointGainM2,
  totalHeightMm,
  warmContourM2,
} from "../derive.ts";
import * as wo from "../weekend-one.ts";
import * as wm from "../weekend-mini.ts";
import * as f1 from "../family-one.ts";
import * as f2 from "../family-two.ts";
import * as sf from "../super-family.ts";
import * as nas from "../nasledie.ts";
import * as din from "../dinastiya.ts";
import {
  CELL_M,
  MODULE_AREA,
  MODULE_HEIGHT_M,
  MODULE_SIDE_M,
  STEP_M,
  TEMPLATES,
} from "../../constructor/constants.ts";
import { isConnected } from "../../constructor/geometry.ts";

/**
 * Это и есть «харнесс»: тесты заново собирают из констант те числа, которые
 * напечатаны в альбоме. Пока сходится — стандарт описан верно. Как только
 * кто-то поправит габарит «на глаз», сборка упадёт и назовёт лист, с которого
 * число не сошлось.
 */

function area(a: number, b: number): number {
  return Math.round(a * b) / 1000 / 1000;
}

test("состав модуля сходится в обе стороны и по высоте", () => {
  assert.equal(
    MODULE.wallThicknessMm * 2 + MODULE.clearWidthMm,
    MODULE.externalWidthMm,
    "210 + 2780 + 210 должно давать 3200",
  );
  assert.equal(
    MODULE.wallThicknessMm * 2 + MODULE.clearDepthMm,
    MODULE.externalDepthMm,
    "210 + 3000 + 210 должно давать 3420",
  );
  assert.equal(totalHeightMm(), MODULE.totalHeightMm, "300 + 3150 + 300 = 3750");
  assert.equal(MODULE.totalHeightMm, 3750);
});

test("спальня Weekend One — это ровно один модуль в чистоте", () => {
  // Самая надёжная проверка габарита модуля во всём альбоме: спальня не
  // делится перегородками, поэтому её площадь из экспликации и есть чистый
  // размер модуля. 2,78 × 3,00 = 8,34.
  const bedroom = wo.ROOMS.find((r) => r.name === "Спальня");
  assert.ok(bedroom);
  assert.equal(moduleClearM2(), bedroom.areaM2);
});

test("тёплый контур 43,8 м² — это четыре наружные площади модуля", () => {
  const warm = AREA_DEFINITIONS.find((a) => a.id === "warm-contour");
  assert.ok(warm);
  assert.equal(wo.MODULES.length, 4);
  assert.equal(Math.round(warmContourM2(4) * 10) / 10, warm.valueM2);
});

test("площадь «55 м²» из презентации — это тёплый контур плюс крыльцо", () => {
  const marketing = AREA_DEFINITIONS.find((a) => a.id === "marketing");
  const warm = AREA_DEFINITIONS.find((a) => a.id === "warm-contour");
  assert.ok(marketing && warm);
  assert.equal(Math.round(warm.valueM2 + OUTDOOR_AREAS.porchM2), marketing.valueM2);
});

test("габарит по осям 1–7 собирается из положения модулей", () => {
  // 12590 на листе 3 — не отдельное число, а следствие раскладки: два стыка
  // спина к спине и один общей стеной.
  assert.equal(bounds(wo.MODULES).widthMm, wo.OVERALL.widthMm);
});

test("оси альбома проходят по серединам и граням стен модулей", () => {
  const byId = new Map(wo.MODULES.map((m) => [m.id, m]));
  const a = byId.get("A")!;
  const c = byId.get("C")!;
  const d = byId.get("D")!;
  const w = MODULE.wallThicknessMm;

  assert.equal(wo.AXES_X["1"], a.xMm);
  assert.equal(wo.AXES_X["2"], a.xMm + MODULE.externalWidthMm - w);
  assert.equal(wo.AXES_X["3"], a.xMm + MODULE.externalWidthMm);
  assert.equal(wo.AXES_X["4"], c.xMm + w / 2, "ось 4 — середина общей стены B и C");
  assert.equal(wo.AXES_X["5"], d.xMm);
  assert.equal(wo.AXES_X["6"], d.xMm + w);
  assert.equal(wo.AXES_X["7"], d.xMm + MODULE.externalWidthMm);

  // Цепочка листа 3 по X: 2990 | 210 | 3095 | 3095 | 210 | 2990.
  const xs = ["1", "2", "3", "4", "5", "6", "7"].map((k) => wo.AXES_X[k]);
  const chain = xs.slice(1).map((v, i) => v - xs[i]);
  assert.deepEqual(chain, [2990, 210, 3095, 3095, 210, 2990]);
  assert.equal(chainSumMm(chain), wo.OVERALL.widthMm);
});

test("цепочка осей А–Д даёт подписанную глубину 6920", () => {
  const ys = ["Д", "Г", "В", "Б", "А"].map((k) => wo.AXES_Y[k]);
  const chain = ys.slice(1).map((v, i) => ys[i] - v);
  assert.deepEqual(chain, [2000, 1710, 1500, 1710]);
  assert.equal(chainSumMm(chain), wo.OVERALL.depthMm);
});

test("модули смещаются ровно на половину своей глубины", () => {
  assert.equal(offsetStepMm(), wo.OFFSET_MM);
  assert.equal(wo.OFFSET_MM, 1710);
  const ys = new Set(wo.MODULES.map((m) => m.yMm));
  assert.deepEqual(
    [...ys].sort((p, q) => p - q),
    [0, wo.OFFSET_MM],
  );
});

test("каждая размерная цепочка грани сходится с габаритом грани", () => {
  for (const m of wo.MODULES) {
    for (const f of m.faces) {
      assert.equal(
        chainSumMm(f.chainMm),
        f.spanMm,
        `модуль ${m.id}, развёртка ${f.id}: цепочка не сходится`,
      );
      assert.ok(
        f.spanMm === MODULE.externalWidthMm || f.spanMm === MODULE.externalDepthMm,
        `модуль ${m.id}, развёртка ${f.id}: габарит грани не совпадает с модулем`,
      );
    }
    const spans = m.faces.map((f) => f.spanMm).sort((p, q) => p - q);
    assert.deepEqual(
      spans,
      [
        MODULE.externalWidthMm,
        MODULE.externalWidthMm,
        MODULE.externalDepthMm,
        MODULE.externalDepthMm,
      ],
      `у модуля ${m.id} должно быть две грани 3200 и две 3420`,
    );
  }
});

test("высоты проёмов складываются с плитами в полную высоту модуля", () => {
  for (const v of OPENING_HEIGHTS) {
    assert.equal(
      MODULE.floorSlabMm + v.heightMm + v.headroomMm + MODULE.roofSlabMm,
      MODULE.totalHeightMm,
      `вариант ${v.id}: сумма по вертикали не даёт 3750`,
    );
  }
  // Панорамный вариант — во всю высоту помещения, без простенка сверху.
  const full = OPENING_HEIGHTS.find((v) => v.id === "h3150");
  assert.ok(full);
  assert.equal(full.heightMm, MODULE.clearHeightMm);
  // Дверь — единственный проём, у которого подтверждены обе стороны.
  assert.equal(DOOR_OPENING.heightMm, 2100);
  assert.equal(DOOR_OPENING.widthMm, 800);
});

test("все высоты проёмов на развёртках есть в каталоге вариантов", () => {
  const known = new Set(OPENING_HEIGHTS.map((v) => v.heightMm));
  for (const m of wo.MODULES) {
    for (const f of m.faces) {
      if (f.openingHeightMm === undefined) continue;
      assert.ok(
        known.has(f.openingHeightMm),
        `${m.id}/${f.id}: высота ${f.openingHeightMm} не описана`,
      );
    }
  }
});

test("кухня-гостиная — два модуля со снятой общей стеной", () => {
  const room = wo.ROOMS.find((r) => r.name === "Кухня-гостиная");
  assert.ok(room);
  const computed = moduleClearM2() * 2 + openedJointGainM2("shared-wall"); // 17,31
  // Расхождение с экспликацией — 0,04 м². Оно есть в самом альбоме и
  // зафиксировано здесь намеренно: пока архитектор его не пояснил, честнее
  // держать допуск, чем подгонять габарит модуля под красивое число.
  assert.ok(
    Math.abs(computed - room.areaM2) <= 0.05,
    `расчёт ${computed}, в альбоме ${room.areaM2}`,
  );
});

test("Weekend Mini сходится с тем же модулем: три штуки и два открытых стыка", () => {
  assert.equal(wm.MODULES.length, 3);
  const rooms = wm.ROOMS.reduce((s, r) => s + r.areaM2, 0); // 27,5
  const computed =
    moduleClearM2() * 3 + wm.JOINTS.reduce((s, j) => s + openedJointGainM2(j.kind), 0); // 27,54
  assert.ok(
    Math.abs(computed - rooms) <= 0.1,
    `по стандарту ${computed} м², на заводской планировке ${rooms} м²`,
  );
  // Карточка каталога округляет ту же сумму вниз.
  assert.equal(Math.floor(rooms), wm.CATALOG.houseAreaM2);
  assert.equal(wm.CATALOG.ceilingHeightM, MODULE.clearHeightMm / 1000);
});

test("Г-образная раскладка Weekend Mini не разваливается на части", () => {
  // Три модуля должны образовывать один дом: у каждого есть сосед по стыку.
  const ids = new Set(wm.MODULES.map((m) => m.id));
  for (const j of wm.JOINTS) {
    assert.ok(ids.has(j.a) && ids.has(j.b));
  }
  const linked = new Set(wm.JOINTS.flatMap((j) => [j.a, j.b]));
  assert.equal(linked.size, wm.MODULES.length);
  const b = bounds(wm.MODULES);
  assert.equal(b.widthMm, 6840);
  assert.equal(b.depthMm, 6400);
});

test("боевой конструктор пока не соответствует стандарту — расхождение зафиксировано", () => {
  const report = conformance({
    moduleSideM: MODULE_SIDE_M,
    moduleHeightM: MODULE_HEIGHT_M,
    moduleAreaM2: MODULE_AREA,
    stepM: STEP_M,
  });
  const failing = report.filter((r) => !r.matches).map((r) => r.what);
  // Список закрытый: расхождений ровно четыре, и все они известны. Если
  // конструктор поправят — тест упадёт и потребует обновить docs/STANDARDS.md.
  assert.deepEqual(failing, [
    "Ширина модуля",
    "Глубина модуля",
    "Площадь модуля снаружи",
    "Шаг смещения модуля",
  ]);
  // Единственное, что уже совпадает.
  assert.equal(report.find((r) => r.what === "Высота помещения")?.matches, true);
  assert.equal(CELL_M, MODULE_SIDE_M);
});

test("в стандарте нет цен: прайс живёт отдельно и устаревает быстрее геометрии", () => {
  const dir = new URL("../", import.meta.url).pathname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.ok(!/\bруб\b|₽|pricePerM2|priceRub/.test(text), `${f}: в стандарт просочилась цена`);
  }
});

test("каждое число стандарта помнит, откуда взято", () => {
  assert.ok(MODULE.source.sheet);
  for (const a of AREA_DEFINITIONS) assert.ok(a.source.doc);
  for (const v of OPENING_HEIGHTS) assert.ok(v.source.sheet);
  for (const m of wo.MODULES) assert.ok(m.source.sheet);
  // Правила планировки — самая ценная часть: без них габариты бесполезны.
  assert.ok(PLANNING_RULES.length >= 5);
  for (const r of PLANNING_RULES) assert.ok(r.evidence.length > 20);
});

test("площадь модуля снаружи и в чистоте различаются ровно на стены", () => {
  assert.equal(moduleFootprintM2(), area(MODULE.externalWidthMm, MODULE.externalDepthMm));
  assert.ok(moduleFootprintM2() > moduleClearM2());
});

// ── Family One и Family Two: размерные планы ────────────────────────────

test("сетка Family повторяется на двух проектах — это система, а не совпадение", () => {
  assert.equal(f1.DIMENSIONS.gridPitchXMm, f2.DIMENSIONS.gridPitchXMm);
  assert.equal(f2.DIMENSIONS.gridPitchXMm * 4, f2.DIMENSIONS.overallWidthMm, "13 572 = 4 × 3393");
  assert.equal(f1.DIMENSIONS.gridPitchXMm * 3, f1.DIMENSIONS.overallWidthMm, "10 179 = 3 × 3393");
  // Глубина у обоих одна и та же — дом растёт вдоль, а не поперёк.
  assert.equal(f1.DIMENSIONS.overallDepthMm, f2.DIMENSIONS.overallDepthMm);
});

test("сетка Family и модуль альбома — это один модуль, а не два", () => {
  // Расхождение казалось непримиримым, пока не пришли планы Nasledie и
  // Dinastiya: 3393 сравнивали не с тем габаритом. Это 3420 по отделке.
  assert.equal(GRID_RECONCILIATION.finishedPitchMm, f1.DIMENSIONS.gridPitchXMm);
  assert.equal(GRID_RECONCILIATION.moduleDepthMm, MODULE.externalDepthMm);
  assert.equal(
    GRID_RECONCILIATION.differenceMm,
    GRID_RECONCILIATION.moduleDepthMm - GRID_RECONCILIATION.finishedPitchMm,
  );
  assert.ok(GRID_RECONCILIATION.differenceMm < 40, "разница ушла в толщину отделки");
  assert.ok(GRID_RECONCILIATION.resolvedBy.length >= 2, "развязано двумя независимыми планами");
});

test("габариты Nasledie и Dinastiya раскладываются на модуль альбома без остатка", () => {
  // Самое сильное подтверждение стандарта после самого альбома: каталожные
  // планы CUBAX делятся на 3420 и 3200 нацело.
  for (const p of [nas, din]) {
    assert.equal(
      p.DIMENSIONS.baysXMm.reduce((a: number, b: number) => a + b, 0),
      p.DIMENSIONS.overallWidthMm,
    );
    for (const bay of p.DIMENSIONS.baysXMm) assert.equal(bay, MODULE.externalDepthMm);
    for (const bay of p.DIMENSIONS.baysZMm) assert.equal(bay, MODULE.externalWidthMm);
    assert.equal(p.DIMENSIONS.overallWidthMm % MODULE.externalDepthMm, 0);
    assert.equal(p.DIMENSIONS.overallDepthMm % MODULE.externalWidthMm, 0);
  }
  // Каждое число модуля с плана Nasledie выводится из стандарта — это и есть
  // доказательство, что альбом и каталог описывают один и тот же модуль.
  const derived = new Set([
    MODULE.wallThicknessMm,
    MODULE.wallThicknessMm * 2,
    MODULE.clearWidthMm,
    MODULE.clearDepthMm,
    MODULE.externalWidthMm,
    MODULE.clearDepthMm + MODULE.wallThicknessMm,
    MODULE.externalDepthMm,
    MODULE.externalDepthMm * 2,
  ]);
  for (const n of nas.DIMENSIONS.moduleNumbersOnPlan) {
    assert.ok(derived.has(n), `${n} с плана Nasledie не выводится из стандарта`);
  }
  for (const n of din.DIMENSIONS.moduleNumbersOnPlan) assert.ok(derived.has(n));
});

test("сумма помещений сходится с подписью на плане у Nasledie и Dinastiya", () => {
  for (const p of [nas, din]) {
    const sum = p.ROOMS.reduce((s, r) => s + r.areaM2, 0);
    assert.ok(Math.abs(sum - p.CATALOG.planSumM2) < 0.05, `${p.SOURCE.doc}: ${sum}`);
  }
});

test("сервис растёт ступенями: один санузел, два, три", () => {
  // Правило подбора: по числу санузлов видно масштаб дома.
  assert.equal(f2.CATALOG.bathrooms, 1);
  assert.equal(sf.CATALOG.bathrooms, 2);
  assert.equal(nas.CATALOG.bathrooms, 2);
  assert.equal(din.CATALOG.bathrooms, 3);
  // Мастер-спальня как блок появляется вместе со вторым санузлом.
  assert.equal(nas.MASTER_SUITE.rooms.length, 3);
  assert.ok(din.MASTER_SUITE.areaM2 > nas.MASTER_SUITE.areaM2);
  // И только на 133 м² спальни наконец перерастают 11 м².
  assert.ok(
    Math.max(...din.ROOMS.filter((r) => r.name.includes("спальная")).map((r) => r.areaM2)) > 13,
  );
});

test("габариты помещений на планах Family сходятся с подписанными площадями", () => {
  for (const p of [f1, f2]) {
    for (const s of p.DIMENSIONS.roomSpans) {
      const computed = (s.widthMm * s.depthMm) / 1e6;
      assert.ok(
        Math.abs(computed - s.checkM2) <= 0.35,
        `${s.room}: ${s.widthMm} × ${s.depthMm} = ${computed.toFixed(2)}, на плане ${s.checkM2}`,
      );
    }
  }
});

test("спальня держит один размер на домах 56 и 74 м²", () => {
  const small = f1.ROOMS.filter((r) => r.name.startsWith("Спальная")).map((r) => r.areaM2);
  const big = f2.ROOMS.filter((r) => r.name.startsWith("Спальная")).map((r) => r.areaM2);
  assert.ok(Math.max(...small) === Math.max(...big), "9,6 м² и там, и там");
  // Растёт общая комната: 29,1 → 35.
  assert.ok(f2.OPEN_SPACE.coreAreaM2 > f1.OPEN_SPACE.mergedAreaM2);
  assert.ok(f2.CATALOG.houseAreaM2 > f1.CATALOG.houseAreaM2);
});

test("перегородка тоньше стены модуля, а двери — из закрытого ряда", () => {
  assert.equal(f1.DIMENSIONS.partitionMm, f2.DIMENSIONS.partitionMm);
  assert.ok(f1.DIMENSIONS.partitionMm < MODULE.wallThicknessMm);
  assert.ok(
    f1.DOOR_WIDTHS_MM.includes(DOOR_OPENING.widthMm),
    "800 подтверждён и альбомом, и планом",
  );
});

test("сумма площадей сходится с карточкой каталога у обоих Family", () => {
  const sum = (rooms: { areaM2: number }[]) => rooms.reduce((s, r) => s + r.areaM2, 0);
  assert.ok(Math.abs(sum(f1.ROOMS) - f1.CATALOG.houseAreaM2) <= 1);
  assert.ok(Math.abs(sum(f2.ROOMS) - f2.CATALOG.houseAreaM2) <= 2);
  // Высота потолков одна на все четыре проекта — единственная константа,
  // которая не спорит сама с собой нигде.
  for (const c of [f1.CATALOG, f2.CATALOG, wm.CATALOG]) {
    assert.equal(c.ceilingHeightM, MODULE.clearHeightMm / 1000);
  }
});

test("каждый паттерн двуязычен, подтверждён и попадает в промпт", () => {
  assert.ok(PATTERNS.length >= 35);
  const ids = new Set<string>();
  for (const p of PATTERNS) {
    assert.ok(p.rule.length > 20, `${p.id}: пустая формулировка`);
    assert.ok(p.en.length > 20, `${p.id}: нет английской формулировки для промпта`);
    assert.ok(p.evidence.length > 20, `${p.id}: паттерн без подтверждения проектом`);
    assert.ok(!ids.has(p.id), `${p.id}: дубль`);
    ids.add(p.id);
  }
  const briefing = patternBriefing();
  for (const p of PATTERNS) assert.ok(briefing.includes(p.en), `${p.id} не попал в промпт`);
  // Оговорка про контур обязана быть в блоке террасы: без неё паттерны
  // ломают единственное жёсткое правило генерации.
  assert.match(briefing, /must stay strictly inside the given footprint/);
});

test("опорных проектов семь, и у каждого назван источник", () => {
  assert.equal(REFERENCE_PROJECTS.length, 7);
  assert.equal(REFERENCE_LAYOUTS.length, REFERENCE_PROJECTS.length);
  for (const p of REFERENCE_PROJECTS) {
    assert.ok(p.evidence.length > 10);
    assert.ok(p.areaM2 > 0);
  }
});

test("готовые раскладки конструктора ссылаются на реальные проекты и не разваливаются", () => {
  const referenced = TEMPLATES.filter((t) => t.reference);
  assert.equal(referenced.length, 7, "семь опорных проектов — семь стартовых раскладок");
  const known = new Set(REFERENCE_LAYOUTS.map((l) => l.id));
  for (const t of referenced) {
    assert.ok(known.has(t.reference!), `${t.id}: ссылка на несуществующий проект`);
    const modules = t.seeds.map((s, i) => ({ id: `m${i}`, ...s }));
    // Дом обязан быть одним зданием — иначе человек возьмёт шаблон и сразу
    // упрётся в запрет, который сам же шаблон и нарушил.
    assert.ok(isConnected(modules), `${t.id}: раскладка разваливается на части`);
    assert.ok(t.note && t.note.length > 10, `${t.id}: карточка без пояснения`);
  }
  // Состав помещений должен повторять проект: у Family Two три спальни.
  const familyTwo = TEMPLATES.find((t) => t.reference === "family-two")!;
  assert.equal(familyTwo.seeds.filter((s) => s.role === "bedroom").length, 3);
  assert.equal(familyTwo.seeds.filter((s) => s.role === "bathroom").length, 1);
});

test("подбор образца находит масштаб, а не просто ближайшее имя", () => {
  const sig = (footprintM2: number, moduleCount: number, widthM: number, depthM: number) => ({
    footprintM2,
    moduleCount,
    widthM,
    depthM,
    bedrooms: 2,
  });
  assert.equal(matchReference(sig(27, 3, 6, 6))?.layout.id, "weekend-mini");
  assert.equal(matchReference(sig(45, 4, 12, 5))?.layout.id, "weekend-one");
  assert.equal(matchReference(sig(72, 6, 10, 7))?.layout.id, "family-one");
  assert.equal(matchReference(sig(99, 9, 14, 7))?.layout.id, "family-two");
  assert.equal(matchReference(sig(108, 11, 10, 13))?.layout.id, "super-family");
  // Один кубик не похож ни на что: лучше без образца, чем с чужим.
  assert.equal(matchReference(sig(9, 1, 3, 3)), null);
  // Похожесть всегда в границах и не выдумывается.
  const m = matchReference(sig(45, 4, 12, 5))!;
  assert.ok(m.similarity >= MIN_SIMILARITY && m.similarity <= 1);
  assert.ok(m.why.includes("площадь"));
});

test("образец в промпте не отменяет контур", () => {
  const m = matchReference({
    footprintM2: 72,
    moduleCount: 6,
    widthM: 10,
    depthM: 7,
    bedrooms: 2,
  })!;
  const text = referenceBriefing(m);
  assert.match(text, /CLOSEST BUILT PROJECT/);
  assert.match(text, /Do NOT copy its outline/);
  assert.ok(text.includes(m.layout.solutionEn));
});

test("сетка 3393 подтверждена тремя проектами подряд", () => {
  // Одно наблюдение — случайность, три совпадения — система. Систему потом
  // удалось объяснить: тот же модуль, размеченный по чистовой отделке.
  for (const p of [f1, f2, sf])
    assert.equal(p.DIMENSIONS.gridPitchXMm, GRID_RECONCILIATION.finishedPitchMm);
  assert.equal(sf.DIMENSIONS.gridPitchXMm * 3, sf.DIMENSIONS.overallWidthMm);
  assert.equal(sf.DIMENSIONS.partitionMm, f1.DIMENSIONS.partitionMm);
  // Тонкая перегородка санузлов — новая толщина, которой не было у Family.
  assert.ok(sf.DIMENSIONS.thinPartitionMm < sf.DIMENSIONS.partitionMm);
});

test("дом растёт сервисом и общими зонами, а не спальнями", () => {
  const bedrooms = (rooms: { name: string; areaM2: number }[]) =>
    rooms.filter((r) => r.name.startsWith("Спальная") || r.name.startsWith("Детская"));
  const small = bedrooms(f1.ROOMS).map((r) => r.areaM2);
  const large = bedrooms(sf.ROOMS).map((r) => r.areaM2);
  // Дом вырос с 56 до 92 м², спальня — с 9,6 до 11,2. Растёт не она.
  assert.ok(Math.max(...large) - Math.max(...small) < 2);
  // Зато появилось то, чего не было: второй санузел, постирочная, гардеробные.
  assert.equal(sf.CATALOG.bathrooms, 2);
  assert.equal(f1.CATALOG.bathrooms, 1);
  assert.ok(sf.ROOMS.some((r) => r.name === "Постирочная"));
  assert.ok(sf.ROOMS.filter((r) => r.name.startsWith("Гардероб")).length === 2);
  assert.ok(!f2.ROOMS.some((r) => r.name.startsWith("Гардероб")));
});

test("сумма помещений Super Family укладывается в производственный допуск", () => {
  const sum = sf.ROOMS.reduce((s, r) => s + r.areaM2, 0);
  assert.ok(
    Math.abs(sum - sf.CATALOG.houseAreaM2) <= sf.CATALOG.houseAreaM2 * AREA_TOLERANCE.relative,
    `сумма ${sum.toFixed(1)}, в карточке ${sf.CATALOG.houseAreaM2}`,
  );
  assert.ok(AREA_TOLERANCE.reason.includes("стык") || AREA_TOLERANCE.reason.includes("отлив"));
});

test("жилая площадь — тёплый контур в большую сторону, террасы отдельно", () => {
  assert.equal(AREA_POLICY.livingAreaDefinition, "warm-contour");
  assert.equal(AREA_POLICY.outdoorSeparate, true);
  // Weekend One: жилая 43,8 — тёплый контур, а не сумма помещений 34,17.
  const rooms = AREA_DEFINITIONS.find((a) => a.id === "rooms")!;
  assert.equal(livingAreaM2(wo.MODULES.length), 43.8);
  assert.ok(livingAreaM2(wo.MODULES.length) > rooms.valueM2);
  // Округление именно вверх: 32,832 → 32,9, а не 32,8.
  assert.equal(livingAreaM2(3), 32.9);
  // Терраса и крыльцо в жилую не входят ни при каком счёте.
  assert.ok(livingAreaM2(4) < 43.8 + OUTDOOR_AREAS.terraceM2);
});
