export const site = {
  name: "EcoCub",
  tagline: "Современные дома под ключ в Московской области",
  phone: "+7 (980) 875-86-43",
  phoneHref: "tel:+79808758643",
  email: "info@eco-cub.ru",
  emailPartners: "partners@eco-cub.ru",
  whatsappHref: "https://wa.me/79808758643",
  telegramHref: "https://t.me/+79808758643",
};

export type NavItem = { label: string; to: string };

export const mainNav: NavItem[] = [
  { label: "Бетонные дома", to: "/concrete" },
  { label: "Каркасные Eco Wood", to: "/scandi" },
  { label: "Виллы Hi-Tech", to: "/villas" },
  { label: "Портфолио", to: "/portfolio" },
  { label: "Презентация", to: "/presentation" },
  { label: "Контакты", to: "/contacts" },
];
