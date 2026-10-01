/**
 * Рендеры в две стадии.
 *
 * Стадия 1 — «паспорт объекта»: из нашего же 3D (r3f) снимаются фиксированные
 * ракурсы в «глине» (clay/whitebox) плюс карты глубины, рёбер и сегментации.
 * Детерминированно, бесплатно, геометрия точная. Здесь — только описание
 * камер и проходов; снимает их клиентский рендерер.
 *
 * Стадия 2 — фотореализм поверх видов стадии 1 (отделка, мебель, озеленение,
 * свет) через image-to-image со структурным контролем. Нужен эндпоинт,
 * принимающий входное изображение. У rgrouter `/v1/images/edits` для нашего
 * ключа закрыт (501), в каталоге только rg-gpt-image-2 / 2.5 — стадия 2
 * заблокирована; запасной путь — рендер по промпту с описанием геометрии из
 * паспорта и автопроверкой числа окон на кадре.
 */
import { GRAMMAR } from "../grammar/index.ts";
import { buildRenderPrompt } from "./render-prompt.ts";
import { bbox, footprint } from "./geometry.ts";
import type { Project, Side } from "./types.ts";

export type RenderPass = "clay" | "depth" | "edges" | "segmentation";
export type ViewKind = "facade" | "aerial" | "interior";

export interface CameraView {
  id: string;
  kind: ViewKind;
  label: string;
  /** Координаты в мм; z — высота над землёй. */
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
  side?: Side;
  roomId?: string;
  /** Сколько окон должно быть видно — для автопроверки фотореалистичного кадра. */
  expectedWindows: number;
}

export interface ViewSet {
  stage: 1;
  views: CameraView[];
  passes: RenderPass[];
  resolution: { w: number; h: number };
}

export interface Stage2Plan {
  status: "blocked" | "ready";
  endpoint: string;
  reason: string;
  fallback: string;
  model: string;
  maxRunsPerSession: number;
}

/**
 * Стадия 2 (image-to-image по 3D-снимку) — за флагом: когда rgrouter откроет
 * /v1/images/edits, ставим VITE_PILOT_STAGE2=1 (клиент) и PILOT_IMAGE_EDITS=1 (сервер).
 */
const stage2On = (() => {
  try {
    return (
      (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PILOT_STAGE2 === "1"
    );
  } catch {
    return false;
  }
})();

export const STAGE2: Stage2Plan = {
  status: stage2On ? "ready" : "blocked",
  endpoint: "rgrouter /v1/images/edits",
  reason:
    "Для нашего ключа /v1/images/edits отвечает 501; моделей, принимающих входное изображение, в каталоге нет.",
  fallback: "Рендер по промпту с геометрией из паспорта + автопроверка числа окон моделью зрения.",
  model: "rg-gpt-image-2.5",
  maxRunsPerSession: 2,
};

const EYE = 1700;

export function viewSet(p: Project): ViewSet {
  const b = bbox(p.modules.map(footprint));
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const tiers = Math.max(...p.modules.map((m) => m.tier));
  const h = tiers * GRAMMAR.module.externalMm.h;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const dist = Math.round(span * 1.4 + 6000);
  const windowsOn = (side: Side) =>
    p.openings.filter((o) => o.kind === "window" && o.face === side).length;
  const facade = (side: Side, label: string, dx: number, dy: number): CameraView => ({
    id: `facade-${side}`,
    kind: "facade",
    label,
    position: [Math.round(cx + dx * dist), Math.round(cy + dy * dist), EYE],
    target: [Math.round(cx), Math.round(cy), Math.round(h / 2)],
    fovDeg: 40,
    side,
    expectedWindows: windowsOn(side),
  });
  const views: CameraView[] = [
    facade("S", "Южный фасад", 0, -1),
    facade("E", "Восточный фасад", 1, 0),
    facade("N", "Северный фасад", 0, 1),
    facade("W", "Западный фасад", -1, 0),
    {
      id: "aerial",
      kind: "aerial",
      label: "Вид сверху на участок",
      position: [Math.round(cx - dist * 0.7), Math.round(cy - dist * 0.7), Math.round(dist * 0.9)],
      target: [Math.round(cx), Math.round(cy), 0],
      fovDeg: 45,
      expectedWindows: windowsOn("S") + windowsOn("W"),
    },
  ];
  for (const r of p.rooms.filter((x) => x.type === "kitchen-living" || x.type === "bedroom")) {
    const m = p.modules.find((x) => x.id === r.moduleIds[0]);
    if (!m) continue;
    const f = footprint(m);
    const z0 = (m.tier - 1) * GRAMMAR.module.externalMm.h + 300;
    views.push({
      id: `interior-${r.id}`,
      kind: "interior",
      label: r.type === "kitchen-living" ? "Кухня-гостиная" : "Спальня",
      position: [f.x0 + 500, f.y0 + 500, z0 + 1500],
      target: [Math.round((f.x0 + f.x1) / 2) + 600, Math.round((f.y0 + f.y1) / 2) + 600, z0 + 1200],
      fovDeg: 70,
      roomId: r.id,
      expectedWindows: p.openings.filter((o) => o.roomId === r.id && o.kind === "window").length,
    });
  }
  return {
    stage: 1,
    views,
    passes: ["clay", "depth", "edges", "segmentation"],
    resolution: { w: 1536, h: 1024 },
  };
}

/** Промпт запасного пути стадии 2: точная геометрия дома словами (render-prompt.ts). */
export function promptFor(
  p: Project,
  view: CameraView,
  context: { timeOfDay?: string; season?: string } = {},
): string {
  return buildRenderPrompt(p, view, context);
}
