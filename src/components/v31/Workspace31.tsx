/**
 * Единое рабочее пространство «Дом + участок» (v3.1).
 *
 * Отдельного экрана посадки нет: тот же URL, тот же холст, то же состояние —
 * меняется только контекст инструментов («Дом» / «Участок») и рабочий
 * масштаб. Режимы просмотра («Вместе» / «План» / «3D») отвечают на другой
 * вопрос — как сейчас смотрим результат; по умолчанию открыт «Вместе», где
 * план и белый объём видны одновременно.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Blocks, Boxes, Building2, Expand, Map as MapIcon, SquareStack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_FLOORS } from "@/lib/v31/constants";
import {
  useWorkspace,
  type ToolContext,
  type ViewMode,
  type WorkspaceApi,
} from "@/lib/v31/useWorkspace";
import { PlanCanvas } from "./PlanCanvas";
import { ClearDialog, EmptyState, HouseTools, KeyStats, ModuleMenu, SiteTools } from "./panels";

const Scene31 = lazy(() => import("./Scene31"));

export function Workspace31({
  api,
  onReady,
}: {
  api: WorkspaceApi;
  /** Следующий шаг после валидной конфигурации (фасад и расчёт). */
  onReady: () => void;
}) {
  const [menu, setMenu] = useState<{ moduleId: string; x: number; y: number } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [expanded3d, setExpanded3d] = useState(false);
  const [webglOk, setWebglOk] = useState(true);

  // WebGL проверяем один раз: без него 3D просто не показываем, а
  // редактирование в 2D остаётся полностью рабочим.
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      setWebglOk(!!gl);
    } catch {
      setWebglOk(false);
    }
  }, []);

  // Сообщение о результате действия живёт несколько секунд.
  useEffect(() => {
    if (!api.message) return;
    const t = window.setTimeout(() => api.clearMessage(), 4200);
    return () => window.clearTimeout(t);
  }, [api.message, api]);

  const openMenu = useCallback((moduleId: string, x: number, y: number) => {
    setMenu({ moduleId, x, y });
  }, []);

  const showPlan = api.viewMode !== "3d";
  const show3d = api.viewMode !== "plan" && webglOk;
  const empty = api.house.modules.length === 0;

  const scene = useMemo(
    () => (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Загружаем объём…
          </div>
        }
      >
        <Scene31
          house={api.house}
          site={api.site}
          showSite={api.context === "site"}
          autoRotate={false}
        />
      </Suspense>
    ),
    [api.house, api.site, api.context],
  );

  return (
    <div className="rounded-sm border border-border bg-card shadow-sm">
      {/* Верхняя панель: что редактируем и как смотрим */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
        <ContextSwitch value={api.context} onChange={api.setContext} />
        <div className="flex items-center gap-2">
          <FloorSwitch api={api} />
          <ViewSwitch value={api.viewMode} onChange={api.setViewMode} webglOk={webglOk} />
        </div>
      </div>

      <div className="p-4 md:p-6">
        <div
          className={
            api.viewMode === "together"
              ? "grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
              : "grid gap-5"
          }
        >
          {/* Мобильный порядок: сначала объём, затем редактируемый план */}
          {api.viewMode === "together" && show3d && (
            <div className="order-1 lg:order-2">
              <ThreeDPanel onExpand={() => setExpanded3d(true)}>{scene}</ThreeDPanel>
              <div className="mt-4 hidden lg:block">
                <KeyStats api={api} />
              </div>
            </div>
          )}

          <div className={api.viewMode === "together" ? "order-2 lg:order-1" : ""}>
            {showPlan ? (
              empty ? (
                <EmptyState api={api} />
              ) : (
                <PlanCanvas api={api} onModuleMenu={openMenu} />
              )
            ) : (
              <div className="h-[60vh] overflow-hidden rounded-sm border border-border">
                {scene}
              </div>
            )}

            {/* Итог последнего действия — без layout shift */}
            <div aria-live="polite" className="mt-2 min-h-6 text-sm">
              {api.message && (
                <span
                  className={api.message.ok ? "text-foreground" : "font-medium text-destructive"}
                >
                  {api.message.ok ? "✓ " : "✕ "}
                  {api.message.text}
                </span>
              )}
            </div>

            {api.issues.length > 0 && (
              <p className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-700">
                {api.issues[0]} — состыкуйте модули, иначе расчёт и фасад будут недоступны.
              </p>
            )}

            {!webglOk && api.viewMode !== "plan" && (
              <p className="mt-2 rounded-sm border border-border bg-secondary p-2.5 text-xs text-muted-foreground">
                3D недоступен в этом браузере — план и расчёт работают как обычно.
              </p>
            )}
          </div>
        </div>

        {/* Инструменты выбранного контекста */}
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            {api.context === "house" ? (
              <HouseTools api={api} onClear={() => setClearOpen(true)} />
            ) : (
              <SiteTools api={api} />
            )}
          </div>
          <div className="space-y-4">
            <div className={api.viewMode === "together" ? "lg:hidden" : ""}>
              <KeyStats api={api} />
            </div>
            <Button
              size="lg"
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={!api.readiness.ready}
              onClick={onReady}
            >
              Фасад и расчёт
            </Button>
            {!api.readiness.ready && (
              <p className="text-xs text-muted-foreground">
                {api.readiness.reasons[0] ?? "Соберите дом, чтобы перейти дальше"}
              </p>
            )}
          </div>
        </div>
      </div>

      {menu && (
        <ModuleMenu
          api={api}
          moduleId={menu.moduleId}
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}

      {clearOpen && (
        <ClearDialog
          onCancel={() => setClearOpen(false)}
          onConfirm={() => {
            api.clearAction();
            setClearOpen(false);
          }}
        />
      )}

      {expanded3d && show3d && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Дом в объёме</p>
            <Button variant="outline" size="sm" onClick={() => setExpanded3d(false)}>
              Свернуть
            </Button>
          </div>
          <div className="flex-1">{scene}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ContextSwitch({
  value,
  onChange,
}: {
  value: ToolContext;
  onChange: (v: ToolContext) => void;
}) {
  const items: Array<{ id: ToolContext; label: string; icon: typeof Building2 }> = [
    { id: "house", label: "Дом", icon: Building2 },
    { id: "site", label: "Участок", icon: MapIcon },
  ];
  return (
    <div
      className="inline-flex rounded-sm border border-border p-0.5"
      role="group"
      aria-label="Что редактируем"
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={[
            "inline-flex min-h-9 items-center gap-1.5 rounded-[3px] px-3 text-sm font-medium transition-colors",
            value === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function ViewSwitch({
  value,
  onChange,
  webglOk,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  webglOk: boolean;
}) {
  const items: Array<{ id: ViewMode; label: string; icon: typeof Boxes }> = [
    { id: "together", label: "Вместе", icon: SquareStack },
    { id: "plan", label: "План", icon: Blocks },
    { id: "3d", label: "3D", icon: Boxes },
  ];
  return (
    <div
      className="inline-flex rounded-sm border border-border p-0.5"
      role="group"
      aria-label="Как смотрим"
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          disabled={!webglOk && id !== "plan"}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={[
            "inline-flex min-h-9 items-center gap-1.5 rounded-[3px] px-3 text-sm font-medium transition-colors disabled:opacity-40",
            value === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <Icon className="size-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function FloorSwitch({ api }: { api: WorkspaceApi }) {
  const floors = Math.max(1, Math.min(MAX_FLOORS, api.areas.floors || 1));
  if (floors < 2) return null;
  return (
    <div
      className="inline-flex rounded-sm border border-border p-0.5"
      role="group"
      aria-label="Этаж"
    >
      {Array.from({ length: floors }, (_, f) => (
        <button
          key={f}
          type="button"
          onClick={() => api.setFloor(f)}
          aria-pressed={api.floor === f}
          className={[
            "min-h-9 rounded-[3px] px-3 text-sm font-medium transition-colors",
            api.floor === f ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {f + 1} эт.
        </button>
      ))}
    </div>
  );
}

function ThreeDPanel({ children, onExpand }: { children: React.ReactNode; onExpand: () => void }) {
  return (
    <div className="rounded-sm border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-semibold">Дом в объёме</p>
          <p className="text-[11px] text-muted-foreground">
            Все изменения плана сразу появляются здесь
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onExpand}>
          <Expand className="size-4" /> Развернуть
        </Button>
      </div>
      <div className="h-64 md:h-80 lg:h-[26rem]">{children}</div>
    </div>
  );
}

export { useWorkspace };
