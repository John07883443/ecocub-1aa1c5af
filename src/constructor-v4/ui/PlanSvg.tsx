/**
 * 2D-план из той же модели (engine/plan.ts): по ярусу, в мм, север вверх.
 * Стены в масштабе и в серых тонах: наружные тёмные, стык — две тонкие стены
 * модулей с зазором; двери прорезают стены и показаны дугой; порталы внутри
 * помещения — раскрытый стык; вход — крыльцо с подписью.
 */
import { useEffect, useRef, useState } from "react";
import { planFromProject } from "../engine/plan.ts";
import { bbox, footprint } from "../engine/geometry.ts";
import { carportPlace } from "../engine/site.ts";
import type { Project } from "../engine/types.ts";
import { labelFontMm } from "./plan-labels.ts";

const FURN_LABEL: Record<string, string> = {
  bed: "кровать",
  "kitchen-run": "кухня",
  sofa: "диван",
  "dining-table": "стол",
  shower: "душ",
  wc: "",
  sink: "",
  boiler: "бойлер",
  desk: "стол",
  stairs: "лестница",
  tv: "ТВ",
  nightstand: "",
  wardrobe: "гардероб",
  litter: "лоток",
};

const WALL_FILL = { exterior: "#4a4a4a", "joint-b2b": "#8c8c8c", partition: "#a3a3a3" } as const;

export function PlanSvg({
  project,
  tier,
  selectedRoomId,
  onPickRoom,
  highlight,
  highlightKey,
}: {
  project: Project;
  tier: number;
  selectedRoomId?: string | null;
  onPickRoom?: (roomId: string) => void;
  /** Кубики, которые только что поменялись (подсветка правки). */
  highlight?: string[];
  highlightKey?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pxPerMm, setPxPerMm] = useState(0);
  const plan = planFromProject(project);
  const mods = project.modules.filter((m) => m.tier === tier);
  const carport = tier === 1 ? carportPlace(project) : null;
  const b = bbox([...project.modules.map(footprint), ...(carport ? [carport.rect] : [])]);
  const pad = 2200;
  const vbW = b.x1 - b.x0 + 2 * pad;
  const vbH = b.y1 - b.y0 + 2 * pad;
  const vb = `${b.x0 - pad} ${-(b.y1 + pad)} ${vbW} ${vbH}`;
  // Сколько пикселей экрана в 1 мм плана (preserveAspectRatio=meet) — для читаемых подписей.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setPxPerMm(Math.min(r.width / vbW, r.height / vbH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vbW, vbH]);
  if (!mods.length)
    return <p className="p-4 text-sm text-neutral-500">На ярусе {tier} кубиков нет.</p>;
  const fs = (baseMm: number, minPx: number) => labelFontMm(baseMm, minPx, pxPerMm);
  const R = (r: { x0: number; y0: number; x1: number; y1: number }) => ({
    x: r.x0,
    y: -r.y1,
    width: r.x1 - r.x0,
    height: r.y1 - r.y0,
  });
  const T = <T extends { tier: number }>(xs: T[]) => xs.filter((x) => x.tier === tier);
  return (
    <svg
      ref={svgRef}
      viewBox={vb}
      className="h-full w-full bg-white"
      role="img"
      aria-label={`План яруса ${tier}`}
    >
      {/* Навес для машины — на участке, вне модулей */}
      {carport && (
        <g>
          <rect
            {...R(carport.rect)}
            fill="#eceae6"
            stroke="#8a857c"
            strokeWidth={20}
            strokeDasharray="160 90"
          />
          <text
            x={(carport.rect.x0 + carport.rect.x1) / 2}
            y={-(carport.rect.y0 + carport.rect.y1) / 2}
            fontSize={fs(240, 12)}
            textAnchor="middle"
            fill="#5f5a52"
            fontWeight={600}
          >
            Навес
          </text>
          <text
            x={(carport.rect.x0 + carport.rect.x1) / 2}
            y={-(carport.rect.y0 + carport.rect.y1) / 2 + fs(240, 12) * 1.2}
            fontSize={fs(200, 11)}
            textAnchor="middle"
            fill="#5f5a52"
          >
            машина
          </text>
        </g>
      )}
      {/* Крыльцо у входа */}
      {T(plan.entrances).map((e) => (
        <g key={e.doorId}>
          <rect {...R(e.porch)} fill="#e7dccb" stroke="#b9a88f" strokeWidth={14} />
          <text
            x={e.at.x}
            y={-e.at.y + 60}
            fontSize={fs(190, 12)}
            textAnchor="middle"
            fill="#6b5a43"
            fontWeight={600}
          >
            {e.label}
          </text>
        </g>
      ))}
      {/* Пол: весь кубик, поверх — стены. Зазор между стенами стыка остаётся светлым. */}
      {mods.map((m) => {
        const room = project.rooms.find((r) => r.moduleIds.includes(m.id));
        const sel = !!room && room.id === selectedRoomId;
        return (
          <rect
            key={m.id}
            {...R(footprint(m))}
            fill={sel ? "#fde9c8" : "#faf7f1"}
            style={onPickRoom ? { cursor: "pointer" } : undefined}
            onClick={room && onPickRoom ? () => onPickRoom(room.id) : undefined}
          >
            {room ? <title>{`Выбрать: ${room.id}`}</title> : null}
          </rect>
        );
      })}
      {T(plan.furniture).map((f) => (
        <g key={f.id}>
          <rect
            {...R(f.rect)}
            fill={f.kind === "litter" ? "#f3e6d3" : "none"}
            stroke={f.kind === "litter" ? "#a5824f" : "#b5ab9d"}
            strokeWidth={16}
            pointerEvents="none"
          />
          {FURN_LABEL[f.kind] ? (
            <text
              x={(f.rect.x0 + f.rect.x1) / 2}
              y={-(f.rect.y0 + f.rect.y1) / 2 + fs(150, 11) / 3}
              fontSize={fs(150, 11)}
              textAnchor="middle"
              fill={f.kind === "litter" ? "#7a5a2c" : "#8f8577"}
              fontWeight={f.kind === "tv" || f.kind === "litter" ? 600 : 400}
              pointerEvents="none"
            >
              {FURN_LABEL[f.kind]}
            </text>
          ) : null}
        </g>
      ))}
      {T(plan.walls).map((w) => (
        <rect key={w.id} {...R(w.drawRect)} fill={WALL_FILL[w.kind]} />
      ))}
      {/* Порталы внутри помещения — раскрытый стык, пунктир по линии стыка */}
      {T(plan.portals)
        .filter((p) => p.kind === "open")
        .map((p) => (
          <line
            key={p.id}
            x1={p.a.x}
            y1={-p.a.y}
            x2={p.b.x}
            y2={-p.b.y}
            stroke="#d8cfc2"
            strokeWidth={14}
            strokeDasharray="120 90"
          />
        ))}
      {T(plan.windows).map((w) => (
        <rect
          key={w.id}
          {...R(w.rect)}
          fill={w.heightMm === 3150 ? "#8cc0e6" : "#c3def2"}
          stroke="#4a4a4a"
          strokeWidth={10}
        />
      ))}
      {T(plan.doors).map((d) => {
        const r = d.widthMm;
        return (
          <g key={d.id}>
            <line
              x1={d.hinge.x}
              y1={-d.hinge.y}
              x2={d.leafEnd.x}
              y2={-d.leafEnd.y}
              stroke={d.kind === "entrance" ? "#6b3f1d" : "#333"}
              strokeWidth={d.kind === "entrance" ? 40 : 26}
            />
            <path
              d={`M ${d.leafEnd.x} ${-d.leafEnd.y} A ${r} ${r} 0 0 0 ${d.closedEnd.x} ${-d.closedEnd.y}`}
              fill="none"
              stroke="#555"
              strokeWidth={12}
              strokeDasharray="50 35"
            />
          </g>
        );
      })}
      {T(plan.rooms).map((r) => (
        <g key={r.id}>
          <text
            x={r.labelAt.x}
            y={-r.labelAt.y - 60}
            fontSize={fs(230, 13)}
            textAnchor="middle"
            fill="#222"
            fontWeight={600}
            pointerEvents="none"
          >
            {r.label}
          </text>
          <text
            x={r.labelAt.x}
            y={-r.labelAt.y + 60 + fs(200, 12)}
            fontSize={fs(200, 12)}
            textAnchor="middle"
            fill="#555"
            pointerEvents="none"
          >
            {r.areaM2.toLocaleString("ru-RU")} м²
          </text>
        </g>
      ))}
      <text
        x={b.x0 - pad + 200}
        y={-(b.y1 + pad) + 200 + fs(260, 14)}
        fontSize={fs(260, 14)}
        fill="#b3261e"
      >
        ↑ С
      </text>
      {/* Подсветка правки: только что добавленные/изменённые кубики */}
      {highlight?.length ? (
        <g key={`hl-${highlightKey ?? 0}`} pointerEvents="none">
          <style>{`@keyframes plan-hl{0%{opacity:1}100%{opacity:0}}`}</style>
          {mods
            .filter((m) => highlight.includes(m.id))
            .map((m) => (
              <rect
                key={m.id}
                {...R(footprint(m))}
                fill="rgba(245,158,11,0.28)"
                stroke="#d97706"
                strokeWidth={90}
                style={{ animation: "plan-hl 2.4s ease-out forwards" }}
              />
            ))}
        </g>
      ) : null}
    </svg>
  );
}

export default PlanSvg;
