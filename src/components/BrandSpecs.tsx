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
          <h2 className="mt-6 text-4xl font-bold uppercase leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
            Дом, спроектированный<br />как техника
          </h2>
          <p className="mx-auto mt-8 max-w-2xl text-base text-white/70 md:text-lg">
            Hi-tech архитектура. Заводская готовность. Сборка на участке за 5 дней.
            Конструктор от 36 до 300 м².
          </p>
        </div>

        <div className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-sm bg-white/10 md:grid-cols-4">
          {specs.map((s) => (
            <div key={s.label} className="flex flex-col items-center bg-primary px-6 py-10 text-center md:py-14">
              <p className="text-4xl font-bold tracking-tight text-white md:text-6xl">
                {s.value}
                {s.unit && <span className="ml-1 text-2xl text-white/60 md:text-3xl">{s.unit}</span>}
              </p>
              <p className="mt-4 text-xs uppercase tracking-wider text-white/60 md:text-sm">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
