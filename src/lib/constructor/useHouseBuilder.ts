import { useCallback, useMemo, useRef, useState } from "react";
import type { ModuleItem, Role } from "./types";
import {
  anchorForPoint,
  canPlace,
  canRemove,
  isConnected,
  computeStats,
  dropUnsupported,
  gridSizeForSotki,
  maxAnchor,
  minAnchor,
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

/**
 * Модули EcoCub универсальные: назначение кубика (спальня, кухня, санузел)
 * на этапе сборки не задаётся — планировку внутри объёма прорабатывает
 * инженер. Роль в модели данных осталась, потому что на ней держатся
 * экспериментальные версии конструктора, но боевая сборка использует
 * единственное значение.
 */
const UNIVERSAL_ROLE: Role = "living";

/** Центрирует стартовую планировку на текущей сетке (координаты в метрах). */
function seedsToModules(templateId: string, n: number): ModuleItem[] {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return [];
  const minX = Math.min(...tpl.seeds.map((s) => s.x));
  const maxX = Math.max(...tpl.seeds.map((s) => s.x));
  const minZ = Math.min(...tpl.seeds.map((s) => s.z));
  const maxZ = Math.max(...tpl.seeds.map((s) => s.z));
  // Центрируем внутри зоны застройки: дом не должен упереться в отступ.
  const min = minAnchor();
  const max = maxAnchor(n);
  const offX = min + Math.max(0, Math.round((max - min - (maxX - minX)) / 2)) - minX;
  const offZ = min + Math.max(0, Math.round((max - min - (maxZ - minZ)) / 2)) - minZ;
  // Роли из шаблонов не переносим: кубики одинаковые, отличается только форма.
  return tpl.seeds.map((s) => ({
    id: newId(),
    x: s.x + offX,
    z: s.z + offZ,
    floor: s.floor,
    role: UNIVERSAL_ROLE,
  }));
}

export function useHouseBuilder(basePricePerM2: number) {
  const [sotki, setSotkiState] = useState(DEFAULT_SOTKI);
  const gridN = useMemo(() => gridSizeForSotki(sotki), [sotki]);

  const [modules, setModules] = useState<ModuleItem[]>(() =>
    seedsToModules("l-family", gridSizeForSotki(DEFAULT_SOTKI)),
  );
  const [floor, setFloor] = useState(0);
  // Роль остаётся в API ради совместимости с экспериментальными версиями,
  // но боевой конструктор ставит только универсальные модули.
  const [role, setRole] = useState<Role>(UNIVERSAL_ROLE);
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
    const min = minAnchor();
    // Убираем модули, вышедшие за зону застройки, и осиротевшие верхние.
    setModules((prev) =>
      dropUnsupported(prev.filter((m) => m.x >= min && m.z >= min && m.x <= max && m.z <= max)),
    );
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
              : prev.length
                ? "Модуль ставится только вплотную к дому — дом должен быть один"
                : "Здесь модуль не помещается";
          return prev;
        }
        return [...prev, { id: newId(), x: anchor.x, z: anchor.z, floor, role }];
      });
    },
    [floor, role, gridN],
  );

  /** Передвинуть модуль в новую позицию (координаты в метрах, шаг 0,5 м). */
  const moveModule = useCallback(
    (id: string, x: number, z: number) => {
      lastError.current = null;
      setModules((prev) => {
        const target = prev.find((m) => m.id === id);
        if (!target || (target.x === x && target.z === z)) return prev;
        const rest = prev.filter((m) => m.id !== id);
        const moved = { ...target, x, z };
        if (!canPlace(rest, moved, gridN)) {
          lastError.current =
            target.floor > 0
              ? "Верхнему этажу нужна опора минимум на треть площади модуля"
              : "Сюда модуль не помещается";
          return prev;
        }
        const next = [...rest, moved];
        if (dropUnsupported(next).length !== next.length) {
          lastError.current = "Так модули выше останутся без опоры";
          return prev;
        }
        if (!isConnected(next)) {
          lastError.current = "Так дом разорвётся на части — модули должны стыковаться";
          return prev;
        }
        return next;
      });
    },
    [gridN],
  );

  const removeModule = useCallback((id: string) => {
    lastError.current = null;
    setModules((prev) => {
      // Удаление изнутри дома разорвало бы его на два здания. Дом всегда один.
      if (!canRemove(prev, id)) {
        lastError.current = "Этот модуль держит дом вместе — удалите крайний";
        return prev;
      }
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
    moveModule,
    removeModule,
    selectModule,
    setModuleRole,
    loadTemplate,
    clearAll,
  };
}

export type HouseBuilderApi = ReturnType<typeof useHouseBuilder>;
