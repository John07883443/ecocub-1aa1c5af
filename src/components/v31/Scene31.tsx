/**
 * Белая архитектурная 3D-модель v3.1.
 *
 * Не картинка и не отдельная демка: объём собирается из того же состояния,
 * что план, площадь и цена. Светлый massing, мягкий свет и контактные тени —
 * это стадия проектирования, а не финальный тёмный фасад. Секции стоят
 * вплотную, поэтому щелей и двойных стен между модулями нет.
 *
 * Грузится лениво отдельным чанком и только на клиенте; при отсутствии WebGL
 * рабочим остаётся 2D-план (обработка — в родительском компоненте).
 */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import { CEILING_HEIGHT_M, MODULE_SIDE_M, SLAB_M } from "@/lib/v31/constants";
import { bounds } from "@/lib/v31/geometry";
import { moduleOnSite } from "@/lib/v31/site";
import type { HouseState, SiteState } from "@/lib/v31/types";

export interface Scene31Props {
  house: HouseState;
  site: SiteState;
  /** Показывать участок с границами и стороной въезда. */
  showSite: boolean;
  autoRotate?: boolean;
}

const WALL = "#f4f3f0";
const WALL_TERRACE = "#e6e3dc";
const ROOF = "#e9e7e2";
const GROUND = "#dfe3da";
const PLOT = "#e8ebe3";

export default function Scene31({ house, site, showSite, autoRotate = false }: Scene31Props) {
  // Дом центрируется в кадре: камера смотрит на середину участка или дома.
  const target = useMemo(() => {
    if (showSite)
      return { x: site.widthM / 2, z: site.depthM / 2, span: Math.max(site.widthM, site.depthM) };
    const b = bounds(house.modules, 0);
    return {
      x: b.minX + b.w / 2,
      z: b.minZ + b.d / 2,
      span: Math.max(b.w, b.d, 9),
    };
  }, [showSite, site.widthM, site.depthM, house.modules]);

  const dist = target.span * 1.6 + 8;

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [target.x + dist * 0.75, dist * 0.7, target.z + dist * 0.75], fov: 38 }}
      style={{ background: "#f7f8f5" }}
    >
      {/* Мягкий свет: объёмы читаются, но не выглядят тяжёлыми */}
      <ambientLight intensity={0.75} />
      <hemisphereLight args={["#ffffff", "#d9dcd3", 0.55]} />
      <directionalLight
        position={[target.x + 18, 26, target.z + 12]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <Ground target={target} showSite={showSite} site={site} />
      <HouseMesh house={house} site={site} showSite={showSite} autoRotate={autoRotate} />

      <OrbitControls
        target={[target.x, CEILING_HEIGHT_M / 2, target.z]}
        enablePan={false}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={target.span * 0.6}
        maxDistance={target.span * 4 + 20}
      />
    </Canvas>
  );
}

function Ground({
  target,
  showSite,
  site,
}: {
  target: { x: number; z: number; span: number };
  showSite: boolean;
  site: SiteState;
}) {
  return (
    <group>
      {/* Общая плоскость — дом не висит в пустоте */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[target.x, -0.01, target.z]} receiveShadow>
        <planeGeometry args={[target.span * 6 + 40, target.span * 6 + 40]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>

      {showSite && (
        <>
          {/* Участок в масштабе */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[site.widthM / 2, 0.01, site.depthM / 2]}
            receiveShadow
          >
            <planeGeometry args={[site.widthM, site.depthM]} />
            <meshStandardMaterial color={PLOT} roughness={1} />
          </mesh>
          {/* Границы — четыре низкие полосы вместо линий: читаются при любом зуме */}
          <SiteBorder site={site} />
          <AccessMark site={site} />
        </>
      )}
    </group>
  );
}

function SiteBorder({ site }: { site: SiteState }) {
  const t = 0.22;
  const bars: Array<[number, number, number, number]> = [
    [site.widthM / 2, 0, site.widthM, t],
    [site.widthM / 2, site.depthM, site.widthM, t],
    [0, site.depthM / 2, t, site.depthM],
    [site.widthM, site.depthM / 2, t, site.depthM],
  ];
  return (
    <group>
      {bars.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.06, z]} receiveShadow>
          <boxGeometry args={[w, 0.12, d]} />
          <meshStandardMaterial color="#b6bbae" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function AccessMark({ site }: { site: SiteState }) {
  const pos = (() => {
    switch (site.accessSide) {
      case "north":
        return { x: site.widthM / 2, z: -1.2, w: 5, d: 2.4 };
      case "south":
        return { x: site.widthM / 2, z: site.depthM + 1.2, w: 5, d: 2.4 };
      case "west":
        return { x: -1.2, z: site.depthM / 2, w: 2.4, d: 5 };
      default:
        return { x: site.widthM + 1.2, z: site.depthM / 2, w: 2.4, d: 5 };
    }
  })();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pos.x, 0.02, pos.z]} receiveShadow>
      <planeGeometry args={[pos.w, pos.d]} />
      <meshStandardMaterial color="#cfd2c8" roughness={1} />
    </mesh>
  );
}

function HouseMesh({
  house,
  site,
  showSite,
  autoRotate,
}: {
  house: HouseState;
  site: SiteState;
  showSite: boolean;
  autoRotate: boolean;
}) {
  const groupRef = useRef<Group>(null);
  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) groupRef.current.rotation.y += delta * 0.12;
  });

  const roomById = useMemo(() => new Map(house.rooms.map((r) => [r.id, r])), [house.rooms]);

  return (
    <group ref={groupRef}>
      {house.modules.map((m) => {
        const room = roomById.get(m.roomId);
        const isTerrace = room?.type === "terrace";
        const pos = showSite
          ? moduleOnSite(m, house.modules, site, MODULE_SIDE_M)
          : { x: m.x, z: m.z, w: MODULE_SIDE_M, d: MODULE_SIDE_M };
        const height = isTerrace ? 0.25 : CEILING_HEIGHT_M;
        const y = m.floor * (CEILING_HEIGHT_M + SLAB_M) + height / 2;
        return (
          <mesh
            key={m.id}
            position={[pos.x + pos.w / 2, y, pos.z + pos.d / 2]}
            castShadow
            receiveShadow
          >
            {/* Секции стоят вплотную: габарит ровно 3 × 3, без зазора */}
            <boxGeometry args={[pos.w, height, pos.d]} />
            <meshStandardMaterial
              color={isTerrace ? WALL_TERRACE : WALL}
              roughness={0.85}
              metalness={0}
            />
          </mesh>
        );
      })}

      {/* Плита кровли поверх каждого этажа — единая светлая плоскость */}
      {Array.from(new Set(house.modules.map((m) => m.floor))).map((f) =>
        house.modules
          .filter((m) => m.floor === f && roomById.get(m.roomId)?.type !== "terrace")
          .map((m) => {
            const pos = showSite
              ? moduleOnSite(m, house.modules, site, MODULE_SIDE_M)
              : { x: m.x, z: m.z, w: MODULE_SIDE_M, d: MODULE_SIDE_M };
            const y = f * (CEILING_HEIGHT_M + SLAB_M) + CEILING_HEIGHT_M + SLAB_M / 2;
            return (
              <mesh
                key={`roof-${m.id}`}
                position={[pos.x + pos.w / 2, y, pos.z + pos.d / 2]}
                castShadow
              >
                <boxGeometry args={[pos.w + 0.16, SLAB_M, pos.d + 0.16]} />
                <meshStandardMaterial color={ROOF} roughness={0.9} />
              </mesh>
            );
          }),
      )}
    </group>
  );
}
