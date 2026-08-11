import { useCallback, useMemo, useReducer } from "react";
import { findOpeningPreset, OPENING_PRESETS } from "./catalog.ts";
import { createModule, newId } from "./factory.ts";
import { footprintOf, localFace, defOf } from "./geometry.ts";
import { bandCandidates, mergeBand } from "./opening-band.ts";
import { placeOnFace, presetWidthOn } from "./opening-place.ts";
import { freeSpotNear, newOverlaps } from "./overlap.ts";
import type {
  FaceId,
  HouseProject,
  ModuleInstance,
  OpeningInstance,
  RotationDeg,
} from "./types.ts";

/**
 * Состояние редактора: сам проект плюс история отмены.
 *
 * История хранит целые снимки проекта, а не команды. Снимок дороже по
 * памяти, но проект — это десятки объектов, а не гигабайты; зато отмена
 * гарантированно возвращает ровно то состояние, что было, и не зависит от
 * того, правильно ли написана обратная операция для каждой команды.
 * Обратные операции ошибаются молча, и обнаруживается это через месяц.
 *
 * Глубина истории ограничена: без ограничения вкладка, открытая на день,
 * съедает память снимками, которые никто не отменит.
 */

const HISTORY_LIMIT = 60;

export interface EditorState {
  project: HouseProject;
  past: HouseProject[];
  future: HouseProject[];
  /** Выделенные модули. Групповые операции работают по этому набору. */
  selection: string[];
  selectedOpeningId: string | null;
  activeFloor: number;
  /** Есть ли несохранённые изменения. */
  dirty: boolean;
  /**
   * Последнее отклонённое действие.
   *
   * Редуктор не умеет показывать сообщения, а молча ничего не делать хуже
   * ошибки: человек решит, что сломалась мышь. Поэтому причина кладётся в
   * состояние, а интерфейс на неё смотрит. Номер нужен, чтобы два одинаковых
   * отказа подряд считались двумя событиями, а не одним.
   */
  rejection: { seq: number; reason: string } | null;
}

export type EditorAction =
  | { type: "load"; project: HouseProject }
  | { type: "saved"; project: HouseProject }
  | { type: "add-module"; x: number; y: number }
  | { type: "move-modules"; moves: { id: string; x: number; y: number }[] }
  | { type: "patch-module"; id: string; patch: Partial<ModuleInstance> }
  | { type: "rotate"; ids: string[]; direction: 1 | -1 }
  | { type: "mirror"; ids: string[] }
  | { type: "delete-modules"; ids: string[] }
  | { type: "duplicate-modules"; ids: string[] }
  | { type: "move-to-floor"; ids: string[]; floor: number }
  | {
      type: "add-opening";
      moduleId: string;
      faceId: FaceId;
      presetId: string;
      /** Куда попал курсор вдоль грани, мм. Без него проём встаёт по центру. */
      alongMm?: number;
    }
  | { type: "patch-opening"; id: string; patch: Partial<OpeningInstance> }
  | { type: "merge-band"; openingId: string; neighbourId: string }
  | { type: "split-band"; id: string }
  | { type: "delete-opening"; id: string }
  | { type: "patch-project"; patch: Partial<HouseProject> }
  | { type: "select"; ids: string[] }
  | { type: "select-opening"; id: string | null }
  | { type: "set-floor"; floor: number }
  | { type: "undo" }
  | { type: "redo" };

function withHistory(state: EditorState, next: HouseProject): EditorState {
  return {
    ...state,
    past: [...state.past, state.project].slice(-HISTORY_LIMIT),
    future: [],
    project: { ...next, updatedAt: new Date().toISOString() },
    dirty: true,
    rejection: null,
  };
}

/**
 * Застава против наложения модулей.
 *
 * Стоит здесь, а не в каждом обработчике мыши, и это принципиально. Способов
 * сдвинуть модуль много: перетаскивание, ввод координаты числом, поворот,
 * дублирование, перенос на этаж. Проверять наложение в каждом из них значит
 * рано или поздно забыть про один — и запрет, который действует «почти
 * всегда», не запрет вовсе. Через редуктор проходят все, и проверка одна.
 *
 * Сравнивается с прежним состоянием: если наложение уже лежало в проекте
 * (старая запись, импорт чужого JSON), чинить его должно быть можно.
 */
function guardOverlap(
  state: EditorState,
  next: HouseProject,
  extra?: Partial<EditorState>,
): EditorState {
  const added = newOverlaps(state.project.model.modules, next.model.modules);
  if (added.length) {
    return {
      ...state,
      rejection: {
        seq: (state.rejection?.seq ?? 0) + 1,
        reason:
          added.length === 1
            ? "Модули наложились бы друг на друга — так дом не собрать"
            : `Наложение сразу в ${added.length} местах — так дом не собрать`,
      },
    };
  }
  return { ...withHistory(state, next), ...extra };
}

function mapModules(
  project: HouseProject,
  fn: (m: ModuleInstance) => ModuleInstance,
): HouseProject {
  return { ...project, model: { ...project.model, modules: project.model.modules.map(fn) } };
}

/** Поворот по кругу: 0 → 90 → 180 → 270 → 0. */
function turn(deg: RotationDeg, direction: 1 | -1): RotationDeg {
  const order: RotationDeg[] = [0, 90, 180, 270];
  const i = order.indexOf(deg);
  return order[(i + direction + 4) % 4];
}

/**
 * Проём по пресету на указанной грани.
 *
 * Если известно, куда попал курсор, проём встаёт серединой в эту точку — так
 * работает бросок из панели инструментов на стену. Если нет, проём встаёт по
 * центру грани: это единственное положение, которое не требует догадки.
 * В обоих случаях он держится в пределах чистой длины стены и не наезжает на
 * угловой простенок толщиной 210 мм.
 *
 * Проектировщик затем вводит смещение с чертежа — и валидация напомнит, что
 * размер, не привязанный к варианту из стандарта, нужно сверить.
 */
function openingFromPreset(
  module: ModuleInstance,
  faceId: FaceId,
  presetId: string,
  alongMm?: number,
): OpeningInstance | null {
  const preset = findOpeningPreset(presetId) ?? OPENING_PRESETS[0];
  if (!preset) return null;
  const span = localFace(defOf(module), faceId).spanMm;
  const wall = defOf(module).wallThicknessMm;
  const width = presetWidthOn(module, faceId, presetId);
  const placed = placeOnFace(span, alongMm ?? span / 2, width, wall);
  return {
    id: newId("o"),
    moduleId: module.id,
    faceId,
    kind: preset.kind,
    offsetMm: placed.offsetMm,
    widthMm: placed.widthMm,
    heightMm: preset.heightMm,
    sillMm: preset.sillMm,
    variantId: preset.variantId,
    note: preset.note,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const project = state.project;

  switch (action.type) {
    case "load":
      return {
        project: action.project,
        past: [],
        future: [],
        selection: [],
        selectedOpeningId: null,
        activeFloor: 0,
        dirty: false,
        rejection: null,
      };

    case "saved":
      // Сервер вернул запись с новым номером версии. История не трогается:
      // отменять правки после сохранения — законное желание.
      return { ...state, project: action.project, dirty: false };

    case "add-module": {
      const m = createModule(action.x, action.y, state.activeFloor);
      return guardOverlap(
        state,
        { ...project, model: { ...project.model, modules: [...project.model.modules, m] } },
        { selection: [m.id] },
      );
    }

    case "move-modules": {
      const byId = new Map(action.moves.map((mv) => [mv.id, mv]));
      return guardOverlap(
        state,
        mapModules(project, (m) => {
          const mv = byId.get(m.id);
          return mv ? { ...m, positionMm: { x: Math.round(mv.x), y: Math.round(mv.y) } } : m;
        }),
      );
    }

    case "patch-module":
      return guardOverlap(
        state,
        mapModules(project, (m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      );

    case "rotate": {
      const ids = new Set(action.ids);
      return guardOverlap(
        state,
        mapModules(project, (m) =>
          ids.has(m.id) ? { ...m, rotationDeg: turn(m.rotationDeg, action.direction) } : m,
        ),
      );
    }

    case "mirror": {
      const ids = new Set(action.ids);
      return guardOverlap(
        state,
        mapModules(project, (m) => {
          if (!ids.has(m.id)) return m;
          // Отражение разрешено не всем типам: проверка в валидации, но не
          // дать поставить заведомо запрещённое состояние дешевле, чем потом
          // объяснять ошибку.
          if (!defOf(m).mirrorAllowed) return m;
          return { ...m, mirrored: !m.mirrored };
        }),
      );
    }

    case "delete-modules": {
      const ids = new Set(action.ids);
      const modules = project.model.modules.filter((m) => !ids.has(m.id));
      // Проёмы удалённых модулей уходят вместе с ними: висящая ссылка сделала
      // бы проект нечитаемым при следующем открытии.
      const openings = project.model.openings.filter((o) => !ids.has(o.moduleId));
      return {
        ...withHistory(state, { ...project, model: { ...project.model, modules, openings } }),
        selection: [],
        selectedOpeningId: null,
      };
    }

    case "duplicate-modules": {
      const ids = new Set(action.ids);
      const copies: ModuleInstance[] = [];
      const openings = [...project.model.openings];
      for (const m of project.model.modules) {
        if (!ids.has(m.id)) continue;
        const f = footprintOf(m);
        const copy: ModuleInstance = {
          ...m,
          id: newId("m"),
          // Копия появляется рядом, а не поверх оригинала: наложенные друг на
          // друга модули невозможно разделить мышью.
          positionMm: { x: m.positionMm.x + f.widthMm, y: m.positionMm.y },
        };
        // Место справа почти всегда занято соседом. Требовать от человека
        // сначала расчистить его — глупость: копия сама обходит занятое.
        const spot = freeSpotNear(copy, [...project.model.modules, ...copies]);
        if (!spot) continue;
        copy.positionMm = spot;
        copies.push(copy);
        for (const o of project.model.openings) {
          if (o.moduleId !== m.id) continue;
          openings.push({ ...o, id: newId("o"), moduleId: copy.id });
        }
      }
      if (!copies.length) {
        return {
          ...state,
          rejection: {
            seq: (state.rejection?.seq ?? 0) + 1,
            reason: "Рядом нет свободного места для копии",
          },
        };
      }
      return guardOverlap(
        state,
        {
          ...project,
          model: { ...project.model, modules: [...project.model.modules, ...copies], openings },
        },
        { selection: copies.map((c) => c.id) },
      );
    }

    case "move-to-floor": {
      const ids = new Set(action.ids);
      const floor = Math.max(0, action.floor);
      return guardOverlap(
        state,
        mapModules(project, (m) => (ids.has(m.id) ? { ...m, floor } : m)),
        { activeFloor: floor },
      );
    }

    case "add-opening": {
      const module = project.model.modules.find((m) => m.id === action.moduleId);
      if (!module) return state;
      const opening = openingFromPreset(module, action.faceId, action.presetId, action.alongMm);
      if (!opening) return state;
      return {
        ...withHistory(state, {
          ...project,
          model: { ...project.model, openings: [...project.model.openings, opening] },
        }),
        selectedOpeningId: opening.id,
      };
    }

    case "merge-band": {
      // Кандидат пересчитывается здесь, а не приходит готовым из интерфейса.
      // Подсказка про объединение живёт во всплывающем сообщении несколько
      // секунд, и за это время окно могли подвинуть или изменить: применять
      // рассчитанное «тогда» смещение значило бы промахнуться молча.
      const candidate = bandCandidates(project.model, action.openingId).find(
        (c) => c.neighbourId === action.neighbourId,
      );
      if (!candidate) return state;

      // Оба окна правятся одним шагом истории: объединение — это одно
      // действие человека, и отменяться оно должно одним нажатием.
      const patches = mergeBand(project.model, candidate, newId("band"));
      if (!patches.length) return state;
      const byId = new Map(patches.map((p) => [p.id, p]));
      return {
        ...withHistory(state, {
          ...project,
          model: {
            ...project.model,
            openings: project.model.openings.map((o) => {
              const p = byId.get(o.id);
              return p ? { ...o, offsetMm: p.offsetMm, widthMm: p.widthMm, bandId: p.bandId } : o;
            }),
          },
        }),
        selectedOpeningId: candidate.openingId,
      };
    }

    case "split-band": {
      // Разъединение снимает только метку. Ширину назад не отматываем: за
      // время в ленте её могли поменять, и «вернуть как было» означало бы
      // выкинуть чужую правку.
      const target = project.model.openings.find((o) => o.id === action.id);
      if (!target?.bandId) return state;
      return withHistory(state, {
        ...project,
        model: {
          ...project.model,
          openings: project.model.openings.map((o) =>
            o.bandId === target.bandId ? { ...o, bandId: undefined } : o,
          ),
        },
      });
    }

    case "patch-opening":
      return withHistory(state, {
        ...project,
        model: {
          ...project.model,
          openings: project.model.openings.map((o) =>
            o.id === action.id ? { ...o, ...action.patch } : o,
          ),
        },
      });

    case "delete-opening":
      return {
        ...withHistory(state, {
          ...project,
          model: {
            ...project.model,
            openings: project.model.openings.filter((o) => o.id !== action.id),
          },
        }),
        selectedOpeningId: null,
      };

    case "patch-project":
      return withHistory(state, { ...project, ...action.patch });

    case "select":
      return { ...state, selection: action.ids, selectedOpeningId: null };

    case "select-opening":
      return { ...state, selectedOpeningId: action.id };

    case "set-floor":
      return { ...state, activeFloor: Math.max(0, action.floor) };

    case "undo": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        dirty: true,
      };
    }

    case "redo": {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        ...state,
        project: next,
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        dirty: true,
      };
    }

    default:
      return state;
  }
}

export function useDesignEditor(initial: HouseProject) {
  const [state, dispatch] = useReducer(editorReducer, {
    project: initial,
    past: [],
    future: [],
    selection: [],
    selectedOpeningId: null,
    activeFloor: 0,
    dirty: false,
    rejection: null,
  });

  const floors = useMemo(() => {
    const used = new Set(state.project.model.modules.map((m) => m.floor));
    used.add(0);
    used.add(state.activeFloor);
    return [...used].sort((a, b) => a - b);
  }, [state.project.model.modules, state.activeFloor]);

  const selectedModules = useMemo(
    () => state.project.model.modules.filter((m) => state.selection.includes(m.id)),
    [state.project.model.modules, state.selection],
  );

  const selectedOpening = useMemo(
    () => state.project.model.openings.find((o) => o.id === state.selectedOpeningId) ?? null,
    [state.project.model.openings, state.selectedOpeningId],
  );

  const act = useCallback((action: EditorAction) => dispatch(action), []);

  return {
    state,
    dispatch: act,
    floors,
    selectedModules,
    selectedOpening,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

export type DesignEditor = ReturnType<typeof useDesignEditor>;
