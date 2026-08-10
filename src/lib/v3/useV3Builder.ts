/**
 * Состояние редактора v3: совместимо с HouseBuilderApi (чтобы переиспользовать
 * боевые PlanEditor и Scene3D без их правки), плюс история undo/redo,
 * крупные действия и журнал изменений для объяснений и заявки.
 *
 * Любая мутация идёт через commit(): состояние всегда сериализуемо, а
 * недопустимые конфигурации отбрасываются валидатором ещё в builder-actions.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { HouseBuilderApi } from "../constructor/useHouseBuilder";
import type { ModuleItem, Role } from "../constructor/types";
import {
  anchorForPoint,
  canPlace,
  computeStats,
  dropUnsupported,
  gridSizeForSotki,
  maxAnchor,
  minAnchor,
  orphansAfterRemoval,
} from "../constructor/geometry";
import { DESIGN_PRESETS, MAX_FLOORS, MAX_SOTKI, MIN_SOTKI } from "../constructor/constants";
import {
  addRoleModule,
  addSecondFloor,
  mirrorHouse,
  nextModuleId,
  removeRoleModule,
} from "./builder-actions";
import { cellsToModules, findPlan } from "./plans";

const HISTORY_LIMIT = 60;

export interface V3BuilderApi extends HouseBuilderApi {
  /** Крупные действия основного режима. */
  bigAction: (
    action:
      | { type: "add-role"; role: Role; floor?: number; note?: string }
      | { type: "second-floor" }
      | { type: "mirror" }
      | { type: "remove-role"; role: Role },
  ) => { ok: boolean; message: string };
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Последнее человекочитаемое пояснение изменения. */
  lastNote: string | null;
  /** Журнал применённых действий (для заявки менеджеру). */
  appliedActions: string[];
  /** Загрузить план из библиотеки как стартовую конфигурацию. */
  loadPlan: (planId: string) => void;
  /** Восстановить произвольное состояние (из сохранённого проекта). */
  restore: (modules: ModuleItem[], designId: string) => void;
}

/** Центрирует модули плана на текущей сетке. */
function centerModules(modules: ModuleItem[], n: number): ModuleItem[] {
  if (!modules.length) return modules;
  const minX = Math.min(...modules.map((m) => m.x));
  const maxX = Math.max(...modules.map((m) => m.x));
  const minZ = Math.min(...modules.map((m) => m.z));
  const maxZ = Math.max(...modules.map((m) => m.z));
  // Центрируем внутри зоны застройки: дом отступает от границ участка.
  const min = minAnchor();
  const max = maxAnchor(n);
  const offX = min + Math.max(0, Math.round((max - min - (maxX - minX)) / 2)) - minX;
  const offZ = min + Math.max(0, Math.round((max - min - (maxZ - minZ)) / 2)) - minZ;
  return modules.map((m) => ({ ...m, x: m.x + offX, z: m.z + offZ }));
}

export function useV3Builder(
  basePricePerM2: number,
  onChange?: (modules: ModuleItem[], designId: string, actionLabel?: string) => void,
): V3BuilderApi {
  const [sotki, setSotkiState] = useState(10);
  const gridN = useMemo(() => gridSizeForSotki(sotki), [sotki]);

  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [floor, setFloor] = useState(0);
  const [role, setRole] = useState<Role>("living");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignIdState] = useState(DESIGN_PRESETS[0].id);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [appliedActions, setAppliedActions] = useState<string[]>([]);

  const [past, setPast] = useState<ModuleItem[][]>([]);
  const [future, setFuture] = useState<ModuleItem[][]>([]);

  const lastError = useRef<string | null>(null);

  const design = useMemo(
    () => DESIGN_PRESETS.find((d) => d.id === designId) ?? DESIGN_PRESETS[0],
    [designId],
  );
  const stats = useMemo(
    () => computeStats(modules, sotki, basePricePerM2),
    [modules, sotki, basePricePerM2],
  );

  /** Единая точка изменения модулей: история + автосохранение + журнал. */
  const commit = useCallback(
    (next: ModuleItem[], note?: string, logAction = true) => {
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), modules]);
      setFuture([]);
      setModules(next);
      if (note) {
        setLastNote(note);
        if (logAction) setAppliedActions((a) => [...a, note]);
      }
      onChange?.(next, designId, note);
    },
    [modules, designId, onChange],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [modules, ...f]);
      setModules(prev);
      setLastNote("Действие отменено");
      onChange?.(prev, designId, "undo");
      return p.slice(0, -1);
    });
  }, [modules, designId, onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, modules]);
      setModules(next);
      setLastNote("Действие возвращено");
      onChange?.(next, designId, "redo");
      return f.slice(1);
    });
  }, [modules, designId, onChange]);

  const bigAction = useCallback<V3BuilderApi["bigAction"]>(
    (action) => {
      const result =
        action.type === "add-role"
          ? addRoleModule(modules, action.role, action.floor ?? 0, gridN, action.note)
          : action.type === "second-floor"
            ? addSecondFloor(modules, gridN)
            : action.type === "mirror"
              ? mirrorHouse(modules, gridN)
              : removeRoleModule(modules, action.role);

      if (!result.ok) {
        setLastNote(result.error);
        return { ok: false, message: result.error };
      }
      commit(result.modules, result.note);
      return { ok: true, message: result.note };
    },
    [modules, gridN, commit],
  );

  /* ---- HouseBuilderApi-совместимые операции (режим «Точная настройка») ---- */

  const setSotki = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN_SOTKI, Math.min(MAX_SOTKI, Math.round(next)));
      const max = maxAnchor(gridSizeForSotki(clamped));
      const filtered = dropUnsupported(modules.filter((m) => m.x <= max && m.z <= max));
      if (filtered.length !== modules.length) {
        commit(filtered, "Участок уменьшен — модули за границей убраны", false);
      }
      setSotkiState(clamped);
    },
    [modules, commit],
  );

  const placeAtPoint = useCallback(
    (px: number, pz: number) => {
      lastError.current = null;
      const anchor = anchorForPoint(modules, px, pz, floor, gridN);
      if (!anchor) {
        lastError.current =
          floor > 0
            ? "Верхнему этажу нужна опора минимум на треть площади модуля"
            : "Здесь модуль не помещается";
        setLastNote(lastError.current);
        return;
      }
      commit(
        [...modules, { id: nextModuleId(), x: anchor.x, z: anchor.z, floor, role }],
        undefined,
        false,
      );
    },
    [modules, floor, role, gridN, commit],
  );

  const moveModule = useCallback(
    (id: string, x: number, z: number) => {
      lastError.current = null;
      const target = modules.find((m) => m.id === id);
      if (!target || (target.x === x && target.z === z)) return;
      const rest = modules.filter((m) => m.id !== id);
      const moved = { ...target, x, z };
      if (!canPlace(rest, moved, gridN)) {
        lastError.current = "Сюда модуль не помещается";
        setLastNote(lastError.current);
        return;
      }
      const next = [...rest, moved];
      if (dropUnsupported(next).length !== next.length) {
        lastError.current = "Так модули выше останутся без опоры";
        setLastNote(lastError.current);
        return;
      }
      commit(next, undefined, false);
    },
    [modules, gridN, commit],
  );

  const removeModule = useCallback(
    (id: string) => {
      const orphans = orphansAfterRemoval(modules, id);
      const drop = new Set<string>([id, ...orphans.map((o) => o.id)]);
      commit(
        modules.filter((m) => !drop.has(m.id)),
        undefined,
        false,
      );
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [modules, commit],
  );

  const selectModule = useCallback((id: string | null) => setSelectedId(id), []);

  const setModuleRole = useCallback(
    (id: string, nextRole: Role) => {
      commit(
        modules.map((m) => (m.id === id ? { ...m, role: nextRole } : m)),
        undefined,
        false,
      );
    },
    [modules, commit],
  );

  // Сигнатура совпадает с useState-сеттером боевого конструктора
  // (HouseBuilderApi), поэтому принимаем и значение, и функцию-обновление.
  const setDesignId = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (next) => {
      setDesignIdState((prev) => {
        const id = typeof next === "function" ? next(prev) : next;
        onChange?.(modules, id, "design");
        return id;
      });
    },
    [modules, onChange],
  );

  const loadPlan = useCallback(
    (planId: string) => {
      const plan = findPlan(planId);
      if (!plan) return;
      const centered = centerModules(cellsToModules(plan.cells), gridN);
      setPast([]);
      setFuture([]);
      setAppliedActions([]);
      setModules(centered);
      setSelectedId(null);
      setFloor(0);
      setLastNote(`Загружен план «${plan.name}»`);
      onChange?.(centered, designId, `load:${planId}`);
    },
    [gridN, designId, onChange],
  );

  const loadTemplate = useCallback(
    (templateId: string) => loadPlan(`template-${templateId}`),
    [loadPlan],
  );

  const restore = useCallback((nextModules: ModuleItem[], nextDesignId: string) => {
    setPast([]);
    setFuture([]);
    setModules(nextModules);
    if (DESIGN_PRESETS.some((d) => d.id === nextDesignId)) setDesignIdState(nextDesignId);
    setSelectedId(null);
    setFloor(0);
  }, []);

  const clearAll = useCallback(() => {
    commit([], "Участок очищен", false);
    setSelectedId(null);
    setFloor(0);
  }, [commit]);

  return {
    sotki,
    gridN,
    modules,
    floor,
    role,
    selectedId,
    design,
    designId,
    stats,
    canGoUp: floor < MAX_FLOORS - 1,
    lastError,
    setSotki,
    setFloor,
    setRole,
    setDesignId,
    placeAtPoint,
    moveModule,
    removeModule,
    selectModule,
    setModuleRole,
    loadTemplate,
    clearAll,
    // расширение v3
    bigAction,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    lastNote,
    appliedActions,
    loadPlan,
    restore,
  };
}
