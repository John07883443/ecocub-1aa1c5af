import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Box, Layers3, Trash2, Sparkles, Eraser, RefreshCw, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { PlanEditor } from "./PlanEditor";
import { StatsPanel } from "./StatsPanel";
import { AiLayoutBlock } from "./AiLayoutBlock";
import { PlanBlock } from "./PlanBlock";
import { useHouseBuilder } from "@/lib/constructor/useHouseBuilder";
import { canRemove } from "@/lib/constructor/geometry";
import {
  CELL_M,
  DESIGN_PRESETS,
  MAX_FLOORS,
  MODULE_HEIGHT_M,
  TEMPLATES,
  MIN_SOTKI,
  MAX_SOTKI,
} from "@/lib/constructor/constants";
import type { HouseStats } from "@/lib/constructor/types";

const Scene3D = lazy(() => import("./Scene3D"));

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

/**
 * Сводка для заявки. Состав комнат не перечисляем: модули универсальные,
 * назначение помещений менеджер и инженер уточняют после обращения.
 */
function buildSummary(stats: HouseStats, sotki: number, designName: string) {
  return [
    "Моя конфигурация в конструкторе EcoCub:",
    `• Модулей: ${stats.moduleCount} (${fmt(stats.totalArea)} м²)`,
    `• Этажей: ${stats.floors}`,
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

  /** Контекстное меню модуля: открывается тапом/кликом прямо на плане. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (view === "3d") setOpened3d(true);
  }, [view]);

  // Меню закрывается по Esc и при уходе со вкладки плана.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  useEffect(() => {
    if (view !== "plan") setMenu(null);
  }, [view]);

  const handleModuleTap = (id: string, clientX: number, clientY: number) => {
    // Пустой id приходит от тапа по свободному месту при открытом меню —
    // такой тап только закрывает панель и ничего не ставит.
    if (!id) {
      setMenu(null);
      api.selectModule(null);
      return;
    }
    setMenu({ id, x: clientX, y: clientY });
  };

  const existingTopFloor = api.modules.reduce((mx, m) => Math.max(mx, m.floor), -1);
  const floorButtons = Array.from(
    { length: Math.min(MAX_FLOORS, Math.max(2, existingTopFloor + 2)) },
    (_, i) => i,
  );

  const plotSideM = Math.round(Math.sqrt(api.sotki * 100));

  const handleQuote = () => {
    const summary = buildSummary(api.stats, api.sotki, api.design.name);
    onRequestQuote?.(summary);
  };

  return (
    <div>
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

            {/* Быстрая очистка плана — на виду, а не в глубине панели */}
            {view === "plan" && (
              <Button
                variant="outline"
                size="sm"
                disabled={!api.modules.length}
                onClick={() => setConfirmClear(true)}
                className="ml-auto gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
              >
                <Eraser className="size-3.5" /> Очистить план
              </Button>
            )}
          </div>

          {/*
          На телефоне поле квадратное и во всю ширину: кубики крупнее
          относительно пальца, поэтому в них проще попадать и видно, куда
          ведёшь модуль. На широких экранах пропорции прежние.
        */}
          <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-gradient-to-b from-sky-100 to-secondary sm:aspect-[4/3] md:aspect-[16/10]">
            {/* PLAN */}
            <div
              className={cn("absolute inset-0 p-1.5 sm:p-3", view === "plan" ? "block" : "hidden")}
            >
              <div className="mx-auto flex h-full w-full max-w-[560px] items-center justify-center">
                <PlanEditor api={api} onModuleTap={handleModuleTap} suppressPlace={!!menu} />
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
              Тапните по свободному месту, чтобы поставить кубик {CELL_M}×{CELL_M} м, или потяните
              готовый модуль пальцем либо мышкой — он примагнитится вплотную к соседнему, без
              зазора. Тап по модулю открывает меню с удалением. Участок {plotSideM}×{plotSideM} м.
            </p>
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

        {menu && (
          <ModuleMenu
            floor={api.modules.find((m) => m.id === menu.id)?.floor ?? 0}
            anchor={{ x: menu.x, y: menu.y }}
            canDelete={canRemove(api.modules, menu.id)}
            onDelete={() => {
              api.removeModule(menu.id);
              setMenu(null);
            }}
            onClose={() => {
              setMenu(null);
              api.selectModule(null);
            }}
          />
        )}

        {confirmClear && (
          <ClearDialog
            onCancel={() => setConfirmClear(false)}
            onConfirm={() => {
              api.clearAll();
              setMenu(null);
              setConfirmClear(false);
            }}
          />
        )}
      </div>

      {/* Планировка по правилам: считается на месте, из геометрии дома. */}
      <PlanBlock modules={api.modules} />

      {/* Генерация нейросетью. Блок сам себя скрывает, пока функция выключена
          на сервере, — а выключена она с тех пор, как планировку стал считать
          планировщик. Оставлен намеренно: если у чертежа найдётся слепое
          пятно, возвращаться будет к чему. */}
      <AiLayoutBlock modules={api.modules} onRequestQuote={onRequestQuote} />
    </div>
  );
}

/**
 * Меню модуля. Открывается обычным кликом мышью и обычным тапом пальцем —
 * long press не требуется. Кнопки крупные, чтобы попадать пальцем.
 */
function ModuleMenu({
  floor,
  anchor,
  canDelete,
  onDelete,
  onClose,
}: {
  floor: number;
  anchor: { x: number; y: number };
  /** Крайний ли это модуль. Удаление внутреннего разорвало бы дом надвое. */
  canDelete: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Слушаем со следующего кадра: тап, открывший меню, не должен его закрыть.
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  // Панель держится в пределах экрана и не перекрывает сам модуль.
  const width = 208;
  const left = Math.min(
    Math.max(12, anchor.x - width / 2),
    (typeof window !== "undefined" ? window.innerWidth : 360) - width - 12,
  );
  const top = Math.min(
    anchor.y + 14,
    (typeof window !== "undefined" ? window.innerHeight : 640) - 130,
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Действия с модулем"
      className="fixed z-50 rounded-sm border border-border bg-background p-2 shadow-[0_14px_36px_-12px_rgba(0,0,0,0.4)]"
      style={{ left, top, width }}
    >
      <div className="flex items-center justify-between px-1.5 py-1">
        <span className="text-xs text-muted-foreground">Модуль 3 × 3 м · {floor + 1} эт.</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-sm px-2.5 text-left text-sm transition-colors",
          canDelete
            ? "text-destructive hover:bg-destructive/5"
            : "cursor-not-allowed text-muted-foreground",
        )}
      >
        <Trash2 className="size-4" /> Удалить модуль
      </button>
      <p className="px-2.5 pb-1 pt-0.5 text-[11px] leading-snug text-muted-foreground">
        {canDelete
          ? "Чтобы передвинуть — просто потяните модуль."
          : "Этот модуль держит дом вместе. Удалять можно крайние."}
      </p>
    </div>
  );
}

function ClearDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-sm border border-border bg-background p-5">
        <p className="text-base font-semibold">Очистить план?</p>
        <p className="mt-2 text-sm text-muted-foreground">
          С участка уберутся все модули на всех этажах. Участок, дизайн фасада и настройки
          сохранятся — собрать заново можно с готовой планировки.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={onConfirm}>
            Очистить план
          </Button>
        </div>
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
