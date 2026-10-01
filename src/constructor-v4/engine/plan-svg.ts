/**
 * План яруса строкой SVG — без React. Нужен там, где нет браузера: критику на
 * сервере (картинка для модели зрения) и скрипту оценки моделей. Рисует ту же
 * модель, что PlanSvg.tsx: пол, стены, окна, двери, мебель с подписями, комнаты.
 */
import { planFromProject } from "./plan.ts";
import { bbox, footprint, type Rect } from "./geometry.ts";
import { carportPlace } from "./site.ts";
import type { Project } from "./types.ts";

const LABEL: Record<string, string> = {
  bed: "кровать",
  "kitchen-run": "кухня",
  sofa: "диван",
  "dining-table": "стол",
  shower: "душ",
  boiler: "бойлер",
  desk: "стол",
  stairs: "лестница",
  tv: "ТВ",
  wardrobe: "гардероб",
  litter: "лоток",
};
const WALL = { exterior: "#4a4a4a", "joint-b2b": "#8c8c8c", partition: "#a3a3a3" } as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function planSvgString(p: Project, tier = 1, widthPx = 1200): string {
  const plan = planFromProject(p);
  const mods = p.modules.filter((m) => m.tier === tier);
  const carport = tier === 1 ? carportPlace(p) : null;
  const b = bbox([...p.modules.map(footprint), ...(carport ? [carport.rect] : [])]);
  const pad = 2200;
  const vbW = b.x1 - b.x0 + 2 * pad;
  const vbH = b.y1 - b.y0 + 2 * pad;
  const heightPx = Math.round((widthPx * vbH) / vbW);
  const k = widthPx / vbW;
  const fs = (minPx: number) => Math.ceil(minPx / k);
  const R = (r: Rect, extra: string) =>
    `<rect x="${r.x0}" y="${-r.y1}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" ${extra}/>`;
  const T = (x: number, y: number, size: number, text: string, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" font-family="sans-serif" ${extra}>${esc(text)}</text>`;
  const on = <X extends { tier: number }>(xs: X[]) => xs.filter((x) => x.tier === tier);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="${b.x0 - pad} ${-(b.y1 + pad)} ${vbW} ${vbH}">`,
    R({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }, `fill="#ffffff"`),
  ];
  if (carport)
    out.push(
      R(
        carport.rect,
        `fill="#eceae6" stroke="#8a857c" stroke-width="20" stroke-dasharray="160 90"`,
      ),
      T(
        (carport.rect.x0 + carport.rect.x1) / 2,
        -(carport.rect.y0 + carport.rect.y1) / 2,
        fs(14),
        "Навес · машина",
        `fill="#5f5a52"`,
      ),
    );
  for (const e of on(plan.entrances))
    out.push(
      R(e.porch, `fill="#e7dccb" stroke="#b9a88f" stroke-width="14"`),
      T(e.at.x, -e.at.y, fs(13), e.label, `fill="#6b5a43" font-weight="600"`),
    );
  for (const m of mods) out.push(R(footprint(m), `fill="#faf7f1"`));
  for (const f of on(plan.furniture)) {
    out.push(R(f.rect, `fill="none" stroke="#b5ab9d" stroke-width="16"`));
    if (LABEL[f.kind])
      out.push(
        T(
          (f.rect.x0 + f.rect.x1) / 2,
          -(f.rect.y0 + f.rect.y1) / 2,
          fs(11),
          LABEL[f.kind],
          `fill="#8f8577"`,
        ),
      );
  }
  for (const w of on(plan.walls)) out.push(R(w.drawRect, `fill="${WALL[w.kind]}"`));
  for (const w of on(plan.windows))
    out.push(
      R(
        w.rect,
        `fill="${w.heightMm === 3150 ? "#8cc0e6" : "#c3def2"}" stroke="#4a4a4a" stroke-width="10"`,
      ),
    );
  for (const d of on(plan.doors))
    out.push(
      `<line x1="${d.hinge.x}" y1="${-d.hinge.y}" x2="${d.leafEnd.x}" y2="${-d.leafEnd.y}" stroke="${d.kind === "entrance" ? "#6b3f1d" : "#333"}" stroke-width="${d.kind === "entrance" ? 40 : 26}"/>`,
      `<path d="M ${d.leafEnd.x} ${-d.leafEnd.y} A ${d.widthMm} ${d.widthMm} 0 0 0 ${d.closedEnd.x} ${-d.closedEnd.y}" fill="none" stroke="#555" stroke-width="12" stroke-dasharray="50 35"/>`,
    );
  for (const r of on(plan.rooms))
    out.push(
      T(r.labelAt.x, -r.labelAt.y - 60, fs(14), r.label, `fill="#222" font-weight="600"`),
      T(
        r.labelAt.x,
        -r.labelAt.y + 60 + fs(12),
        fs(12),
        `${r.areaM2.toLocaleString("ru-RU")} м²`,
        `fill="#555"`,
      ),
    );
  out.push(
    `<text x="${b.x0 - pad + 200}" y="${-(b.y1 + pad) + 200 + fs(16)}" font-size="${fs(16)}" fill="#b3261e" font-family="sans-serif">↑ С</text>`,
    "</svg>",
  );
  return out.join("");
}
