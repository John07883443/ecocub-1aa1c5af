/**
 * План этажа: чертёж вместо картинки от нейросети.
 *
 * Всё, что здесь нарисовано, вычислено детерминированно из геометрии дома:
 * наружный контур, стены между помещениями, двери с дугой открывания, окна и
 * расстановка мебели. Никакой генерации — один и тот же дом даёт один и тот же
 * чертёж, и каждый размер прослеживается до модуля стандарта.
 *
 * Отрисовка только читающая: собирать дом человек продолжает наверху, в 2D/3D
 * конструкторе, а здесь смотрит, что из этого получается внутри.
 *
 * Единица SVG — метр. Толщины линий поэтому дробные: 0.16 наружной стены —
 * это 160 мм на плане, а не 160 пикселей.
 */

import { useMemo } from "react";

import { MODULE_SIDE_M, ROOM_TYPES } from "@/lib/planner/constants";
import { computeWalls } from "@/lib/planner/geometry";
import { computeJoints, deriveOpenings } from "@/lib/planner/rooms";
import { roomAreaM2 } from "@/lib/planner/zoning";
import type { HouseState } from "@/lib/planner/types";

import { FurnitureShape } from "./FurnitureShapes";

const INK = "#3f423e";
const LINE_SOFT = "#b9bcb6";
const SURFACE = "#ffffff";

export function PlanView({ house, floor = 0 }: { house: HouseState; floor?: number }) {
  const modules = useMemo(() => house.modules.filter((m) => m.floor === floor), [house, floor]);
  const joints = useMemo(
    () => computeJoints(house).filter((j) => j.floor === floor),
    [house, floor],
  );
  const openings = useMemo(() => deriveOpenings(house, floor), [house, floor]);
  const walls = useMemo(() => computeWalls(house.modules, floor), [house, floor]);
  const rooms = useMemo(() => house.rooms.filter((r) => r.floor === floor), [house, floor]);

  if (!modules.length) return null;

  // Поле зрения по факту застройки плюс поля под подписи. Без этого дом
  // прижимается к краю и обрезается по стене.
  const pad = 0.8;
  const minX = Math.min(...modules.map((m) => m.x)) - pad;
  const minZ = Math.min(...modules.map((m) => m.z)) - pad;
  const maxX = Math.max(...modules.map((m) => m.x + MODULE_SIDE_M)) + pad;
  const maxZ = Math.max(...modules.map((m) => m.z + MODULE_SIDE_M)) + pad;

  return (
    <svg
      viewBox={`${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`}
      className="block w-full"
      role="img"
      aria-label="План этажа с расстановкой мебели"
    >
      {/* Пол: прямоугольники встык, без рамок — стены рисуются отдельным слоем */}
      {modules.map((m) => (
        <rect
          key={`s-${m.id}`}
          x={m.x}
          y={m.z}
          width={MODULE_SIDE_M}
          height={MODULE_SIDE_M}
          fill={SURFACE}
        />
      ))}

      {/* Внутренние грани: тип стыка решает, стена это, дверь или проём */}
      {joints.map((j) => (
        <JointLine key={`${j.aId}-${j.bId}`} joint={j} />
      ))}

      {/* Мебель под контуром: линии стен всегда должны читаться поверх */}
      {rooms.map((room) =>
        (house.layouts[room.id]?.items ?? []).map((item) => (
          <FurnitureShape key={item.id} item={item} />
        )),
      )}

      {/* Наружный контур поверх всего — единой графитовой линией */}
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
        />
      ))}

      {/* Окна и вход — разрывы в наружной стене */}
      {openings.map((o) => (
        <OpeningMark key={o.id} opening={o} />
      ))}

      {/* Подписи: название и площадь в чистоте по стандарту */}
      {rooms.map((room) => {
        const own = modules.filter((m) => m.roomId === room.id);
        if (!own.length) return null;
        const cx = own.reduce((s, m) => s + m.x + MODULE_SIDE_M / 2, 0) / own.length;
        const cz = own.reduce((s, m) => s + m.z + MODULE_SIDE_M / 2, 0) / own.length;
        return (
          <g key={`label-${room.id}`} style={{ pointerEvents: "none" }}>
            <text
              x={cx}
              y={cz - 0.12}
              textAnchor="middle"
              fill={INK}
              fontSize={0.34}
              fontWeight={500}
            >
              {ROOM_TYPES[room.type].label}
            </text>
            <text x={cx} y={cz + 0.32} textAnchor="middle" fill={INK} fontSize={0.3}>
              {roomAreaM2(house, room.id).toFixed(2).replace(".", ",")} м²
            </text>
          </g>
        );
      })}
    </svg>
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
