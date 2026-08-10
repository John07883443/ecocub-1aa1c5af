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
  basePricePerM2: 105000,
  warrantyYears: 50,
  lifespanYears: 120,
  productionDays: 90,
  assemblyDays: 10,
};

export type NavItem = { label: string; to: string };

export const mainNav: NavItem[] = [
  { label: "Бетонные дома", to: "/concrete" },
  { label: "Технология", to: "/technology" },
  { label: "Конструктор", to: "/constructor" },
  { label: "Портфолио", to: "/portfolio" },
  { label: "Блог", to: "/blog" },
  { label: "Контакты", to: "/contacts" },
];

export type SubNavItem = { label: string; to: string; hint?: string; badge?: string };

/**
 * Выпадающее меню пункта «Конструктор»: быстрый доступ ко всем версиям.
 * Добавлено по решению владельца (10.08.2026) — до этого эксперименты
 * были доступны только по прямым ссылкам.
 */
export const constructorNav: SubNavItem[] = [
  {
    label: "AI-подбор под семью",
    to: "/constructor-ai-v3",
    hint: "вопросы → до трёх домов → участок и фасад",
    badge: "новое",
  },
  {
    label: "3D-конструктор",
    to: "/constructor",
    hint: "свободная сборка из модулей 3×3 м",
  },
  {
    label: "Квиз подбора проекта",
    to: "/#quiz",
    hint: "минута — и ориентир по площади и цене",
  },
  {
    label: "Дом мечты",
    to: "/#dream",
    hint: "карта потребностей с живым превью",
  },
  {
    label: "Все версии · лаборатория",
    to: "/constructor-lab",
    hint: "сравнить все варианты конструктора",
  },
];
