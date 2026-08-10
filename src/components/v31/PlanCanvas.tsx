/**
 * 2D-план v3.1 — строгая монохромная архитектурная схема.
 *
 * Принципы: у типов помещений нет постоянной цветовой заливки, у модулей нет
 * карточных рамок и скруглений, между состыкованными секциями не видно фона
 * холста, а внешний контур этажа рисуется единой графитовой линией поверх
 * общей геометрии. Назначение комнаты читается по мебели и по полному
 * названию при выборе — букв «Г», «С», «К» на плане нет.
 *
 * Один и тот же холст работает в двух контекстах: «Дом» (комнаты, drag
 * модулей с магнитной стыковкой) и «Участок» (дом двигается целиком).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { MODULE_SIDE_M, ROOM_TYPES } from "@/lib/v31/constants";
import { bounds, pickSnap, snapCandidates, type SnapCandidate } from "@/lib/v31/geometry";
import { computeJoints, deriveOpenings } from "@/lib/v31/rooms";
import { moduleOnSite, placementRange, setbacks } from "@/lib/v31/site";
import type { WorkspaceApi } from "@/lib/v31/useWorkspace";
import type { ModuleFootprint } from "@/lib/v31/types";
import { FurnitureShape } from "./FurnitureShapes";

/** Порог, после которого нажатие превращается в перетаскивание (px экрана). */
const DRAG_THRESHOLD_PX = 6;

const INK = "#3f423e";
const LINE_SOFT = "#b9bcb6";
const ACCENT = "#c6a15a";
const SURFACE = "#ffffff";
const CANVAS = "#eef0ec";

interface DragState {
  moduleId: string;
  grabDX: number;
  grabDZ: number;
  rawX: number;
  rawZ: number;
  startClientX: number;
  startClientY: number;
  active: boolean;
  candidates: SnapCandidate[];
  snap: SnapCandidate | null;
}

interface SiteDragState {
  startClientX: number;
  startClientY: number;
  startX: number;
  startZ: number;
  active: boolean;
}

export function PlanCanvas({
  api,
  onModuleMenu,
}: {
  api: WorkspaceApi;
  /** Открыть контекстную панель модуля рядом с точкой экрана. */
  onModuleMenu: (moduleId: string, clientX: number, clientY: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [siteDrag, setSiteDragState] = useState<SiteDragState | null>(null);
  const siteDragRef = useRef<SiteDragState | null>(null);

  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const setSiteDrag = (next: SiteDragState | null) => {
    siteDragRef.current = next;
    setSiteDragState(next);
  };

  const { house, site, floor, context, selectedModuleId } = api;
  const isSite = context === "site";

  const floorModules = useMemo(
    () => house.modules.filter((m) => m.floor === floor),
    [house.modules, floor],
  );
  const otherFloorModules = useMemo(
    () => house.modules.filter((m) => m.floor !== floor),
    [house.modules, floor],
  );
  const walls = useMemo(() => api.wallsByFloor(floor), [api, floor]);
  const joints = useMemo(
    () => computeJoints(house).filter((j) => j.floor === floor),
    [house, floor],
  );
  const openings = useMemo(() => deriveOpenings(house, floor), [house, floor]);
  const roomById = useMemo(() => new Map(house.rooms.map((r) => [r.id, r])), [house.rooms]);

  /* ---------------- viewBox: дом крупно, участок целиком ---------------- */

  const view = useMemo(() => {
    if (isSite) {
      const pad = 2;
      return { x: -pad, z: -pad, w: site.widthM + pad * 2, d: site.depthM + pad * 2 };
    }
    const b = bounds(house.modules, floor);
    if (!b.w) return { x: -6, z: -6, w: 18, d: 18 };
    const pad = 2.5;
    return { x: b.minX - pad, z: b.minZ - pad, w: b.w + pad * 2, d: b.d + pad * 2 };
  }, [isSite, site.widthM, site.depthM, house.modules, floor]);

  /** Экранная точка → метры плана (в контексте «Дом») или участка. */
  const toModel = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, z: 0 };
      const r = svg.getBoundingClientRect();
      return {
        x: view.x + ((clientX - r.left) / r.width) * view.w,
        z: view.z + ((clientY - r.top) / r.height) * view.d,
      };
    },
    [view],
  );

  /** Метры на пиксель — нужно, чтобы порог магнита не зависел от масштаба. */
  const metresPerPixel = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return 0.05;
    const r = svg.getBoundingClientRect();
    return r.width ? view.w / r.width : 0.05;
  }, [view]);

  /* ---------------- перетаскивание модуля (контекст «Дом») ---------------- */

  const startDrag = (e: React.PointerEvent<SVGGElement>, m: ModuleFootprint) => {
    if (isSite) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toModel(e.clientX, e.clientY);
    setDrag({
      moduleId: m.id,
      grabDX: p.x - m.x,
      grabDZ: p.z - m.z,
      rawX: m.x,
      rawZ: m.z,
      startClientX: e.clientX,
      startClientY: e.clientY,
      active: false,
      candidates: [],
      snap: null,
    });
  };

  const updateDrag = (e: React.PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let next = d;
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      if (dist < DRAG_THRESHOLD_PX) return;
      // Кандидаты стыковки считаются один раз за перетаскивание.
      next = {
        ...next,
        active: true,
        candidates: snapCandidates(house.modules, floor, d.moduleId),
      };
    }
    const p = toModel(e.clientX, e.clientY);
    const rawX = p.x - d.grabDX;
    const rawZ = p.z - d.grabDZ;
    // Порог захвата задаётся в пикселях экрана и переводится в метры,
    // чтобы магнит вёл себя одинаково при любом масштабе.
    const threshold = Math.max(0.6, metresPerPixel() * 28);
    const snap = pickSnap(next.candidates, rawX, rawZ, next.snap, threshold);
    setDrag({ ...next, rawX, rawZ, snap });
  };

  const endDrag = (commit: boolean, e?: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (!d.active) {
      // Короткое нажатие без перемещения — это выбор, а не drag.
      if (commit && e) {
        api.selectModule(d.moduleId);
        onModuleMenu(d.moduleId, e.clientX, e.clientY);
      }
      return;
    }
    if (!commit) return;
    if (d.snap) {
      api.moveModuleAction(d.moduleId, d.snap.x, d.snap.z);
    } else {
      // Без стыковки модуль возвращается на место: разорванный набор
      // объёмов не выдаётся за собранный дом.
      api.selectModule(d.moduleId);
    }
  };

  /* ---------------- перетаскивание дома (контекст «Участок») ---------------- */

  const startSiteDrag = (e: React.PointerEvent<SVGGElement>) => {
    if (!isSite || !house.modules.length) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSiteDrag({
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: site.houseX,
      startZ: site.houseZ,
      active: false,
    });
  };

  const updateSiteDrag = (e: React.PointerEvent<SVGGElement>) => {
    const d = siteDragRef.current;
    if (!d) return;
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      if (dist < DRAG_THRESHOLD_PX) return;
      setSiteDrag({ ...d, active: true });
    }
    const mpp = metresPerPixel();
    const range = placementRange(house.modules, site);
    const nextX = clamp(d.startX + (e.clientX - d.startClientX) * mpp, range.minX, range.maxX);
    const nextZ = clamp(d.startZ + (e.clientY - d.startClientY) * mpp, range.minZ, range.maxZ);
    api.setSiteLive({
      houseX: Math.round(nextX * 2) / 2,
      houseZ: Math.round(nextZ * 2) / 2,
      preset: null,
    });
  };

  const endSiteDrag = () => {
    const d = siteDragRef.current;
    setSiteDrag(null);
    if (d?.active) api.setSite({ houseX: site.houseX, houseZ: site.houseZ, preset: null });
  };

  /* ---------------- отрисовка ---------------- */

  const dragged = drag?.active ? floorModules.find((m) => m.id === drag.moduleId) : null;
  const marks = setbacks(house.modules, site);

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.z} ${view.w} ${view.d}`}
        className="w-full touch-manipulation select-none rounded-sm border border-border"
        style={{ background: CANVAS, aspectRatio: isSite ? "3 / 4" : "1 / 1", maxHeight: "70vh" }}
        role="img"
        aria-label={
          isSite
            ? `Участок ${site.widthM} на ${site.depthM} метров с размещённым домом`
            : `План ${floor + 1}-го этажа, модули 3 на 3 метра`
        }
        onPointerDown={() => {
          if (!isSite) api.selectModule(null);
        }}
      >
        {isSite && <SiteBackground api={api} />}

        <g
          transform={
            isSite
              ? // В контексте участка план дома сдвигается целиком — комнаты
                // при этом не трогаются, меняется только трансформация.
                `translate(0 0)`
              : undefined
          }
          onPointerDown={isSite ? startSiteDrag : undefined}
          onPointerMove={isSite ? updateSiteDrag : undefined}
          onPointerUp={isSite ? endSiteDrag : undefined}
          onPointerCancel={isSite ? endSiteDrag : undefined}
          style={
            isSite
              ? { cursor: siteDrag?.active ? "grabbing" : "grab", touchAction: "none" }
              : undefined
          }
        >
          {/* Соседние этажи — призрачный контур, чтобы понимать объём */}
          {!isSite &&
            otherFloorModules.map((m) => (
              <rect
                key={`ghost-${m.id}`}
                x={m.x}
                y={m.z}
                width={MODULE_SIDE_M}
                height={MODULE_SIDE_M}
                fill="none"
                stroke={LINE_SOFT}
                strokeWidth={0.05}
                strokeDasharray="0.5 0.4"
                style={{ pointerEvents: "none" }}
              />
            ))}

          {/* Поверхность дома: прямоугольники встык, без рамок и скруглений */}
          {(isSite ? house.modules.filter((m) => m.floor === 0) : floorModules).map((m) => {
            const pos = isSite
              ? moduleOnSite(m, house.modules, site, MODULE_SIDE_M)
              : { x: m.x, z: m.z, w: MODULE_SIDE_M, d: MODULE_SIDE_M };
            return (
              <rect
                key={`surface-${m.id}`}
                x={pos.x}
                y={pos.z}
                width={pos.w}
                height={pos.d}
                fill={SURFACE}
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {!isSite && (
            <>
              {/* Внутренние линии: тип стыка задаёт, что рисуем на общей грани */}
              {joints.map((j) => (
                <JointLine key={`${j.aId}-${j.bId}`} joint={j} />
              ))}

              {/* Мебель — производный слой, указатель не перехватывает */}
              {house.rooms
                .filter((r) => r.floor === floor)
                .map((room) =>
                  (house.layouts[room.id]?.items ?? []).map((item) => (
                    <FurnitureShape key={item.id} item={item} />
                  )),
                )}

              {/* Внешний контур этажа поверх всего — единая графитовая линия */}
              {walls.map((w, i) => (
                <line
                  key={`w-${i}`}
                  x1={w.x1}
                  y1={w.z1}
                  x2={w.x2}
                  y2={w.z2}
                  stroke={INK}
                  strokeWidth={0.16}
                  strokeLinecap="square"
                  style={{ pointerEvents: "none" }}
                />
              ))}

              {/* Окна и входная дверь — разрывы в наружной стене */}
              {openings.map((o) => (
                <OpeningMark key={o.id} opening={o} />
              ))}

              {/* Прозрачные зоны захвата: клик/тап и перетаскивание модуля */}
              {floorModules.map((m) => {
                const room = roomById.get(m.roomId);
                const selected = m.id === selectedModuleId;
                const isDragged = drag?.active && drag.moduleId === m.id;
                return (
                  <g
                    key={`hit-${m.id}`}
                    onPointerDown={(e) => startDrag(e, m)}
                    onPointerMove={updateDrag}
                    onPointerUp={(e) => endDrag(true, e)}
                    onPointerCancel={() => endDrag(false)}
                    style={{ cursor: "grab", touchAction: "none", opacity: isDragged ? 0.3 : 1 }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${room ? ROOM_TYPES[room.type].label : "Модуль"}, 9 м², ${floor + 1}-й этаж`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        api.selectModule(m.id);
                        const r = (e.currentTarget as SVGGElement).getBoundingClientRect();
                        onModuleMenu(m.id, r.left + r.width / 2, r.top + r.height / 2);
                      }
                    }}
                  >
                    <rect
                      x={m.x}
                      y={m.z}
                      width={MODULE_SIDE_M}
                      height={MODULE_SIDE_M}
                      fill="transparent"
                    />
                    {selected && (
                      <rect
                        x={m.x + 0.06}
                        y={m.z + 0.06}
                        width={MODULE_SIDE_M - 0.12}
                        height={MODULE_SIDE_M - 0.12}
                        fill={`${ACCENT}14`}
                        stroke={ACCENT}
                        strokeWidth={0.1}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </g>
                );
              })}

              {/* Магнитная стыковка: подсветка будущей позиции и общей грани */}
              {drag?.active && dragged && (
                <g style={{ pointerEvents: "none" }}>
                  {drag.snap && (
                    <>
                      <rect
                        x={drag.snap.x}
                        y={drag.snap.z}
                        width={MODULE_SIDE_M}
                        height={MODULE_SIDE_M}
                        fill={`${ACCENT}1f`}
                        stroke={ACCENT}
                        strokeWidth={0.12}
                      />
                      <SnapEdge snap={drag.snap} />
                    </>
                  )}
                  <rect
                    x={drag.rawX}
                    y={drag.rawZ}
                    width={MODULE_SIDE_M}
                    height={MODULE_SIDE_M}
                    fill="rgba(255,255,255,0.75)"
                    stroke={drag.snap ? INK : "#b4453c"}
                    strokeWidth={0.1}
                    strokeDasharray={drag.snap ? undefined : "0.4 0.3"}
                  />
                </g>
              )}
            </>
          )}

          {/* В контексте участка дом — единый объект: контур первого этажа */}
          {isSite &&
            api.wallsByFloor(0).map((w, i) => {
              const a = sitePoint(w.x1, w.z1, house.modules, site);
              const b = sitePoint(w.x2, w.z2, house.modules, site);
              return (
                <line
                  key={`sw-${i}`}
                  x1={a.x}
                  y1={a.z}
                  x2={b.x}
                  y2={b.z}
                  stroke={INK}
                  strokeWidth={0.28}
                  strokeLinecap="square"
                />
              );
            })}
        </g>
      </svg>

      {isSite && house.modules.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Отступы: запад {fmt(marks.west)} м · север {fmt(marks.north)} м · восток {fmt(marks.east)}{" "}
          м · юг {fmt(marks.south)} м. Минимум по схеме — {site.setbackM} м.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Вспомогательные фигуры                                              */
/* ------------------------------------------------------------------ */

/** Линия общей грани: перегородка, дверь, широкий проём или объединение. */
function JointLine({ joint }: { joint: ReturnType<typeof computeJoints>[number] }) {
  const { axis, at, from, to, state } = joint;
  const horizontal = axis === "z";
  const line = (a: number, b: number, width: number, dash?: string) =>
    horizontal ? (
      <line x1={a} y1={at} x2={b} y2={at} stroke={INK} strokeWidth={width} strokeDasharray={dash} />
    ) : (
      <line x1={at} y1={a} x2={at} y2={b} stroke={INK} strokeWidth={width} strokeDasharray={dash} />
    );

  if (state === "open") {
    // Технологический шов между секциями — тонкая нейтральная линия.
    return (
      <g style={{ pointerEvents: "none" }} opacity={0.5}>
        {horizontal ? (
          <line x1={from} y1={at} x2={to} y2={at} stroke={LINE_SOFT} strokeWidth={0.04} />
        ) : (
          <line x1={at} y1={from} x2={at} y2={to} stroke={LINE_SOFT} strokeWidth={0.04} />
        )}
      </g>
    );
  }

  const center = (from + to) / 2;
  const gap = state === "door" ? 0.9 : state === "opening" ? 1.8 : 0;
  return (
    <g style={{ pointerEvents: "none" }}>
      {gap > 0 ? (
        <>
          {line(from, center - gap / 2, 0.1)}
          {line(center + gap / 2, to, 0.1)}
          {state === "door" && <DoorArc axis={axis} at={at} center={center} width={gap} />}
        </>
      ) : (
        line(from, to, 0.1)
      )}
    </g>
  );
}

/** Дверь: створка и дуга открывания. */
function DoorArc({
  axis,
  at,
  center,
  width,
}: {
  axis: "x" | "z";
  at: number;
  center: number;
  width: number;
}) {
  const r = width;
  if (axis === "z") {
    const x0 = center - width / 2;
    return (
      <g>
        <line x1={x0} y1={at} x2={x0} y2={at - r} stroke={INK} strokeWidth={0.06} />
        <path
          d={`M ${x0} ${at - r} A ${r} ${r} 0 0 1 ${x0 + r} ${at}`}
          fill="none"
          stroke={LINE_SOFT}
          strokeWidth={0.05}
        />
      </g>
    );
  }
  const z0 = center - width / 2;
  return (
    <g>
      <line x1={at} y1={z0} x2={at - r} y2={z0} stroke={INK} strokeWidth={0.06} />
      <path
        d={`M ${at - r} ${z0} A ${r} ${r} 0 0 0 ${at} ${z0 + r}`}
        fill="none"
        stroke={LINE_SOFT}
        strokeWidth={0.05}
      />
    </g>
  );
}

/** Окно — двойная тонкая линия в разрыве стены; вход — утолщённый порог. */
function OpeningMark({ opening }: { opening: ReturnType<typeof deriveOpenings>[number] }) {
  const { axis, x, z, widthM, kind } = opening;
  const half = widthM / 2;
  const isEntry = kind === "entry";
  const color = isEntry ? INK : "#8d918b";
  if (axis === "z") {
    return (
      <g style={{ pointerEvents: "none" }}>
        <line x1={x - half} y1={z} x2={x + half} y2={z} stroke="#ffffff" strokeWidth={0.2} />
        <line
          x1={x - half}
          y1={z - 0.05}
          x2={x + half}
          y2={z - 0.05}
          stroke={color}
          strokeWidth={0.05}
        />
        <line
          x1={x - half}
          y1={z + 0.05}
          x2={x + half}
          y2={z + 0.05}
          stroke={color}
          strokeWidth={0.05}
        />
        {isEntry && <ThresholdMark x={x} z={z} axis="z" />}
      </g>
    );
  }
  return (
    <g style={{ pointerEvents: "none" }}>
      <line x1={x} y1={z - half} x2={x} y2={z + half} stroke="#ffffff" strokeWidth={0.2} />
      <line
        x1={x - 0.05}
        y1={z - half}
        x2={x - 0.05}
        y2={z + half}
        stroke={color}
        strokeWidth={0.05}
      />
      <line
        x1={x + 0.05}
        y1={z - half}
        x2={x + 0.05}
        y2={z + half}
        stroke={color}
        strokeWidth={0.05}
      />
      {isEntry && <ThresholdMark x={x} z={z} axis="x" />}
    </g>
  );
}

/** Стрелка входа — понятный сценарий «с улицы в дом». */
function ThresholdMark({ x, z, axis }: { x: number; z: number; axis: "x" | "z" }) {
  const len = 0.9;
  return axis === "z" ? (
    <polyline
      points={`${x - 0.22},${z + len - 0.25} ${x},${z + len} ${x + 0.22},${z + len - 0.25}`}
      fill="none"
      stroke={INK}
      strokeWidth={0.07}
    />
  ) : (
    <polyline
      points={`${x + len - 0.25},${z - 0.22} ${x + len},${z} ${x + len - 0.25},${z + 0.22}`}
      fill="none"
      stroke={INK}
      strokeWidth={0.07}
    />
  );
}

/** Подсветка грани, которой модуль пристыкуется. */
function SnapEdge({ snap }: { snap: SnapCandidate }) {
  const s = MODULE_SIDE_M;
  const edges: Record<SnapCandidate["side"], [number, number, number, number]> = {
    right: [snap.x, snap.z, snap.x, snap.z + s],
    left: [snap.x + s, snap.z, snap.x + s, snap.z + s],
    bottom: [snap.x, snap.z, snap.x + s, snap.z],
    top: [snap.x, snap.z + s, snap.x + s, snap.z + s],
  };
  const [x1, z1, x2, z2] = edges[snap.side];
  return (
    <line
      x1={x1}
      y1={z1}
      x2={x2}
      y2={z2}
      stroke={ACCENT}
      strokeWidth={0.24}
      strokeLinecap="round"
    />
  );
}

/** Участок: газон, отступы, компас и сторона въезда. */
function SiteBackground({ api }: { api: WorkspaceApi }) {
  const { site } = api;
  const inner = {
    x: site.setbackM,
    z: site.setbackM,
    w: Math.max(0, site.widthM - site.setbackM * 2),
    d: Math.max(0, site.depthM - site.setbackM * 2),
  };
  const access = (() => {
    const cx = site.widthM / 2;
    const cz = site.depthM / 2;
    switch (site.accessSide) {
      case "north":
        return { x: cx - 2.5, z: -1.4, w: 5, d: 1.4 };
      case "south":
        return { x: cx - 2.5, z: site.depthM, w: 5, d: 1.4 };
      case "west":
        return { x: -1.4, z: cz - 2.5, w: 1.4, d: 5 };
      default:
        return { x: site.widthM, z: cz - 2.5, w: 1.4, d: 5 };
    }
  })();

  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={0}
        y={0}
        width={site.widthM}
        height={site.depthM}
        fill="#e4e8df"
        stroke={INK}
        strokeWidth={0.22}
      />
      <rect
        x={inner.x}
        y={inner.z}
        width={inner.w}
        height={inner.d}
        fill="none"
        stroke="#a8ab9f"
        strokeWidth={0.12}
        strokeDasharray="0.9 0.7"
      />
      <rect x={access.x} y={access.z} width={access.w} height={access.d} fill="#c9ccc2" />
      <g transform={`translate(${site.widthM - 1.8} 1.4)`}>
        <line x1={0} y1={2.2} x2={0} y2={0.3} stroke={INK} strokeWidth={0.14} />
        <polyline points="-0.35,0.75 0,0.2 0.35,0.75" fill="none" stroke={INK} strokeWidth={0.14} />
        <text x={0} y={3.1} textAnchor="middle" fontSize={1} fill={INK} fontWeight={600}>
          С
        </text>
      </g>
      <g transform={`translate(1.2 ${site.depthM - 1.2})`}>
        <line x1={0} y1={0} x2={5} y2={0} stroke={INK} strokeWidth={0.16} />
        <text x={2.5} y={-0.5} textAnchor="middle" fontSize={0.9} fill={INK}>
          5 м
        </text>
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */

function sitePoint(
  x: number,
  z: number,
  modules: ModuleFootprint[],
  site: WorkspaceApi["site"],
): { x: number; z: number } {
  const b = bounds(modules, 0);
  const lx = x - b.minX;
  const lz = z - b.minZ;
  switch (site.houseRotation) {
    case 90:
      return { x: site.houseX + (b.d - lz), z: site.houseZ + lx };
    case 180:
      return { x: site.houseX + (b.w - lx), z: site.houseZ + (b.d - lz) };
    case 270:
      return { x: site.houseX + lz, z: site.houseZ + (b.w - lx) };
    default:
      return { x: site.houseX + lx, z: site.houseZ + lz };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");
