/**
 * 3D-сцена пилота: участок с отступами и севером, кубики двух ярусов, окна и
 * двери из модели, терраса, колонны. Клик по стене выбирает её для правки.
 * Координаты модели: x — восток, y — север (мм). В three: x, высота, −z = север.
 */
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges, Text } from "@react-three/drei";
import { useMemo, type ReactElement } from "react";
import { footprint, bbox, supportOf } from "../engine/geometry.ts";
import { GRAMMAR, FINISHES } from "../grammar/index.ts";
import { columnsFor, modulesOnTier } from "../engine/rules.ts";
import type { ModulePlacement, Opening, Project, Side } from "../engine/types.ts";
import { planFromProject } from "../engine/plan.ts";
import { carportPlace } from "../engine/site.ts";

export interface WallPick {
  moduleId: string;
  side: Side;
}

const H = GRAMMAR.module.externalMm.h / 1000;
const SLAB = 0.3;

const ROOM_TINT: Record<string, string> = {
  "kitchen-living": "#f2e6d0",
  bedroom: "#dfe8f1",
  "wet-core": "#d9efe9",
  study: "#efe2f0",
  hall: "#ece9e2",
};

const FACADE_COLOR: Record<string, string> = {
  "planken-larch": "#b08d63",
  "planken-thermo": "#6b4f35",
  "fiber-cement": "#9a9a96",
  "metal-panel": "#3a3d40",
  "plaster-white": "#f1efea",
  "siding-light": "#e3ded2",
  "planken-dark-stone": "#3b2a1e",
  "plaster-warm": "#e7d9bf",
};

function sideOfNormal(x: number, z: number): Side | null {
  if (x > 0.5) return "E";
  if (x < -0.5) return "W";
  if (z < -0.5) return "N";
  if (z > 0.5) return "S";
  return null;
}

function OpeningMesh({ m, o, ox, oz }: { m: ModulePlacement; o: Opening; ox: number; oz: number }) {
  const r = footprint(m);
  const y0 = (m.tier - 1) * H + SLAB;
  const w = o.widthMm / 1000;
  const h = o.heightMm / 1000;
  const along = (o.face === "N" || o.face === "S" ? r.x0 : r.y0) / 1000 + o.offsetMm / 1000 + w / 2;
  const t = 0.06;
  let pos: [number, number, number];
  let size: [number, number, number];
  switch (o.face) {
    case "N":
      pos = [along - ox, y0 + h / 2, -(r.y1 / 1000) + oz - t / 2 + 0.02];
      size = [w, h, t];
      break;
    case "S":
      pos = [along - ox, y0 + h / 2, -(r.y0 / 1000) + oz + t / 2 - 0.02];
      size = [w, h, t];
      break;
    case "E":
      pos = [r.x1 / 1000 - ox + t / 2 - 0.02, y0 + h / 2, -along + oz];
      size = [t, h, w];
      break;
    case "W":
      pos = [r.x0 / 1000 - ox - t / 2 + 0.02, y0 + h / 2, -along + oz];
      size = [t, h, w];
      break;
  }
  const color = o.kind === "window" ? "#2f4b63" : o.kind === "entrance" ? "#5a3b22" : "#8a6a4a";
  if (o.kind === "internal-door") return null;
  return (
    <mesh position={pos} raycast={() => null}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        metalness={o.kind === "window" ? 0.6 : 0}
        roughness={o.kind === "window" ? 0.15 : 0.7}
      />
    </mesh>
  );
}

export function HouseScene({
  project,
  selected,
  onPick,
  shot,
}: {
  project: Project;
  selected: WallPick | null;
  onPick: (w: WallPick) => void;
  shot?: boolean;
}) {
  const fp = useMemo(() => bbox(project.modules.map(footprint)), [project]);
  // Центр дома — начало сцены; участок рисуется вокруг по посадке.
  const ox = (fp.x0 + fp.x1) / 2000;
  const oz = (fp.y0 + fp.y1) / 2000;
  const facade = FACADE_COLOR[project.finishes.facade] ?? "#cfc8bb";
  const plot = project.plot;
  const style = FINISHES.styles.find((s) => s.id === project.finishes.styleId);
  const t1 = modulesOnTier(project, 1);

  const plotGroup = plot ? (
    <group>
      {(() => {
        const px = project.placementMm.xMm / 1000;
        const py = project.placementMm.yMm / 1000;
        // Участок: начало (юго-западный угол) в координатах дома.
        const x0 = -px - ox;
        const z0 = py + oz;
        const W = plot.widthM;
        const D = plot.depthM;
        const sb = (plot.setbackMm ?? GRAMMAR.site.setbackMm) / 1000;
        return (
          <>
            <mesh
              rotation-x={-Math.PI / 2}
              position={[x0 + W / 2, -0.01, z0 - D / 2]}
              receiveShadow
              raycast={() => null}
            >
              <planeGeometry args={[W, D]} />
              <meshStandardMaterial color="#9bb57a" />
            </mesh>
            <mesh
              rotation-x={-Math.PI / 2}
              position={[x0 + W / 2, 0.005, z0 - D / 2]}
              raycast={() => null}
            >
              <planeGeometry args={[Math.max(0.1, W - 2 * sb), Math.max(0.1, D - 2 * sb)]} />
              <meshStandardMaterial color="#b3c994" transparent opacity={0.6} />
            </mesh>
            <group
              position={[x0 + W - 2, 0.05, z0 - D + 2]}
              rotation-y={((plot.northDeg ?? 0) * Math.PI) / 180}
            >
              <mesh rotation-x={-Math.PI / 2} position={[0, 0, -0.6]}>
                <coneGeometry args={[0.5, 1.4, 3]} />
                <meshStandardMaterial color="#b3261e" />
              </mesh>
              <Text
                position={[0, 0.1, -1.8]}
                rotation-x={-Math.PI / 2}
                fontSize={0.9}
                color="#b3261e"
              >
                С
              </Text>
            </group>
          </>
        );
      })()}
    </group>
  ) : null;

  // Терраса — настил вдоль стороны террасы, площадь из модели.
  const terrace = (() => {
    const t = project.terrace;
    if (!t.deckM2) return null;
    const lenX = (fp.x1 - fp.x0) / 1000;
    const lenY = (fp.y1 - fp.y0) / 1000;
    const along = t.side === "N" || t.side === "S" ? lenX : lenY;
    const depth = Math.min(4, t.deckM2 / along);
    const pos: [number, number, number] =
      t.side === "S"
        ? [0, 0.08, lenY / 2 + depth / 2]
        : t.side === "N"
          ? [0, 0.08, -lenY / 2 - depth / 2]
          : t.side === "E"
            ? [lenX / 2 + depth / 2, 0.08, 0]
            : [-lenX / 2 - depth / 2, 0.08, 0];
    const size: [number, number, number] =
      t.side === "N" || t.side === "S" ? [along, 0.15, depth] : [depth, 0.15, along];
    return (
      <mesh position={pos} raycast={() => null} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#a77b4f" />
      </mesh>
    );
  })();

  // Навес для машины: кровля на четырёх стойках, место — из модели (engine/site.ts).
  const carport = (() => {
    const c = carportPlace(project);
    if (!c) return null;
    const r = c.rect;
    const cx = (r.x0 + r.x1) / 2000 - ox;
    const cz = -(r.y0 + r.y1) / 2000 + oz;
    const w = (r.x1 - r.x0) / 1000;
    const d = (r.y1 - r.y0) / 1000;
    const h = 2.6;
    return (
      <group>
        <mesh position={[cx, 0.02, cz]} rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color="#bdbab3" />
        </mesh>
        <mesh position={[cx, h, cz]} raycast={() => null} castShadow>
          <boxGeometry args={[w + 0.3, 0.12, d + 0.3]} />
          <meshStandardMaterial color="#4b4b4b" />
        </mesh>
        {[
          [r.x0 + 150, r.y0 + 150],
          [r.x1 - 150, r.y0 + 150],
          [r.x0 + 150, r.y1 - 150],
          [r.x1 - 150, r.y1 - 150],
        ].map(([x, y], i) => (
          <mesh
            key={`cp-${i}`}
            position={[x / 1000 - ox, h / 2, -y / 1000 + oz]}
            raycast={() => null}
          >
            <cylinderGeometry args={[0.06, 0.06, h, 8]} />
            <meshStandardMaterial color="#4b4b4b" />
          </mesh>
        ))}
        <Text
          position={[cx, h + 0.08, cz]}
          rotation-x={-Math.PI / 2}
          fontSize={0.6}
          color="#f2f2f2"
        >
          Навес · машина
        </Text>
      </group>
    );
  })();

  const columns = (() => {
    if (!columnsFor(project)) return null;
    const out: ReactElement[] = [];
    for (const u of modulesOnTier(project, 2)) {
      const s = supportOf(u, t1);
      const r = footprint(u);
      for (const side of ["N", "E", "S", "W"] as Side[]) {
        if (s.overhangMm[side] <= GRAMMAR.tiers.maxOverhangMm) continue;
        const pts: [number, number][] =
          side === "E"
            ? [
                [r.x1 - 150, r.y0 + 150],
                [r.x1 - 150, r.y1 - 150],
              ]
            : side === "W"
              ? [
                  [r.x0 + 150, r.y0 + 150],
                  [r.x0 + 150, r.y1 - 150],
                ]
              : side === "N"
                ? [
                    [r.x0 + 150, r.y1 - 150],
                    [r.x1 - 150, r.y1 - 150],
                  ]
                : [
                    [r.x0 + 150, r.y0 + 150],
                    [r.x1 - 150, r.y0 + 150],
                  ];
        pts.forEach(([x, y], i) =>
          out.push(
            <mesh
              key={`${u.id}-${side}-${i}`}
              position={[x / 1000 - ox, H / 2, -y / 1000 + oz]}
              raycast={() => null}
            >
              <cylinderGeometry args={[0.12, 0.12, H, 12]} />
              <meshStandardMaterial color="#555" />
            </mesh>,
          ),
        );
      }
    }
    return out;
  })();

  return (
    <Canvas
      shadows
      camera={{ position: [16, 13, 18], fov: 40 }}
      gl={{ preserveDrawingBuffer: !!shot }}
    >
      <color attach="background" args={["#e9eef2"]} />
      <hemisphereLight args={["#ffffff", "#8aa070", 0.7]} />
      <directionalLight
        position={[12, 20, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {plotGroup}
      {carport}
      {terrace}
      {planFromProject(project).entrances.map((e) => (
        <mesh
          key={e.doorId}
          position={[
            (e.porch.x0 + e.porch.x1) / 2000 - ox,
            0.1,
            -(e.porch.y0 + e.porch.y1) / 2000 + oz,
          ]}
          raycast={() => null}
          receiveShadow
        >
          <boxGeometry
            args={[(e.porch.x1 - e.porch.x0) / 1000, 0.2, (e.porch.y1 - e.porch.y0) / 1000]}
          />
          <meshStandardMaterial color="#8d6a48" />
        </mesh>
      ))}
      {columns}
      {project.modules.map((m) => {
        const r = footprint(m);
        const w = (r.x1 - r.x0) / 1000;
        const d = (r.y1 - r.y0) / 1000;
        const cx = (r.x0 + r.x1) / 2000 - ox;
        const cz = -(r.y0 + r.y1) / 2000 + oz;
        const cy = (m.tier - 1) * H + H / 2;
        const room = project.rooms.find((x) => x.moduleIds.includes(m.id));
        const isSel = selected?.moduleId === m.id;
        return (
          <group key={m.id}>
            <mesh
              position={[cx, cy, cz]}
              castShadow
              receiveShadow
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                const n = e.face?.normal;
                if (!n) return;
                const side = sideOfNormal(n.x, n.z);
                if (side) onPick({ moduleId: m.id, side });
              }}
            >
              <boxGeometry args={[w, H, d]} />
              <meshStandardMaterial color={isSel ? "#f5c26b" : facade} roughness={0.8} />
              <Edges color={ROOM_TINT[room?.type ?? ""] ? "#4a4a4a" : "#222"} />
            </mesh>
            {/* Кровельная плита с вылетом */}
            <mesh position={[cx, cy + H / 2 + 0.03, cz]} raycast={() => null}>
              <boxGeometry args={[w + 0.1, 0.06, d + 0.1]} />
              <meshStandardMaterial color={style?.palette?.[2] ?? "#3a3d40"} />
            </mesh>
            {project.openings
              .filter((o) => o.moduleId === m.id)
              .map((o) => (
                <OpeningMesh key={o.id} m={m} o={o} ox={ox} oz={oz} />
              ))}
          </group>
        );
      })}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={6} maxDistance={80} />
    </Canvas>
  );
}

export default HouseScene;
