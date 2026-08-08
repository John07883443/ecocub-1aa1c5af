import { Container } from "@/components/Container";

const specs = [
  { value: "5", unit: "дней", label: "монтаж на участке" },
  { value: "18", unit: "м²", label: "базовый модуль-кубик" },
  { value: "до 300", unit: "м²", label: "3 этажа, любая конфигурация" },
  { value: "A+++", unit: "", label: "энергоэффективность" },
];

export function BrandSpecs() {
  return (
    <section className="bg-primary py-24 text-primary-foreground md:py-36">
      <Container>
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
            Designed and engineered by EcoCub
          </p>
          <h2 className="mt-6 font-bold uppercase leading-[1.05] tracking-tight [font-size:clamp(1.5rem,5.2vw,4.5rem)]">
            <span className="block">Дом, спроектированный</span>
            <span className="block">как техника</span>
          </h2>
          <p className="mx-auto mt-8 max-w-2xl text-base text-white/70 md:text-lg">
            Hi-tech архитектура. Заводская готовность. Сборка на участке за 10 дней.
            Конструктор от 36 до 300 м².
          </p>
        </div>

        <div className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-sm bg-white/10 md:grid-cols-4">
          {specs.map((s) => (
            <div
              key={s.label}
              className="flex min-w-0 flex-col items-center bg-primary px-4 py-10 text-center md:px-6 md:py-14"
            >
              <p className="flex items-baseline justify-center whitespace-nowrap font-bold tracking-tight text-white [font-size:clamp(1.75rem,4.5vw,3.75rem)]">
                <span>{s.value}</span>
                {s.unit && (
                  <span className="ml-1 text-white/60 [font-size:clamp(1rem,2.2vw,1.875rem)]">
                    {s.unit}
                  </span>
                )}
              </p>
              <p className="mt-4 hyphens-auto break-words text-[10px] uppercase tracking-wider text-white/60 md:text-xs lg:text-sm">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
