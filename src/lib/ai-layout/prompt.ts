/**
 * Сборка промпта для генерации планировки.
 *
 * Промпт собирается ТОЛЬКО из проверенных полей: произвольный текст
 * пользователя в модель не уходит. Версия промпта входит в идемпотентный
 * ключ, поэтому смена шаблона автоматически даёт новую генерацию, а не
 * подсовывает старый результат.
 */

import { ENTRANCE_LABELS, type EntranceSide, type Footprint } from "./footprint.ts";
import { MODULE_HEIGHT_M, MODULE_SIDE_M } from "../constructor/constants.ts";
import { MODULE } from "../standards/ecocub.ts";
import { patternBriefing } from "../standards/patterns.ts";
import { matchReference, referenceBriefing } from "../standards/library.ts";

/**
 * Версия v3 добавила в промпт разбор построенных проектов: где оказывается
 * мокрая зона, какое остекление у общей комнаты, чем терраса отличается от
 * пристройки. Контур модель держала и раньше, а внутри рисовала абстрактную
 * квартиру.
 *
 * Версия v4 добавила подбор: к собранному дому подбирается ближайший по
 * площади и форме реальный проект, и его решение уходит в промпт целиком.
 * Модель больше не изобретает планировку с нуля — она пересаживает готовую
 * на новый контур. Когда похожего проекта нет, блок не добавляется вовсе:
 * образец не того масштаба хуже, чем никакого.
 */
export const PROMPT_VERSION = "v4-reference";

/** Программа помещений — то немногое, что задаёт человек. */
export interface LayoutProgram {
  bedrooms: number;
  bathrooms: number;
  residents?: number;
  /** Только из фиксированного списка ниже — свободного текста нет. */
  extraRooms: ExtraRoom[];
  entrance: EntranceSide | null;
}

export const EXTRA_ROOMS = ["office", "wardrobe", "utility", "laundry", "pantry"] as const;
export type ExtraRoom = (typeof EXTRA_ROOMS)[number];

export const EXTRA_ROOM_LABELS: Record<ExtraRoom, string> = {
  office: "кабинет",
  wardrobe: "гардеробная",
  utility: "техпомещение",
  laundry: "постирочная",
  pantry: "кладовая",
};

const EXTRA_ROOM_EN: Record<ExtraRoom, string> = {
  office: "home office",
  wardrobe: "walk-in closet",
  utility: "technical room",
  laundry: "laundry room",
  pantry: "pantry",
};

const ENTRANCE_EN: Record<EntranceSide, string> = {
  north: "top (north) side",
  east: "right (east) side",
  south: "bottom (south) side",
  west: "left (west) side",
};

export const MAX_BEDROOMS = 6;
export const MAX_BATHROOMS = 4;

/** Границы программы: больше комнат, чем влезает, модель всё равно не нарисует. */
export function clampProgram(program: LayoutProgram, footprint: Footprint): LayoutProgram {
  // Ориентир: на спальню с долей общих зон нужно примерно 18 м².
  const maxByArea = Math.max(1, Math.floor(footprint.areaM2 / 18));
  return {
    bedrooms: clamp(program.bedrooms, 1, Math.min(MAX_BEDROOMS, maxByArea)),
    bathrooms: clamp(program.bathrooms, 1, MAX_BATHROOMS),
    residents: program.residents ? clamp(program.residents, 1, 12) : undefined,
    extraRooms: program.extraRooms.filter((r) => EXTRA_ROOMS.includes(r)).slice(0, 3),
    entrance: program.entrance,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * Текст промпта. Критичные факты продублированы и на исходном PNG, и здесь:
 * модель охотнее удерживает геометрию, когда видит её дважды.
 */
export function buildLayoutPrompt(footprint: Footprint, program: LayoutProgram): string {
  const extra = program.extraRooms.map((r) => EXTRA_ROOM_EN[r]).join(", ");
  const programText = [
    `${program.bedrooms} bedroom${program.bedrooms > 1 ? "s" : ""}`,
    `${program.bathrooms} bathroom${program.bathrooms > 1 ? "s" : ""}`,
    "one open kitchen-living room",
    "an entrance hall",
    extra || null,
  ]
    .filter(Boolean)
    .join(", ");

  const entranceText = program.entrance
    ? `Main entrance is on the ${ENTRANCE_EN[program.entrance]}, exactly where the reference image shows the gap in the outer wall.`
    : "Place the main entrance on the longest exterior wall.";

  // Габарит модуля берётся из констант конструктора, а не пишется числом:
  // на исходном контуре нарисованы именно они, и текст обязан совпадать с
  // картинкой. Толщина стены и высота — из стандарта, они от раскладки не
  // зависят.
  const moduleText = `The house is assembled from ${footprint.modules.length} concrete modules of ${MODULE_SIDE_M} x ${MODULE_SIDE_M} m each; overall footprint is ${footprint.widthM} x ${footprint.depthM} m, total ${footprint.areaM2} m2, ceiling height ${MODULE_HEIGHT_M} m.`;

  // Ближайший построенный проект. Может не найтись — тогда остаются одни
  // паттерны, и это нормальный режим, а не деградация.
  const match = matchReference({
    footprintM2: footprint.areaM2,
    moduleCount: footprint.moduleCount,
    widthM: footprint.widthM,
    depthM: footprint.depthM,
    bedrooms: program.bedrooms,
  });
  const reference = match ? `\n${referenceBriefing(match)}\n` : "";

  const patterns = patternBriefing({
    externalWidthMm: MODULE_SIDE_M * 1000,
    externalDepthMm: MODULE_SIDE_M * 1000,
    wallThicknessMm: MODULE.wallThicknessMm,
    clearHeightMm: MODULE_HEIGHT_M * 1000,
  });

  return `Use the uploaded image as an immutable building footprint and exact top-down reference.

READING THE REFERENCE:
- The white area enclosed by the thick black outline is the building. It has ${footprint.walls.length} exterior wall segments and is NOT a plain rectangle.
- The dark area is outside the building. It is not part of the house and must stay dark and completely empty.
- Thin gray lines inside the white area are module joints, not walls.

STRICT GEOMETRY RULES:
- Do not change, crop, bend, expand, shrink or simplify the exterior footprint.
- Never fill in, square off or extend the notches and cut-outs: the dark area must keep exactly the same shape.
- Keep every exterior corner, recess, projection and module boundary in exactly the same position.
- Create the layout only inside the black exterior boundary.
- Do not draw any rooms, furniture, landscape or annotations outside the footprint.
- Keep the same orientation, proportions and aspect ratio as the source image.

DESIGN TASK:
Create one believable residential concept floor plan for a modular concrete house.
Required program: ${programText}.
${entranceText}
${moduleText}

${patterns}
${reference}
LAYOUT REQUIREMENTS:
- Add rational interior partitions, interior doors with opening arcs, windows, kitchen equipment, bathroom fixtures and furniture at believable architectural scale.
- Group kitchen, bathrooms and technical plumbing zones rationally.
- Keep clear circulation paths and avoid collisions with doors and windows.
- Every bedroom must have usable access and a window when the exterior geometry allows it.
- Make the kitchen-living room visually clear and usable.
- Prefer a simple, buildable layout over decorative complexity.

VISUAL STYLE:
- Strict orthographic top-down 2D floor plan.
- Professional minimal architectural presentation.
- White background, thin black and gray lines, restrained pale neutral furniture.
- No perspective, no axonometry, no exterior landscape, no decorative frame, no photorealistic rendering.
- Do not add measurements, logos or marketing text.
- Do not add any text labels.

This is a concept visualization, not a construction drawing.`;
}

/** Короткая человекочитаемая сводка программы — для интерфейса и заявки. */
export function describeProgram(program: LayoutProgram): string {
  const parts = [
    `${program.bedrooms} спальни`,
    `${program.bathrooms} санузла`,
    ...program.extraRooms.map((r) => EXTRA_ROOM_LABELS[r]),
  ];
  if (program.entrance) parts.push(`вход с ${ENTRANCE_LABELS[program.entrance]} стороны`);
  return parts.join(", ");
}
