/** 2D-план из той же модели (engine/plan.ts): по ярусу, в мм, север вверх. */
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

export function PlanSvg({ project, tier }: { project: Project; tier: number }) {
  const plan = planFromProject(project);
  const mods = project.modules.filter((m) => m.tier === tier);
  if (!mods.length)
    return <p className="p-4 text-sm text-neutral-500">На ярусе {tier} кубиков нет.</p>;
  const b = bbox(project.modules.map(footprint));
  const pad = 800;
  const vb = `${b.x0 - pad} ${-(b.y1 + pad)} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}`;
  const R = (r: { x0: number; y0: number; x1: number; y1: number }) => ({
    x: r.x0,
    y: -r.y1,
    width: r.x1 - r.x0,
    height: r.y1 - r.y0,
  });
  return (
    <svg
      viewBox={vb}
      className="h-full w-full bg-white"
      role="img"
      aria-label={`План яруса ${tier}`}
    >
      {plan.rooms
        .filter((r) => r.tier === tier)
        .flatMap((r) =>
          r.clearRects.map((c, i) => <rect key={`${r.id}-${i}`} {...R(c)} fill="#faf7f1" />),
        )}
      {plan.furniture
        .filter((f) => f.tier === tier)
        .map((f) => (
          <g key={f.id}>
            <rect {...R(f.rect)} fill="none" stroke="#9a8f80" strokeWidth={18} />
            {FURN_LABEL[f.kind] ? (
              <text
                x={(f.rect.x0 + f.rect.x1) / 2}
                y={-(f.rect.y0 + f.rect.y1) / 2}
                fontSize={170}
                textAnchor="middle"
                fill="#9a8f80"
              >
                {FURN_LABEL[f.kind]}
              </text>
            ) : null}
          </g>
        ))}
      {plan.walls
        .filter((w) => w.tier === tier)
        .map((w) => (
          <rect key={w.id} {...R(w.rect)} fill={w.kind === "partition" ? "#777" : "#2b2b2b"} />
        ))}
      {plan.windows
        .filter((w) => w.tier === tier)
        .map((w) => (
          <rect
            key={w.id}
            {...R(w.rect)}
            fill={w.heightMm === 3150 ? "#7fb6e0" : "#b9d8ef"}
            stroke="#2b2b2b"
            strokeWidth={10}
          />
        ))}
      {plan.doors
        .filter((d) => d.tier === tier)
        .map((d) => {
          const r = d.widthMm;
          const sweep = 0;
          return (
            <g key={d.id}>
              <line
                x1={d.hinge.x}
                y1={-d.hinge.y}
                x2={d.closedEnd.x}
                y2={-d.closedEnd.y}
                stroke="#fff"
                strokeWidth={200}
              />
              <line
                x1={d.hinge.x}
                y1={-d.hinge.y}
                x2={d.leafEnd.x}
                y2={-d.leafEnd.y}
                stroke="#2b2b2b"
                strokeWidth={22}
              />
              <path
                d={`M ${d.leafEnd.x} ${-d.leafEnd.y} A ${r} ${r} 0 0 ${sweep} ${d.closedEnd.x} ${-d.closedEnd.y}`}
                fill="none"
                stroke="#2b2b2b"
                strokeWidth={10}
                strokeDasharray="40 30"
              />
            </g>
          );
        })}
      {plan.rooms
        .filter((r) => r.tier === tier)
        .map((r) => (
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
      <text x={b.x0 - pad + 150} y={-(b.y1 + pad) + 350} fontSize={260} fill="#b3261e">
        ↑ С
      </text>
    </svg>
  );
}

export default PlanSvg;
