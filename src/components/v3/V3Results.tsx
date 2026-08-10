/**
 * Выдача подбора: до трёх реальных планов EcoCub с объяснением, компромиссами
 * и честными пометками про условные схемы. Фиктивных вариантов не бывает —
 * если подошло меньше трёх, показываем сколько есть; если ноль — честный
 * пустой экран с ручным путём и контактом.
 */

import { ArrowRight, BadgeInfo, Bath, BedDouble, Layers2, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Recommendation } from "@/lib/v3/types";
import { kindLabel } from "@/lib/v3/recommend";
import { site } from "@/lib/site";
import { fmtRub, MiniPlan, PlanLegend, StepShell } from "./shared";

export function V3Results({
  recommendations,
  onSelect,
  onManual,
}: {
  recommendations: Recommendation[];
  onSelect: (rec: Recommendation) => void;
  onManual: () => void;
}) {
  if (!recommendations.length) {
    return (
      <StepShell
        stage={3}
        eyebrow="Честный результат"
        title="Готового плана под такой запрос пока нет"
        intro="В библиотеке EcoCub сейчас нет планировки, которая проходит по всем вашим требованиям. Мы не будем выдумывать вариант — предлагаем два настоящих пути."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-sm border border-border p-5">
            <p className="text-sm font-semibold">Собрать вручную</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Откройте конструктор с чистого участка и соберите дом из модулей под себя.
            </p>
            <Button className="mt-4" variant="outline" onClick={onManual}>
              Открыть конструктор <ArrowRight />
            </Button>
          </div>
          <div className="rounded-sm border border-border p-5">
            <p className="text-sm font-semibold">Спросить инженера</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Позвоните или напишите — подберём решение за пределами онлайн-библиотеки.
            </p>
            <Button asChild className="mt-4" variant="outline">
              <a href={site.phoneHref}>{site.phone}</a>
            </Button>
          </div>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      stage={3}
      eyebrow={
        recommendations.length === 3
          ? "Три варианта из реальных планов EcoCub"
          : `Подошло вариантов: ${recommendations.length}`
      }
      title="Дома, собранные под вашу семью"
      intro="Это предварительный автоматический подбор из библиотеки реальных решений EcoCub — не «идеальный дом» и не точная смета. Любой вариант можно изменить в конструкторе."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {recommendations.map((rec, i) => (
          <RecommendationCard key={rec.plan.id} rec={rec} highlight={i === 0} onSelect={onSelect} />
        ))}
      </div>
    </StepShell>
  );
}

function RecommendationCard({
  rec,
  highlight,
  onSelect,
}: {
  rec: Recommendation;
  highlight: boolean;
  onSelect: (rec: Recommendation) => void;
}) {
  const m = rec.plan.metrics;
  return (
    <div
      className={[
        "flex flex-col rounded-sm border p-5 transition-shadow",
        highlight ? "border-accent ring-1 ring-accent" : "border-border",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
          {kindLabel(rec.kind)}
        </span>
        <span className="text-xs text-muted-foreground">
          Соответствие {Math.round(rec.score * 100)}%
        </span>
      </div>

      <h3 className="mt-3 text-lg font-bold uppercase tracking-tight">{rec.plan.name}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{rec.plan.description}</p>

      {rec.plan.assets.coverImage && (
        <img
          src={rec.plan.assets.coverImage}
          alt={rec.plan.name}
          loading="lazy"
          className="mt-3 aspect-[4/3] w-full rounded-sm object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}

      <div className="mt-3 rounded-sm bg-secondary p-3">
        <MiniPlan cells={rec.plan.cells} className="mx-auto max-h-40 w-full" />
        <div className="mt-2">
          <PlanLegend cells={rec.plan.cells} />
        </div>
        {rec.plan.needsReview && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <BadgeInfo className="mt-0.5 size-3.5 shrink-0 text-accent" />
            Схема условная: раскладку модулей подтверждает инженер EcoCub.
          </p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Metric icon={Ruler} label="Площадь" value={`${m.grossAreaM2} м²`} />
        <Metric icon={Layers2} label="Этажей" value={String(m.floors)} />
        <Metric icon={BedDouble} label="Спальни" value={String(m.bedrooms)} />
        <Metric icon={Bath} label="Санузлы" value={String(m.bathrooms)} />
      </dl>

      <p className="mt-4 text-sm">
        <span className="font-semibold text-accent">от {fmtRub(rec.estimate.price)} ₽</span>{" "}
        <span className="text-xs text-muted-foreground">
          · диапазон до {fmtRub(rec.estimate.max)} ₽
        </span>
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        {rec.estimate.disclaimer}
      </p>

      <div className="mt-4 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Почему подходит
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {rec.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </div>

      {rec.tradeoffs.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Компромиссы
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {rec.tradeoffs.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Что можно менять
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {rec.allowedChanges.map((c) => (
            <li key={c}>· {c}</li>
          ))}
        </ul>
      </div>

      <Button
        className={[
          "mt-5 w-full",
          highlight
            ? "bg-accent text-accent-foreground hover:bg-accent/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        ].join(" ")}
        onClick={() => onSelect(rec)}
      >
        Открыть в конструкторе <ArrowRight />
      </Button>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Ruler;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-accent" strokeWidth={1.75} />
      <div>
        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="text-sm font-semibold leading-tight">{value}</dd>
      </div>
    </div>
  );
}
