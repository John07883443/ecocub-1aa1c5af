import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FINISHES, GRAMMAR, findStyle } from "../grammar/index.ts";
import {
  REFERENCE_LIMITS,
  mergeProfiles,
  styleProfileFromText,
  validateReferences,
} from "../engine/style.ts";
import { PRICE_CONFIG } from "../engine/price-config.ts";

const schema = JSON.parse(
  readFileSync(new URL("../grammar/modules.schema.json", import.meta.url), "utf8"),
);

test("грамматика содержит все обязательные поля схемы", () => {
  for (const k of schema.required) assert.ok(k in GRAMMAR, k);
  for (const k of schema.properties.module.required) assert.ok(k in GRAMMAR.module, `module.${k}`);
  for (const r of GRAMMAR.roomTypes)
    for (const k of schema.properties.roomTypes.items.required) assert.ok(k in r, `${r.id}.${k}`);
});

test("модуль и ограничения — как в альбоме и решениях владельца", () => {
  assert.deepEqual(GRAMMAR.module.externalMm, { w: 3200, d: 3420, h: 3750 });
  assert.deepEqual(GRAMMAR.module.clearMm, { w: 2780, d: 3000, h: 3150 });
  assert.equal(GRAMMAR.module.wallMm, 210);
  assert.equal(GRAMMAR.module.clearAreaM2, (2780 * 3000) / 1e6);
  assert.deepEqual(
    GRAMMAR.joints.map((j) => j.wallMm),
    [210, 420],
  );
  assert.equal(GRAMMAR.tiers.maxTiers, 2);
  assert.equal(GRAMMAR.tiers.maxOverhangMm, 1500);
  assert.equal(GRAMMAR.tiers.overhangWithColumnMm, null);
  assert.deepEqual(GRAMMAR.openings.heightsMm, [2100, 2500, 2800, 3150]);
});

test("стили ссылаются только на существующие отделки", () => {
  for (const s of FINISHES.styles) {
    assert.ok(
      FINISHES.categories.facade.some((f) => f.id === s.facade),
      s.id,
    );
    assert.ok(
      FINISHES.categories.roof.some((f) => f.id === s.roof),
      s.id,
    );
    assert.ok(
      FINISHES.categories.windowFrames.some((f) => f.id === s.windowFrames),
      s.id,
    );
    assert.ok(
      FINISHES.categories.interior.some((f) => f.id === s.interior),
      s.id,
    );
  }
  assert.equal(findStyle("Скандинавский")?.id, "scandi");
  assert.equal(findStyle("хочу в японском стиле")?.id, "japandi");
});

test("цены — заглушки, пока владелец не подтвердил", () => {
  if (PRICE_CONFIG.status === "PLACEHOLDER") assert.equal(PRICE_CONFIG.confirmedBy, null);
  for (const [k, v] of Object.entries(PRICE_CONFIG)) {
    if (v && typeof v === "object" && "min" in v) {
      assert.ok(v.max >= v.min, k);
      if (PRICE_CONFIG.status === "PLACEHOLDER" && !String(v.source).startsWith("Владелец"))
        assert.equal(v.placeholder, true, k);
    }
  }
});

test("StyleProfile из слов: фасад, окна, кровля, интерьер", () => {
  const p = styleProfileFromText("Белый фасад, чёрные рамы, внутри светлый дуб, много стекла");
  assert.equal(p.finishes.facade, "plaster-white");
  assert.equal(p.finishes.windowFrames, "frame-black");
  assert.equal(p.finishes.interior, "interior-light-oak");
  assert.ok(p.exterior.tags.includes("панорамное остекление"));
  assert.ok(p.confidence >= 0.5);
});

test("референсы: лимиты размера, типа и количества", () => {
  assert.deepEqual(
    validateReferences([{ id: "a", kind: "exterior", mime: "image/jpeg", bytes: 1_000_000 }]),
    [],
  );
  assert.equal(
    validateReferences([{ id: "b", kind: "interior", mime: "image/heic", bytes: 10 }]).length,
    1,
  );
  assert.equal(
    validateReferences([{ id: "c", kind: "interior", mime: "image/png", bytes: 20 * 1024 * 1024 }])
      .length,
    1,
  );
  const many = Array.from({ length: REFERENCE_LIMITS.maxFiles + 1 }, (_, i) => ({
    id: `r${i}`,
    kind: "exterior" as const,
    mime: "image/webp",
    bytes: 100,
  }));
  assert.ok(validateReferences(many).length >= 1);
});

test("слова человека важнее разбора фото", () => {
  const text = styleProfileFromText("чёрные рамы");
  const img = { ...styleProfileFromText("деревянные рамы, бетон"), source: "images" as const };
  const m = mergeProfiles(text, img);
  assert.equal(m.finishes.windowFrames, "frame-black");
  assert.equal(m.finishes.facade, "fiber-cement");
  assert.equal(m.source, "mixed");
});
