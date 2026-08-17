import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignEditor } from "@/lib/house-project/editor";
import { BASE_MODULE, DEFAULT_MODULE_TYPE_ID } from "@/lib/house-project/catalog";
import {
  boundsOf,
  defOf,
  footprintOf,
  localFace,
  localToWorld,
  openingSegment,
  rectOf,
  worldFace,
} from "@/lib/house-project/geometry";
import {
  nearestFace,
  placeOnFace,
  presetWidthOn,
  wallOf,
  type FaceHit,
} from "@/lib/house-project/opening-place";
import { overlapsAny } from "@/lib/house-project/overlap";
import { pickAnchor, snapAnchors, snapToStep, type SnapAnchor } from "@/lib/house-project/snap";
import type { FaceId, ModuleInstance, OpeningKind } from "@/lib/house-project/types";
import { FACE_IDS } from "@/lib/house-project/types";
import { cn } from "@/lib/utils";

/** Тип данных перетаскивания «проём из панели инструментов». */
export const OPENING_DND_TYPE = "application/x-ecocub-opening";

/** Как проём называется в подсказке под курсором. */
const OPENING_LABELS: Record<OpeningKind, string> = {
  window: "Окно",
  door: "Дверь",
  panoramic: "Витраж",
  passage: "Проём",
};

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
  /** Пресет проёма, взятый в верхней панели и ждущий стены. */
  openingPresetId: string | null;
  /** Проём поставлен — панель гасит подсветку взятого инструмента. */
  onOpeningToolDone: () => void;
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

/**
 * На каком расстоянии от стены проём считается наведённым на неё, пикселей.
 *
 * Больше порога примагничивания модулей: попасть в линию труднее, чем в
 * прямоугольник, а промах здесь ничего не портит — проём просто не ставится.
 */
const FACE_PICK_PX = 46;

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

export function PlanCanvas({
  editor,
  tool,
  snapStepMm,
  showOtherFloors,
  onFacePick,
  openingPresetId,
  onOpeningToolDone,
}: Props) {
  const { state, dispatch } = editor;
  const { project, activeFloor, selection } = state;
  const modules = project.model.modules;

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [view, setView] = useState<View>(() => ({ x: -2000, y: 10000, scale: 0.03 }));
  const [fitted, setFitted] = useState(false);

  // Всегда свежий view для нативных обработчиков щипка (эффект ниже не должен
  // пересоздавать слушатели на каждое изменение view — иначе жест дёргается).
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  // Пока активен щипок двумя пальцами, одиночные жесты (перетаскивание модуля,
  // рамка выделения) не должны стартовать от второго пальца — иначе второе
  // касание одновременно и масштабирует, и тащит объект под собой.
  const pinchActiveRef = useRef(false);

  const [drag, setDrag] = useState<{
    ids: string[];
    startModel: { x: number; y: number };
    origin: Map<string, { x: number; y: number }>;
    current: { x: number; y: number };
    anchor: SnapAnchor | null;
  } | null>(null);
  const [pan, setPan] = useState<{ px: number; py: number; view: View } | null>(null);
  /** Рамка выделения: две точки в координатах модели. */
  const [marquee, setMarquee] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    additive: boolean;
    base: string[];
  } | null>(null);
  /** Перетаскивание проёма вдоль его грани. */
  const [openingDrag, setOpeningDrag] = useState<{
    id: string;
    startOffsetMm: number;
    startAlongMm: number;
    currentOffsetMm: number;
  } | null>(null);
  const [measure, setMeasure] = useState<{
    a: { x: number; y: number };
    b?: { x: number; y: number };
  } | null>(null);
  const [hoverFace, setHoverFace] = useState<string | null>(null);
  /** Проём под курсором — по нему рисуется подсказка «клик — изменить». */
  const [hoverOpening, setHoverOpening] = useState<string | null>(null);
  /** Курсор в координатах модели: по нему живут оба призрака. */
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<
    | { kind: "module"; id: string; px: number; py: number }
    | { kind: "opening"; id: string; px: number; py: number }
    | null
  >(null);

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

  // Escape убирает линейку и закрывает меню. Кнопка «Убрать линейку» внизу
  // никуда не делась, но человек, поставивший отрезок случайно, ищет сначала
  // Escape — а не глазами по углам экрана.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Пока курсор в поле ввода, Delete стирает цифру, а не объект. Без
      // этой проверки правка ширины числом заканчивалась бы удалением проёма.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        setMeasure(null);
        setMenu(null);
        setMarquee(null);
        // Взятый в панели проём тоже кладётся обратно: держать его в руке
        // после отказа не должен ни один инструмент.
        onOpeningToolDone();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selectedOpeningId) {
          e.preventDefault();
          dispatch({ type: "delete-opening", id: state.selectedOpeningId });
        } else if (selection.length) {
          e.preventDefault();
          dispatch({ type: "delete-modules", ids: selection });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpeningToolDone, dispatch, state.selectedOpeningId, selection]);

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

  /* --- Масштаб щипком (тачскрин) ---------------------------------------
   *
   * На тачскрине колеса мыши нет — без этого эффекта отдалить план вообще
   * нечем. Слушатели нативные (не React onPointer*), потому что должны
   * видеть оба пальца независимо от того, на что именно попал второй —
   * хоть на модуль, хоть на пустое место, — а React-обработчики на
   * элементах глушат всплытие через stopPropagation.
   */
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const pts = new Map<number, { x: number; y: number }>();
    let start: { dist: number; midPx: { x: number; y: number }; view: View } | null = null;

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const midOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2) return;

      pinchActiveRef.current = true;
      // Второй палец мог начать одиночный жест первым касанием — гасим его,
      // иначе модуль одновременно и двигается, и участвует в масштабировании.
      setDrag(null);
      setMarquee(null);
      setPan(null);
      setOpeningDrag(null);

      const [a, b] = Array.from(pts.values());
      const rect = el.getBoundingClientRect();
      const m = midOf(a, b);
      start = {
        dist: dist(a, b),
        midPx: { x: m.x - rect.left, y: m.y - rect.top },
        view: viewRef.current,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2 || !start) return;
      e.preventDefault();

      const [a, b] = Array.from(pts.values());
      const rect = el.getBoundingClientRect();
      const factor = dist(a, b) / start.dist;
      const sv = start.view;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, sv.scale * factor));
      // Та же логика привязки, что у колеса: модельная точка под НАЧАЛЬНОЙ
      // серединой пальцев следует за текущей серединой — так жест одновременно
      // и масштабирует, и панорамирует, как в любом карточном приложении.
      const mx = sv.x + start.midPx.x / sv.scale;
      const my = sv.y - start.midPx.y / sv.scale;
      const m = midOf(a, b);
      const curPx = { x: m.x - rect.left, y: m.y - rect.top };
      setView({ scale, x: mx - curPx.x / scale, y: my + curPx.y / scale });
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      // Пересчитываем щипок заново, если останется/появится вторая точка —
      // иначе следующий кадр использует расстояние от уже отпущенного пальца.
      start = null;
      if (pts.size < 2) pinchActiveRef.current = false;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
    };
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

  /* --- Призрак нового модуля ------------------------------------------- */

  /**
   * Модуль, которого ещё нет, но видно, где он встанет.
   *
   * Раньше «Модуль» работал вслепую: клик по пустому месту — и кубик появлялся
   * там, где пришёлся угол курсора, часто со ступенькой к соседу, которую потом
   * приходилось исправлять перетаскиванием. Призрак показывает результат до
   * нажатия, и примагничивается он тем же кодом, что и настоящее
   * перетаскивание, — двух правд о «вплотную» в редакторе быть не должно.
   *
   * Курсор держит середину модуля, а не угол: целятся в место, где будет
   * комната, а не в её левый нижний угол.
   */
  const ghost = useMemo(() => {
    if (tool !== "add" || !hoverPoint) return null;
    const probe: ModuleInstance = {
      id: "__ghost__",
      moduleTypeId: DEFAULT_MODULE_TYPE_ID,
      floor: activeFloor,
      positionMm: { x: 0, y: 0 },
      rotationDeg: 0,
    };
    const f = footprintOf(probe);
    const rawX = hoverPoint.x - f.widthMm / 2;
    const rawY = hoverPoint.y - f.depthMm / 2;
    const candidates = snapAnchors(modules, probe, snapStepMm);
    const picked = pickAnchor(candidates, rawX, rawY, SNAP_THRESHOLD_PX / view.scale);
    const positionMm = picked
      ? { x: picked.x, y: picked.y }
      : { x: snapToStep(rawX, snapStepMm), y: snapToStep(rawY, snapStepMm) };

    // Вне привязки курсор может увести модуль на соседа. Ставить его туда
    // нельзя — два объёма не занимают одно место, — поэтому наложение видно
    // ещё до нажатия, а само нажатие в этом положении ничего не делает.
    const collides = overlapsAny({ ...probe, positionMm }, modules);

    return {
      module: { ...probe, positionMm },
      anchors: candidates,
      picked,
      collides,
      widthMm: f.widthMm,
      depthMm: f.depthMm,
    };
  }, [tool, hoverPoint, activeFloor, modules, snapStepMm, view.scale]);

  /* --- Призрак проёма --------------------------------------------------- */

  /**
   * Пресет, ждущий стены.
   *
   * Один и тот же для обоих способов взять проём — кликом по кнопке панели и
   * перетаскиванием её на план. Так и должно быть: во время HTML-перетаскивания
   * `dataTransfer.getData` намеренно возвращает пустую строку, читать данные
   * разрешено только в момент отпускания. Значит, знать пресет заранее может
   * лишь тот, кто начал перетаскивание, — панель. Она его и объявляет.
   */
  const placingPresetId = openingPresetId;

  /**
   * Куда встанет проём, если отпустить кнопку прямо сейчас.
   *
   * Стена ищется по расстоянию до отрезка, а не попаданием в тонкую полоску:
   * проём достаточно поднести к стене. Ширина и положение считаются той же
   * функцией, что и при настоящей постановке, поэтому показанное на экране и
   * записанное в модель не могут разойтись.
   */
  const openingPreview = useMemo(() => {
    if (!placingPresetId || !hoverPoint) return null;
    const hit: FaceHit | null = nearestFace(
      modules,
      activeFloor,
      hoverPoint,
      FACE_PICK_PX / view.scale,
    );
    if (!hit) return null;
    const module = modules.find((m) => m.id === hit.moduleId);
    if (!module) return null;
    const width = presetWidthOn(module, hit.faceId, placingPresetId);
    const placed = placeOnFace(hit.spanMm, hit.alongMm, width, wallOf(module));
    const seg = openingSegment(module, {
      id: "__preview__",
      moduleId: module.id,
      faceId: hit.faceId,
      kind: "window",
      offsetMm: placed.offsetMm,
      widthMm: placed.widthMm,
      heightMm: 0,
      sillMm: 0,
    });
    return seg ? { hit, placed, seg } : null;
  }, [placingPresetId, hoverPoint, modules, activeFloor, view.scale]);

  /** Поставить проём в подсвеченную стену. Возвращает, получилось ли. */
  const placeOpening = useCallback(
    (presetId: string, point: { x: number; y: number }) => {
      const hit = nearestFace(modules, activeFloor, point, FACE_PICK_PX / view.scale);
      if (!hit) return false;
      dispatch({
        type: "add-opening",
        moduleId: hit.moduleId,
        faceId: hit.faceId,
        presetId,
        alongMm: hit.alongMm,
      });
      return true;
    },
    [modules, activeFloor, view.scale, dispatch],
  );

  const onPointerDownModule = (e: React.PointerEvent, m: ModuleInstance) => {
    // Второй палец щипка мог попасть прямо на модуль — это не начало
    // перетаскивания, а часть жеста масштабирования.
    if (pinchActiveRef.current) return;
    // Пока в руке проём, модуль под курсором — это стена, в которую целятся,
    // а не объект, который двигают. Событие уходит наверх, к постановке.
    if (placingPresetId) return;
    if (tool !== "select") return;
    e.stopPropagation();
    setMenu(null);

    // Правая кнопка выбирает объект и открывает меню, но ничего не двигает:
    // иначе вызов меню сдвигал бы модуль на пиксель-другой.
    if (e.button === 2) {
      if (!selection.includes(m.id)) dispatch({ type: "select", ids: [m.id] });
      const rect = hostRef.current?.getBoundingClientRect();
      setMenu({
        kind: "module",
        id: m.id,
        px: e.clientX - (rect?.left ?? 0),
        py: e.clientY - (rect?.top ?? 0),
      });
      return;
    }

    (e.target as Element).setPointerCapture?.(e.pointerId);

    // Shift и Ctrl добавляют модуль к выделению и убирают из него: без этого
    // групповые операции недостижимы — выбрать второй модуль было бы нечем.
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids: string[];
    if (additive) {
      ids = selection.includes(m.id) ? selection.filter((id) => id !== m.id) : [...selection, m.id];
      dispatch({ type: "select", ids });
      // Снятие выделения не должно начинать перетаскивание.
      if (!ids.includes(m.id)) return;
    } else {
      ids = selection.includes(m.id) ? selection : [m.id];
      if (!selection.includes(m.id)) dispatch({ type: "select", ids });
    }

    const start = pointerModel(e);
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const mod = modules.find((x) => x.id === id);
      if (mod) origin.set(id, { ...mod.positionMm });
    }
    setDrag({ ids, startModel: start, origin, current: start, anchor: null });
  };

  /**
   * Проекция точки на грань проёма: сколько миллиметров от начала грани.
   *
   * Проём живёт на прямой, а курсор — на плоскости, поэтому перетаскивание
   * считается скалярным произведением на направляющую грани. Иначе проём
   * «убегал» бы от курсора при движении поперёк стены.
   */
  const alongFaceMm = useCallback(
    (m: ModuleInstance, faceId: FaceId, p: { x: number; y: number }): number => {
      const face = worldFace(m, faceId);
      const dx = face.to.x - face.from.x;
      const dy = face.to.y - face.from.y;
      const len = Math.hypot(dx, dy);
      if (!len) return 0;
      return ((p.x - face.from.x) * dx + (p.y - face.from.y) * dy) / len;
    },
    [],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    // Курсор запоминается только когда его кто-то ждёт: в режиме выбора это
    // была бы перерисовка всего плана на каждое движение мыши впустую.
    if (tool === "add" || placingPresetId) setHoverPoint(pointerModel(e));
    else if (hoverPoint) setHoverPoint(null);

    if (pan) {
      const dx = (e.clientX - pan.px) / pan.view.scale;
      const dy = (e.clientY - pan.py) / pan.view.scale;
      setView({ ...pan.view, x: pan.view.x - dx, y: pan.view.y + dy });
      return;
    }
    if (marquee) {
      const to = pointerModel(e);
      setMarquee({ ...marquee, to });
      // Выделение обновляется прямо во время протяжки: человек должен видеть,
      // что попадёт в рамку, до того как отпустит кнопку.
      const inside = modulesInRect(marquee.from, to);
      const ids = marquee.additive ? [...new Set([...marquee.base, ...inside])] : inside;
      if (ids.join() !== selection.join()) dispatch({ type: "select", ids });
      return;
    }
    if (openingDrag) {
      const opening = project.model.openings.find((o) => o.id === openingDrag.id);
      const module = opening ? modules.find((m) => m.id === opening.moduleId) : undefined;
      if (!opening || !module) return;
      const along = alongFaceMm(module, opening.faceId, pointerModel(e));
      const span = localFace(defOf(module), opening.faceId).spanMm;
      const raw = openingDrag.startOffsetMm + (along - openingDrag.startAlongMm);
      // Проём не может выйти за грань — и не выходит уже в момент таскания,
      // а не после проверки. Значение держится в состоянии перетаскивания и
      // уходит в модель один раз, на отпускании: иначе каждое движение мыши
      // легло бы отдельным шагом в историю отмены.
      setOpeningDrag({
        ...openingDrag,
        currentOffsetMm: Math.max(0, Math.min(span - opening.widthMm, Math.round(raw))),
      });
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

  /** Положения модулей, если перетаскивание закончить прямо сейчас. */
  const dragMoves = useCallback((): { id: string; x: number; y: number }[] => {
    if (!drag) return [];
    if (drag.anchor && drag.ids.length === 1) {
      return [{ id: drag.ids[0], x: drag.anchor.x, y: drag.anchor.y }];
    }
    const dx = drag.current.x - drag.startModel.x;
    const dy = drag.current.y - drag.startModel.y;
    return drag.ids.map((id) => {
      const o = drag.origin.get(id)!;
      return { id, x: snapToStep(o.x + dx, snapStepMm), y: snapToStep(o.y + dy, snapStepMm) };
    });
  }, [drag, snapStepMm]);

  /**
   * Наложится ли перетаскиваемое на чужой объём.
   *
   * Считается на каждое движение мыши, чтобы контур успел покраснеть до
   * отпускания кнопки. Двигаемые модули сверяются с неподвижными и между
   * собой: групповое перетаскивание тоже не должно схлопывать группу.
   */
  const dragCollides = useMemo(() => {
    if (!drag) return false;
    const moved = new Map(dragMoves().map((mv) => [mv.id, mv]));
    const next = modules.map((m) => {
      const mv = moved.get(m.id);
      return mv ? { ...m, positionMm: { x: mv.x, y: mv.y } } : m;
    });
    return next.some((m) => moved.has(m.id) && overlapsAny(m, next));
  }, [drag, dragMoves, modules]);

  const commitDrag = () => {
    if (!drag) return;
    const moves = dragMoves();

    // Наложение не применяется вовсе: модуль возвращается туда, где стоял.
    // Контур к этому моменту уже красный, так что откат не выглядит сбоем.
    if (dragCollides) {
      setDrag(null);
      return;
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

  /** Идентификаторы модулей активного этажа, попавших в прямоугольник. */
  const modulesInRect = useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }): string[] => {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      return modules
        .filter((m) => m.floor === activeFloor)
        .filter((m) => {
          const r = rectOf(m);
          // Достаточно пересечения: требовать полного охвата значит заставлять
          // человека тянуть рамку с запасом за габарит дома.
          return r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY;
        })
        .map((m) => m.id);
    },
    [modules, activeFloor],
  );

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (pinchActiveRef.current) return;
    setMenu(null);
    const p = pointerModel(e);

    // Проём в руке важнее любого другого режима: человек уже выбрал действие
    // в панели, и клик по плану может значить только его.
    if (placingPresetId) {
      // Правая кнопка кладёт инструмент обратно — привычный отказ от действия.
      if (e.button !== 2) placeOpening(placingPresetId, p);
      onOpeningToolDone();
      return;
    }

    if (tool === "add") {
      // В наложение модуль не ставится вовсе. Призрак уже красный и подписан,
      // так что отказ не выглядит поломкой: человек видел, куда целится.
      if (ghost?.collides) return;
      // Ставим ровно туда, где нарисован призрак, а не туда, где курсор:
      // иначе примагничивание было бы обманом — показали одно, сделали другое.
      const pos = ghost?.module.positionMm ?? {
        x: snapToStep(p.x, snapStepMm),
        y: snapToStep(p.y, snapStepMm),
      };
      dispatch({ type: "add-module", x: pos.x, y: pos.y });
      return;
    }
    if (tool === "measure") {
      setMeasure((prev) => (prev && !prev.b ? { ...prev, b: p } : { a: p }));
      return;
    }

    // Правая и средняя кнопки двигают лист, левая тянет рамку выделения.
    // Разделение обычное для чертёжных программ: без него нельзя выбрать
    // несколько модулей, а панорамирование остаётся под привычной рукой.
    if (e.button === 2 || e.button === 1) {
      setPan({ px: e.clientX, py: e.clientY, view });
      return;
    }

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    setMarquee({ from: p, to: p, additive, base: additive ? selection : [] });
    if (!additive && selection.length) dispatch({ type: "select", ids: [] });
  };

  /**
   * Отпускание кнопки: доводим до конца то, что было начато.
   *
   * Обработчик висит только на контейнере, и это важно. Захват указателя
   * (`setPointerCapture`) перенаправляет pointerup на сам модуль или проём, но
   * событие после этого продолжает всплывать до контейнера. Пока такой же
   * обработчик стоял и на элементе, и на контейнере, каждое перетаскивание
   * заканчивалось двумя одинаковыми действиями: состояние внутри одного
   * события ещё не успевало обновиться, и вторая проверка видела ту же
   * незавершённую операцию. Внешне ничего не менялось, а в истории отмены
   * появлялся лишний шаг — первое нажатие «отменить» выглядело как
   * неработающая кнопка.
   */
  const finishGesture = () => {
    commitDrag();
    if (openingDrag) {
      const opening = project.model.openings.find((o) => o.id === openingDrag.id);
      if (opening && opening.offsetMm !== openingDrag.currentOffsetMm) {
        dispatch({
          type: "patch-opening",
          id: openingDrag.id,
          patch: { offsetMm: openingDrag.currentOffsetMm },
        });
      }
      setOpeningDrag(null);
    }
    setMarquee(null);
    setPan(null);
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
              : dragging && dragCollides
                ? "fill-destructive/15 stroke-destructive"
                : selected
                  ? "fill-accent/15 stroke-accent"
                  : "fill-card stroke-foreground/70",
          )}
          strokeWidth={selected ? 2 : 1.2}
          style={{ cursor: ghost ? "default" : tool === "select" ? "move" : "crosshair" }}
          onPointerDown={(e) => !ghost && onPointerDownModule(e, m)}
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
            if (placingPresetId || tool !== "select") return;
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
      className={cn(
        "relative h-full w-full touch-none overflow-hidden rounded-sm border bg-[#fafaf9]",
        placingPresetId ? "border-accent" : "border-border",
      )}
      style={{ cursor: placingPresetId || tool === "add" ? "crosshair" : undefined }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishGesture}
      onPointerLeave={() => {
        finishGesture();
        setHoverPoint(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      /*
        Перетаскивание из панели инструментов.

        Обычный HTML-drag, а не своя реализация на указателе: браузер сам
        рисует «взятый» элемент и сам решает, что делать при отпускании за
        пределами плана. Координаты в dragover приходят те же экранные, что и
        в событиях указателя, поэтому призрак считается одним и тем же кодом.
      */
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(OPENING_DND_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        const rect = hostRef.current?.getBoundingClientRect();
        if (rect) setHoverPoint(toModel(e.clientX - rect.left, e.clientY - rect.top));
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(OPENING_DND_TYPE) || placingPresetId;
        const rect = hostRef.current?.getBoundingClientRect();
        if (id && rect) placeOpening(id, toModel(e.clientX - rect.left, e.clientY - rect.top));
        setHoverPoint(null);
        onOpeningToolDone();
      }}
      onDragLeave={() => setHoverPoint(null)}
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
            // Во время перетаскивания проём рисуется по временному смещению:
            // в модель оно уходит один раз, на отпускании кнопки.
            const shown =
              openingDrag?.id === o.id ? { ...o, offsetMm: openingDrag.currentOffsetMm } : o;
            const seg = openingSegment(m, shown);
            if (!seg) return null;
            const a = toScreen(seg.from.x, seg.from.y);
            const b = toScreen(seg.to.x, seg.to.y);
            const selected = state.selectedOpeningId === o.id;
            const hovered = hoverOpening === o.id;

            const onDown = (e: React.PointerEvent) => {
              // С проёмом в руке существующий проём не перехватывает клик:
              // иначе поставить второе окно рядом с первым было бы нельзя.
              if (placingPresetId) return;
              e.stopPropagation();
              setMenu(null);
              dispatch({ type: "select-opening", id: o.id });

              if (e.button === 2) {
                const rect = hostRef.current?.getBoundingClientRect();
                setMenu({
                  kind: "opening",
                  id: o.id,
                  px: e.clientX - (rect?.left ?? 0),
                  py: e.clientY - (rect?.top ?? 0),
                });
                return;
              }
              if (tool !== "select") return;
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              setOpeningDrag({
                id: o.id,
                startOffsetMm: o.offsetMm,
                startAlongMm: alongFaceMm(m, o.faceId, pointerModel(e)),
                currentOffsetMm: o.offsetMm,
              });
            };

            return (
              <g key={o.id}>
                {/*
                  Невидимая полоса под проёмом — то, во что человек на самом
                  деле целится. Сам проём рисуется линией в 4,5 пикселя: это
                  правильная толщина для чертежа, но промахнуться по ней мышью
                  можно почти всегда. Разводить «как выглядит» и «куда можно
                  попасть» — обычный приём, и здесь он обязателен: иначе
                  поставленное окно потом нельзя ни подвинуть, ни удалить.
                */}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  strokeWidth={18}
                  strokeLinecap="butt"
                  className="stroke-transparent"
                  style={{ cursor: placingPresetId ? "crosshair" : "grab" }}
                  onPointerEnter={() => setHoverOpening(o.id)}
                  onPointerLeave={() => setHoverOpening((cur) => (cur === o.id ? null : cur))}
                  onPointerDown={onDown}
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  strokeWidth={selected ? 7 : hovered ? 6.5 : 4.5}
                  strokeLinecap="butt"
                  className={cn(
                    "pointer-events-none transition-[stroke-width]",
                    selected
                      ? "stroke-accent"
                      : hovered
                        ? "stroke-accent/80"
                        : o.kind === "door"
                          ? "stroke-amber-600"
                          : o.kind === "passage"
                            ? "stroke-emerald-600"
                            : "stroke-sky-600",
                  )}
                />
              </g>
            );
          })}
        </g>

        {/*
          Подсказка при наведении на проём.

          Пока её не было, проём выглядел как декоративная чёрточка на стене:
          что он вообще нажимается, знал только тот, кто его поставил. Здесь
          прямо сказано, что это и что с ним делать, — а курсор уже сменился
          на «взять».
        */}
        {hoverOpening &&
          !placingPresetId &&
          !openingDrag &&
          (() => {
            const o = project.model.openings.find((x) => x.id === hoverOpening);
            const m = o ? modules.find((x) => x.id === o.moduleId) : undefined;
            if (!o || !m || m.floor !== activeFloor) return null;
            const seg = openingSegment(m, o);
            if (!seg) return null;
            const mid = toScreen((seg.from.x + seg.to.x) / 2, (seg.from.y + seg.to.y) / 2);
            const band = o.bandId
              ? project.model.openings.filter((x) => x.bandId === o.bandId).length
              : 0;
            const label =
              `${OPENING_LABELS[o.kind]} ${o.widthMm} мм` + (band > 1 ? ` · лента из ${band}` : "");
            const hint = "клик — изменить, правая кнопка — удалить";
            const width = Math.max(label.length, hint.length) * 6.1 + 26;
            const top = Math.max(4, mid.y - 46);
            const left = Math.min(Math.max(4, mid.x - width / 2), size.width - width - 4);
            return (
              <g className="pointer-events-none">
                <rect
                  x={left}
                  y={top}
                  width={width}
                  height={38}
                  rx={4}
                  className="fill-foreground/90"
                />
                {/* Значок «нажми»: стрелка курсора перед первой строкой. */}
                <path
                  d={`M${left + 9} ${top + 10} l0 11 l2.6 -2.6 l1.9 4.2 l1.9 -0.9 l-1.9 -4.1 l3.4 -0.2 z`}
                  className="fill-background"
                />
                <text
                  x={left + 24}
                  y={top + 16}
                  className="fill-background text-[11px] font-medium"
                >
                  {label}
                </text>
                <text x={left + 12} y={top + 30} className="fill-background/70 text-[10px]">
                  {hint}
                </text>
              </g>
            );
          })()}

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

        {/*
          Призрак нового модуля.

          Полупрозрачный, пунктиром, с подписью габарита — и с точками всех
          положений, куда он может встать вплотную к соседям. Точка, в которую
          он примагнитился, залита цветом: видно не только «куда встанет», но и
          «почему именно туда».
        */}
        {ghost && (
          <g className="pointer-events-none">
            {ghost.anchors.slice(0, 400).map((a, i) => {
              const p = toScreen(a.x + ghost.widthMm / 2, a.y + ghost.depthMm / 2);
              const active = ghost.picked?.x === a.x && ghost.picked?.y === a.y;
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
            {(() => {
              const r = rectOf(ghost.module);
              const p = toScreen(r.x, r.y + r.h);
              const w = r.w * view.scale;
              const h = r.h * view.scale;
              const wall = defOf(ghost.module).wallThicknessMm * view.scale;
              return (
                <>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={w}
                    height={h}
                    className={
                      ghost.collides
                        ? "fill-destructive/15 stroke-destructive"
                        : "fill-accent/15 stroke-accent"
                    }
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                  />
                  {wall > 1.5 && (
                    <rect
                      x={p.x + wall}
                      y={p.y + wall}
                      width={Math.max(0, w - wall * 2)}
                      height={Math.max(0, h - wall * 2)}
                      className={cn(
                        "fill-none",
                        ghost.collides ? "stroke-destructive/40" : "stroke-accent/40",
                      )}
                      strokeWidth={1}
                    />
                  )}
                  {w > 46 && (
                    <text
                      x={p.x + w / 2}
                      y={p.y + h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={cn(
                        "select-none text-[10px] font-medium",
                        ghost.collides ? "fill-destructive" : "fill-accent",
                      )}
                    >
                      {ghost.collides ? "наложение" : ghost.picked ? "вплотную" : `${r.w} × ${r.h}`}
                    </text>
                  )}
                </>
              );
            })()}
          </g>
        )}

        {/* Призрак проёма: подсвеченная стена и отрезок будущего проёма. */}
        {openingPreview && (
          <g className="pointer-events-none">
            {(() => {
              const module = modules.find((m) => m.id === openingPreview.hit.moduleId);
              if (!module) return null;
              const face = worldFace(module, openingPreview.hit.faceId);
              const fa = toScreen(face.from.x, face.from.y);
              const fb = toScreen(face.to.x, face.to.y);
              const a = toScreen(openingPreview.seg.from.x, openingPreview.seg.from.y);
              const b = toScreen(openingPreview.seg.to.x, openingPreview.seg.to.y);
              return (
                <>
                  <line
                    x1={fa.x}
                    y1={fa.y}
                    x2={fb.x}
                    y2={fb.y}
                    strokeWidth={3}
                    className="stroke-accent/35"
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    strokeWidth={7}
                    strokeLinecap="butt"
                    className="stroke-accent"
                  />
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 12}
                    textAnchor="middle"
                    className="fill-accent text-[11px] font-semibold"
                  >
                    {openingPreview.placed.widthMm} мм · {openingPreview.hit.faceId}
                  </text>
                </>
              );
            })()}
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

        {/* Рамка выделения */}
        {marquee && (
          <rect
            className="pointer-events-none fill-accent/10 stroke-accent"
            strokeWidth={1}
            strokeDasharray="4 3"
            x={Math.min(toScreen(marquee.from.x, 0).x, toScreen(marquee.to.x, 0).x)}
            y={Math.min(toScreen(0, marquee.from.y).y, toScreen(0, marquee.to.y).y)}
            width={Math.abs(toScreen(marquee.to.x, 0).x - toScreen(marquee.from.x, 0).x)}
            height={Math.abs(toScreen(0, marquee.to.y).y - toScreen(0, marquee.from.y).y)}
          />
        )}

        {/* Смещение проёма во время перетаскивания — число, а не «на глаз». */}
        {openingDrag &&
          (() => {
            const o = project.model.openings.find((x) => x.id === openingDrag.id);
            const m = o ? modules.find((x) => x.id === o.moduleId) : undefined;
            if (!o || !m) return null;
            const seg = openingSegment(m, { ...o, offsetMm: openingDrag.currentOffsetMm });
            if (!seg) return null;
            const mid = toScreen((seg.from.x + seg.to.x) / 2, (seg.from.y + seg.to.y) / 2);
            return (
              <text
                x={mid.x}
                y={mid.y - 10}
                textAnchor="middle"
                className="pointer-events-none fill-accent text-[11px] font-semibold"
              >
                {openingDrag.currentOffsetMm} мм
              </text>
            );
          })()}

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
            title="Или нажмите Escape"
            className="pointer-events-auto rounded-sm border border-rose-300 bg-background px-2 py-1 text-rose-700 shadow-sm hover:border-rose-500"
          >
            Убрать линейку · Esc
          </button>
        )}
        {selection.length > 1 && (
          <span className="pointer-events-auto rounded-sm bg-accent/15 px-2 py-1 text-accent shadow-sm">
            Выбрано модулей: {selection.length}
          </span>
        )}
        {/*
          Пока проём в руке, человеку нужно знать две вещи: что делать дальше
          и почему ничего не подсвечивается, если он держит курсор в пустоте.
        */}
        {placingPresetId && (
          <span
            className={cn(
              "pointer-events-auto rounded-sm px-2 py-1 shadow-sm",
              openingPreview
                ? "bg-accent/15 text-accent"
                : "bg-background/90 text-muted-foreground",
            )}
          >
            {openingPreview
              ? "Клик — поставить проём · Esc — отмена"
              : "Наведите на стену дома · Esc — отмена"}
          </span>
        )}
        {tool === "add" && (
          <span
            className={cn(
              "pointer-events-auto rounded-sm px-2 py-1 shadow-sm",
              ghost?.collides ? "bg-destructive/10 text-destructive" : "bg-accent/15 text-accent",
            )}
          >
            {ghost?.collides
              ? "Сюда нельзя: модуль наложится на соседний"
              : ghost?.picked
                ? "Клик — поставить вплотную к соседу"
                : "Клик — поставить модуль"}
          </span>
        )}
        {dragCollides && (
          <span className="pointer-events-auto rounded-sm bg-destructive/10 px-2 py-1 text-destructive shadow-sm">
            Сюда нельзя: модули наложатся друг на друга
          </span>
        )}
      </div>

      {/*
        Контекстное меню. Оно обязательно, а не «в дополнение к горячим
        клавишам»: человек, впервые открывший редактор, не знает про Delete и
        не обязан догадываться. Правая кнопка на объекте — привычный способ
        спросить «что с этим можно сделать».
      */}
      {menu && (
        <div
          className="absolute z-20 min-w-44 rounded-sm border border-border bg-background py-1 shadow-lg"
          style={{
            left: Math.min(menu.px, size.width - 190),
            top: Math.min(menu.py, size.height - 190),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {menu.kind === "module" ? (
            <>
              <MenuHeader>
                {selection.length > 1 ? `Модулей: ${selection.length}` : `Модуль ${menu.id}`}
              </MenuHeader>
              <MenuItem onClick={() => dispatch({ type: "rotate", ids: selection, direction: 1 })}>
                Повернуть на 90°
              </MenuItem>
              <MenuItem onClick={() => dispatch({ type: "mirror", ids: selection })}>
                Отразить
              </MenuItem>
              <MenuItem onClick={() => dispatch({ type: "duplicate-modules", ids: selection })}>
                Дублировать
              </MenuItem>
              <MenuItem
                onClick={() =>
                  dispatch({ type: "move-to-floor", ids: selection, floor: activeFloor + 1 })
                }
              >
                Поднять на {activeFloor + 2}-й этаж
              </MenuItem>
              {activeFloor > 0 && (
                <MenuItem
                  onClick={() =>
                    dispatch({ type: "move-to-floor", ids: selection, floor: activeFloor - 1 })
                  }
                >
                  Опустить на {activeFloor}-й этаж
                </MenuItem>
              )}
              <MenuItem danger onClick={() => dispatch({ type: "delete-modules", ids: selection })}>
                Удалить
              </MenuItem>
            </>
          ) : (
            <>
              <MenuHeader>Проём</MenuHeader>
              <MenuItem danger onClick={() => dispatch({ type: "delete-opening", id: menu.id })}>
                Удалить проём
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );

  function MenuHeader({ children }: { children: React.ReactNode }) {
    return (
      <p className="border-b border-border px-3 pb-1.5 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {children}
      </p>
    );
  }

  function MenuItem({
    children,
    onClick,
    danger,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
  }) {
    return (
      <button
        type="button"
        onClick={() => {
          onClick();
          setMenu(null);
        }}
        className={cn(
          "block w-full px-3 py-1.5 text-left text-[13px] hover:bg-secondary",
          danger && "text-destructive",
        )}
      >
        {children}
      </button>
    );
  }
}
