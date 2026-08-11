import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls, Sky } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import { BASE_MODULE } from "@/lib/house-project/catalog";
import {
  boundsOf,
  defOf,
  footprintOf,
  localFace,
  localToWorld,
  moduleLevelMm,
  rectOf,
} from "@/lib/house-project/geometry";
import type { HouseModel, ModuleInstance, OpeningInstance } from "@/lib/house-project/types";
import { FACE_IDS } from "@/lib/house-project/types";

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

interface Props {
  model: HouseModel;
  autoRotate?: boolean;
  /** Показывать основание и землю. На странице проекта — да, в редакторе — по желанию. */
  showGround?: boolean;
}

/** Проёмы одной грани модуля — тонкие пластины поверх стены. */
function FaceOpenings({
  module,
  openings,
  centre,
}: {
  module: ModuleInstance;
  openings: OpeningInstance[];
  centre: [number, number];
}) {
  const def = defOf(module);
  const level = moduleLevelMm(module) * MM;

  return (
    <>
      {openings.map((o) => {
        const face = localFace(def, o.faceId);
        const from = localToWorld(module, face.from);
        const to = localToWorld(module, face.to);
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        if (!len) return null;
        const ux = (to.x - from.x) / len;
        const uy = (to.y - from.y) / len;

        const midMm = o.offsetMm + o.widthMm / 2;
        const px = from.x + ux * midMm;
        const py = from.y + uy * midMm;
        const [sx, sz] = toScene(px, py);

        // Поворот пластины вокруг вертикали: направление грани в плане
        // переносится в сцену с учётом перевёрнутой оси глубины.
        const angle = Math.atan2(-uy, ux);

        return (
          <mesh
            key={o.id}
            position={[
              sx - centre[0] + ux * 0.02,
              level + (o.sillMm + o.heightMm / 2) * MM,
              sz - centre[1] - -uy * 0.02,
            ]}
            rotation={[0, angle, 0]}
          >
            <planeGeometry args={[o.widthMm * MM, o.heightMm * MM]} />
            <meshStandardMaterial
              color={o.kind === "door" ? "#5a4632" : o.kind === "passage" ? "#e8e6e1" : "#22333b"}
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

function ModuleBox({
  module,
  openings,
  centre,
}: {
  module: ModuleInstance;
  openings: OpeningInstance[];
  centre: [number, number];
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
      <mesh position={[sx - centre[0], y, sz - centre[1]]} castShadow receiveShadow>
        <boxGeometry args={[f.widthMm * MM, height, f.depthMm * MM]} />
        <meshStandardMaterial color="#e9e7e2" roughness={0.85} metalness={0} />
        <Edges threshold={15} color="#3b3a37" />
      </mesh>
      <FaceOpenings module={module} openings={openings} centre={centre} />
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

export default function HouseView3D({ model, autoRotate = false, showGround = true }: Props) {
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
        shadow-bias={-0.0004}
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
        />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[0, BASE_MODULE.clearHeightMm * MM * 0.5, 0]}
        minDistance={span * 0.4}
        maxDistance={span * 3}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2 - 0.05}
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
        makeDefault
      />
    </Canvas>
  );
}

export { FACE_IDS };
