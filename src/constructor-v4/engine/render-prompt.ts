/**
 * Промпт рендера по ТОЧНОМУ дому, пока у rgrouter закрыт images/edits (501):
 * пятно застройки в метрах, ярусы, консоли, окна по фасадам слева направо так,
 * как их видит камера, материалы из отделок (house-look.ts), терраса и навес,
 * простая ортогональная схема кубиков сверху и ближайший дом-образец из
 * слайдера и каталога eco-cub.ru. Модель картинок всё равно «примерно похоже» —
 * это честно пишется под кадром.
 */
import { GRAMMAR } from "../grammar/index.ts";
import { HERO_REFERENCES, CATALOG_REFERENCES, RENDER_STYLE_BASELINE } from "./house-style.ts";
import { bbox, footprint, supportOf, type Rect } from "./geometry.ts";
import { houseLook } from "./house-look.ts";
import { modulesOnTier, roomOf } from "./rules.ts";
import { carportPlace } from "./site.ts";
import type { CameraView } from "./render-plan.ts";
import type { ModulePlacement, Opening, Project, Side } from "./types.ts";

const m1 = (mm: number) => (Math.round(mm / 100) / 10).toFixed(1);

export type FootprintShape = "rectangle" | "L-shape" | "U-shape" | "complex";

/** Форма пятна яруса по сетке кубиков. */
export function footprintShape(mods: ModulePlacement[]): FootprintShape {
  if (!mods.length) return "rectangle";
  const rects = mods.map(footprint);
  const b = bbox(rects);
  const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  const fill = area / ((b.x1 - b.x0) * (b.y1 - b.y0));
  if (fill > 0.97) return "rectangle";
  // Пустые клетки сетки 400 мм: каких сторон пятна они касаются.
  const step = 400;
  const touches = new Set<string>();
  for (let x = b.x0 + step / 2; x < b.x1; x += step)
    for (let y = b.y0 + step / 2; y < b.y1; y += step) {
      if (rects.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) continue;
      if (x - b.x0 < step) touches.add("W");
      if (b.x1 - x < step) touches.add("E");
      if (y - b.y0 < step) touches.add("S");
      if (b.y1 - y < step) touches.add("N");
    }
  const t = [...touches];
  if (
    t.length === 2 &&
    !(t.includes("N") && t.includes("S")) &&
    !(t.includes("E") && t.includes("W"))
  )
    return "L-shape";
  if (t.length === 1) return "U-shape";
  return "complex";
}

export interface Archetype {
  heroId: string;
  heroTitle: string;
  catalogId: string;
  why: string;
}

/** Ближайший дом-образец: слайдер главной (форма и дух) + построенный проект каталога (размер). */
export function closestArchetype(p: Project): Archetype {
  const t1 = modulesOnTier(p, 1);
  const tiers = modulesOnTier(p, 2).length ? 2 : 1;
  const shape = footprintShape(t1);
  const b = bbox(t1.map(footprint));
  const aspect = Math.max(b.x1 - b.x0, b.y1 - b.y0) / Math.min(b.x1 - b.x0, b.y1 - b.y0);
  const look = houseLook(p);
  const heroId =
    tiers === 2
      ? "hero-7"
      : shape === "L-shape"
        ? "hero-4"
        : shape === "U-shape"
          ? "hero-5"
          : shape === "complex"
            ? "hero-3"
            : look.material === "concrete"
              ? "hero-2"
              : aspect >= 1.8
                ? "hero-1"
                : "hero-6";
  const cubes: Record<string, number> = {
    "weekend-one": 4,
    "sky-river": 7,
    "weekend-two": 10,
    "family-one": 12,
    "family-two": 14,
  };
  const catalogId = [...CATALOG_REFERENCES]
    .map((c) => c.id)
    .sort(
      (a, c) => Math.abs(cubes[a] - p.modules.length) - Math.abs(cubes[c] - p.modules.length),
    )[0];
  const hero = HERO_REFERENCES.find((h) => h.id === heroId)!;
  return {
    heroId,
    heroTitle: hero.title,
    catalogId,
    why: `${tiers === 2 ? "два яруса" : "один ярус"}, ${shape}, ${p.modules.length} кубиков`,
  };
}

const ROOM_LETTER: Record<string, string> = {
  "kitchen-living": "L",
  bedroom: "B",
  "wet-core": "W",
  study: "S",
  storage: "U",
  hall: "H",
  corridor: "C",
};

/** Схема сверху (север вверх): клетка = кубик 3,2 × 3,42 м; буквы — назначение. */
export function topViewGrid(p: Project, tier: number): string {
  const mods = modulesOnTier(p, tier);
  if (!mods.length) return "";
  const all = bbox(p.modules.map(footprint));
  const { w, d } = GRAMMAR.module.externalMm;
  const cols = Math.round((all.x1 - all.x0) / w);
  const rows = Math.round((all.y1 - all.y0) / d);
  const out: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const cx = all.x0 + c * w + w / 2;
      const cy = all.y0 + r * d + d / 2;
      const m = mods.find((x) => {
        const f = footprint(x);
        return cx >= f.x0 && cx < f.x1 && cy >= f.y0 && cy < f.y1;
      });
      line += m ? (ROOM_LETTER[roomOf(p, m.id)?.type ?? ""] ?? "#") : ".";
    }
    out.push(line);
  }
  return out.join("/");
}

/** Проёмы фасада слева направо, как их видит камера, стоящая перед этим фасадом. */
export function facadeOpenings(
  p: Project,
  side: Side,
): { tier: number; text: string; count: number }[] {
  const res: { tier: number; text: string; count: number }[] = [];
  for (const tier of [1, 2]) {
    const mods = modulesOnTier(p, tier);
    if (!mods.length) continue;
    const b = bbox(mods.map(footprint));
    const list = p.openings
      .filter(
        (o) =>
          o.face === side && o.kind !== "internal-door" && mods.some((m) => m.id === o.moduleId),
      )
      .map((o) => {
        const m = mods.find((x) => x.id === o.moduleId)!;
        const r = footprint(m);
        const start = (side === "N" || side === "S" ? r.x0 : r.y0) + o.offsetMm;
        const end = start + o.widthMm;
        // Слева направо для зрителя: юг — с запада на восток, север — с востока на запад,
        // восток — с юга на север, запад — с севера на юг.
        const len = side === "N" || side === "S" ? b.x1 - b.x0 : b.y1 - b.y0;
        const base = side === "N" || side === "S" ? b.x0 : b.y0;
        const from = side === "S" || side === "E" ? start - base : len - (end - base);
        return { o, from, len };
      })
      .sort((a, c) => a.from - c.from);
    if (!list.length) continue;
    const kind = (o: Opening) =>
      o.kind === "entrance"
        ? "entrance door"
        : o.heightMm >= 3150
          ? "floor-to-ceiling glazing"
          : o.heightMm >= 2800
            ? "tall window"
            : o.widthMm <= 500
              ? "narrow slot window"
              : "window";
    res.push({
      tier,
      count: list.filter((x) => x.o.kind === "window").length,
      text: list
        .map(
          (x) =>
            `${kind(x.o)} ${m1(x.o.widthMm)} m wide at ${m1(x.from)}–${m1(x.from + x.o.widthMm)} m`,
        )
        .join(", "),
    });
  }
  return res;
}

const SIDE_EN: Record<Side, string> = { N: "north", E: "east", S: "south", W: "west" };

function facadeLength(p: Project, side: Side, tier: number): number {
  const mods = modulesOnTier(p, tier);
  if (!mods.length) return 0;
  const b: Rect = bbox(mods.map(footprint));
  return side === "N" || side === "S" ? b.x1 - b.x0 : b.y1 - b.y0;
}

/** Описание массы дома словами (для промпта и для подписи «что рисуем»). */
export function massingDescription(p: Project): string {
  const t1 = modulesOnTier(p, 1);
  const t2 = modulesOnTier(p, 2);
  const b1 = bbox(t1.map(footprint));
  const parts = [
    `Single modular house of ${p.modules.length} identical box modules (each 3.2 × 3.42 m, 3.15 m tall).`,
    `Ground floor: ${t1.length} modules, ${footprintShape(t1)} footprint ${m1(b1.x1 - b1.x0)} m (east-west) × ${m1(b1.y1 - b1.y0)} m (north-south), one storey high (3.15 m).`,
  ];
  if (t2.length) {
    const b2 = bbox(t2.map(footprint));
    const over: Record<Side, number> = { N: 0, E: 0, S: 0, W: 0 };
    for (const u of t2) {
      const s = supportOf(u, t1);
      for (const k of Object.keys(over) as Side[]) over[k] = Math.max(over[k], s.overhangMm[k]);
    }
    const cant = (Object.keys(over) as Side[]).filter((k) => over[k] > 0);
    parts.push(
      `Upper floor: ${t2.length} modules, box ${m1(b2.x1 - b2.x0)} × ${m1(b2.y1 - b2.y0)} m on top (total height 6.3 m)${
        cant.length
          ? `, cantilevering ${cant.map((k) => `${m1(over[k])} m to the ${SIDE_EN[k]}`).join(" and ")}${p.overhangSupports?.length ? " on slim steel columns" : ""}`
          : ", fully resting on the ground floor"
      }.`,
    );
  } else parts.push("No upper floor: the whole house is one storey.");
  parts.push(
    `Top view, north up, row by row (L living, B bedroom, W bath, S study, U storage, H stair hall, . empty): ground ${topViewGrid(p, 1)}${t2.length ? `; upper ${topViewGrid(p, 2)}` : ""}.`,
  );
  return parts.join(" ");
}

/** Промпт кадра: камера + масса + проёмы фасада + материалы + терраса + образец. */
export function buildRenderPrompt(
  p: Project,
  view: CameraView,
  context: { timeOfDay?: string; season?: string } = {},
): string {
  const look = houseLook(p);
  const arch = closestArchetype(p);
  const hero = HERO_REFERENCES.find((h) => h.id === arch.heroId)!;
  const lines: string[] = [];
  lines.push(
    view.kind === "interior"
      ? `Photorealistic interior photo: ${view.label}, inside a modular concrete-module house.`
      : view.kind === "aerial"
        ? "Photorealistic aerial architectural photo from the south-west, 45° from above."
        : `Photorealistic architectural photo, eye level, straight-on view of the ${SIDE_EN[view.side ?? "S"]} facade.`,
  );
  if (view.kind !== "interior") {
    lines.push(massingDescription(p));
    const side = view.side ?? "S";
    for (const s of view.kind === "aerial" ? (["S", "W"] as Side[]) : [side]) {
      const fo = facadeOpenings(p, s);
      for (const f of fo)
        lines.push(
          `${SIDE_EN[s][0].toUpperCase()}${SIDE_EN[s].slice(1)} facade ${f.tier === 1 ? "ground floor" : "upper floor"} (${m1(facadeLength(p, s, f.tier))} m long), left to right: ${f.text}.`,
        );
      const total = fo.reduce((a, f) => a + f.count, 0);
      if (view.kind === "aerial")
        lines.push(`Exactly ${total} window(s) on the ${SIDE_EN[s]} facade, no more.`);
    }
    if (view.kind === "facade")
      lines.push(
        `exactly ${view.expectedWindows} window(s) on this facade, no more; the rest of the wall is solid.`,
      );
  } else {
    lines.push(`${view.expectedWindows} window(s) in this room; interior: ${look.interiorLabel}.`);
  }
  lines.push(
    `Materials: walls ${look.en.facade}${look.en.slats ? `, ${look.en.slats}` : ""}; ${look.en.roof}; ${look.en.frames}; flat roof only, never pitched.`,
  );
  if (view.kind !== "interior") {
    lines.push(
      p.terrace.totalM2 > 0
        ? `Wooden deck terrace ≈${Math.round(p.terrace.totalM2)} m² along the ${SIDE_EN[p.terrace.side]} side.`
        : "No terrace: lawn right up to the walls.",
    );
    const cp = carportPlace(p);
    if (cp)
      lines.push(
        `Flat-roof carport for one car on the ${SIDE_EN[cp.side]} side, 2 m from the house.`,
      );
  }
  lines.push(
    `Closest EcoCub reference: «${hero.title}» (${hero.form}; ${hero.glazing}); scale like the built project ${arch.catalogId}. Keep exactly the geometry above, do not add or remove volumes.`,
  );
  // Фирменная база — только когда материалы совпадают с ней; иначе — дух без материалов.
  lines.push(
    look.material === "plaster" || look.material === "concrete"
      ? RENDER_STYLE_BASELINE
      : "EcoCub spirit: thin flat roof slab with a slight overhang, calm minimalist volumes, warm evening light, pine and birch forest.",
  );
  lines.push(`${context.timeOfDay ?? "golden hour"}, ${context.season ?? "summer"}.`);
  return lines.join(" ").slice(0, 3900);
}
