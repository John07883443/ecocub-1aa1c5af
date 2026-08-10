/**
 * Общие мелкие блоки шагов /constructor-ai-v3: обёртка шага с прогрессом,
 * SVG-миниплан из ячеек и карточка выбора в стиле квизов сайта.
 */

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { MODULE_SIDE_M, ROLES } from "@/lib/constructor/constants";
import type { PlanCell } from "@/lib/v3/types";

export const fmtRub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

/* ------------------------------------------------------------------ */
/* Обёртка шага                                                         */
/* ------------------------------------------------------------------ */

export const STEP_TITLES = [
  "Профиль",
  "Образ жизни",
  "Подбор",
  "Варианты",
  "Редактирование",
  "Участок",
  "Фасад",
  "Проект",
] as const;

export function StepShell({
  stage,
  eyebrow,
  title,
  intro,
  children,
}: {
  /** Индекс в STEP_TITLES; -1 — входной экран без прогресса. */
  stage: number;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const progress = stage < 0 ? 0 : Math.round(((stage + 1) / STEP_TITLES.length) * 100);
  return (
    <div className="rounded-sm border border-border bg-card shadow-sm">
      {stage >= 0 && (
        <div className="border-b border-border px-5 py-4 md:px-8">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span>
              Этап {stage + 1} из {STEP_TITLES.length} · {STEP_TITLES[stage]}
            </span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      <div className="p-5 md:p-8">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">{eyebrow}</p>
        <h2 className="mt-3 text-xl font-bold uppercase tracking-tight md:text-2xl">{title}</h2>
        {intro && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{intro}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Карточка-выбор                                                       */
/* ------------------------------------------------------------------ */

export function ChoiceButton({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "group flex items-center gap-3 rounded-sm border p-4 text-left transition-all",
        active
          ? "border-accent bg-accent/10 ring-1 ring-accent"
          : "border-border bg-card hover:border-accent hover:bg-accent/5",
      ].join(" ")}
    >
      <span
        className={[
          "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
          active ? "border-accent bg-accent text-accent-foreground" : "border-border",
        ].join(" ")}
      >
        {active && <Check className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-snug">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Мини-план из ячеек                                                   */
/* ------------------------------------------------------------------ */

export function MiniPlan({ cells, className }: { cells: PlanCell[]; className?: string }) {
  if (!cells.length) return null;
  const minX = Math.min(...cells.map((c) => c.x));
  const maxX = Math.max(...cells.map((c) => c.x + MODULE_SIDE_M));
  const minZ = Math.min(...cells.map((c) => c.z));
  const maxZ = Math.max(...cells.map((c) => c.z + MODULE_SIDE_M));
  const pad = 0.6;
  const w = maxX - minX + pad * 2;
  const h = maxZ - minZ + pad * 2;
  const ground = cells.filter((c) => c.floor === 0);
  const upper = cells.filter((c) => c.floor > 0);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label="Схема планировки по модулям 3×3 м"
    >
      <g transform={`translate(${pad - minX} ${pad - minZ})`}>
        {ground.map((c) => (
          <rect
            key={c.id}
            x={c.x + 0.12}
            y={c.z + 0.12}
            width={MODULE_SIDE_M - 0.24}
            height={MODULE_SIDE_M - 0.24}
            rx={0.2}
            fill={ROLES[c.role].plan}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={0.07}
          />
        ))}
        {upper.map((c) => (
          <rect
            key={c.id}
            x={c.x + 0.3}
            y={c.z + 0.3}
            width={MODULE_SIDE_M - 0.6}
            height={MODULE_SIDE_M - 0.6}
            rx={0.2}
            fill="none"
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={0.1}
            strokeDasharray="0.5 0.3"
          />
        ))}
      </g>
    </svg>
  );
}

/** Легенда ролей для мини-плана. */
export function PlanLegend({ cells }: { cells: PlanCell[] }) {
  const present = Array.from(new Set(cells.map((c) => c.role)));
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {present.map((r) => (
        <span
          key={r}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span className="size-2.5 rounded-[2px]" style={{ background: ROLES[r].plan }} />
          {ROLES[r].label}
        </span>
      ))}
    </div>
  );
}
