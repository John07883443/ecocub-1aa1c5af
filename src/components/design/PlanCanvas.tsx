import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignEditor } from "@/lib/house-project/editor";
import { BASE_MODULE } from "@/lib/house-project/catalog";
import {
  boundsOf,
  defOf,
  footprintOf,
  localFace,
  localToWorld,
  openingSegment,
  rectOf,
} from "@/lib/house-project/geometry";
import { pickAnchor, snapAnchors, snapToStep, type SnapAnchor } from "@/lib/house-project/snap";
import type { FaceId, ModuleInstance } from "@/lib/house-project/types";
import { FACE_IDS } from "@/lib/house-project/types";
import { cn } from "@/lib/utils";

/**
 * План этажа в миллиметрах.
 *
 * Почему SVG, а не canvas. Дом — это десятки прямоугольников и отрезков;
 * ради такого количества элементов заводить ручную отрисовку и своё
 * попадание курсора незачем. В SVG каждый модуль и каждый проём — обычный
 * элемент со своим обработчиком, а выделение и наведение делает браузер.
 *
 * Ось Y направлена вверх, как на чертеже. Экранная система координат
 * перевёрнута, и весь перевод собран в двух функциях `toScreen`/`toModel`:
 * если знак перепутать в одном месте из десяти, дом окажется зеркальным, а
 * найти это глазами почти невозможно.
 */

export type Tool = "select" | "add" | "measure";

interface Props {
  editor: DesignEditor;
  tool: Tool;
  snapStepMm: number;
  showOtherFloors: boolean;
  onFacePick: (moduleId: string, faceId: FaceId) => void;
}

interface View {
  /** Координата модели, попадающая в левый верхний угол области, мм. */
  x: number;
  y: number;
  /** Пикселей экрана на миллиметр. */
  scale: number;
}

const MIN_SCALE = 0.004;
const MAX_SCALE = 0.25;

/** Порог примагничивания в пикселях — на экране он должен быть постоянным. */
const SNAP_THRESHOLD_PX = 34;

function fitView(width: number, height: number, modules: ModuleInstance[]): View {
  if (!modules.length || width < 10 || height < 10) {
    return { x: -2000, y: 10000, scale: 0.03 };
  }
  const b = boundsOf(modules);
  const pad = 2500;
  const scale = Math.min(
    (width - 40) / (b.widthMm + pad * 2),
    (height - 40) / (b.depthMm + pad * 2),
  );
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const cx = b.minX + b.widthMm / 2;
  const cy = b.minY + b.depthMm / 2;
  return { x: cx - width / 2 / clamped, y: cy + height / 2 / clamped, scale: clamped };
}

export function PlanCanvas({ editor, tool, snapStepMm, showOtherFloors, onFacePick }: Props) {
  const { state, dispatch } = editor;
  const { project, activeFloor, selection } = state;
  const modules = project.model.modules;

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [view, setView] = useState<View>(() => ({ x: -2000, y: 10000, scale: 0.03 }));
  const [fitted, setFitted] = useState(false);

  const [drag, setDrag] = useState<{
    ids: string[];
    startModel: { x: number; y: number };
    origin: Map<string, { x: number; y: number }>;
    current: { x: number; y: number };
    anchor: SnapAnchor | null;
  } | null>(null);
  const [pan, setPan] = useState<{ px: number; py: number; view: View } | null>(null);
  const [measure, setMeasure] = useState<{
    a: { x: number; y: number };
    b?: { x: number; y: number };
  } | null>(null);
  const [hoverFace, setHoverFace] = useState<string | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Первая подгонка под содержимое — один раз, когда стали известны размеры.
  // Дальше вид принадлежит человеку: самовольно двигать его на каждой правке
  // значит терять место, куда он только что смотрел.
  useEffect(() => {
    if (fitted || size.width < 50) return;
    setView(fitView(size.width, size.height, modules));
    setFitted(true);
  }, [fitted, size, modules]);

  const fit = useCallback(() => {
    setView(fitView(size.width, size.height, modules));
  }, [size, modules]);

  const toScreen = useCallback(
    (x: number, y: number) => ({
      x: (x - view.x) * view.scale,
      y: (view.y - y) * view.scale,
    }),
    [view],
  );

  const toModel = useCallback(
    (px: number, py: number) => ({
      x: view.x + px / view.scale,
      y: view.y - py / view.scale,
    }),
    [view],
  );

  const pointerModel = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toModel(e.clientX - rect.left, e.clientY - rect.top);
    },
    [toModel],
  );

  /* --- Масштаб колесом ------------------------------------------------ */

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
        // Точка под курсором остаётся на месте — иначе при приближении
        // содержимое уезжает, и приходится догонять его панорамированием.
        const mx = v.x + px / v.scale;
        const my = v.y - py / v.scale;
        return { scale, x: mx - px / scale, y: my + py / scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* --- Перетаскивание -------------------------------------------------- */

  const movingModules = useMemo(
    () => (drag ? modules.filter((m) => drag.ids.includes(m.id)) : []),
    [drag, modules],
  );

  const anchors = useMemo(() => {
    if (!drag || movingModules.length !== 1) return [];
    return snapAnchors(modules, movingModules[0], snapStepMm);
  }, [drag, movingModules, modules, snapStepMm]);

  const onPointerDownModule = (e: React.PointerEvent, m: ModuleInstance) => {
    if (tool !== "select") return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const ids = selection.includes(m.id) ? selection : [m.id];
    if (!selection.includes(m.id)) dispatch({ type: "select", ids: [m.id] });

    const start = pointerModel(e);
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const mod = modules.find((x) => x.id === id);
      if (mod) origin.set(id, { ...mod.positionMm });
    }
    setDrag({ ids, startModel: start, origin, current: start, anchor: null });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pan) {
      const dx = (e.clientX - pan.px) / pan.view.scale;
      const dy = (e.clientY - pan.py) / pan.view.scale;
      setView({ ...pan.view, x: pan.view.x - dx, y: pan.view.y + dy });
      return;
    }
    if (!drag) return;
    const current = pointerModel(e);
    let anchor: SnapAnchor | null = null;
    if (movingModules.length === 1 && anchors.length) {
      const origin = drag.origin.get(movingModules[0].id)!;
      const rawX = origin.x + (current.x - drag.startModel.x);
      const rawY = origin.y + (current.y - drag.startModel.y);
      anchor = pickAnchor(anchors, rawX, rawY, SNAP_THRESHOLD_PX / view.scale);
    }
    setDrag({ ...drag, current, anchor });
  };

  const commitDrag = () => {
    if (!drag) return;
    const dx = drag.current.x - drag.startModel.x;
    const dy = drag.current.y - drag.startModel.y;

    let moves: { id: string; x: number; y: number }[];
    if (drag.anchor && drag.ids.length === 1) {
      moves = [{ id: drag.ids[0], x: drag.anchor.x, y: drag.anchor.y }];
    } else {
      moves = drag.ids.map((id) => {
        const o = drag.origin.get(id)!;
        return {
          id,
          x: snapToStep(o.x + dx, snapStepMm),
          y: snapToStep(o.y + dy, snapStepMm),
        };
      });
    }
    // Микросдвиг мышью — это не перемещение, а промах по клику. Без порога
    // каждый выбор модуля попадал бы в историю отмены.
    const moved = moves.some((mv) => {
      const o = drag.origin.get(mv.id)!;
      return Math.abs(mv.x - o.x) > 1 || Math.abs(mv.y - o.y) > 1;
    });
    if (moved) dispatch({ type: "move-modules", moves });
    setDrag(null);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const p = pointerModel(e);
    if (tool === "add") {
      dispatch({
        type: "add-module",
        x: snapToStep(p.x, snapStepMm),
        y: snapToStep(p.y, snapStepMm),
      });
      return;
    }
    if (tool === "measure") {
      setMeasure((prev) => (prev && !prev.b ? { ...prev, b: p } : { a: p }));
      return;
    }
    // Правая кнопка и пустое место — панорамирование.
    setPan({ px: e.clientX, py: e.clientY, view });
    dispatch({ type: "select", ids: [] });
  };

  /* --- Сетка ----------------------------------------------------------- */

  const grid = useMemo(() => {
    const stepX = BASE_MODULE.externalWidthMm;
    const stepY = BASE_MODULE.externalDepthMm;
    const left = view.x;
    const right = view.x + size.width / view.scale;
    const top = view.y;
    const bottom = view.y - size.height / view.scale;
    // При сильном отдалении линии сливаются в заливку — рисовать их незачем.
    if ((right - left) / stepX > 90) return { vertical: [], horizontal: [] };
    const vertical: number[] = [];
    for (let x = Math.floor(left / stepX) * stepX; x <= right; x += stepX) vertical.push(x);
    const horizontal: number[] = [];
    for (let y = Math.floor(bottom / stepY) * stepY; y <= top; y += stepY) horizontal.push(y);
    return { vertical, horizontal };
  }, [view, size]);

  const bounds = useMemo(() => boundsOf(modules), [modules]);

  /* --- Отрисовка модуля ------------------------------------------------ */

  function moduleShape(m: ModuleInstance, ghost: boolean) {
    const r = rectOf(m);
    const dragging = drag?.ids.includes(m.id);
    let dx = 0;
    let dy = 0;
    if (dragging && drag) {
      if (drag.anchor && drag.ids.length === 1) {
        const o = drag.origin.get(m.id)!;
        dx = drag.anchor.x - o.x;
        dy = drag.anchor.y - o.y;
      } else {
        dx = drag.current.x - drag.startModel.x;
        dy = drag.current.y - drag.startModel.y;
      }
    }
    const p = toScreen(r.x + dx, r.y + r.h + dy);
    const w = r.w * view.scale;
    const h = r.h * view.scale;
    const selected = selection.includes(m.id);
    const def = defOf(m);
    const wall = def.wallThicknessMm * view.scale;

    return (
      <g key={m.id} opacity={ghost ? 0.22 : 1}>
        <rect
          x={p.x}
          y={p.y}
          width={w}
          height={h}
          className={cn(
            "transition-colors",
            ghost
              ? "fill-muted stroke-muted-foreground"
              : selected
                ? "fill-accent/15 stroke-accent"
                : "fill-card stroke-foreground/70",
          )}
          strokeWidth={selected ? 2 : 1.2}
          style={{ cursor: ghost ? "default" : tool === "select" ? "move" : "crosshair" }}
          onPointerDown={(e) => !ghost && onPointerDownModule(e, m)}
          onPointerUp={commitDrag}
        />
        {/* Внутренний контур — толщина стены. На нём видно, где общая стена. */}
        {!ghost && wall > 1.5 && (
          <rect
            x={p.x + wall}
            y={p.y + wall}
            width={Math.max(0, w - wall * 2)}
            height={Math.max(0, h - wall * 2)}
            className="pointer-events-none fill-none stroke-foreground/25"
            strokeWidth={1}
          />
        )}
        {!ghost && w > 46 && (
          <text
            x={p.x + w / 2}
            y={p.y + h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="pointer-events-none select-none fill-foreground/60 text-[10px]"
          >
            {m.id}
          </text>
        )}
        {!ghost && !drag && renderFaces(m)}
      </g>
    );
  }

  /** Полосы граней: по ним ставится проём и видно, какая грань выбрана. */
  function renderFaces(m: ModuleInstance) {
    const def = defOf(m);
    return FACE_IDS.map((faceId) => {
      const f = localFace(def, faceId);
      const from = localToWorld(m, f.from);
      const to = localToWorld(m, f.to);
      const a = toScreen(from.x, from.y);
      const b = toScreen(to.x, to.y);
      const key = `${m.id}:${faceId}`;
      const hovered = hoverFace === key;
      return (
        <line
          key={key}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          strokeWidth={hovered ? 7 : 6}
          strokeLinecap="butt"
          className={cn(
            "cursor-pointer",
            hovered ? "stroke-accent" : "stroke-transparent hover:stroke-accent/40",
          )}
          onPointerEnter={() => setHoverFace(key)}
          onPointerLeave={() => setHoverFace((cur) => (cur === key ? null : cur))}
          onPointerDown={(e) => {
            if (tool !== "select") return;
            e.stopPropagation();
            onFacePick(m.id, faceId);
          }}
        />
      );
    });
  }

  const visible = modules.filter((m) => m.floor === activeFloor);
  const others = showOtherFloors ? modules.filter((m) => m.floor !== activeFloor) : [];
  const underlay = project.underlay;

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full touch-none overflow-hidden rounded-sm border border-border bg-[#fafaf9]"
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        commitDrag();
        setPan(null);
      }}
      onPointerLeave={() => {
        commitDrag();
        setPan(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width={size.width} height={size.height} className="block">
        {/* Подложка-чертёж под всем остальным. */}
        {/*
          Изображение подложки живёт в своих пикселях, поэтому масштабируется
          составом «пиксель чертежа → миллиметр модели → пиксель экрана».
          Так масштаб, заданный калибровкой по двум точкам, действует и при
          любом приближении: два множителя не могут разойтись.
        */}
        {underlay?.visible && underlay.floor === activeFloor && (
          <g
            className="pointer-events-none"
            transform={
              `translate(${toScreen(underlay.offsetMm.x, underlay.offsetMm.y).x} ` +
              `${toScreen(underlay.offsetMm.x, underlay.offsetMm.y).y}) ` +
              `rotate(${underlay.rotationDeg}) ` +
              `scale(${underlay.mmPerPx * view.scale})`
            }
          >
            <image href={underlay.src} x={0} y={0} opacity={underlay.opacity} />
          </g>
        )}

        <g className="pointer-events-none">
          {grid.vertical.map((x) => {
            const p = toScreen(x, 0);
            return (
              <line
                key={`v${x}`}
                x1={p.x}
                y1={0}
                x2={p.x}
                y2={size.height}
                className="stroke-border"
                strokeWidth={0.5}
              />
            );
          })}
          {grid.horizontal.map((y) => {
            const p = toScreen(0, y);
            return (
              <line
                key={`h${y}`}
                x1={0}
                y1={p.y}
                x2={size.width}
                y2={p.y}
                className="stroke-border"
                strokeWidth={0.5}
              />
            );
          })}
        </g>

        {others.map((m) => moduleShape(m, true))}
        {visible.map((m) => moduleShape(m, false))}

        {/* Проёмы поверх модулей: они читаются как разрывы стены. */}
        <g>
          {project.model.openings.map((o) => {
            const m = modules.find((x) => x.id === o.moduleId);
            if (!m || m.floor !== activeFloor || drag?.ids.includes(m.id)) return null;
            const seg = openingSegment(m, o);
            if (!seg) return null;
            const a = toScreen(seg.from.x, seg.from.y);
            const b = toScreen(seg.to.x, seg.to.y);
            const selected = state.selectedOpeningId === o.id;
            return (
              <line
                key={o.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={selected ? 6 : 4.5}
                strokeLinecap="butt"
                className={cn(
                  "cursor-pointer",
                  selected
                    ? "stroke-accent"
                    : o.kind === "door"
                      ? "stroke-amber-600"
                      : o.kind === "passage"
                        ? "stroke-emerald-600"
                        : "stroke-sky-600",
                )}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "select-opening", id: o.id });
                }}
              />
            );
          })}
        </g>

        {/* Точки допустимых положений — видно, куда модуль может встать. */}
        {drag && anchors.length > 0 && (
          <g className="pointer-events-none">
            {anchors.slice(0, 400).map((a, i) => {
              const f = footprintOf(movingModules[0]);
              const p = toScreen(a.x + f.widthMm / 2, a.y + f.depthMm / 2);
              const active = drag.anchor?.x === a.x && drag.anchor?.y === a.y;
              return (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={active ? 5 : 2.5}
                  className={
                    active
                      ? "fill-accent"
                      : a.joint === "shared-wall"
                        ? "fill-emerald-500/50"
                        : "fill-foreground/25"
                  }
                />
              );
            })}
          </g>
        )}

        {/* Габарит дома с подписью — главное число на экране. */}
        {modules.length > 0 && (
          <g className="pointer-events-none">
            <rect
              x={toScreen(bounds.minX, 0).x}
              y={toScreen(0, bounds.minY + bounds.depthMm).y}
              width={bounds.widthMm * view.scale}
              height={bounds.depthMm * view.scale}
              className="fill-none stroke-accent/40"
              strokeWidth={1}
              strokeDasharray="6 5"
            />
            <text
              x={toScreen(bounds.minX + bounds.widthMm / 2, 0).x}
              y={toScreen(0, bounds.minY + bounds.depthMm).y - 8}
              textAnchor="middle"
              className="fill-foreground/70 text-[11px] font-medium"
            >
              {bounds.widthMm} × {bounds.depthMm} мм
            </text>
          </g>
        )}

        {/* Линейка */}
        {measure && (
          <g className="pointer-events-none">
            {(() => {
              const a = toScreen(measure.a.x, measure.a.y);
              const b = measure.b ? toScreen(measure.b.x, measure.b.y) : a;
              const dist = measure.b
                ? Math.round(Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y))
                : 0;
              return (
                <>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="stroke-rose-600"
                    strokeWidth={1.5}
                  />
                  <circle cx={a.x} cy={a.y} r={3} className="fill-rose-600" />
                  {measure.b && <circle cx={b.x} cy={b.y} r={3} className="fill-rose-600" />}
                  {measure.b && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 6}
                      textAnchor="middle"
                      className="fill-rose-700 text-[11px] font-semibold"
                    >
                      {dist} мм
                    </text>
                  )}
                </>
              );
            })()}
          </g>
        )}
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-2 text-[11px]">
        <span className="pointer-events-auto rounded-sm bg-background/90 px-2 py-1 text-muted-foreground shadow-sm">
          Высота помещений — 3,15 м
        </span>
        <span className="pointer-events-auto rounded-sm bg-background/90 px-2 py-1 text-muted-foreground shadow-sm">
          Масштаб 1 : {Math.round(1 / view.scale)}
        </span>
        <button
          type="button"
          onClick={fit}
          className="pointer-events-auto rounded-sm border border-border bg-background px-2 py-1 text-foreground shadow-sm hover:border-accent"
        >
          Вписать
        </button>
        {measure && (
          <button
            type="button"
            onClick={() => setMeasure(null)}
            className="pointer-events-auto rounded-sm border border-border bg-background px-2 py-1 text-foreground shadow-sm hover:border-accent"
          >
            Убрать линейку
          </button>
        )}
      </div>
    </div>
  );
}
