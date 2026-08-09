import { useCallback, useMemo, useRef, useState } from "react";
import type { ModuleItem, Role } from "./types";
import {
  anchorForPoint,
  computeStats,
  gridSizeForSotki,
  maxAnchor,
  orphansAfterRemoval,
  supportArea,
} from "./geometry";
import {
  DEFAULT_SOTKI,
  DESIGN_PRESETS,
  MAX_FLOORS,
  MAX_SOTKI,
  MIN_SOTKI,
  MIN_SUPPORT_AREA,
  TEMPLATES,
} from "./constants";

let idCounter = 0;
const newId = () => `m${++idCounter}`;

/** Центрирует стартовую планировку на текущей сетке (координаты в метрах). */
function seedsToModules(templateId: string, n: number): ModuleItem[] {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return [];
  const minX = Math.min(...tpl.seeds.map((s) => s.x));
  const maxX = Math.max(...tpl.seeds.map((s) => s.x));
  const minZ = Math.min(...tpl.seeds.map((s) => s.z));
  const maxZ = Math.max(...tpl.seeds.map((s) => s.z));
  const max = maxAnchor(n);
  const offX = Math.max(0, Math.round((max - (maxX - minX)) / 2)) - minX;
  const offZ = Math.max(0, Math.round((max - (maxZ - minZ)) / 2)) - minZ;
  return tpl.seeds.map((s) => ({
    id: newId(),
    x: s.x + offX,
    z: s.z + offZ,
    floor: s.floor,
    role: s.role,
  }));
}

/** Каскадное удаление модулей, оставшихся без достаточной опоры. */
function dropOrphans(modules: ModuleItem[]): ModuleItem[] {
  let kept = modules;
  for (;;) {
    const orphans = kept.filter((m) => m.floor > 0 && supportArea(m, kept) < MIN_SUPPORT_AREA);
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

  const lastError = useRef<string | null>(null);

  const setSotki = useCallback((next: number) => {
    const clamped = Math.max(MIN_SOTKI, Math.min(MAX_SOTKI, Math.round(next)));
    const max = maxAnchor(gridSizeForSotki(clamped));
    // Убираем модули, вышедшие за уменьшенный участок, и осиротевшие верхние.
    setModules((prev) => dropOrphans(prev.filter((m) => m.x <= max && m.z <= max)));
    setSotkiState(clamped);
  }, []);

  /** Поставить модуль по точке тапа (координаты в метрах участка). */
  const placeAtPoint = useCallback(
    (px: number, pz: number) => {
      lastError.current = null;
      setModules((prev) => {
        const anchor = anchorForPoint(prev, px, pz, floor, gridN);
        if (!anchor) {
          lastError.current =
            floor > 0
              ? "Верхнему этажу нужна опора минимум на треть площади модуля"
              : "Здесь модуль не помещается";
          return prev;
        }
        return [...prev, { id: newId(), x: anchor.x, z: anchor.z, floor, role }];
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
    canGoUp,
    lastError,
    // действия
    setSotki,
    setFloor,
    setRole,
    setDesignId,
    placeAtPoint,
    removeModule,
    selectModule,
    setModuleRole,
    loadTemplate,
    clearAll,
  };
}

export type HouseBuilderApi = ReturnType<typeof useHouseBuilder>;
