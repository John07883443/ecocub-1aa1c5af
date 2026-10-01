/**
 * 2D-план из той же модели (engine/plan.ts): по ярусу, в мм, север вверх.
 * Стены в масштабе и в серых тонах: наружные тёмные, стык — две тонкие стены
 * модулей с зазором; двери прорезают стены и показаны дугой; порталы внутри
 * помещения — раскрытый стык; вход — крыльцо с подписью.
 */
import { planFromProject } from "../engine/plan.ts";
import { bbox, footprint } from "../engine/geometry.ts";
import type { Project } from "../engine/types.ts";

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
  nightstand: "",
};

const WALL_FILL = { exterior: "#4a4a4a", "joint-b2b": "#8c8c8c", partition: "#a3a3a3" } as const;

export function PlanSvg({ project, tier }: { project: Project; tier: number }) {
  const plan = planFromProject(project);
  const mods = project.modules.filter((m) => m.tier === tier);
  if (!mods.length)
    return <p className="p-4 text-sm text-neutral-500">На ярусе {tier} кубиков нет.</p>;
  const b = bbox(project.modules.map(footprint));
  const pad = 2200;
  const vb = `${b.x0 - pad} ${-(b.y1 + pad)} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}`;
  const R = (r: { x0: number; y0: number; x1: number; y1: number }) => ({
    x: r.x0,
    y: -r.y1,
    width: r.x1 - r.x0,
    height: r.y1 - r.y0,
  });
  const T = <T extends { tier: number }>(xs: T[]) => xs.filter((x) => x.tier === tier);
  return (
    <svg
      viewBox={vb}
      className="h-full w-full bg-white"
      role="img"
      aria-label={`План яруса ${tier}`}
    >
      {/* Крыльцо у входа */}
      {T(plan.entrances).map((e) => (
        <g key={e.doorId}>
          <rect {...R(e.porch)} fill="#e7dccb" stroke="#b9a88f" strokeWidth={14} />
          <text
            x={e.at.x}
            y={-e.at.y + 60}
            fontSize={190}
            textAnchor="middle"
            fill="#6b5a43"
            fontWeight={600}
          >
            {e.label}
          </text>
        </g>
      ))}
      {/* Пол: весь кубик, поверх — стены. Зазор между стенами стыка остаётся светлым. */}
      {mods.map((m) => (
        <rect key={m.id} {...R(footprint(m))} fill="#faf7f1" />
      ))}
      {T(plan.furniture).map((f) => (
        <g key={f.id}>
          <rect {...R(f.rect)} fill="none" stroke="#b5ab9d" strokeWidth={16} />
          {FURN_LABEL[f.kind] ? (
            <text
              x={(f.rect.x0 + f.rect.x1) / 2}
              y={-(f.rect.y0 + f.rect.y1) / 2 + 50}
              fontSize={150}
              textAnchor="middle"
              fill="#a99f91"
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
            fontSize={230}
            textAnchor="middle"
            fill="#222"
            fontWeight={600}
          >
            {r.label}
          </text>
          <text
            x={r.labelAt.x}
            y={-r.labelAt.y + 220}
            fontSize={200}
            textAnchor="middle"
            fill="#555"
          >
            {r.areaM2.toLocaleString("ru-RU")} м²
          </text>
        </g>
      ))}
      <text x={b.x0 - pad + 200} y={-(b.y1 + pad) + 400} fontSize={260} fill="#b3261e">
        ↑ С
      </text>
    </svg>
  );
}

export default PlanSvg;
