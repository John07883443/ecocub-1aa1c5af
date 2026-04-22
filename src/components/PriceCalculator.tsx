import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { site } from "@/lib/site";

interface PriceCalculatorProps {
  variant?: "light" | "dark";
}

const formatPrice = (n: number) =>
  new Intl.NumberFormat("ru-RU").format(Math.round(n));

export function PriceCalculator({ variant = "light" }: PriceCalculatorProps) {
  const [area, setArea] = useState(120);
  const isDark = variant === "dark";
  const total = area * site.basePricePerM2;
  const totalMln = (total / 1_000_000).toFixed(1);

  const cardClass = isDark
    ? "rounded-sm bg-white/5 p-6 md:p-10"
    : "rounded-sm border border-border bg-card p-6 md:p-10";
  const titleClass = isDark ? "text-white" : "text-foreground";
  const subtitleClass = isDark ? "text-white/70" : "text-muted-foreground";
  const valueClass = isDark ? "text-accent" : "text-accent";

  return (
    <div className={cardClass}>
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
        Калькулятор стоимости
      </p>
      <h3 className={`mt-3 text-2xl font-bold uppercase md:text-3xl ${titleClass}`}>
        Посчитайте свой дом
      </h3>
      <p className={`mt-3 text-sm ${subtitleClass}`}>
        Базовая стоимость — {formatPrice(site.basePricePerM2)} ₽ за м² в комплектации
        под предчистовую отделку. Площадь — любая, согласуем под ваш участок.
      </p>

      <div className="mt-8 space-y-6">
        <div>
          <div className="flex items-end justify-between">
            <span className={`text-sm uppercase tracking-wide ${subtitleClass}`}>
              Площадь дома
            </span>
            <span className={`text-3xl font-bold ${titleClass}`}>
              {area} <span className="text-base font-normal">м²</span>
            </span>
          </div>
          <Slider
            value={[area]}
            min={55}
            max={300}
            step={1}
            onValueChange={(v) => setArea(v[0])}
            className="mt-4"
          />
          <div className={`mt-2 flex justify-between text-xs ${subtitleClass}`}>
            <span>55 м²</span>
            <span>300 м²</span>
          </div>
        </div>

        <div className={`rounded-sm border-l-2 border-accent p-4 ${isDark ? "bg-white/5" : "bg-secondary"}`}>
          <p className={`text-xs uppercase tracking-wide ${subtitleClass}`}>
            Ориентировочная стоимость
          </p>
          <p className={`mt-2 text-4xl font-bold ${valueClass}`}>
            {formatPrice(total)} ₽
          </p>
          <p className={`mt-1 text-sm ${subtitleClass}`}>
            ≈ {totalMln} млн ₽ под предчистовую отделку
          </p>
        </div>

        <Button
          asChild
          size="lg"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <Link to="/contacts">
            Получить точный расчёт
            <ArrowRight />
          </Link>
        </Button>

        <p className={`text-xs ${subtitleClass}`}>
          В стоимость входит: фундамент, монолитные модули из бетона M400, фасад,
          кровля, окна, черновая инженерия, тёплые полы, монтаж. Финишная отделка
          и мебель — по индивидуальному проекту.
        </p>
      </div>
    </div>
  );
}
