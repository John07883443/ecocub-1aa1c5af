/**
 * Выбор фасадного стиля (v3.1).
 *
 * Каталог data-driven, выбор сохраняется в проекте. Генерация концептуального
 * AI-рендера пока НЕ подключена: серверного сервиса с защищённым ключом,
 * лимитами и журналом заданий у сайта нет, поэтому кнопка честно помечена
 * «Скоро», а моковая картинка за настоящий рендер не выдаётся. Точная белая
 * 3D-модель при этом доступна всегда — она и есть источник геометрии.
 */

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "@/components/v3/shared";
import { analyticsV31 } from "@/lib/analytics";
import { activeImageProvider, buildRenderBrief, FACADE_STYLES } from "@/lib/v31/facade";
import { bounds } from "@/lib/v31/geometry";
import type { WorkspaceApi } from "@/lib/v31/useWorkspace";

export function FacadeStep({
  api,
  onBack,
  onNext,
}: {
  api: WorkspaceApi;
  onBack: () => void;
  onNext: () => void;
}) {
  const [mood, setMood] = useState<{ lighting: "day" | "evening"; season: "summer" | "winter" }>({
    lighting: "day",
    season: "summer",
  });
  const provider = activeImageProvider();
  const selectedId = api.project.facadeStyleId ?? FACADE_STYLES[0].id;

  const select = (id: string) => {
    api.patchProject({ facadeStyleId: id });
    analyticsV31.facadeStyleSelected(id);
  };

  // Бриф собирается уже сейчас: он уходит менеджеру вместе с заявкой,
  // а когда появится серверный провайдер — тот же объект пойдёт в очередь.
  const brief = buildRenderBrief({
    projectId: api.project.id,
    styleId: selectedId,
    areas: api.areas,
    footprint: api.house.modules
      .filter((m) => m.floor === 0)
      .map(
        (m) =>
          `${m.x - bounds(api.house.modules, 0).minX},${m.z - bounds(api.house.modules, 0).minZ}`,
      )
      .sort(),
    ceilingHeightM: api.project.ceilingHeightM,
    site: api.site,
    mood,
  });

  return (
    <StepShell
      stage={6}
      eyebrow="Фасад"
      title="Каким будет образ дома"
      intro="Стиль меняет только материалы и цвет — геометрия дома остаётся ровно такой, какую вы собрали."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FACADE_STYLES.map((style) => {
          const active = style.id === selectedId;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => select(style.id)}
              aria-pressed={active}
              className={[
                "overflow-hidden rounded-sm border text-left transition-all",
                active ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent",
              ].join(" ")}
            >
              {/* Превью — палитра стиля, а не выдуманный рендер дома */}
              <div className="relative flex h-24" aria-hidden>
                <span className="flex-1" style={{ background: style.wallColor }} />
                <span className="w-1/4" style={{ background: style.accentColor }} />
                <span className="w-1/6" style={{ background: style.frameColor }} />
                {active && (
                  <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Check className="size-3.5" />
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold">{style.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{style.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-medium">Настроение визуализации</p>
          <div className="flex flex-wrap gap-1.5">
            {(["day", "evening"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setMood((m) => ({ ...m, lighting: l }))}
                aria-pressed={mood.lighting === l}
                className={chip(mood.lighting === l)}
              >
                {l === "day" ? "День" : "Вечер"}
              </button>
            ))}
            {(["summer", "winter"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMood((m) => ({ ...m, season: s }))}
                aria-pressed={mood.season === s}
                className={chip(mood.season === s)}
              >
                {s === "summer" ? "Лето" : "Зима"}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-sm border border-border p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Info className="size-4 text-accent" /> Фотореалистичный рендер
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {provider.available
              ? "Генерация доступна."
              : "Генерация появится позже — сейчас она не подключена. Точная белая 3D-модель уже собрана по вашей конфигурации, а задание на рендер уходит специалисту EcoCub вместе с заявкой."}
          </p>
          <Button variant="outline" className="mt-3 w-full" disabled>
            Сгенерировать рендер · скоро
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            В задании зафиксировано: {brief.geometry.floors} эт., модулей{" "}
            {brief.geometry.moduleCount}, высота потолков{" "}
            {brief.geometry.ceilingHeightM.toFixed(2).replace(".", ",")} м — менять геометрию
            генерация не имеет права.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={onNext}
        >
          Получить проект <ArrowRight />
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Вернуться к дому и участку
        </button>
      </div>
    </StepShell>
  );
}

function chip(active: boolean): string {
  return [
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-accent bg-accent/10"
      : "border-border text-muted-foreground hover:border-accent",
  ].join(" ");
}
