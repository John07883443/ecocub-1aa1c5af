import { useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";

const slides = [
  {
    src: "/images/hero-villa.jpg",
    alt: "Современная вилла EcoCub из бетона на закате — кухня, камин, панорамные окна",
  },
  {
    src: "/images/hero-villa-2.jpg",
    alt: "Одноэтажный модульный дом EcoCub с террасой и панорамным остеклением",
  },
  {
    src: "/images/hero-villa-3.jpg",
    alt: "Бетонный дом EcoCub в сосновом лесу — минималистичная архитектура",
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
          {slides.map((s) => (
            <div key={s.src} className="relative h-full min-w-0 flex-[0_0_100%]">
              <img
                src={s.src}
                alt={s.alt}
                className="h-full w-full object-cover"
                loading="eager"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent" />
      <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2 md:bottom-8">
        {slides.map((s, i) => (
          <button
            key={s.src}
            type="button"
            aria-label={`Слайд ${i + 1}`}
            onClick={() => emblaApi?.scrollTo(i)}
            className={`h-1 rounded-full transition-all ${
              i === selected ? "w-10 bg-accent" : "w-6 bg-white/40 hover:bg-white/70"
            }`}
          />
        ))}
      </div>
    </>
  );
}
