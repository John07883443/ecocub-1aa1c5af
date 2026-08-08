import { Reveal } from "@/components/motion/Reveal";

const interiors = [
  {
    src: "/images/interiors/living-1.jpg",
    alt: "Интерьер гостиной модульного дома EcoCub с панорамным окном",
  },
  {
    src: "/images/interiors/kitchen-1.jpg",
    alt: "Кухня-столовая в монолитно-модульном доме EcoCub",
  },
  { src: "/images/interiors/living-2.jpg", alt: "Гостиная с дизайнерской мебелью в доме EcoCub" },
  { src: "/images/interiors/bedroom-1.jpg", alt: "Спальня в модульном бетонном доме EcoCub" },
  { src: "/images/interiors/bedroom-2.jpg", alt: "Дизайн спальни в доме из бетона EcoCub" },
  { src: "/images/interiors/bathroom-1.jpg", alt: "Ванная комната в модульном доме EcoCub" },
];

export function InteriorsGallery() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
      {interiors.map((it, i) => (
        <Reveal
          key={it.src}
          variant="scale"
          delay={i * 90}
          className={`group relative overflow-hidden rounded-sm bg-secondary ${
            i === 0 ? "sm:col-span-2 sm:row-span-2 aspect-square sm:aspect-auto" : "aspect-square"
          }`}
        >
          <img
            src={it.src}
            alt={it.alt}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        </Reveal>
      ))}
    </div>
  );
}
