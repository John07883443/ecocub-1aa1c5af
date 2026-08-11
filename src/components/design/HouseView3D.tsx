import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Edges, OrbitControls, Sky } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import { BASE_MODULE, OPENING_PRESETS, findOpeningPreset } from "@/lib/house-project/catalog";
import {
  boundsOf,
  defOf,
  footprintOf,
  localFace,
  localToWorld,
  moduleLevelMm,
  rectOf,
} from "@/lib/house-project/geometry";
import { nearestFace, placeOnFace, presetWidthOn } from "@/lib/house-project/opening-place";
import type {
  FaceId,
  HouseModel,
  ModuleInstance,
  OpeningInstance,
} from "@/lib/house-project/types";

/**
 * Объём дома по канонической модели. Только просмотр.
 *
 * Отдельная сцена от `constructor/Scene3D` — по необходимости, а не ради
 * симметрии: та работает с кубиками 3 × 3 м и раскрашивает их по назначению
 * помещения, здесь же нужен нейтральный технический вид заводского модуля
 * 3200 × 3420 с настоящими проёмами и отметками. Свести их в одну сцену
 * значило бы протащить миллиметры в публичный конструктор.
 *
 * Подача намеренно скупая: белые объёмы, тёмные контуры, стекло синевой.
 * Это чертёж в объёме, а не визуализация фасада — раскрашивать модули в
 * разные цвета здесь было бы враньём, они все одинаковые.
 *
 * Оси. План ведётся в миллиметрах с осью Y вверх; сцена — в метрах, где
 * вверх это Y, а глубина плана ложится на −Z. Перевод собран в `toScene`.
 */

const MM = 0.001;

function toScene(xMm: number, yMm: number): [number, number] {
  return [xMm * MM, -yMm * MM];
}

/**
 * Точка сцены обратно в миллиметры плана.
 *
 * Нужна для постановки проёма мышью прямо в объёме: луч попадает в стену и
 * даёт точку в метрах сцены, а модель живёт в миллиметрах плана. Обратное
 * преобразование написано здесь, рядом с прямым, — разъехавшаяся пара таких
 * функций даёт зеркальный дом, и найти это глазами почти невозможно.
 */
function fromScene(sx: number, sz: number, centre: [number, number]): { x: number; y: number } {
  return { x: (sx + centre[0]) / MM, y: -(sz + centre[1]) / MM };
}

/** Насколько далеко от плоскости стены точка ещё считается попаданием в неё, мм. */
const FACE_HIT_TOLERANCE_MM = 400;

/**
 * Ракурсы.
 *
 * `top` — ортографический вид сверху: параллельная проекция, в которой
 * ближний угол дома не крупнее дальнего, и габарит можно сверять с планом.
 * Остальные — фасадные направления. Стороны света здесь не называются
 * намеренно: ориентация дома на участке в модели не хранится, и подписать
 * фасад «северным» значило бы сообщить то, чего система не знает. Подписи
 * ракурсов живут в панели редактора.
 */
export type CameraView = "free" | "top" | "north" | "east" | "south" | "west";

interface Props {
  model: HouseModel;
  autoRotate?: boolean;
  /** Показывать основание и землю. На странице проекта — да, в редакторе — по желанию. */
  showGround?: boolean;
  cameraView?: CameraView;
  /**
   * Пресет проёма, взятый в панели инструментов.
   *
   * Пока он задан, сцена перестаёт быть только просмотром: наведение на стену
   * рисует будущий проём, клик его ставит. Публичная страница проекта этих
   * свойств не передаёт и остаётся просмотром, как была.
   */
  openingPresetId?: string | null;
  onPlaceOpening?: (moduleId: string, faceId: FaceId, alongMm: number) => void;
  selectedOpeningId?: string | null;
  onSelectOpening?: (id: string) => void;
}

/** Что будет поставлено, если нажать прямо сейчас. */
interface OpeningPreview {
  moduleId: string;
  faceId: FaceId;
  alongMm: number;
  offsetMm: number;
  widthMm: number;
  sillMm: number;
  heightMm: number;
}

/**
 * Положение пластины проёма в сцене.
 *
 * Вынесено из отрисовки, потому что тем же расчётом живёт призрак будущего
 * проёма: показать одно, а поставить другое — худшее, что может сделать
 * редактор.
 */
function plateTransform(
  module: ModuleInstance,
  faceId: FaceId,
  offsetMm: number,
  widthMm: number,
  sillMm: number,
  heightMm: number,
  centre: [number, number],
): { position: [number, number, number]; rotation: [number, number, number] } {
  const def = defOf(module);
  const face = localFace(def, faceId);
  const from = localToWorld(module, face.from);
  const to = localToWorld(module, face.to);
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;

  const midMm = offsetMm + widthMm / 2;
  const [sx, sz] = toScene(from.x + ux * midMm, from.y + uy * midMm);
  const level = moduleLevelMm(module) * MM;

  return {
    // Пластина чуть вынесена наружу от стены, иначе она мерцает вровень с ней.
    position: [
      sx - centre[0] + ux * 0.02,
      level + (sillMm + heightMm / 2) * MM,
      sz - centre[1] + uy * 0.02,
    ],
    // Поворот вокруг вертикали: направление грани в плане переносится в сцену
    // с учётом перевёрнутой оси глубины.
    rotation: [0, Math.atan2(-uy, ux), 0],
  };
}

/** Проёмы одной грани модуля — тонкие пластины поверх стены. */
function FaceOpenings({
  module,
  openings,
  centre,
  selectedOpeningId,
  onSelectOpening,
}: {
  module: ModuleInstance;
  openings: OpeningInstance[];
  centre: [number, number];
  selectedOpeningId?: string | null;
  onSelectOpening?: (id: string) => void;
}) {
  return (
    <>
      {openings.map((o) => {
        const t = plateTransform(
          module,
          o.faceId,
          o.offsetMm,
          o.widthMm,
          o.sillMm,
          o.heightMm,
          centre,
        );
        const selected = selectedOpeningId === o.id;

        return (
          <mesh
            key={o.id}
            position={t.position}
            rotation={t.rotation}
            onClick={
              onSelectOpening
                ? (e) => {
                    e.stopPropagation();
                    onSelectOpening(o.id);
                  }
                : undefined
            }
          >
            <planeGeometry args={[o.widthMm * MM, o.heightMm * MM]} />
            <meshStandardMaterial
              color={
                selected
                  ? "#b98a3c"
                  : o.kind === "door"
                    ? "#5a4632"
                    : o.kind === "passage"
                      ? "#e8e6e1"
                      : "#22333b"
              }
              roughness={o.kind === "passage" ? 0.9 : 0.25}
              metalness={o.kind === "passage" ? 0 : 0.1}
              transparent={o.kind !== "door" && o.kind !== "passage"}
              opacity={o.kind === "door" || o.kind === "passage" ? 1 : 0.75}
              side={2}
            />
          </mesh>
        );
      })}
    </>
  );
}

/** Полупрозрачная пластина на месте будущего проёма. */
function OpeningGhost({
  preview,
  modules,
  centre,
}: {
  preview: OpeningPreview;
  modules: ModuleInstance[];
  centre: [number, number];
}) {
  const module = modules.find((m) => m.id === preview.moduleId);
  if (!module) return null;
  const t = plateTransform(
    module,
    preview.faceId,
    preview.offsetMm,
    preview.widthMm,
    preview.sillMm,
    preview.heightMm,
    centre,
  );
  return (
    <mesh position={t.position} rotation={t.rotation}>
      <planeGeometry args={[preview.widthMm * MM, preview.heightMm * MM]} />
      <meshBasicMaterial color="#c8973f" transparent opacity={0.45} side={2} depthWrite={false} />
    </mesh>
  );
}

function ModuleBox({
  module,
  openings,
  centre,
  selectedOpeningId,
  onSelectOpening,
  onWallHover,
  onWallClick,
}: {
  module: ModuleInstance;
  openings: OpeningInstance[];
  centre: [number, number];
  selectedOpeningId?: string | null;
  onSelectOpening?: (id: string) => void;
  /** Точка на стене этого модуля в миллиметрах плана. null — курсор ушёл. */
  onWallHover?: (module: ModuleInstance, point: { x: number; y: number } | null) => void;
  onWallClick?: (module: ModuleInstance, point: { x: number; y: number }) => void;
}) {
  const def = defOf(module);
  const f = footprintOf(module);
  const r = rectOf(module);
  const [sx, sz] = toScene(r.x + r.w / 2, r.y + r.h / 2);
  const level = moduleLevelMm(module) * MM;
  // Объём считается от низа плиты пола до верха плиты кровли.
  const height = def.totalHeightMm * MM;
  const y = level - def.floorSlabMm * MM + height / 2;

  return (
    <group>
      <mesh
        position={[sx - centre[0], y, sz - centre[1]]}
        castShadow
        receiveShadow
        onPointerMove={
          onWallHover
            ? (e) => {
                e.stopPropagation();
                onWallHover(module, fromScene(e.point.x, e.point.z, centre));
              }
            : undefined
        }
        onPointerOut={onWallHover ? () => onWallHover(module, null) : undefined}
        onClick={
          onWallClick
            ? (e) => {
                e.stopPropagation();
                onWallClick(module, fromScene(e.point.x, e.point.z, centre));
              }
            : undefined
        }
      >
        <boxGeometry args={[f.widthMm * MM, height, f.depthMm * MM]} />
        <meshStandardMaterial color="#e9e7e2" roughness={0.85} metalness={0} />
        <Edges threshold={15} color="#3b3a37" />
      </mesh>
      <FaceOpenings
        module={module}
        openings={openings}
        centre={centre}
        selectedOpeningId={selectedOpeningId}
        onSelectOpening={onSelectOpening}
      />
    </group>
  );
}

/** Сваи по углам каждого модуля — ровно то, что показано на фасадах альбома. */
function Foundation({ model, centre }: { model: HouseModel; centre: [number, number] }) {
  const clearance = model.foundation.clearanceMm * MM;
  if (model.foundation.kind === "none" || clearance <= 0) return null;

  if (model.foundation.kind === "slab") {
    const b = boundsOf(model.modules);
    const [cx, cz] = toScene(b.minX + b.widthMm / 2, b.minY + b.depthMm / 2);
    return (
      <mesh
        position={[cx - centre[0], -clearance / 2 - BASE_MODULE.floorSlabMm * MM, cz - centre[1]]}
        receiveShadow
      >
        <boxGeometry args={[(b.widthMm + 600) * MM, clearance, (b.depthMm + 600) * MM]} />
        <meshStandardMaterial color="#b9b6b0" roughness={0.95} />
      </mesh>
    );
  }

  return (
    <>
      {model.modules
        .filter((m) => m.floor === 0)
        .flatMap((m) => {
          const r = rectOf(m);
          const inset = 400;
          const corners: [number, number][] = [
            [r.x + inset, r.y + inset],
            [r.x + r.w - inset, r.y + inset],
            [r.x + inset, r.y + r.h - inset],
            [r.x + r.w - inset, r.y + r.h - inset],
          ];
          return corners.map(([x, y], i) => {
            const [sx, sz] = toScene(x, y);
            return (
              <mesh
                key={`${m.id}-${i}`}
                position={[
                  sx - centre[0],
                  -clearance / 2 - BASE_MODULE.floorSlabMm * MM,
                  sz - centre[1],
                ]}
                castShadow
              >
                <cylinderGeometry args={[0.14, 0.14, clearance, 10]} />
                <meshStandardMaterial color="#8d8a84" roughness={0.9} />
              </mesh>
            );
          });
        })}
    </>
  );
}

/**
 * Переводит камеру в выбранный ракурс.
 *
 * Живёт внутри сцены, потому что доступ к камере и к управлению есть только
 * из контекста Canvas. Ракурс применяется при смене `view`, а не каждый кадр:
 * иначе мышь не смогла бы отвести камеру от заданного положения, и режим
 * «свободно» перестал бы существовать.
 */
function CameraRig({ view, span, height }: { view: CameraView; span: number; height: number }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (view === "free") return;
    const d = span * 1.6;
    const target: [number, number, number] = [0, height / 2, 0];
    const position: Record<Exclude<CameraView, "free">, [number, number, number]> = {
      top: [0, span * 3, 0.001],
      north: [0, height / 2, -d],
      east: [d, height / 2, 0],
      south: [0, height / 2, d],
      west: [-d, height / 2, 0],
    };
    camera.position.set(...position[view]);
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
    const orbit = controls as {
      target?: { set: (x: number, y: number, z: number) => void };
      update?: () => void;
    } | null;
    orbit?.target?.set(...target);
    orbit?.update?.();
  }, [view, span, height, camera, controls]);

  return null;
}

export default function HouseView3D({
  model,
  autoRotate = false,
  showGround = true,
  cameraView = "free",
  openingPresetId = null,
  onPlaceOpening,
  selectedOpeningId = null,
  onSelectOpening,
}: Props) {
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const placing = Boolean(openingPresetId && onPlaceOpening);

  /**
   * Что встанет в стену под курсором.
   *
   * Луч попадает в наружную поверхность модуля, поэтому точка попадания в
   * плане лежит ровно на линии грани — та же геометрия, что и на плане, и
   * ищется она той же функцией. Крыша отсекается сама: её точка далеко от
   * всех четырёх граней, и `nearestFace` вернёт null.
   */
  const previewAt = useCallback(
    (module: ModuleInstance, point: { x: number; y: number }): OpeningPreview | null => {
      if (!openingPresetId) return null;
      const hit = nearestFace([module], module.floor, point, FACE_HIT_TOLERANCE_MM);
      if (!hit) return null;
      const preset = findOpeningPreset(openingPresetId) ?? OPENING_PRESETS[0];
      const width = presetWidthOn(module, hit.faceId, openingPresetId);
      const placed = placeOnFace(hit.spanMm, hit.alongMm, width, defOf(module).wallThicknessMm);
      return {
        moduleId: module.id,
        faceId: hit.faceId,
        alongMm: hit.alongMm,
        offsetMm: placed.offsetMm,
        widthMm: placed.widthMm,
        sillMm: preset.sillMm,
        heightMm: preset.heightMm,
      };
    },
    [openingPresetId],
  );

  const handleHover = useCallback(
    (module: ModuleInstance, point: { x: number; y: number } | null) => {
      if (!placing) return;
      setPreview(point ? previewAt(module, point) : null);
    },
    [placing, previewAt],
  );

  const handleClick = useCallback(
    (module: ModuleInstance, point: { x: number; y: number }) => {
      if (!placing) return;
      const next = previewAt(module, point);
      if (!next) return;
      onPlaceOpening?.(next.moduleId, next.faceId, next.alongMm);
      setPreview(null);
    },
    [placing, previewAt, onPlaceOpening],
  );

  // Инструмент положили — призрак должен исчезнуть, а не остаться висеть.
  useEffect(() => {
    if (!placing) setPreview(null);
  }, [placing]);

  const b = useMemo(() => boundsOf(model.modules), [model.modules]);
  const centre = useMemo<[number, number]>(() => {
    const [cx, cz] = toScene(b.minX + b.widthMm / 2, b.minY + b.depthMm / 2);
    return [cx, cz];
  }, [b]);

  const span = Math.max(6, Math.max(b.widthMm, b.depthMm) * MM);
  const openingsByModule = useMemo(() => {
    const map = new Map<string, OpeningInstance[]>();
    for (const o of model.openings) {
      const list = map.get(o.moduleId) ?? [];
      list.push(o);
      map.set(o.moduleId, list);
    }
    return map;
  }, [model.openings]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      camera={{ position: [span * 0.9, span * 0.75, span * 1.1], fov: 42 }}
      // preserveDrawingBuffer нужен для снимка обложки: без него содержимое
      // буфера очищается сразу после кадра, и toBlob возвращает пустой холст.
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#f2f1ee"]} />
      <Sky sunPosition={[40, 30, 20]} turbidity={5} rayleigh={0.9} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[span, span * 1.4, span * 0.6]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={span * 4}
        /*
          Смещение карты теней. Одного `bias` мало: на больших плоских стенах
          он даёт полосатую «лесенку» самозатенения, и с окнами во всю стену
          её видно сквозь стекло на весь фасад. `normalBias` сдвигает выборку
          вдоль нормали и убирает именно этот случай — плоскость, почти
          параллельную лучам света.
        */
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />

      {showGround && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -model.foundation.clearanceMm * MM - BASE_MODULE.floorSlabMm * MM, 0]}
          receiveShadow
        >
          <planeGeometry args={[span * 6, span * 6]} />
          <meshStandardMaterial color="#8a9a72" roughness={1} />
        </mesh>
      )}

      <Foundation model={model} centre={centre} />

      {model.modules.map((m) => (
        <ModuleBox
          key={m.id}
          module={m}
          openings={openingsByModule.get(m.id) ?? []}
          centre={centre}
          selectedOpeningId={selectedOpeningId}
          // Пока проём в руке, существующий не перехватывает клик: иначе
          // поставить второе окно рядом с первым было бы нельзя — луч упёрся
          // бы в пластину. Без обработчика r3f эту пластину не проверяет.
          onSelectOpening={placing ? undefined : onSelectOpening}
          onWallHover={placing ? handleHover : undefined}
          onWallClick={placing ? handleClick : undefined}
        />
      ))}

      {preview && <OpeningGhost preview={preview} modules={model.modules} centre={centre} />}

      <CameraRig view={cameraView} span={span} height={BASE_MODULE.clearHeightMm * MM} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[0, BASE_MODULE.clearHeightMm * MM * 0.5, 0]}
        minDistance={span * 0.4}
        maxDistance={span * 3}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2 - 0.05}
        autoRotate={autoRotate && cameraView === "free"}
        autoRotateSpeed={0.6}
        makeDefault
      />
    </Canvas>
  );
}
