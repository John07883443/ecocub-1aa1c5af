import { Link } from "@tanstack/react-router";
import { ArrowRight, Box, Boxes, Blocks } from "lucide-react";
import { Container } from "@/components/Container";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/Reveal";

const configs = [
  {
    icon: Box,
    name: "Studio",
    modules: "1 модуль",
    area: "36 м²",
    floors: "1 этаж",
    desc: "Компактный дом или гостевой блок. Идеально для дачи или сдачи в аренду.",
  },
  {
    icon: Boxes,
    name: "Family",
    modules: "4 модуля",
    area: "144 м²",
    floors: "2 этажа",
    desc: "Семейный дом для круглогодичного проживания с тремя спальнями.",
  },
  {
    icon: Blocks,
    name: "Estate",
    modules: "8 модулей",
    area: "288 м²",
    floors: "3 этажа",
    desc: "Просторный бетонный дом с панорамным остеклением, террасами и эксплуатируемой кровлей.",
  },
];

export function Configurator() {
  return (
    <section id="builder" className="scroll-mt-28 bg-background py-24 md:scroll-mt-32 md:py-32">
      <Container>
        <Reveal className="mb-14 max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Конструктор</p>
          <h2 className="mt-3 text-3xl font-bold uppercase tracking-tight md:text-5xl">
            Соберите свой EcoCub
          </h2>
          <p className="mt-4 text-muted-foreground">
            Кратно 18 м². До 3 этажей. Любая планировка. Соберите дом из модулей в интерактивном
            3D-конструкторе, покрутите его на участке и сразу узнайте площадь и стоимость.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-6 bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Link to="/constructor">
              Открыть 3D-конструктор <ArrowRight />
            </Link>
          </Button>
        </Reveal>

        <div className="grid gap-6 md:grid-cols-3">
          {configs.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal
                key={c.name}
                variant="up"
                delay={i * 110}
                className="group hover-lift flex h-full flex-col rounded-sm border border-border bg-card p-8 hover:border-accent hover:shadow-lg"
              >
                <Icon
                  className="size-10 text-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 group-hover:scale-110"
                  strokeWidth={1.5}
                />
                <h3 className="mt-6 text-2xl font-bold uppercase tracking-tight">{c.name}</h3>
                <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                  <p>{c.modules}</p>
                  <p className="text-2xl font-bold text-foreground">{c.area}</p>
                  <p>{c.floors}</p>
                </div>
                <p className="mt-6 flex-1 text-sm text-muted-foreground">{c.desc}</p>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={120} className="mt-10">
          <Link
            to="/portfolio"
            className="group inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            Смотреть готовые конфигурации{" "}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </Container>
    </section>
  );
}
