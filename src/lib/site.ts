/**
 * Стартовая цена для сниппетов и рекламных подписей: ₽ за м² ПОД КЛЮЧ
 * — с чистовой отделкой, доставкой модулей и фундаментом. Решение владельца
 * от 01.10.2026 (материалы отделки могут добавить ≈15 тыс. ₽/м² — ещё не
 * подтверждено, поэтому в текстах «с отделкой», а не «с материалами»).
 * Это ЕДИНСТВЕННАЯ точка правки цены: title/description/OG главной и
 * /concrete и ориентир короткого квиза собираются из неё (lib/seo.ts).
 *
 * С 01.10.2026 по решению владельца эта же ставка — site.basePricePerM2:
 * конструктор, калькулятор и квизы считают по ней (раньше было 105 000
 * «под предчистовую отделку» без доставки и фундамента).
 */
export const START_PRICE_PER_M2_RUB = 150_000;

/** Ориентир без чистовой отделки — вторичная подпись под ценой. */
export const NO_FINISH_PRICE_PER_M2_RUB = 130_000;

/** Что входит в цену — одна формулировка для всех подписей. */
export const PRICE_SCOPE = "под ключ с чистовой отделкой, доставкой и фундаментом";

/** «без чистовой — около 130 тыс. ₽/м²» */
export const NO_FINISH_NOTE = `без чистовой — около ${Math.round(NO_FINISH_PRICE_PER_M2_RUB / 1000)} тыс. ₽/м²`;

export const site = {
  name: "EcoCub",
  tagline: "Монолитно-модульные дома из бетона под ключ за 90 дней",
  brandTagline: "Engineered to last 120 years.",
  brandPromise: "Designed and engineered by EcoCub",
  phone: "+7 (980) 875-86-43",
  phoneHref: "tel:+79808758643",
  phoneSecondary: "+7 (980) 875-86-43",
  phoneSecondaryHref: "tel:+79808758643",
  email: "info@eco-cub.ru",
  emailPartners: "partners@eco-cub.ru",
  whatsappHref: "https://wa.me/79808758643",
  telegramHref: "https://t.me/agregator_john",
  url: "https://eco-cub.ru",
  basePricePerM2: START_PRICE_PER_M2_RUB,
  warrantyYears: 50,
  lifespanYears: 120,
  productionDays: 90,
  assemblyDays: 10,
};

export type NavItem = { label: string; to: string };

export const mainNav: NavItem[] = [
  { label: "Бетонные дома", to: "/concrete" },
  { label: "Технология", to: "/technology" },
  { label: "Проекты домов", to: "/houses" },
  { label: "Конструктор", to: "/constructor" },
  { label: "Портфолио", to: "/portfolio" },
  { label: "Блог", to: "/blog" },
  { label: "Аналитика", to: "/analytics" },
  { label: "Контакты", to: "/contacts" },
  // Служебный раздел в общем меню — решение владельца: инструмент нужен под
  // рукой. Посетителю он не вредит: страница закрыта от индексации (noindex),
  // а изменить или опубликовать что-либо без секрета из окружения сервера
  // нельзя — редактор откроется в режиме чтения с формой входа.
  { label: "Проектирование", to: "/design" },
];
