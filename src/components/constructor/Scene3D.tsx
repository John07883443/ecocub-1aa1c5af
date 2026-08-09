import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sky, Edges } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import { CELL_M, MODULE_HEIGHT_M } from "@/lib/constructor/constants";
import { ROLES } from "@/lib/constructor/constants";
import type { DesignPreset, ModuleItem } from "@/lib/constructor/types";

const FOUNDATION_H = 0.35;
const H = MODULE_HEIGHT_M;

interface Props {
  modules: ModuleItem[];
  design: DesignPreset;
  gridN: number;
  autoRotate: boolean;
}

type WindowSpec = { pos: [number, number, number]; rotY: number; w: number; h: number };

function useOccByFloor(modules: ModuleItem[]) {
  return useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const m of modules) {
      const set = map.get(m.floor) ?? new Set<string>();
      set.add(`${m.x}:${m.z}`);
      map.set(m.floor, set);
    }
    return map;
  }, [modules]);
}

function ModuleMesh({
  m,
  design,
  gridN,
  sameFloor,
  aboveFloor,
}: {
  m: ModuleItem;
  design: DesignPreset;
  gridN: number;
  sameFloor: Set<string>;
  aboveFloor: Set<string> | undefined;
}) {
  const toWorld = (cellCol: number) => (cellCol - gridN / 2) * CELL_M;
  const size = CELL_M;
  const centerX = toWorld(m.x + 0.5);
  const centerZ = toWorld(m.z + 0.5);
  const baseY = FOUNDATION_H + m.floor * H;
  const centerY = baseY + H / 2;

  const isTerrace = m.role === "terrace";

  // Окна на внешних гранях (там, где нет соседнего модуля этого этажа).
  const windows = useMemo<WindowSpec[]>(() => {
    if (isTerrace) return [];
    const specs: WindowSpec[] = [];
    const dirs: Array<{ dx: number; dz: number; rotY: number }> = [
      { dx: 1, dz: 0, rotY: Math.PI / 2 },
      { dx: -1, dz: 0, rotY: -Math.PI / 2 },
      { dx: 0, dz: 1, rotY: 0 },
      { dx: 0, dz: -1, rotY: Math.PI },
    ];
    const winY = baseY + H * 0.46;
    for (const d of dirs) {
      if (sameFloor.has(`${m.x + d.dx}:${m.z + d.dz}`)) continue;
      const off = 0.03;
      specs.push({
        pos: [centerX + d.dx * (size / 2 + off), winY, centerZ + d.dz * (size / 2 + off)],
        rotY: d.rotY,
        w: size * 0.66,
        h: H * 0.5,
      });
    }
    return specs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.x, m.z, m.floor, m.role, gridN, sameFloor]);

  const roofed = !aboveFloor || !aboveFloor.has(`${m.x}:${m.z}`);

  if (isTerrace) {
    // Терраса: настил, 4 стойки и лёгкая плоская кровля, без стен.
    const postH = H * 0.92;
    const corners: Array<[number, number]> = [
      [centerX - size / 2 + 0.2, centerZ - size / 2 + 0.2],
      [centerX + size / 2 - 0.2, centerZ - size / 2 + 0.2],
      [centerX - size / 2 + 0.2, centerZ + size / 2 - 0.2],
      [centerX + size / 2 - 0.2, centerZ + size / 2 - 0.2],
    ];
    return (
      <group>
        <mesh position={[centerX, baseY + 0.08, centerZ]} receiveShadow castShadow>
          <boxGeometry args={[size, 0.16, size]} />
          <meshStandardMaterial color={ROLES.terrace.floor3d} roughness={0.9} />
        </mesh>
        {corners.map(([px, pz], i) => (
          <mesh key={i} position={[px, baseY + postH / 2, pz]} castShadow>
            <boxGeometry args={[0.14, postH, 0.14]} />
            <meshStandardMaterial color={design.roof} roughness={0.7} />
          </mesh>
        ))}
        {roofed && (
          <mesh position={[centerX, baseY + postH, centerZ]} castShadow receiveShadow>
            <boxGeometry args={[size + 0.2, 0.16, size + 0.2]} />
            <meshStandardMaterial color={design.roof} roughness={0.7} />
          </mesh>
        )}
      </group>
    );
  }

  return (
    <group>
      {/* Стены */}
      <mesh position={[centerX, centerY, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[size, H, size]} />
        <meshStandardMaterial
          color={design.wall}
          roughness={design.wallRoughness}
          metalness={design.wallMetalness}
        />
        <Edges threshold={15} color="#1a1a1a" />
      </mesh>

      {/* Окна */}
      {windows.map((w, i) => (
        <mesh key={i} position={w.pos} rotation={[0, w.rotY, 0]}>
          <planeGeometry args={[w.w, w.h]} />
          <meshStandardMaterial
            color={design.glass}
            roughness={0.08}
            metalness={0.25}
            transparent
            opacity={0.62}
          />
        </mesh>
      ))}

      {/* Плоская кровля с небольшим свесом */}
      {roofed && (
        <mesh position={[centerX, baseY + H + 0.12, centerZ]} castShadow receiveShadow>
          <boxGeometry args={[size + 0.24, 0.24, size + 0.24]} />
          <meshStandardMaterial color={design.roof} roughness={0.7} />
        </mesh>
      )}

      {/* Фундамент под модулями первого этажа */}
      {m.floor === 0 && (
        <mesh position={[centerX, FOUNDATION_H / 2, centerZ]} receiveShadow castShadow>
          <boxGeometry args={[size + 0.1, FOUNDATION_H, size + 0.1]} />
          <meshStandardMaterial color="#3a3a3c" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

function Ground({ design, gridN }: { design: DesignPreset; gridN: number }) {
  const span = gridN * CELL_M;
  return (
    <group>
      {/* Большой газон вокруг */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[span * 3, span * 3]} />
        <meshStandardMaterial color={design.ground} roughness={1} />
      </mesh>
      {/* Участок */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[span, span]} />
        <meshStandardMaterial color={design.ground} roughness={1} />
        <Edges threshold={1} color="#f4f1ea" />
      </mesh>
    </group>
  );
}

export default function Scene3D({ modules, design, gridN, autoRotate }: Props) {
  const occByFloor = useOccByFloor(modules);
  const span = gridN * CELL_M;
  const sun: [number, number, number] = [span * 0.8, span * 0.9, span * 0.5];

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{
        position: [span * 0.85, span * 0.7, span * 0.95],
        fov: 42,
        near: 0.5,
        far: span * 8,
      }}
    >
      <Sky sunPosition={sun} turbidity={6} rayleigh={1.2} mieCoefficient={0.006} />

      <hemisphereLight args={["#cfe0f0", design.ground, 0.55]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={sun}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={1}
        shadow-camera-far={span * 4}
        shadow-bias={-0.0004}
      />

      <Ground design={design} gridN={gridN} />

      {modules.map((m) => (
        <ModuleMesh
          key={m.id}
          m={m}
          design={design}
          gridN={gridN}
          sameFloor={occByFloor.get(m.floor) ?? new Set()}
          aboveFloor={occByFloor.get(m.floor + 1)}
        />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[0, H, 0]}
        minDistance={span * 0.35}
        maxDistance={span * 2.2}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2 - 0.06}
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
        makeDefault
      />
    </Canvas>
  );
}
