/**
 * Фасад и атмосфера + подготовка точного задания на AI-рендер.
 *
 * Генеративная модель не может менять архитектуру: задание собирается из
 * фактической конфигурации (этажность, число модулей, силуэт) и только
 * допустимых параметров. Режим рендера — честный manual: задание уходит
 * менеджеру вместе с проектом, автоматической генерации на сайте нет
 * (см. src/lib/v3/render.ts).
 */

import { useState } from "react";
import { ArrowRight, Check, ImageIcon, Moon, Snowflake, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DESIGN_PRESETS } from "@/lib/constructor/constants";
import type { ModuleItem } from "@/lib/constructor/types";
import {
  activeRenderProvider,
  buildRenderRequest,
  ENVIRONMENTS,
  type RenderMood,
} from "@/lib/v3/render";
import type { RenderJob } from "@/lib/v3/types";
import { StepShell } from "./shared";

export function V3Facade({
  projectId,
  modules,
  designId,
  onDesign,
  onDone,
  onRenderRequested,
}: {
  projectId: string;
  modules: ModuleItem[];
  designId: string;
  onDesign: (id: string) => void;
  onDone: (job: RenderJob | null, mood: RenderMood) => void;
  onRenderRequested: (provider: string) => void;
}) {
  const [mood, setMood] = useState<RenderMood>({
    lighting: "day",
    season: "summer",
    environment: ENVIRONMENTS[0],
  });
  const [job, setJob] = useState<RenderJob | null>(null);
  const [pending, setPending] = useState(false);

  const design = DESIGN_PRESETS.find((d) => d.id === designId) ?? DESIGN_PRESETS[0];
  const provider = activeRenderProvider();

  const prepare = async () => {
    setPending(true);
    try {
      const request = buildRenderRequest(projectId, modules, design, mood);
      const created = await provider.createRender(request);
      setJob(created);
      onRenderRequested(provider.id);
    } finally {
      setPending(false);
    }
  };

  return (
    <StepShell
      stage={6}
      eyebrow="Фасад и атмосфера"
      title="Каким будет образ дома"
      intro="Выберите фасад и настроение. Конфигурация дома при этом не меняется — художественный рендер строится строго по вашей геометрии."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {/* Пресеты фасада */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {DESIGN_PRESETS.map((d) => {
              const active = d.id === designId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onDesign(d.id)}
                  aria-pressed={active}
                  className={[
                    "overflow-hidden rounded-sm border text-left transition-all",
                    active
                      ? "border-accent ring-1 ring-accent"
                      : "border-border hover:border-accent",
                  ].join(" ")}
                >
                  <div className="relative aspect-[4/3] bg-secondary">
                    {d.image ? (
                      <img
                        src={d.image}
                        alt={d.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="h-full w-full" style={{ background: d.wall }} />
                    )}
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-semibold">{d.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                      {d.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Настроение */}
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <MoodGroup label="Свет">
              <MoodChip
                active={mood.lighting === "day"}
                onClick={() => setMood((m) => ({ ...m, lighting: "day" }))}
              >
                <Sun className="size-3.5" /> День
              </MoodChip>
              <MoodChip
                active={mood.lighting === "evening"}
                onClick={() => setMood((m) => ({ ...m, lighting: "evening" }))}
              >
                <Moon className="size-3.5" /> Вечер
              </MoodChip>
            </MoodGroup>
            <MoodGroup label="Сезон">
              <MoodChip
                active={mood.season === "summer"}
                onClick={() => setMood((m) => ({ ...m, season: "summer" }))}
              >
                <Sun className="size-3.5" /> Лето
              </MoodChip>
              <MoodChip
                active={mood.season === "winter"}
                onClick={() => setMood((m) => ({ ...m, season: "winter" }))}
              >
                <Snowflake className="size-3.5" /> Зима
              </MoodChip>
            </MoodGroup>
            <MoodGroup label="Участок">
              <select
                value={mood.environment}
                onChange={(e) => setMood((m) => ({ ...m, environment: e.target.value }))}
                className="w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
              >
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </select>
            </MoodGroup>
          </div>
        </div>

        {/* Задание на рендер */}
        <div className="space-y-4">
          <div className="rounded-sm border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ImageIcon className="size-4 text-accent" /> AI-рендер фасада
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {provider.modeNote}
            </p>
            {job ? (
              <div className="mt-3 rounded-sm border border-accent/30 bg-accent/5 p-3 text-xs">
                <p className="font-semibold text-foreground">✓ Задание подготовлено</p>
                <p className="mt-1 text-muted-foreground">
                  Фасад «{design.name}», {mood.lighting === "day" ? "день" : "вечер"},{" "}
                  {mood.season === "summer" ? "лето" : "зима"}, {mood.environment.toLowerCase()}.
                  Задание прикрепится к вашей заявке.
                </p>
              </div>
            ) : (
              <Button
                variant="outline"
                className="mt-3 w-full"
                disabled={pending || !modules.length}
                onClick={prepare}
              >
                {pending ? "Готовим…" : "Подготовить задание на рендер"}
              </Button>
            )}
          </div>

          <Button
            size="lg"
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => onDone(job, mood)}
          >
            Дальше — получить проект <ArrowRight />
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Рендер можно и не заказывать — проект вы получите в любом случае.
          </p>
        </div>
      </div>
    </StepShell>
  );
}

function MoodGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

function MoodChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-accent bg-accent/10"
          : "border-border text-muted-foreground hover:border-accent",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
