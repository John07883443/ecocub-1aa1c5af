/**
 * Состояние рабочего пространства v3.1: дом, участок, история и режимы.
 *
 * Один источник истины на весь редактор: 2D-план, 3D-сцена, площади и цена
 * читают одно и то же состояние, поэтому расходиться не могут. Любое
 * изменение проходит через commit() — одна атомарная запись в историю.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { estimateByAreas } from "../v3/pricing";
import {
  addRoom,
  addSecondFloor,
  changeRoomType,
  clearHouse,
  deleteImpact,
  deleteModule,
  emptyHouse,
  growRoom,
  houseReadiness,
  mirrorHouse,
  moveModule,
} from "./actions";
import { computeAreas, computeJoints } from "./rooms";
import { computeWalls, houseIssues } from "./geometry";
import { planRoom } from "./furniture";
import { reclampPlacement } from "./site";
import type { HouseState, RoomType, SiteState, TxResult } from "./types";
import { createProject31, project31Store, type V31Project } from "./project31";

const HISTORY_LIMIT = 60;

export type ViewMode = "together" | "plan" | "3d";
export type ToolContext = "house" | "site";

interface Snapshot {
  house: HouseState;
  site: SiteState;
}

export interface WorkspaceApi {
  project: V31Project;
  house: HouseState;
  site: SiteState;
  /** Производные данные — считаются один раз на изменение состояния. */
  areas: ReturnType<typeof computeAreas>;
  price: ReturnType<typeof estimateByAreas>;
  joints: ReturnType<typeof computeJoints>;
  wallsByFloor: (floor: number) => ReturnType<typeof computeWalls>;
  issues: string[];
  readiness: { ready: boolean; reasons: string[] };

  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  context: ToolContext;
  setContext: (c: ToolContext) => void;
  floor: number;
  setFloor: (f: number) => void;
  selectedModuleId: string | null;
  selectModule: (id: string | null) => void;

  message: { text: string; ok: boolean } | null;
  clearMessage: () => void;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  addRoomAction: (type: RoomType, floor?: number) => void;
  growRoomAction: (roomId: string) => void;
  secondFloorAction: () => void;
  mirrorAction: () => void;
  moveModuleAction: (id: string, x: number, z: number) => void;
  deleteModuleAction: (id: string, confirmed?: boolean) => TxResult;
  changeRoomTypeAction: (roomId: string, type: RoomType) => void;
  otherLayoutAction: (roomId: string) => void;
  clearAction: () => void;
  restoreBaseAction: () => void;

  setSite: (patch: Partial<SiteState>) => void;
  /** Изменение участка без записи в историю (тянем ползунок). */
  setSiteLive: (patch: Partial<SiteState>) => void;

  loadHouse: (house: HouseState, basePlanId: string | null, note: string) => void;
  restoreProject: (project: V31Project) => void;
  patchProject: (patch: Partial<V31Project>) => void;
}

export function useWorkspace(initial?: V31Project): WorkspaceApi {
  const [project, setProject] = useState<V31Project>(() => initial ?? createProject31());
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("together");
  const [context, setContext] = useState<ToolContext>("house");
  const [floor, setFloor] = useState(0);
  const [selectedModuleId, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  /** Исходная конфигурация выбранного плана — для «Вернуть исходный вариант». */
  const baseHouse = useRef<HouseState | null>(null);

  const persist = useCallback((next: V31Project) => {
    project31Store.save(next);
    return next;
  }, []);

  /** Единственная точка изменения дома/участка: снимок в историю + сохранение. */
  const commit = useCallback(
    (next: Partial<Snapshot>, note?: string, ok = true) => {
      setProject((prev) => {
        setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), { house: prev.house, site: prev.site }]);
        setFuture([]);
        const house = next.house ?? prev.house;
        // Габариты дома могли измениться — посадка пересчитывается, но
        // выбранный пресет/якорь сохраняется.
        const site = reclampPlacement(house.modules, next.site ?? prev.site);
        const updated: V31Project = {
          ...prev,
          house,
          site,
          appliedActions: note ? [...prev.appliedActions, note] : prev.appliedActions,
        };
        return persist(updated);
      });
      if (note) setMessage({ text: note, ok });
    },
    [persist],
  );

  const run = useCallback(
    (result: TxResult) => {
      if (!result.ok) {
        setMessage({ text: result.error, ok: false });
        return;
      }
      commit({ house: result.house }, result.note);
    },
    [commit],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const snapshot = p[p.length - 1];
      setProject((prev) => {
        setFuture((f) => [{ house: prev.house, site: prev.site }, ...f]);
        return persist({ ...prev, house: snapshot.house, site: snapshot.site });
      });
      setMessage({ text: "Действие отменено", ok: true });
      return p.slice(0, -1);
    });
  }, [persist]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const snapshot = f[0];
      setProject((prev) => {
        setPast((p) => [...p, { house: prev.house, site: prev.site }]);
        return persist({ ...prev, house: snapshot.house, site: snapshot.site });
      });
      setMessage({ text: "Действие возвращено", ok: true });
      return f.slice(1);
    });
  }, [persist]);

  /* ---------------- действия ---------------- */

  const addRoomAction = useCallback(
    (type: RoomType, targetFloor?: number) =>
      run(addRoom(project.house, type, targetFloor ?? floor)),
    [project.house, floor, run],
  );

  const growRoomAction = useCallback(
    (roomId: string) => run(growRoom(project.house, roomId)),
    [project.house, run],
  );

  const secondFloorAction = useCallback(() => {
    const result = addSecondFloor(project.house);
    run(result);
    if (result.ok) setFloor(1);
  }, [project.house, run]);

  const mirrorAction = useCallback(() => run(mirrorHouse(project.house)), [project.house, run]);

  const moveModuleAction = useCallback(
    (id: string, x: number, z: number) => run(moveModule(project.house, id, x, z)),
    [project.house, run],
  );

  const deleteModuleAction = useCallback(
    (id: string, confirmed = false): TxResult => {
      const result = deleteModule(project.house, id, confirmed);
      if (result.ok) {
        commit({ house: result.house }, result.note);
        setSelected(null);
      } else if (!result.needsConfirm) {
        setMessage({ text: result.error, ok: false });
      }
      return result;
    },
    [project.house, commit],
  );

  const changeRoomTypeAction = useCallback(
    (roomId: string, type: RoomType) => run(changeRoomType(project.house, roomId, type)),
    [project.house, run],
  );

  /** «Другой вариант»: следующий допустимый пресет расстановки. */
  const otherLayoutAction = useCallback(
    (roomId: string) => {
      const current = project.house.layouts[roomId];
      const nextIndex = current ? currentPresetIndex(current.presetId) + 1 : 0;
      const layout = planRoom(project.house, roomId, nextIndex);
      if (layout.fallback || layout.presetCount <= 1) {
        setMessage({ text: "Другой допустимой расстановки для этой комнаты нет", ok: false });
        return;
      }
      commit(
        { house: { ...project.house, layouts: { ...project.house.layouts, [roomId]: layout } } },
        "Показан другой вариант расстановки",
      );
    },
    [project.house, commit],
  );

  const clearAction = useCallback(() => {
    const result = clearHouse();
    if (result.ok) {
      commit({ house: result.house }, result.note);
      setSelected(null);
      setFloor(0);
    }
  }, [commit]);

  const restoreBaseAction = useCallback(() => {
    if (!baseHouse.current) {
      setMessage({ text: "Исходный вариант не выбран — начните с подбора", ok: false });
      return;
    }
    commit({ house: baseHouse.current }, "Возвращён исходный вариант планировки");
    setSelected(null);
    setFloor(0);
  }, [commit]);

  const setSite = useCallback(
    (patch: Partial<SiteState>) => commit({ site: { ...project.site, ...patch } }, undefined),
    [project.site, commit],
  );

  /** Живое изменение участка (ползунок/drag) — без засорения истории. */
  const setSiteLive = useCallback(
    (patch: Partial<SiteState>) => {
      setProject((prev) =>
        persist({
          ...prev,
          site: reclampPlacement(prev.house.modules, { ...prev.site, ...patch }),
        }),
      );
    },
    [persist],
  );

  const loadHouse = useCallback(
    (house: HouseState, basePlanId: string | null, note: string) => {
      baseHouse.current = house;
      setPast([]);
      setFuture([]);
      setSelected(null);
      setFloor(0);
      setProject((prev) =>
        persist({
          ...prev,
          house,
          basePlanId,
          site: reclampPlacement(house.modules, prev.site),
          appliedActions: [],
        }),
      );
      setMessage({ text: note, ok: true });
    },
    [persist],
  );

  const restoreProject = useCallback((restored: V31Project) => {
    baseHouse.current = restored.house;
    setPast([]);
    setFuture([]);
    setSelected(null);
    setFloor(0);
    setProject(restored);
  }, []);

  const patchProject = useCallback(
    (patch: Partial<V31Project>) => setProject((prev) => persist({ ...prev, ...patch })),
    [persist],
  );

  /* ---------------- производные данные ---------------- */

  const areas = useMemo(() => computeAreas(project.house), [project.house]);
  const price = useMemo(
    () => estimateByAreas(areas.totalAreaM2, areas.terraceAreaM2),
    [areas.totalAreaM2, areas.terraceAreaM2],
  );
  const joints = useMemo(() => computeJoints(project.house), [project.house]);
  const wallsByFloor = useCallback(
    (f: number) => computeWalls(project.house.modules, f),
    [project.house.modules],
  );
  const issues = useMemo(() => houseIssues(project.house.modules), [project.house.modules]);
  const readiness = useMemo(() => houseReadiness(project.house), [project.house]);

  return {
    project,
    house: project.house,
    site: project.site,
    areas,
    price,
    joints,
    wallsByFloor,
    issues,
    readiness,

    viewMode,
    setViewMode,
    context,
    setContext,
    floor,
    setFloor,
    selectedModuleId,
    selectModule: setSelected,

    message,
    clearMessage: () => setMessage(null),

    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,

    addRoomAction,
    growRoomAction,
    secondFloorAction,
    mirrorAction,
    moveModuleAction,
    deleteModuleAction,
    changeRoomTypeAction,
    otherLayoutAction,
    clearAction,
    restoreBaseAction,

    setSite,
    setSiteLive,

    loadHouse,
    restoreProject,
    patchProject,
  };
}

function currentPresetIndex(presetId: string): number {
  const n = Number(presetId.split("-").pop());
  return Number.isFinite(n) ? n : 0;
}

/** Реэкспорт для панелей: последствия удаления показываем до подтверждения. */
export { deleteImpact, emptyHouse };
