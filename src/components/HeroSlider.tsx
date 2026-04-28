import { useEffect, useRef, useState, useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Slide = {
  base: string; // e.g. "/images/hero-villa"
  alt: string;
};

const slides: Slide[] = [
  {
    base: "/images/hero-villa",
    alt: "Современная вилла EcoCub с деревянной отделкой и террасой на закате",
  },
  {
    base: "/images/hero-villa-2",
    alt: "Минималистичный бетонный дом EcoCub с панорамным остеклением в лесу",
  },
  {
    base: "/images/hero-villa-3",
    alt: "Одноэтажная вилла EcoCub с тёплым вечерним светом и открытой кухней",
  },
  {
    base: "/images/hero-villa-4",
    alt: "Угловая вилла EcoCub с большой террасой и панорамными окнами",
  },
  {
    base: "/images/hero-villa-5",
    alt: "Современная белая вилла EcoCub с крытой террасой и лаунж-зоной",
  },
  {
    base: "/images/hero-villa-6",
    alt: "Лаконичный дом EcoCub в сосновом лесу с мягкой вечерней подсветкой",
  },
  {
    base: "/images/hero-villa-7",
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

  const scrollPrev = useCallback(() => {
    if (!emblaApi) return;
    autoplay.current.reset();
    emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (!emblaApi) return;
    autoplay.current.reset();
    emblaApi.scrollNext();
  }, [emblaApi]);

  return (
    <>
      <div ref={emblaRef} className="absolute inset-0 overflow-hidden">
        <div className="flex h-full">
          {slides.map((s, index) => (
            <div key={s.base} className="relative h-full min-w-0 flex-[0_0_100%] overflow-hidden bg-primary">
              <picture>
                <source
                  media="(max-width: 767px)"
                  srcSet={`${s.base}-mobile-768.webp 768w, ${s.base}-mobile-1080.webp 1080w`}
                  sizes="100vw"
                />
                <img
                  src={`${s.base}-1600.webp`}
                  srcSet={`${s.base}-768.webp 768w, ${s.base}-1600.webp 1600w`}
                  sizes="100vw"
                  alt={s.alt}
                  className="absolute inset-0 h-full w-full object-cover [object-position:50%_30%] md:[object-position:50%_50%]"
                  loading={index === 0 ? "eager" : "lazy"}
                  decoding={index === 0 ? "sync" : "async"}
                  {...(index === 0 ? { fetchPriority: "high" as const } : {})}
                />
              </picture>
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent" />

      {/* Arrows */}
      <button
        type="button"
        aria-label="Предыдущий слайд"
        onClick={scrollPrev}
        className="group absolute left-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/20 text-white backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-accent/60 hover:bg-black/40 md:left-6 md:size-14"
      >
        <ChevronLeft className="size-5 transition-transform duration-300 group-hover:-translate-x-0.5 md:size-6" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Следующий слайд"
        onClick={scrollNext}
        className="group absolute right-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/20 text-white backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-accent/60 hover:bg-black/40 md:right-6 md:size-14"
      >
        <ChevronRight className="size-5 transition-transform duration-300 group-hover:translate-x-0.5 md:size-6" strokeWidth={1.5} />
      </button>

      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-nowrap items-center justify-center gap-1.5 md:bottom-8 md:gap-2">
        {slides.map((s, i) => (
          <button
            key={s.base}
            type="button"
            aria-label={`Слайд ${i + 1}`}
            onClick={() => {
              autoplay.current.reset();
              emblaApi?.scrollTo(i);
            }}
            className={`h-1 shrink-0 rounded-full transition-all ${
              i === selected ? "w-6 bg-accent md:w-8" : "w-3 bg-white/40 hover:bg-white/70 md:w-5"
            }`}
          />
        ))}
      </div>
    </>
  );
}
