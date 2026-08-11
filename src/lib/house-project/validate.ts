import { findModuleDefinition } from "./catalog.ts";
import {
  defOf,
  gapBetween,
  isSingleBuilding,
  localFace,
  overlapAreaMm2,
  rectOf,
  supportAreaMm2,
  touching,
} from "./geometry.ts";
import type { HouseModel, HouseProject, ValidationIssue } from "./types.ts";
import { FACE_IDS } from "./types.ts";

/**
 * Проверка модели.
 *
 * Разделение на ошибки и предупреждения проведено по одному признаку:
 * ошибка — это то, что физически невозможно или сломает чтение проекта
 * (модули занимают один объём, проём вышел за стену, дублируются
 * идентификаторы). Предупреждение — то, что возможно, но требует решения
 * инженера: маленькая опора, проём вплотную к углу, зазор между модулями,
 * размер, введённый руками вместо варианта из стандарта.
 *
 * Ошибка блокирует публикацию. Предупреждение — нет: запретить публикацию
 * из-за правила, у которого в исходниках нет подтверждения, значит выдать
 * догадку за норматив.
 */

/** Минимальная доля опоры модуля верхнего этажа, ниже которой предупреждаем. */
export const MIN_SUPPORT_RATIO = 0.5;

/** Зазор меньше этого считается ошибкой стыковки, а не задуманным разрывом. */
export const SUSPICIOUS_GAP_MM = 200;

function issue(
  level: ValidationIssue["level"],
  code: string,
  message: string,
  targetId?: string,
): ValidationIssue {
  return { level, code, message, targetId };
}

/** Проверка одной модели дома. Проект целиком проверяет `validateProject`. */
export function validateModel(model: HouseModel): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const modules = model.modules;

  if (!modules.length) {
    out.push(issue("error", "empty", "В проекте нет ни одного модуля"));
    return out;
  }

  /* --- Идентификаторы ------------------------------------------------ */

  const moduleIds = new Set<string>();
  for (const m of modules) {
    if (moduleIds.has(m.id)) {
      out.push(
        issue("error", "duplicate-module-id", `Модуль с id «${m.id}» встречается дважды`, m.id),
      );
    }
    moduleIds.add(m.id);
  }

  const openingIds = new Set<string>();
  for (const o of model.openings) {
    if (openingIds.has(o.id)) {
      out.push(
        issue("error", "duplicate-opening-id", `Проём с id «${o.id}» встречается дважды`, o.id),
      );
    }
    openingIds.add(o.id);
  }

  /* --- Модули --------------------------------------------------------- */

  for (const m of modules) {
    const def = findModuleDefinition(m.moduleTypeId);
    if (!def) {
      out.push(
        issue("error", "unknown-module-type", `Неизвестный тип модуля «${m.moduleTypeId}»`, m.id),
      );
      continue;
    }
    if (!def.allowedRotations.includes(m.rotationDeg)) {
      out.push(
        issue("error", "bad-rotation", `Поворот ${m.rotationDeg}° недопустим для этого типа`, m.id),
      );
    }
    if (m.mirrored && !def.mirrorAllowed) {
      out.push(
        issue(
          "error",
          "mirror-forbidden",
          "Этот тип модуля отражать нельзя — меняется разводка",
          m.id,
        ),
      );
    }
    if (m.floor < 0 || !Number.isInteger(m.floor)) {
      out.push(issue("error", "bad-floor", `Некорректный этаж: ${m.floor}`, m.id));
    }
    for (const key of ["x", "y"] as const) {
      if (!Number.isFinite(m.positionMm[key])) {
        out.push(issue("error", "bad-position", "Координата модуля не число", m.id));
      }
    }
  }

  /* --- Пересечения ---------------------------------------------------- */

  const wall = defOf(modules[0]).wallThicknessMm;
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i];
      const b = modules[j];
      if (a.floor !== b.floor) continue;
      const ra = rectOf(a);
      const rb = rectOf(b);
      const area = overlapAreaMm2(ra, rb);
      if (area <= 0) continue;

      // Наложение ровно на толщину стены — это общая стена, законный стык.
      const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
      const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
      if (Math.min(overlapX, overlapY) === wall) continue;

      out.push(
        issue(
          "error",
          "modules-intersect",
          `Модули «${a.id}» и «${b.id}» занимают один объём (наложение ${Math.round(
            Math.min(overlapX, overlapY),
          )} мм)`,
          a.id,
        ),
      );
    }
  }

  /* --- Зазоры --------------------------------------------------------- */

  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i];
      const b = modules[j];
      const gap = gapBetween(a, b);
      if (gap === null || gap <= 0) continue;
      if (gap < SUSPICIOUS_GAP_MM) {
        out.push(
          issue(
            "warning",
            "small-gap",
            `Между модулями «${a.id}» и «${b.id}» щель ${Math.round(gap)} мм — скорее всего, промах привязки`,
            a.id,
          ),
        );
      }
    }
  }

  /* --- Связность и опирание ------------------------------------------- */

  if (!isSingleBuilding(modules)) {
    out.push(
      issue(
        "error",
        "not-single-building",
        "Модули не образуют одно здание: часть стоит отдельно и ни с чем не стыкуется",
      ),
    );
  }

  const usedFloors = [...new Set(modules.map((m) => m.floor))].sort((x, y) => x - y);
  for (let i = 1; i < usedFloors.length; i += 1) {
    if (usedFloors[i] !== usedFloors[i - 1] + 1) {
      out.push(
        issue(
          "error",
          "floor-gap",
          `Этаж ${usedFloors[i] + 1} есть, а этажа ${usedFloors[i - 1] + 2} под ним нет`,
        ),
      );
    }
  }

  for (const m of modules) {
    if (m.floor === 0) continue;
    const support = supportAreaMm2(m, modules);
    const r = rectOf(m);
    const area = r.w * r.h;
    if (support <= 0) {
      out.push(
        issue(
          "error",
          "no-support",
          `Модуль «${m.id}» на этаже ${m.floor + 1} стоит без опоры`,
          m.id,
        ),
      );
      continue;
    }
    const ratio = support / area;
    if (ratio < MIN_SUPPORT_RATIO) {
      out.push(
        issue(
          "warning",
          "weak-support",
          `Модуль «${m.id}» опирается на ${Math.round(ratio * 100)}% площади — консоль требует расчёта конструктора`,
          m.id,
        ),
      );
    }
  }

  /* --- Проёмы --------------------------------------------------------- */

  const byId = new Map(modules.map((m) => [m.id, m]));
  const perFace = new Map<string, typeof model.openings>();

  for (const o of model.openings) {
    const m = byId.get(o.moduleId);
    if (!m) {
      out.push(
        issue(
          "error",
          "opening-orphan",
          `Проём «${o.id}» ссылается на несуществующий модуль`,
          o.id,
        ),
      );
      continue;
    }
    if (!FACE_IDS.includes(o.faceId)) {
      out.push(issue("error", "opening-bad-face", `У проёма «${o.id}» неизвестная грань`, o.id));
      continue;
    }
    const def = defOf(m);
    if (!def.allowedOpenings.includes(o.kind)) {
      out.push(
        issue(
          "error",
          "opening-kind-forbidden",
          `Проём такого типа недопустим в этом модуле`,
          o.id,
        ),
      );
    }

    const span = localFace(def, o.faceId).spanMm;
    if (o.widthMm <= 0 || o.heightMm <= 0) {
      out.push(issue("error", "opening-degenerate", `У проёма «${o.id}» нулевой размер`, o.id));
    }
    if (o.offsetMm < 0 || o.offsetMm + o.widthMm > span) {
      out.push(
        issue(
          "error",
          "opening-out-of-wall",
          `Проём «${o.id}» выходит за пределы грани ${o.faceId} (${span} мм)`,
          o.id,
        ),
      );
    } else {
      const margin = def.restriction.edgeMarginMm;
      if (o.offsetMm < margin || span - (o.offsetMm + o.widthMm) < margin) {
        out.push(
          issue(
            "warning",
            "opening-corner-pier",
            `Проём «${o.id}» ближе ${margin} мм к углу. ${def.restriction.reason}`,
            o.id,
          ),
        );
      }
    }

    if (o.sillMm < 0 || o.sillMm + o.heightMm > def.clearHeightMm) {
      out.push(
        issue(
          "error",
          "opening-too-tall",
          `Проём «${o.id}»: низ ${o.sillMm} + высота ${o.heightMm} выходит за высоту помещения ${def.clearHeightMm} мм`,
          o.id,
        ),
      );
    }

    if (!o.variantId) {
      out.push(
        issue(
          "warning",
          "opening-manual-size",
          `Размер проёма «${o.id}» введён вручную и не привязан к варианту из стандарта — нужна сверка с чертежом`,
          o.id,
        ),
      );
    }

    const key = `${o.moduleId}::${o.faceId}`;
    const list = perFace.get(key) ?? [];
    list.push(o);
    perFace.set(key, list);
  }

  for (const [, list] of perFace) {
    const sorted = [...list].sort((a, b) => a.offsetMm - b.offsetMm);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.offsetMm + prev.widthMm > cur.offsetMm) {
        out.push(
          issue(
            "error",
            "openings-overlap",
            `Проёмы «${prev.id}» и «${cur.id}» накладываются`,
            cur.id,
          ),
        );
      }
    }
  }

  /* --- Основание ------------------------------------------------------ */

  if (model.foundation.clearanceMm < 0) {
    out.push(issue("error", "bad-foundation", "Отрицательный просвет основания"));
  }
  if (model.foundation.kind === "piles" && model.foundation.pileGridMm == null) {
    out.push(
      issue(
        "warning",
        "pile-grid-unknown",
        "Шаг свай не задан. В исходных проектах его нет — расстановку определяет конструктор",
      ),
    );
  }

  return out;
}

/**
 * Полная проверка проекта: модель плюс то, без чего нельзя показать карточку.
 *
 * `forPublication` включает проверку полей каталога. При сохранении черновика
 * они не нужны — черновик на то и черновик.
 */
export function validateProject(
  project: HouseProject,
  opts: { forPublication?: boolean } = {},
): ValidationIssue[] {
  const out = validateModel(project.model);

  if (!project.title.trim()) out.push(issue("error", "no-title", "У проекта нет названия"));
  if (!/^[a-z0-9-]+$/.test(project.slug)) {
    out.push(
      issue(
        "error",
        "bad-slug",
        "Адрес страницы может содержать только латиницу в нижнем регистре, цифры и дефис",
      ),
    );
  }

  if (opts.forPublication) {
    if (!project.publication.coverImage) {
      out.push(issue("error", "no-cover", "Для каталога нужна обложка"));
    }
    if (!project.description?.trim()) {
      out.push(issue("error", "no-description", "Для каталога нужно описание"));
    }
  }

  return out;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
