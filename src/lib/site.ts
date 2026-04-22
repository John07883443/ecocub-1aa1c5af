export const site = {
  name: "EcoCub",
  tagline: "Монолитно-модульные дома из бетона под ключ за 90 дней",
  brandTagline: "Engineered to last 120 years.",
  brandPromise: "Designed and engineered by EcoCub",
  phone: "+7 (969) 466-09-32",
  phoneHref: "tel:+79694660932",
  phoneSecondary: "+7 (980) 875-86-43",
  phoneSecondaryHref: "tel:+79808758643",
  email: "info@eco-cub.ru",
  emailPartners: "partners@eco-cub.ru",
  whatsappHref: "https://wa.me/79694660932",
  telegramHref: "https://t.me/+79694660932",
  basePricePerM2: 105000,
  warrantyYears: 50,
  lifespanYears: 120,
  productionDays: 90,
  assemblyDays: 5,
};

export type NavItem = { label: string; to: string };

export const mainNav: NavItem[] = [
  { label: "Бетонные дома", to: "/concrete" },
  { label: "Виллы Hi-Tech", to: "/villas" },
  { label: "Технология", to: "/technology" },
  { label: "Портфолио", to: "/portfolio" },
  { label: "Блог", to: "/blog" },
  { label: "Контакты", to: "/contacts" },
];
