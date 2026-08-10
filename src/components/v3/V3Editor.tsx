/**
 * Редактор выбранного дома: крупные понятные действия — основной режим,
 * свободная сетка боевого конструктора (PlanEditor) — отдельный режим
 * «Точная настройка». Каждое действие проходит валидатор ограничений,
 * площадь и цена пересчитываются единым прайс-сервисом.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import {
  ArrowRight,
  Bath,
  BedDouble,
  BriefcaseBusiness,
  FlipHorizontal2,
  Layers2,
  Redo2,
  Settings2,
  Sofa,
  TentTree,
  Trash2,
  Undo2,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanEditor } from "@/components/constructor/PlanEditor";
import { StatsPanel } from "@/components/constructor/StatsPanel";
import { MAX_FLOORS, ROLE_ORDER, ROLES } from "@/lib/constructor/constants";
import type { Role } from "@/lib/constructor/types";
import type { V3BuilderApi } from "@/lib/v3/useV3Builder";
import { StepShell } from "./shared";

const Scene3D = lazy(() => import("@/components/constructor/Scene3D"));

type BigActionDef = {
  key: string;
  label: string;
  hint: string;
  icon: typeof BedDouble;
  action: Parameters<V3BuilderApi["bigAction"]>[0];
};

const BIG_ACTIONS: BigActionDef[] = [
  {
    key: "bedroom",
    label: "Добавить спальню",
    hint: "+9 м² жилой",
    icon: BedDouble,
    action: { type: "add-role", role: "bedroom" },
  },
  {
    key: "office",
    label: "Добавить кабинет",
    hint: "тихая комната для работы",
    icon: BriefcaseBusiness,
    action: { type: "add-role", role: "living", note: "Кабинет добавлен (+9 м²)" },
  },
  {
    key: "living",
    label: "Увеличить кухню-гостиную",
    hint: "+9 м² общей зоны",
    icon: Sofa,
    action: { type: "add-role", role: "living" },
  },
  {
    key: "bathroom",
    label: "Добавить санузел",
    hint: "+9 м², мокрая зона",
    icon: Bath,
    action: { type: "add-role", role: "bathroom" },
  },
  {
    key: "storage",
    label: "Хранение / постирочная",
    hint: "кладовая и гардероб",
    icon: Warehouse,
    action: {
      type: "add-role",
      role: "living",
      note: "Зона хранения/постирочная добавлена (+9 м²)",
    },
  },
  {
    key: "terrace",
    label: "Добавить террасу",
    hint: "открытая зона, дешевле жилой",
    icon: TentTree,
    action: { type: "add-role", role: "terrace" },
  },
  {
    key: "floor",
    label: "Рассмотреть второй этаж",
    hint: "лестница + спальня наверху",
    icon: Layers2,
    action: { type: "second-floor" },
  },
  {
    key: "mirror",
    label: "Зеркально развернуть",
    hint: "под ориентацию участка",
    icon: FlipHorizontal2,
    action: { type: "mirror" },
  },
];

export function V3Editor({
  api,
  planName,
  needsReview,
  onNext,
  onAction,
}: {
  api: V3BuilderApi;
  planName: string | null;
  needsReview: boolean;
  onNext: () => void;
  onAction: (key: string, ok: boolean) => void;
}) {
  const [fineTune, setFineTune] = useState(false);
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(true);

  // Сообщение о результате действия живёт несколько секунд.
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [message]);

  const run = (def: BigActionDef) => {
    const result = api.bigAction(def.action);
    setMessage(result.message);
    setMessageOk(result.ok);
    onAction(def.key, result.ok);
  };

  const removeRole = (role: Role) => {
    const result = api.bigAction({ type: "remove-role", role });
    setMessage(result.message);
    setMessageOk(result.ok);
    onAction(`remove-${role}`, result.ok);
  };

  return (
    <StepShell
      stage={4}
      eyebrow={planName ? `За основу взят план «${planName}»` : "Сборка с нуля"}
      title="Настройте дом под себя"
      intro={
        needsReview
          ? "Схема условная: раскладка восстановлена по карточке проекта, точную планировку подтверждает инженер EcoCub. Изменения проверяются конструктивными правилами, площадь и цена пересчитываются сразу."
          : "Каждое изменение проверяется конструктивными правилами EcoCub, площадь и цена пересчитываются сразу."
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {/* Переключатели вида и undo/redo */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-sm border border-border p-0.5">
              {(["plan", "3d"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={[
                    "rounded-[3px] px-4 py-1.5 text-sm font-medium transition-colors",
                    view === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {v === "plan" ? "План" : "3D"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={!api.canUndo}
                onClick={api.undo}
                aria-label="Отменить"
              >
                <Undo2 className="size-4" /> Отменить
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!api.canRedo}
                onClick={api.redo}
                aria-label="Повторить"
              >
                <Redo2 className="size-4" />
              </Button>
            </div>
          </div>

          {/* Сцена */}
          <div className="mt-3">
            {view === "plan" ? (
              fineTune ? (
                <FineTunePanel api={api} />
              ) : (
                <ReadonlyPlan api={api} />
              )
            ) : (
              <div className="aspect-square w-full overflow-hidden rounded-sm border border-border bg-[#dfe6d8] md:aspect-[4/3]">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Загружаем 3D…
                    </div>
                  }
                >
                  <Scene3D modules={api.modules} design={api.design} gridN={api.gridN} autoRotate />
                </Suspense>
              </div>
            )}
          </div>

          {/* Итог действия */}
          <div aria-live="polite" className="mt-3 min-h-6 text-sm">
            {message && (
              <span className={messageOk ? "text-foreground" : "font-medium text-destructive"}>
                {messageOk ? "✓ " : "✕ "}
                {message}
              </span>
            )}
          </div>

          {/* Крупные действия */}
          <div className="mt-2 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {BIG_ACTIONS.map((def) => {
              const Icon = def.icon;
              const disabled = def.key === "floor" && api.stats.floors >= MAX_FLOORS;
              return (
                <button
                  key={def.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => run(def)}
                  className="group flex min-h-20 flex-col items-start gap-1.5 rounded-sm border border-border p-3 text-left transition-all hover:border-accent hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon className="size-5 text-accent" strokeWidth={1.75} />
                  <span className="text-xs font-semibold leading-tight">{def.label}</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    {def.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Убрать модуль по роли */}
          <details className="mt-4 rounded-sm border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              <Trash2 className="mr-1.5 inline size-4" /> Убрать лишнее
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLE_ORDER.map((r) => (
                <Button key={r} variant="outline" size="sm" onClick={() => removeRole(r)}>
                  − {ROLES[r].label}
                </Button>
              ))}
            </div>
          </details>

          {/* Точная настройка */}
          <button
            type="button"
            onClick={() => setFineTune((v) => !v)}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings2 className="size-4" />
            {fineTune
              ? "Скрыть точную настройку"
              : "Точная настройка: свободная сетка, этажи, участок"}
          </button>
        </div>

        {/* Статистика и дальше */}
        <div className="space-y-4">
          <StatsPanel stats={api.stats} />
          <Button
            size="lg"
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            disabled={api.modules.length === 0}
            onClick={onNext}
          >
            Посадить на участок <ArrowRight />
          </Button>
        </div>
      </div>
    </StepShell>
  );
}

/** План только для просмотра (основной режим): без случайных тапов на мобильном. */
function ReadonlyPlan({ api }: { api: V3BuilderApi }) {
  return (
    <div className="relative">
      <div className="pointer-events-none">
        <PlanEditor api={api} showRoles />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Модули двигаются в режиме «Точная настройка» — так случайный тап на телефоне не изменит дом.
      </p>
    </div>
  );
}

/** Свободный режим: полноценный редактор боевого конструктора + этажи и роли. */
function FineTunePanel({ api }: { api: V3BuilderApi }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-sm border border-border p-0.5">
          {Array.from({ length: MAX_FLOORS }, (_, f) => (
            <button
              key={f}
              type="button"
              onClick={() => api.setFloor(f)}
              className={[
                "rounded-[3px] px-3 py-1 text-xs font-medium transition-colors",
                api.floor === f ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {f + 1} этаж
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => api.setRole(r)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                api.role === r
                  ? "border-accent bg-accent/10"
                  : "border-border text-muted-foreground",
              ].join(" ")}
            >
              <span
                className="mr-1 inline-block size-2 rounded-full"
                style={{ background: ROLES[r].plan }}
              />
              {ROLES[r].label}
            </button>
          ))}
        </div>
      </div>
      <PlanEditor api={api} showRoles />
      <p className="mt-2 text-xs text-muted-foreground">
        Тап по свободному месту — поставить «{ROLES[api.role].label}», перетаскивание — передвинуть
        (зелёные точки подскажут куда), тап по модулю — выбрать. Участок: {api.sotki} соток.
      </p>
      {api.selectedId && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Выбранный модуль:</span>
          {ROLE_ORDER.map((r) => (
            <Button
              key={r}
              variant="outline"
              size="sm"
              onClick={() => api.setModuleRole(api.selectedId!, r)}
            >
              {ROLES[r].label}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => api.removeModule(api.selectedId!)}>
            <Trash2 className="size-4" /> Убрать
          </Button>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <label className="text-xs text-muted-foreground" htmlFor="v3-sotki">
          Размер участка (соток)
        </label>
        <input
          id="v3-sotki"
          type="range"
          min={4}
          max={30}
          value={api.sotki}
          onChange={(e) => api.setSotki(Number(e.target.value))}
          className="w-44 accent-[var(--color-accent,#c6a15a)]"
        />
        <span className="text-xs font-semibold">{api.sotki}</span>
      </div>
    </div>
  );
}
