import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSpam, MIN_FILL_MS } from "../antispam.ts";
import { concreteSnippet, homeSnippet, DESCRIPTION_MAX, TITLE_MAX } from "../seo.ts";
import { messengerHref } from "../messengers.ts";
import { START_PRICE_PER_M2_RUB, site } from "../site.ts";

test("цена одна на сайт: калькулятор и конструктор считают по START_PRICE_PER_M2_RUB", () => {
  assert.equal(site.basePricePerM2, START_PRICE_PER_M2_RUB);
});

test("антиспам: honeypot", () => {
  assert.deepEqual(checkSpam({ honeypot: "http://x" }), { spam: true, reason: "honeypot" });
  assert.deepEqual(checkSpam({ honeypot: "", elapsedMs: 10_000 }), { spam: false });
});

test("антиспам: слишком быстро", () => {
  assert.deepEqual(checkSpam({ elapsedMs: 300 }), { spam: true, reason: "too_fast" });
  assert.deepEqual(checkSpam({ elapsedMs: MIN_FILL_MS }), { spam: false });
});

test("антиспам: старая форма без полей — не спам", () => {
  assert.deepEqual(checkSpam({}), { spam: false });
  assert.deepEqual(checkSpam({ elapsedMs: "fast" }), { spam: false });
});

for (const [name, s] of Object.entries({ home: homeSnippet, concrete: concreteSnippet })) {
  test(`сниппет ${name}: длины и цена`, () => {
    assert.ok(s.title.length <= TITLE_MAX, `title ${s.title.length} > ${TITLE_MAX}: ${s.title}`);
    assert.ok(
      s.description.length <= DESCRIPTION_MAX,
      `description ${s.description.length} > ${DESCRIPTION_MAX}`,
    );
    const price = String(Math.round(START_PRICE_PER_M2_RUB / 1000));
    for (const text of [s.title, s.ogTitle]) {
      assert.ok(text.includes(price), `нет цены в «${text}»`);
      assert.ok(text.includes("под ключ"), `нет «под ключ» в «${text}»`);
      assert.ok(!/(^|\s)от\s/.test(text), `«от» в цене запрещено: «${text}»`);
    }
    assert.ok(s.description.includes("с отделкой, доставкой и фундаментом"));
    assert.ok(s.description.includes("Московская область"));
    // «ИИ-конструктор» выходит вместе с новым конструктором (PR #34).
    for (const text of Object.values(s)) assert.ok(!text.includes("ИИ"), `ИИ в «${text}»`);
  });
}

test("ссылки мессенджеров берут контакты сайта и кодируют текст", () => {
  const wa = messengerHref("whatsapp", "Расчёт: 6 модулей & 54 м²");
  assert.ok(wa.startsWith("https://wa.me/"));
  assert.ok(wa.includes("%26"));
  assert.ok(messengerHref("telegram").startsWith("https://t.me/"));
});
