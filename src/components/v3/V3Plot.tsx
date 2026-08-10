/**
 * Посадка дома на участок: точная условная схема в масштабе (SVG-метры),
 * отступы от границ, положение въезда и перемещение дома слайдерами —
 * они удобны и на телефоне, и с клавиатуры. Геометрию считает plot-движок,
 * дисклеймер о предварительности схемы показывается всегда.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MODULE_SIDE_M } from "@/lib/constructor/constants";
import { ROLES } from "@/lib/constructor/constants";
import type { ModuleItem } from "@/lib/constructor/types";
import {
  centerHouse,
  clampPlotSide,
  defaultPlot,
  ENTRANCE_LABELS,
  houseFitsPlot,
  placementFits,
  placementRange,
  PLOT_DISCLAIMER,
} from "@/lib/v3/plot";
import type { EntranceSide, PlotSpec } from "@/lib/v3/types";
import { StepShell } from "./shared";

const SIDES: EntranceSide[] = ["south", "west", "north", "east", "unknown"];

export function V3Plot({
  modules,
  initial,
  onDone,
}: {
  modules: ModuleItem[];
  initial: PlotSpec | null;
  onDone: (plot: PlotSpec, fits: boolean) => void;
}) {
  const [plot, setPlot] = useState<PlotSpec>(() => initial ?? defaultPlot(modules));

  const fitsAtAll = houseFitsPlot(modules, plot);
  const fits = placementFits(modules, plot);
  const range = useMemo(() => placementRange(modules, plot), [modules, plot]);

  // При смене размеров участка дом возвращается в допустимую зону.
  useEffect(() => {
    if (fitsAtAll && !fits) {
      setPlot((p) => ({ ...p, ...centerHouse(modules, p) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot.widthM, plot.depthM, plot.setbackM, fitsAtAll]);

  const setSide = (key: "widthM" | "depthM", v: number) =>
    setPlot((p) => ({ ...p, [key]: clampPlotSide(v) }));

  return (
    <StepShell
      stage={5}
      eyebrow="Масштабная схема"
      title="Посадите дом на участок"
      intro="Схема в реальном масштабе: клетка — 1 метр, штриховая линия — отступ от границ. Двигайте дом ползунками, пока он не встанет как надо."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <PlotScheme modules={modules} plot={plot} fits={fits} />
          <p className="mt-3 rounded-sm border-l-2 border-accent bg-secondary p-3 text-xs leading-relaxed text-muted-foreground">
            {PLOT_DISCLAIMER}
          </p>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Ширина, м</span>
              <Input
                type="number"
                inputMode="numeric"
                min={12}
                max={100}
                value={plot.widthM}
                onChange={(e) => setSide("widthM", Number(e.target.value) || 12)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Глубина, м</span>
              <Input
                type="number"
                inputMode="numeric"
                min={12}
                max={100}
                value={plot.depthM}
                onChange={(e) => setSide("depthM", Number(e.target.value) || 12)}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            ≈ {((plot.widthM * plot.depthM) / 100).toFixed(1)} соток · отступ от границ{" "}
            {plot.setbackM} м
          </p>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Въезд на участок</span>
            <div className="flex flex-wrap gap-1.5">
              {SIDES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPlot((p) => ({ ...p, entranceSide: s }))}
                  className={[
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    plot.entranceSide === s
                      ? "border-accent bg-accent/10"
                      : "border-border text-muted-foreground hover:border-accent",
                  ].join(" ")}
                >
                  {ENTRANCE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {fitsAtAll ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  Дом: запад ↔ восток
                </span>
                <input
                  type="range"
                  className="w-full accent-[#c6a15a]"
                  min={range.minX}
                  max={Math.max(range.minX, range.maxX)}
                  step={1}
                  value={plot.houseX}
                  onChange={(e) => setPlot((p) => ({ ...p, houseX: Number(e.target.value) }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Дом: север ↔ юг</span>
                <input
                  type="range"
                  className="w-full accent-[#c6a15a]"
                  min={range.minZ}
                  max={Math.max(range.minZ, range.maxZ)}
                  step={1}
                  value={plot.houseZ}
                  onChange={(e) => setPlot((p) => ({ ...p, houseZ: Number(e.target.value) }))}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPlot((p) => ({ ...p, ...centerHouse(modules, p) }))}
              >
                <Crosshair className="size-4" /> По центру
              </Button>
            </div>
          ) : (
            <p className="rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              Дом {`шириной ${boundsLabel(modules)}`} не помещается на такой участок с отступами{" "}
              {plot.setbackM} м. Увеличьте размеры участка или вернитесь и уменьшите дом.
            </p>
          )}

          <Button
            size="lg"
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            disabled={!fits}
            onClick={() => onDone(plot, fits)}
          >
            Участок готов — к фасаду <ArrowRight />
          </Button>
        </div>
      </div>
    </StepShell>
  );
}

function boundsLabel(modules: ModuleItem[]): string {
  const ground = modules.filter((m) => m.floor === 0);
  if (!ground.length) return "";
  const w =
    Math.max(...ground.map((m) => m.x + MODULE_SIDE_M)) - Math.min(...ground.map((m) => m.x));
  const d =
    Math.max(...ground.map((m) => m.z + MODULE_SIDE_M)) - Math.min(...ground.map((m) => m.z));
  return `${w} × ${d} м`;
}

/** Схема участка: SVG в метрах, 1 юнит = 1 м. */
function PlotScheme({
  modules,
  plot,
  fits,
}: {
  modules: ModuleItem[];
  plot: PlotSpec;
  fits: boolean;
}) {
  const pad = 2;
  const vbW = plot.widthM + pad * 2;
  const vbH = plot.depthM + pad * 2;
  const ground = modules.filter((m) => m.floor === 0);
  const upper = modules.filter((m) => m.floor > 0);

  const grid = useMemo(() => {
    const lines: { v: number; major: boolean }[] = [];
    for (let v = 1; v < Math.max(plot.widthM, plot.depthM); v += 1) {
      lines.push({ v, major: v % 5 === 0 });
    }
    return lines;
  }, [plot.widthM, plot.depthM]);

  // Маркер въезда: полоска на соответствующей стороне.
  const entrance = (() => {
    const cx = plot.widthM / 2;
    const cz = plot.depthM / 2;
    switch (plot.entranceSide) {
      case "north":
        return { x: cx - 2, y: -0.9, w: 4, h: 0.9 };
      case "south":
        return { x: cx - 2, y: plot.depthM, w: 4, h: 0.9 };
      case "west":
        return { x: -0.9, y: cz - 2, w: 0.9, h: 4 };
      case "east":
        return { x: plot.widthM, y: cz - 2, w: 0.9, h: 4 };
      default:
        return null;
    }
  })();

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="w-full rounded-sm border border-border bg-[#eef1ea]"
      role="img"
      aria-label={`Схема участка ${plot.widthM} на ${plot.depthM} метров с посадкой дома`}
    >
      <g transform={`translate(${pad} ${pad})`}>
        {/* Участок и сетка 1 м */}
        <rect
          x={0}
          y={0}
          width={plot.widthM}
          height={plot.depthM}
          fill="#e5eadd"
          stroke="#5b6152"
          strokeWidth={0.25}
        />
        {grid.map(({ v, major }) => (
          <g
            key={v}
            stroke={major ? "rgba(0,0,0,0.1)" : "rgba(0,0,0,0.045)"}
            strokeWidth={major ? 0.07 : 0.045}
          >
            {v < plot.widthM && <line x1={v} y1={0} x2={v} y2={plot.depthM} />}
            {v < plot.depthM && <line x1={0} y1={v} x2={plot.widthM} y2={v} />}
          </g>
        ))}

        {/* Зона отступов */}
        <rect
          x={plot.setbackM}
          y={plot.setbackM}
          width={Math.max(0, plot.widthM - plot.setbackM * 2)}
          height={Math.max(0, plot.depthM - plot.setbackM * 2)}
          fill="none"
          stroke="#b45309"
          strokeWidth={0.14}
          strokeDasharray="0.9 0.6"
        />

        {/* Въезд */}
        {entrance && (
          <rect
            {...{ x: entrance.x, y: entrance.y, width: entrance.w, height: entrance.h }}
            fill="#8a8f85"
            rx={0.2}
          />
        )}

        {/* Дом */}
        <g transform={`translate(${plot.houseX} ${plot.houseZ})`}>
          {ground.map((m) => (
            <rect
              key={m.id}
              x={m.x + 0.1}
              y={m.z + 0.1}
              width={MODULE_SIDE_M - 0.2}
              height={MODULE_SIDE_M - 0.2}
              rx={0.15}
              fill={fits ? ROLES[m.role].plan : "#d88"}
              stroke={fits ? "rgba(0,0,0,0.3)" : "#b91c1c"}
              strokeWidth={0.1}
            />
          ))}
          {upper.map((m) => (
            <rect
              key={m.id}
              x={m.x + 0.35}
              y={m.z + 0.35}
              width={MODULE_SIDE_M - 0.7}
              height={MODULE_SIDE_M - 0.7}
              fill="none"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={0.1}
              strokeDasharray="0.5 0.3"
            />
          ))}
        </g>

        {/* Компас и масштаб */}
        <g transform={`translate(${plot.widthM - 1.6} 2)`} fontSize={1.1} fontWeight={700}>
          <text textAnchor="middle" fill="#333">
            С
          </text>
          <line x1={0} y1={0.4} x2={0} y2={2} stroke="#333" strokeWidth={0.12} />
        </g>
        <g transform={`translate(1 ${plot.depthM - 1})`}>
          <line x1={0} y1={0} x2={5} y2={0} stroke="#333" strokeWidth={0.16} />
          <text x={2.5} y={-0.4} textAnchor="middle" fontSize={0.9} fill="#333">
            5 м
          </text>
        </g>
      </g>
    </svg>
  );
}
