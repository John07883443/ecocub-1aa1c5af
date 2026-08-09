import { useCallback, useMemo, useRef, useState } from "react";
import type { Cell, ModuleItem, Role } from "./types";
import {
  canPlace,
  computeStats,
  gridSizeForSotki,
  occupancy,
  orphansAfterRemoval,
} from "./geometry";
import {
  DEFAULT_SOTKI,
  DESIGN_PRESETS,
  MAX_FLOORS,
  MAX_SOTKI,
  MIN_SOTKI,
  TEMPLATES,
} from "./constants";

let idCounter = 0;
const newId = () => `m${++idCounter}`;

/** Центрирует стартовую планировку на текущей сетке. */
function seedsToModules(templateId: string, n: number): ModuleItem[] {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return [];
  const minX = Math.min(...tpl.seeds.map((s) => s.x));
  const maxX = Math.max(...tpl.seeds.map((s) => s.x));
  const minZ = Math.min(...tpl.seeds.map((s) => s.z));
  const maxZ = Math.max(...tpl.seeds.map((s) => s.z));
  const offX = Math.max(0, Math.floor((n - (maxX - minX + 1)) / 2)) - minX;
  const offZ = Math.max(0, Math.floor((n - (maxZ - minZ + 1)) / 2)) - minZ;
  return tpl.seeds.map((s) => ({
    id: newId(),
    x: s.x + offX,
    z: s.z + offZ,
    floor: s.floor,
    role: s.role,
  }));
}

/** Каскадное удаление «повисших» модулей после изменения нижних этажей. */
function dropOrphans(modules: ModuleItem[]): ModuleItem[] {
  let kept = modules;
  for (;;) {
    const occ = occupancy(kept);
    const orphans = kept.filter((m) => m.floor > 0 && !occ.has(`${m.floor - 1}:${m.x}:${m.z}`));
    if (!orphans.length) return kept;
    const ids = new Set(orphans.map((o) => o.id));
    kept = kept.filter((m) => !ids.has(m.id));
  }
}

export function useHouseBuilder(basePricePerM2: number) {
  const [sotki, setSotkiState] = useState(DEFAULT_SOTKI);
  const gridN = useMemo(() => gridSizeForSotki(sotki), [sotki]);

  const [modules, setModules] = useState<ModuleItem[]>(() =>
    seedsToModules("l-family", gridSizeForSotki(DEFAULT_SOTKI)),
  );
  const [floor, setFloor] = useState(0);
  const [role, setRole] = useState<Role>("living");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignId] = useState(DESIGN_PRESETS[0].id);

  const design = useMemo(
    () => DESIGN_PRESETS.find((d) => d.id === designId) ?? DESIGN_PRESETS[0],
    [designId],
  );

  const stats = useMemo(
    () => computeStats(modules, sotki, basePricePerM2),
    [modules, sotki, basePricePerM2],
  );

  // Занятость нужна плану, чтобы подсвечивать доступные для 2-го этажа ячейки.
  const occ = useMemo(() => occupancy(modules), [modules]);

  const lastError = useRef<string | null>(null);

  const setSotki = useCallback((next: number) => {
    const clamped = Math.max(MIN_SOTKI, Math.min(MAX_SOTKI, Math.round(next)));
    const n = gridSizeForSotki(clamped);
    // Убираем модули, вышедшие за уменьшенную сетку, и осиротевшие верхние.
    setModules((prev) => dropOrphans(prev.filter((m) => m.x < n && m.z < n)));
    setSotkiState(clamped);
  }, []);

  const placeAtCell = useCallback(
    (cell: Cell) => {
      lastError.current = null;
      setModules((prev) => {
        if (!canPlace(prev, { ...cell, floor }, gridN)) {
          lastError.current =
            floor > 0
              ? "Верхний этаж ставится только поверх модулей этажом ниже"
              : "Здесь модуль не помещается";
          return prev;
        }
        return [...prev, { id: newId(), x: cell.x, z: cell.z, floor, role }];
      });
    },
    [floor, role, gridN],
  );

  const removeModule = useCallback((id: string) => {
    setModules((prev) => {
      const orphans = orphansAfterRemoval(prev, id);
      const drop = new Set<string>([id, ...orphans.map((o) => o.id)]);
      return prev.filter((m) => !drop.has(m.id));
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const selectModule = useCallback((id: string | null) => setSelectedId(id), []);

  const setModuleRole = useCallback((id: string, nextRole: Role) => {
    setModules((prev) => prev.map((m) => (m.id === id ? { ...m, role: nextRole } : m)));
  }, []);

  const loadTemplate = useCallback(
    (templateId: string) => {
      setModules(seedsToModules(templateId, gridN));
      setSelectedId(null);
      setFloor(0);
    },
    [gridN],
  );

  const clearAll = useCallback(() => {
    setModules([]);
    setSelectedId(null);
    setFloor(0);
  }, []);

  const canGoUp = floor < MAX_FLOORS - 1;

  return {
    // состояние
    sotki,
    gridN,
    modules,
    floor,
    role,
    selectedId,
    design,
    designId,
    stats,
    occ,
    canGoUp,
    lastError,
    // действия
    setSotki,
    setFloor,
    setRole,
    setDesignId,
    placeAtCell,
    removeModule,
    selectModule,
    setModuleRole,
    loadTemplate,
    clearAll,
  };
}

export type HouseBuilderApi = ReturnType<typeof useHouseBuilder>;
