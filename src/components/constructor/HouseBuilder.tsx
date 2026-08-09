import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Box, Layers3, Trash2, Sparkles, Eraser, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { PlanEditor } from "./PlanEditor";
import { StatsPanel } from "./StatsPanel";
import { useHouseBuilder } from "@/lib/constructor/useHouseBuilder";
import {
  CELL_M,
  DESIGN_PRESETS,
  MAX_FLOORS,
  ROLE_ORDER,
  ROLES,
  TEMPLATES,
  MIN_SOTKI,
  MAX_SOTKI,
} from "@/lib/constructor/constants";
import type { HouseStats, ModuleItem, Role } from "@/lib/constructor/types";

const Scene3D = lazy(() => import("./Scene3D"));

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

function buildSummary(stats: HouseStats, modules: ModuleItem[], sotki: number, designName: string) {
  const roleCounts = ROLE_ORDER.map((r) => {
    const count = modules.filter((m) => m.role === r).length;
    return count ? `${ROLES[r].label}: ${count}` : null;
  })
    .filter(Boolean)
    .join(", ");
  return [
    "Моя конфигурация в конструкторе EcoCub:",
    `• Модулей: ${stats.moduleCount} (${fmt(stats.heatedArea)} м² жилой${stats.terraceArea ? ` + ${fmt(stats.terraceArea)} м² террас` : ""})`,
    `• Этажей: ${stats.floors}`,
    `• Состав: ${roleCounts || "—"}`,
    `• Участок: ${sotki} соток`,
    `• Дизайн: ${designName}`,
    `• Ориентировочная стоимость: ${fmt(stats.price)} ₽`,
  ].join("\n");
}

export interface HouseBuilderProps {
  basePricePerM2: number;
  onRequestQuote?: (summary: string) => void;
}

export function HouseBuilder({ basePricePerM2, onRequestQuote }: HouseBuilderProps) {
  const api = useHouseBuilder(basePricePerM2);
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [mounted, setMounted] = useState(false);
  const [opened3d, setOpened3d] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (view === "3d") setOpened3d(true);
  }, [view]);

  const selected = useMemo(
    () => api.modules.find((m) => m.id === api.selectedId) ?? null,
    [api.modules, api.selectedId],
  );

  const existingTopFloor = api.modules.reduce((mx, m) => Math.max(mx, m.floor), -1);
  const floorButtons = Array.from(
    { length: Math.min(MAX_FLOORS, Math.max(2, existingTopFloor + 2)) },
    (_, i) => i,
  );

  const plotSideM = Math.round(Math.sqrt(api.sotki * 100));

  const handleQuote = () => {
    const summary = buildSummary(api.stats, api.modules, api.sotki, api.design.name);
    onRequestQuote?.(summary);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* ВЬЮПОРТ */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-sm border border-border p-1">
            <TabBtn active={view === "plan"} onClick={() => setView("plan")}>
              <Box className="size-4" /> План
            </TabBtn>
            <TabBtn active={view === "3d"} onClick={() => setView("3d")}>
              <Layers3 className="size-4" /> 3D
            </TabBtn>
          </div>

          {view === "3d" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRotate((v) => !v)}
              className="gap-1.5"
            >
              <RefreshCw className={cn("size-3.5", autoRotate && "animate-spin-slow")} />
              {autoRotate ? "Остановить" : "Вращать"}
            </Button>
          )}

          {view === "plan" && (
            <div className="inline-flex rounded-sm border border-border p-1">
              {floorButtons.map((f) => (
                <TabBtn key={f} active={api.floor === f} onClick={() => api.setFloor(f)}>
                  {f + 1} эт.
                </TabBtn>
              ))}
            </div>
          )}
        </div>

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-sm bg-gradient-to-b from-sky-100 to-secondary md:aspect-[16/10]">
          {/* PLAN */}
          <div className={cn("absolute inset-0 p-3", view === "plan" ? "block" : "hidden")}>
            <div className="mx-auto flex h-full max-w-[560px] items-center justify-center">
              <PlanEditor api={api} />
            </div>
          </div>

          {/* 3D */}
          <div className={cn("absolute inset-0", view === "3d" ? "block" : "hidden")}>
            {mounted && opened3d ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Загрузка 3D-сцены…
                  </div>
                }
              >
                <Scene3D
                  modules={api.modules}
                  design={api.design}
                  gridN={api.gridN}
                  autoRotate={autoRotate}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Подготовка сцены…
              </div>
            )}
          </div>
        </div>

        {view === "plan" && (
          <p className="text-xs text-muted-foreground">
            Тапните по пустой ячейке, чтобы поставить модуль {CELL_M}×{CELL_M} м. Тапните по модулю,
            чтобы изменить назначение или удалить. Участок {plotSideM}×{plotSideM} м, шаг сетки{" "}
            {CELL_M} м.
          </p>
        )}

        {/* Роли для новых модулей */}
        {view === "plan" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Тип модуля:
            </span>
            {ROLE_ORDER.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => api.setRole(r)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors",
                  api.role === r
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:border-foreground/40",
                )}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: ROLES[r].plan }}
                />
                {ROLES[r].label}
              </button>
            ))}
          </div>
        )}

        {/* Выбранный модуль */}
        {selected && (
          <div className="rounded-sm border border-border bg-secondary p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Модуль ({ROLES[selected.role].label}, {selected.floor + 1} эт.):
              </span>
              {ROLE_ORDER.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => api.setModuleRole(selected.id, r as Role)}
                  className={cn(
                    "rounded-sm border px-2 py-0.5 text-xs transition-colors",
                    selected.role === r
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background hover:border-foreground/40",
                  )}
                >
                  {ROLES[r].label}
                </button>
              ))}
              <div className="ml-auto flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-destructive hover:text-destructive"
                  onClick={() => api.removeModule(selected.id)}
                >
                  <Trash2 className="size-3.5" /> Удалить
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ПАНЕЛЬ УПРАВЛЕНИЯ */}
      <div className="flex flex-col gap-4">
        <StatsPanel stats={api.stats} />

        {/* Участок */}
        <div className="rounded-sm border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Участок</span>
            <span className="text-sm font-semibold text-foreground">
              {api.sotki} соток · {plotSideM}×{plotSideM} м
            </span>
          </div>
          <Slider
            value={[api.sotki]}
            min={MIN_SOTKI}
            max={MAX_SOTKI}
            step={1}
            onValueChange={(v) => api.setSotki(v[0])}
            className="mt-3"
          />
        </div>

        {/* Шаблоны */}
        <div className="rounded-sm border border-border bg-card p-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Готовые планировки
          </span>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => api.loadTemplate(t.id)}
                className="flex items-center justify-between rounded-sm border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-accent"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.shape}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={api.clearAll}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            <Eraser className="size-3.5" /> Очистить участок
          </button>
        </div>

        {/* Дизайн */}
        <div className="rounded-sm border border-border bg-card p-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Дизайн фасада
          </span>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {DESIGN_PRESETS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => api.setDesignId(d.id)}
                className={cn(
                  "rounded-sm border px-2.5 py-2 text-left text-xs transition-colors",
                  api.designId === d.id
                    ? "border-accent ring-1 ring-accent"
                    : "border-border hover:border-accent/60",
                )}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <span
                    className="size-3 rounded-full border border-black/10"
                    style={{ backgroundColor: d.wall }}
                  />
                  {d.name}
                </span>
              </button>
            ))}
          </div>
          {api.design.image && !imgError[api.design.id] && (
            <figure className="mt-3">
              <div className="relative overflow-hidden rounded-sm">
                <img
                  src={api.design.image}
                  alt={`AI-визуализация фасада «${api.design.name}»`}
                  loading="lazy"
                  onError={() => setImgError((s) => ({ ...s, [api.design.id]: true }))}
                  className="aspect-[16/9] w-full object-cover"
                />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-sm bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  <Sparkles className="size-3" /> AI-визуализация
                </span>
              </div>
            </figure>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{api.design.description}</p>
        </div>

        <Button size="lg" className="w-full gap-2" onClick={handleQuote}>
          <Sparkles className="size-4" /> Получить расчёт по этой сборке
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function TabBtn({
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
