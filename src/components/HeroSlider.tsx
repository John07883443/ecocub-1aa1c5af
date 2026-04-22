import { useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";

const slides = [
  {
    src: "/images/hero-villa.jpg",
    alt: "Современная вилла EcoCub с деревянной отделкой и террасой на закате",
  },
  {
    src: "/images/hero-villa-2.jpg",
    alt: "Минималистичный бетонный дом EcoCub с панорамным остеклением в лесу",
  },
  {
    src: "/images/hero-villa-3.jpg",
    alt: "Одноэтажная вилла EcoCub с тёплым вечерним светом и открытой кухней",
  },
  {
    src: "/images/hero-villa-4.jpg",
    alt: "Угловая вилла EcoCub с большой террасой и панорамными окнами",
  },
  {
    src: "/images/hero-villa-5.jpg",
    alt: "Современная белая вилла EcoCub с крытой террасой и лаунж-зоной",
  },
  {
    src: "/images/hero-villa-6.jpg",
    alt: "Лаконичный дом EcoCub в сосновом лесу с мягкой вечерней подсветкой",
  },
  {
    src: "/images/hero-villa-7.jpg",
    alt: "Современная бетонная вилла EcoCub с тёплой архитектурной подсветкой на закате",
  },
];

export function HeroSlider() {
  const autoplay = useRef(
    Autoplay({ delay: 5500, stopOnInteraction: false, stopOnMouseEnter: false }),
  );
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "start" }, [
    autoplay.current,
  ]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  return (
    <>
      <div ref={emblaRef} className="absolute inset-0 overflow-hidden">
        <div className="flex h-full">
          {slides.map((s, index) => (
            <div key={s.src} className="relative h-full min-w-0 flex-[0_0_100%] overflow-hidden bg-primary">
              <img
                src={s.src}
                alt={s.alt}
                className="absolute inset-0 h-full w-full object-cover"
                loading={index === 0 ? "eager" : "lazy"}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent" />
      <div className="absolute bottom-6 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap justify-center gap-2 md:bottom-8">
        {slides.map((s, i) => (
          <button
            key={s.src}
            type="button"
            aria-label={`Слайд ${i + 1}`}
            onClick={() => emblaApi?.scrollTo(i)}
            className={`h-1 rounded-full transition-all ${
              i === selected ? "w-8 bg-accent" : "w-5 bg-white/40 hover:bg-white/70"
            }`}
          />
        ))}
      </div>
    </>
  );
}
