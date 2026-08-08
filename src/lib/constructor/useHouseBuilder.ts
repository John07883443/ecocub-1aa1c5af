import { useCallback, useMemo, useRef, useState } from "react";
import type { Cell, ModuleItem, Orientation, Role } from "./types";
import {
  anchorForClick,
  canPlace,
  cellsOf,
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
  const cells: Cell[] = tpl.seeds.flatMap((s) => cellsOf(s));
  const minX = Math.min(...cells.map((c) => c.x));
  const maxX = Math.max(...cells.map((c) => c.x));
  const minZ = Math.min(...cells.map((c) => c.z));
  const maxZ = Math.max(...cells.map((c) => c.z));
  const offX = Math.max(0, Math.floor((n - (maxX - minX + 1)) / 2)) - minX;
  const offZ = Math.max(0, Math.floor((n - (maxZ - minZ + 1)) / 2)) - minZ;
  return tpl.seeds.map((s) => ({
    id: newId(),
    x: s.x + offX,
    z: s.z + offZ,
    floor: s.floor,
    orient: s.orient,
    role: s.role,
  }));
}

export function useHouseBuilder(basePricePerM2: number) {
  const [sotki, setSotkiState] = useState(DEFAULT_SOTKI);
  const gridN = useMemo(() => gridSizeForSotki(sotki), [sotki]);

  const [modules, setModules] = useState<ModuleItem[]>(() =>
    seedsToModules("l-family", gridSizeForSotki(DEFAULT_SOTKI)),
  );
  const [floor, setFloor] = useState(0);
  const [orient, setOrient] = useState<Orientation>("h");
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
    setModules((prev) => {
      // Убираем модули, вышедшие за уменьшенную сетку, и осиротевшие верхние.
      let kept = prev.filter((m) => cellsOf(m).every((c) => c.x < n && c.z < n));
      let orphans = kept
        .filter((m) => m.floor > 0)
        .filter((m) => {
          const belowOcc = occupancy(kept.filter((k) => k.floor === m.floor - 1));
          return cellsOf(m).some((c) => !belowOcc.has(`${m.floor - 1}:${c.x}:${c.z}`));
        });
      while (orphans.length) {
        const ids = new Set(orphans.map((o) => o.id));
        kept = kept.filter((m) => !ids.has(m.id));
        orphans = kept
          .filter((m) => m.floor > 0)
          .filter((m) => {
            const belowOcc = occupancy(kept.filter((k) => k.floor === m.floor - 1));
            return cellsOf(m).some((c) => !belowOcc.has(`${m.floor - 1}:${c.x}:${c.z}`));
          });
      }
      return kept;
    });
    setSotkiState(clamped);
  }, []);

  const placeAtCell = useCallback(
    (cell: Cell) => {
      lastError.current = null;
      setModules((prev) => {
        const anchor = anchorForClick(prev, cell, floor, orient, gridN);
        if (!anchor) {
          lastError.current =
            floor > 0
              ? "Второй этаж ставится только поверх модулей первого этажа"
              : "Здесь модуль не помещается";
          return prev;
        }
        const m: ModuleItem = { id: newId(), x: anchor.x, z: anchor.z, floor, orient, role };
        return [...prev, m];
      });
    },
    [floor, orient, role, gridN],
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

  const rotateModule = useCallback(
    (id: string) => {
      setModules((prev) => {
        const m = prev.find((x) => x.id === id);
        if (!m) return prev;
        const nextOrient: Orientation = m.orient === "h" ? "v" : "h";
        if (!canPlace(prev, { ...m, orient: nextOrient }, gridN, id)) {
          lastError.current = "Недостаточно места для поворота";
          return prev;
        }
        return prev.map((x) => (x.id === id ? { ...x, orient: nextOrient } : x));
      });
    },
    [gridN],
  );

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
    orient,
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
    setOrient,
    setRole,
    setDesignId,
    placeAtCell,
    removeModule,
    selectModule,
    setModuleRole,
    rotateModule,
    loadTemplate,
    clearAll,
  };
}

export type HouseBuilderApi = ReturnType<typeof useHouseBuilder>;
