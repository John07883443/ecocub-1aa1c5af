/**
 * 3D-сцена пилота: участок, кубики двух ярусов, окна и двери из модели,
 * терраса, колонны, навес. Клик по стене выбирает её для правки.
 * Координаты модели: x — восток, y — север (мм). В three: x, высота, −z = север.
 *
 * Картинка «как в движке»: PBR-материалы по отделкам дома (house-look.ts — та же
 * правда, что в паспорте и промпте рендера), процедурные текстуры (штукатурка,
 * планкен, ламели, бетон, трава — без загрузок), свет окружения из лайтформеров
 * и небо (без сети), мягкие тени, ACES, затенение углов (GTAO). На телефоне —
 * качество «эконом»: без GTAO, тени мельче, DPR ≤ 1,25.
 * Изменённые кубики «вырастают» и подсвечиваются (highlight).
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  Sky,
  Text,
} from "@react-three/drei";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { footprint, bbox, supportOf } from "../engine/geometry.ts";
import { GRAMMAR } from "../grammar/index.ts";
import { modulesOnTier } from "../engine/rules.ts";
import type { ModulePlacement, Opening, Project, Side } from "../engine/types.ts";
import { planFromProject } from "../engine/plan.ts";
import { carportPlace } from "../engine/site.ts";
import { houseLook, type HouseLook } from "../engine/house-look.ts";
import { PILOT } from "../pilot.config.ts";

export interface WallPick {
  moduleId: string;
  side: Side;
}

export type SceneQuality = "high" | "low";

const H = GRAMMAR.module.externalMm.h / 1000;
const SLAB = 0.3;

// ── Процедурные текстуры (CanvasTexture, без сети) ─────────────────────────

const texCache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

/** Детерминированный шум: одинаковая картинка при каждом рендере. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function facadeTexture(look: HouseLook): THREE.Texture {
  const key = `facade:${look.material}:${look.wall}`;
  return canvasTexture(key, 512, (g, s) => {
    const r = rng(7);
    g.fillStyle = look.wall;
    g.fillRect(0, 0, s, s);
    if (look.material === "wood" || look.material === "dark-wood") {
      // Планкен: вертикальные доски 140 мм с тенью в шве и волокнами.
      const n = 12;
      for (let i = 0; i < n; i++) {
        const x = (i * s) / n;
        g.fillStyle = shade(look.wall, 0.86 + r() * 0.24);
        g.fillRect(x, 0, s / n - 3, s);
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(x + s / n - 3, 0, 3, s);
        for (let k = 0; k < 18; k++) {
          g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.06})`;
          g.fillRect(x + r() * (s / n), 0, 1, s);
        }
      }
    } else if (look.material === "metal") {
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(0, (i * s) / 4);
        g.lineTo(s, (i * s) / 4);
        g.stroke();
      }
      for (let i = 0; i <= 2; i++) {
        g.beginPath();
        g.moveTo((i * s) / 2, 0);
        g.lineTo((i * s) / 2, s);
        g.stroke();
      }
    } else {
      // Штукатурка / бетон / сайдинг: мелкое зерно; бетону — точки стяжек опалубки.
      const img = g.getImageData(0, 0, s, s);
      for (let i = 0; i < img.data.length; i += 4) {
        const d = (r() - 0.5) * (look.material === "concrete" ? 26 : 12);
        img.data[i] += d;
        img.data[i + 1] += d;
        img.data[i + 2] += d;
      }
      g.putImageData(img, 0, 0);
      if (look.material === "concrete") {
        g.fillStyle = "rgba(0,0,0,0.25)";
        for (let x = 1; x < 4; x++)
          for (let y = 1; y < 4; y++) {
            g.beginPath();
            g.arc((x * s) / 4, (y * s) / 4, 3, 0, Math.PI * 2);
            g.fill();
          }
        g.strokeStyle = "rgba(0,0,0,0.12)";
        g.strokeRect(0, 0, s, s / 2);
      }
      if (look.material === "siding") {
        g.strokeStyle = "rgba(0,0,0,0.12)";
        for (let y = 0; y < s; y += s / 16) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(s, y);
          g.stroke();
        }
      }
    }
  });
}

function grassTexture(): THREE.Texture {
  return canvasTexture("grass", 512, (g, s) => {
    const r = rng(3);
    g.fillStyle = "#5e7f3d";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const v = r();
      g.fillStyle = v < 0.33 ? "#5f8040" : v < 0.66 ? "#7fa055" : "#8aa95e";
      g.fillRect(r() * s, r() * s, 1 + r() * 2, 2 + r() * 4);
    }
  });
}

function deckTexture(): THREE.Texture {
  return canvasTexture("deck", 256, (g, s) => {
    const r = rng(11);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = shade("#a77b4f", 0.85 + r() * 0.25);
      g.fillRect(0, (i * s) / 8, s, s / 8 - 2);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(0, ((i + 1) * s) / 8 - 2, s, 2);
    }
  });
}

/** Материал фасада: шероховатость и металличность по типу отделки. */
function FacadeMaterial({
  look,
  w,
  h,
  emissive,
}: {
  look: HouseLook;
  w: number;
  h: number;
  emissive?: string;
}) {
  const map = useMemo(() => {
    const t = facadeTexture(look).clone();
    t.needsUpdate = true;
    // Масштаб: одна плитка текстуры ≈ 1,7 м.
    t.repeat.set(Math.max(1, w / 1.7), Math.max(1, h / 1.7));
    return t;
  }, [look, w, h]);
  const metal = look.material === "metal";
  return (
    <meshStandardMaterial
      map={map}
      color="#ffffff"
      roughness={metal ? 0.38 : look.material === "plaster" ? 0.92 : 0.8}
      metalness={metal ? 0.55 : 0}
      envMapIntensity={metal ? 1.1 : 0.7}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissive ? 0.35 : 0}
    />
  );
}

function sideOfNormal(x: number, z: number): Side | null {
  if (x > 0.5) return "E";
  if (x < -0.5) return "W";
  if (z < -0.5) return "N";
  if (z > 0.5) return "S";
  return null;
}

/** Проём: рама из алюминия, стекло с отражениями, тёмная глубина за ним; дверь — полотно. */
function OpeningMesh({
  m,
  o,
  ox,
  oz,
  look,
}: {
  m: ModulePlacement;
  o: Opening;
  ox: number;
  oz: number;
  look: HouseLook;
}) {
  if (o.kind === "internal-door") return null;
  const r = footprint(m);
  const y0 = (m.tier - 1) * H + SLAB;
  const w = o.widthMm / 1000;
  const h = Math.min(o.heightMm / 1000, H - SLAB - 0.05);
  const along = (o.face === "N" || o.face === "S" ? r.x0 : r.y0) / 1000 + o.offsetMm / 1000 + w / 2;
  const t = 0.07;
  let pos: [number, number, number];
  let rotY = 0;
  switch (o.face) {
    case "N":
      pos = [along - ox, y0 + h / 2, -(r.y1 / 1000) + oz - 0.01];
      rotY = Math.PI;
      break;
    case "S":
      pos = [along - ox, y0 + h / 2, -(r.y0 / 1000) + oz + 0.01];
      break;
    case "E":
      pos = [r.x1 / 1000 - ox + 0.01, y0 + h / 2, -along + oz];
      rotY = Math.PI / 2;
      break;
    case "W":
      pos = [r.x0 / 1000 - ox - 0.01, y0 + h / 2, -along + oz];
      rotY = -Math.PI / 2;
      break;
  }
  const f = 0.06; // ширина профиля рамы
  const frame = <meshStandardMaterial color={look.frames} roughness={0.35} metalness={0.6} />;
  return (
    <group position={pos} rotation-y={rotY}>
      {/* Тёмная глубина «внутри» — окно не просвечивает насквозь */}
      <mesh position={[0, 0, 0.004]} raycast={() => null}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#1d2328" roughness={1} />
      </mesh>
      {o.kind === "window" ? (
        <mesh position={[0, 0, 0.012]} raycast={() => null}>
          <planeGeometry args={[w - f, h - f]} />
          <meshPhysicalMaterial
            color="#9fb3c2"
            roughness={0.04}
            metalness={0.15}
            reflectivity={0.9}
            clearcoat={1}
            envMapIntensity={1.6}
            transparent
            opacity={0.55}
          />
        </mesh>
      ) : (
        <mesh position={[0, 0, 0.012]} raycast={() => null}>
          <planeGeometry args={[w - f, h - f]} />
          <meshStandardMaterial color={shade(look.frames, 1.4)} roughness={0.55} metalness={0.3} />
        </mesh>
      )}
      {/* Рама: четыре профиля */}
      <mesh position={[0, h / 2 - f / 2, 0]} raycast={() => null}>
        <boxGeometry args={[w, f, t]} />
        {frame}
      </mesh>
      <mesh position={[0, -h / 2 + f / 2, 0]} raycast={() => null}>
        <boxGeometry args={[w, f, t]} />
        {frame}
      </mesh>
      <mesh position={[-w / 2 + f / 2, 0, 0]} raycast={() => null}>
        <boxGeometry args={[f, h, t]} />
        {frame}
      </mesh>
      <mesh position={[w / 2 - f / 2, 0, 0]} raycast={() => null}>
        <boxGeometry args={[f, h, t]} />
        {frame}
      </mesh>
      {/* Импост у широкого остекления */}
      {o.kind === "window" && w > 2.2 && (
        <mesh position={[0, 0, 0]} raycast={() => null}>
          <boxGeometry args={[f * 0.8, h, t]} />
          {frame}
        </mesh>
      )}
    </group>
  );
}

/** Ламели из лиственницы на глухих наружных гранях — фирменный акцент. */
function Slats({
  m,
  face,
  ox,
  oz,
  color,
}: {
  m: ModulePlacement;
  face: Side;
  ox: number;
  oz: number;
  color: string;
}) {
  const r = footprint(m);
  const y0 = (m.tier - 1) * H + 0.15;
  const len = (face === "N" || face === "S" ? r.x1 - r.x0 : r.y1 - r.y0) / 1000;
  const span = len * 0.55;
  const n = Math.floor(span / 0.11);
  const out: ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    const a = (len - span) / 2 + i * 0.11 + 0.03;
    const along = (face === "N" || face === "S" ? r.x0 : r.y0) / 1000 + a;
    const p: [number, number, number] =
      face === "S"
        ? [along - ox, y0 + (H - 0.3) / 2, -(r.y0 / 1000) + oz + 0.04]
        : face === "N"
          ? [along - ox, y0 + (H - 0.3) / 2, -(r.y1 / 1000) + oz - 0.04]
          : face === "E"
            ? [r.x1 / 1000 - ox + 0.04, y0 + (H - 0.3) / 2, -along + oz]
            : [r.x0 / 1000 - ox - 0.04, y0 + (H - 0.3) / 2, -along + oz];
    out.push(
      <mesh key={i} position={p} castShadow raycast={() => null}>
        <boxGeometry
          args={face === "N" || face === "S" ? [0.045, H - 0.3, 0.06] : [0.06, H - 0.3, 0.045]}
        />
        <meshStandardMaterial color={shade(color, 0.9 + ((i * 37) % 10) / 50)} roughness={0.7} />
      </mesh>,
    );
  }
  return <>{out}</>;
}

/** Кубик: короб фасада, кровельная плита; при подсветке «вырастает» и светится. */
function Cube({
  m,
  ox,
  oz,
  look,
  selected,
  hot,
  hotKey,
  onPick,
  children,
}: {
  m: ModulePlacement;
  ox: number;
  oz: number;
  look: HouseLook;
  selected: boolean;
  hot: boolean;
  hotKey: number;
  onPick: (w: WallPick) => void;
  children?: React.ReactNode;
}) {
  const r = footprint(m);
  const w = (r.x1 - r.x0) / 1000;
  const d = (r.y1 - r.y0) / 1000;
  const cx = (r.x0 + r.x1) / 2000 - ox;
  const cz = -(r.y0 + r.y1) / 2000 + oz;
  const base = (m.tier - 1) * H;
  const group = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial | null>(null);
  const started = useRef<number | null>(null);
  useEffect(() => {
    started.current = hot ? performance.now() : null;
  }, [hot, hotKey]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t0 = started.current;
    if (t0 === null) {
      if (g.scale.y !== 1) g.scale.set(1, 1, 1);
      return;
    }
    const k = Math.min(1, (performance.now() - t0) / 700);
    const ease = 1 - Math.pow(1 - k, 3);
    g.scale.set(1, 0.35 + 0.65 * ease, 1);
    const glow = Math.max(0, 1 - (performance.now() - t0) / 2400);
    const mm = group.current?.children[0] as THREE.Mesh | undefined;
    const material = (mm?.material ?? null) as THREE.MeshStandardMaterial | null;
    mat.current = material;
    if (material) {
      material.emissive.set("#f59e0b");
      material.emissiveIntensity = 0.55 * glow;
    }
    if (k >= 1 && glow <= 0) started.current = null;
  });
  return (
    <group ref={group} position={[cx, base, cz]}>
      <mesh
        position={[0, H / 2, 0]}
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
        <FacadeMaterial
          look={look}
          w={Math.max(w, d)}
          h={H}
          emissive={selected ? "#f5c26b" : undefined}
        />
      </mesh>
      {/* Кровельная плита: тонкая, с выносом 15 см — как у фирменных домов */}
      <mesh position={[0, H + 0.04, 0]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[w + 0.3, 0.12, d + 0.3]} />
        <meshStandardMaterial
          color={look.roofKind === "membrane" ? "#f2f0ec" : look.roof}
          roughness={0.85}
        />
      </mesh>
      {look.roofKind !== "membrane" && (
        <mesh position={[0, H + 0.105, 0]} receiveShadow raycast={() => null}>
          <boxGeometry args={[w, 0.03, d]} />
          <meshStandardMaterial color={look.roof} roughness={1} />
        </mesh>
      )}
      <group position={[-cx, -base, -cz]}>{children}</group>
    </group>
  );
}

/** Затенение углов (GTAO) поверх обычного рендера — только в высоком качестве. */
function AmbientOcclusion() {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, size.width, size.height);
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.2 });
    ao.blendIntensity = 0.85;
    c.addPass(ao);
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera, size.width, size.height]);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    return () => composer.dispose();
  }, [composer, gl, size.width, size.height]);
  useFrame(() => composer.render(), 1);
  return null;
}

export function HouseScene({
  project,
  selected,
  onPick,
  shot,
  highlight,
  highlightKey = 0,
  quality,
}: {
  project: Project;
  selected: WallPick | null;
  onPick: (w: WallPick) => void;
  shot?: boolean;
  /** Кубики, которые только что поменялись. */
  highlight?: string[];
  highlightKey?: number;
  quality?: SceneQuality;
}) {
  const urlQ =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null;
  const q: SceneQuality =
    quality ??
    (urlQ === "low" || urlQ === "high" ? urlQ : null) ??
    (typeof window !== "undefined" &&
    (window.innerWidth < 768 || /Android|iPhone/i.test(navigator.userAgent))
      ? "low"
      : "high");
  const fp = useMemo(() => bbox(project.modules.map(footprint)), [project]);
  // Центр дома — начало сцены; участок рисуется вокруг по посадке.
  const ox = (fp.x0 + fp.x1) / 2000;
  const oz = (fp.y0 + fp.y1) / 2000;
  const look = useMemo(() => houseLook(project), [project]);
  const plot = project.plot;
  const t1 = modulesOnTier(project, 1);
  const hot = new Set(highlight ?? []);

  const ground = (() => {
    const W = plot?.widthM ?? 40;
    const D = plot?.depthM ?? 40;
    const px = (project.placementMm.xMm ?? 0) / 1000;
    const py = (project.placementMm.yMm ?? 0) / 1000;
    const x0 = plot ? -px - ox : -W / 2;
    const z0 = plot ? py + oz : D / 2;
    const tex = grassTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(W / 4, D / 4);
    const sb = (plot?.setbackMm ?? GRAMMAR.site.setbackMm) / 1000;
    return (
      <group>
        {/* Дальний фон: луг до горизонта */}
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.03, 0]} receiveShadow raycast={() => null}>
          <circleGeometry args={[160, 48]} />
          <meshStandardMaterial color="#5f7d40" roughness={1} />
        </mesh>
        <mesh
          rotation-x={-Math.PI / 2}
          position={[x0 + W / 2, -0.01, z0 - D / 2]}
          receiveShadow
          raycast={() => null}
        >
          <planeGeometry args={[W, D]} />
          <meshStandardMaterial map={tex} roughness={1} />
        </mesh>
        {plot && (
          <lineSegments
            position={[x0 + W / 2, 0.01, z0 - D / 2]}
            rotation-x={-Math.PI / 2}
            raycast={() => null}
          >
            <edgesGeometry
              args={[new THREE.PlaneGeometry(Math.max(0.1, W - 2 * sb), Math.max(0.1, D - 2 * sb))]}
            />
            <lineBasicMaterial color="#e8f0d8" transparent opacity={0.7} />
          </lineSegments>
        )}
        {plot && (
          <group
            position={[x0 + W - 2, 0.05, z0 - D + 2]}
            rotation-y={((plot.northDeg ?? 0) * Math.PI) / 180}
          >
            <mesh rotation-x={-Math.PI / 2} position={[0, 0, -0.6]} raycast={() => null}>
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
        )}
      </group>
    );
  })();

  // Терраса — настил вдоль стороны террасы, площадь из модели.
  const terrace = (() => {
    const t = project.terrace;
    if (!t.deckM2) return null;
    const lenX = (fp.x1 - fp.x0) / 1000;
    const lenY = (fp.y1 - fp.y0) / 1000;
    const along = t.side === "N" || t.side === "S" ? lenX : lenY;
    const depth = Math.min(4.5, t.deckM2 / along);
    const pos: [number, number, number] =
      t.side === "S"
        ? [0, 0.08, lenY / 2 + depth / 2]
        : t.side === "N"
          ? [0, 0.08, -lenY / 2 - depth / 2]
          : t.side === "E"
            ? [lenX / 2 + depth / 2, 0.08, 0]
            : [-lenX / 2 - depth / 2, 0.08, 0];
    const size: [number, number, number] =
      t.side === "N" || t.side === "S" ? [along, 0.16, depth] : [depth, 0.16, along];
    const tex = deckTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(t.side === "N" || t.side === "S" ? along / 1.2 : depth / 1.2, 3);
    return (
      <mesh position={pos} raycast={() => null} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial map={tex} roughness={0.75} />
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
        <mesh
          position={[cx, 0.02, cz]}
          rotation-x={-Math.PI / 2}
          receiveShadow
          raycast={() => null}
        >
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color="#bdbab3" roughness={0.95} />
        </mesh>
        <mesh position={[cx, h, cz]} raycast={() => null} castShadow>
          <boxGeometry args={[w + 0.3, 0.12, d + 0.3]} />
          <meshStandardMaterial color="#3d3f42" roughness={0.5} metalness={0.4} />
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
            castShadow
            raycast={() => null}
          >
            <boxGeometry args={[0.1, h, 0.1]} />
            <meshStandardMaterial color="#3d3f42" roughness={0.5} metalness={0.4} />
          </mesh>
        ))}
      </group>
    );
  })();

  // Колонны под свесом: где свес больше 1,5 м и где человек попросил опору.
  const columns = (() => {
    const out: ReactElement[] = [];
    for (const u of modulesOnTier(project, 2)) {
      const s = supportOf(u, t1);
      const r = footprint(u);
      for (const side of ["N", "E", "S", "W"] as Side[]) {
        const over = s.overhangMm[side];
        const asked = over > 0 && project.overhangSupports?.includes(side);
        if (over <= GRAMMAR.tiers.maxOverhangMm && !asked) continue;
        const inset = 150;
        const pts: [number, number][] =
          side === "E"
            ? [
                [r.x1 - inset, r.y0 + inset],
                [r.x1 - inset, r.y1 - inset],
              ]
            : side === "W"
              ? [
                  [r.x0 + inset, r.y0 + inset],
                  [r.x0 + inset, r.y1 - inset],
                ]
              : side === "N"
                ? [
                    [r.x0 + inset, r.y1 - inset],
                    [r.x1 - inset, r.y1 - inset],
                  ]
                : [
                    [r.x0 + inset, r.y0 + inset],
                    [r.x1 - inset, r.y0 + inset],
                  ];
        pts.slice(0, PILOT.structure.columnsPerOverhangSide).forEach(([x, y], i) =>
          out.push(
            <mesh
              key={`${u.id}-${side}-${i}`}
              position={[x / 1000 - ox, H / 2, -y / 1000 + oz]}
              castShadow
              raycast={() => null}
            >
              <boxGeometry args={[0.16, H, 0.16]} />
              <meshStandardMaterial color="#2f3134" roughness={0.45} metalness={0.5} />
            </mesh>,
          ),
        );
      }
    }
    return out;
  })();

  // Глухие наружные грани первого яруса — под ламели (если у стиля есть акцент).
  const slats = (() => {
    if (!look.slats) return null;
    const out: ReactElement[] = [];
    for (const m of project.modules) {
      const r = footprint(m);
      for (const face of ["S", "E", "W", "N"] as Side[]) {
        const covered = project.modules.some((x) => {
          if (x.id === m.id || x.tier !== m.tier) return false;
          const f = footprint(x);
          return face === "E"
            ? f.x0 === r.x1 && f.y0 < r.y1 && f.y1 > r.y0
            : face === "W"
              ? f.x1 === r.x0 && f.y0 < r.y1 && f.y1 > r.y0
              : face === "N"
                ? f.y0 === r.y1 && f.x0 < r.x1 && f.x1 > r.x0
                : f.y1 === r.y0 && f.x0 < r.x1 && f.x1 > r.x0;
        });
        const opened = project.openings.some(
          (o) => o.moduleId === m.id && o.face === face && o.kind !== "internal-door",
        );
        if (covered || opened) continue;
        out.push(
          <Slats key={`${m.id}-${face}`} m={m} face={face} ox={ox} oz={oz} color={look.slats} />,
        );
        break; // одна грань на кубик — акцент, а не обшивка
      }
    }
    return out.slice(0, 6);
  })();

  const span = Math.max(fp.x1 - fp.x0, fp.y1 - fp.y0) / 1000;
  const cam: [number, number, number] = [span * 1.2 + 8, span * 0.75 + 6, span * 1.35 + 9];

  return (
    <Canvas
      shadows={q === "high" ? "soft" : true}
      dpr={q === "high" ? [1, 1.75] : [1, 1.25]}
      camera={{ position: cam, fov: 38, near: 0.3, far: 600 }}
      gl={{
        preserveDrawingBuffer: !!shot,
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.92,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
    >
      <color attach="background" args={["#cfdbe6"]} />
      <fog attach="fog" args={["#cfd9e2", 110, 320]} />
      <Sky
        distance={4500}
        sunPosition={[40, 22, 30]}
        turbidity={6}
        rayleigh={1.4}
        mieCoefficient={0.004}
        mieDirectionalG={0.85}
      />
      {/* Свет окружения без сети: лайтформеры вместо HDRI-файла */}
      <Environment resolution={q === "high" ? 256 : 64} frames={1}>
        <Lightformer
          intensity={1.2}
          position={[0, 12, 0]}
          rotation-x={Math.PI / 2}
          scale={[40, 40, 1]}
          color="#ffffff"
        />
        <Lightformer
          intensity={0.9}
          position={[30, 6, 20]}
          rotation-y={-Math.PI / 3}
          scale={[30, 8, 1]}
          color="#fff2dc"
        />
        <Lightformer
          intensity={0.9}
          position={[-30, 5, -10]}
          rotation-y={Math.PI / 3}
          scale={[30, 8, 1]}
          color="#dce8ff"
        />
        <Lightformer intensity={0.6} position={[0, 2, -40]} scale={[60, 4, 1]} color="#9fb88a" />
      </Environment>
      <hemisphereLight args={["#eaf2ff", "#4f6a3a", 0.25]} />
      <directionalLight
        position={[18, 24, 14]}
        intensity={2.8}
        color="#fff1dd"
        castShadow
        shadow-mapSize={q === "high" ? [4096, 4096] : [1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={q === "high" ? 6 : 3}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={90}
      />
      {ground}
      <ContactShadows
        position={[0, 0.005, 0]}
        scale={span + 14}
        blur={2.4}
        opacity={0.45}
        far={6}
        resolution={q === "high" ? 1024 : 256}
      />
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
          castShadow
          receiveShadow
          raycast={() => null}
        >
          <boxGeometry
            args={[(e.porch.x1 - e.porch.x0) / 1000, 0.2, (e.porch.y1 - e.porch.y0) / 1000]}
          />
          <meshStandardMaterial color="#b8b2a6" roughness={0.9} />
        </mesh>
      ))}
      {columns}
      {slats}
      {project.modules.map((m) => (
        <Cube
          key={m.id}
          m={m}
          ox={ox}
          oz={oz}
          look={look}
          selected={selected?.moduleId === m.id}
          hot={hot.has(m.id)}
          hotKey={highlightKey}
          onPick={onPick}
        >
          {project.openings
            .filter((o) => o.moduleId === m.id)
            .map((o) => (
              <OpeningMesh key={o.id} m={m} o={o} ox={ox} oz={oz} look={look} />
            ))}
        </Cube>
      ))}
      {q === "high" && <AmbientOcclusion />}
      <OrbitControls
        makeDefault
        maxPolarAngle={Math.PI / 2.05}
        minDistance={6}
        maxDistance={90}
        target={[0, 2, 0]}
      />
    </Canvas>
  );
}

export default HouseScene;
