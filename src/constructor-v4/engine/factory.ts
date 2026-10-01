/**
 * Терминология владельца (01.10.2026):
 *  - «кубик» — одна ячейка 3200 × 3420, единица проектирования и привязки
 *    (в коде — ModulePlacement, исторически назван «модулем»);
 *  - «модуль» на языке завода — ДВА кубика, соединённых по длинной грани
 *    (≈ 6400 × 3420). Это единица производства и перевозки.
 *
 * Здесь кубики группируются в заводские модули (пары). Кубик без пары —
 * «требует проверки проектировщиком»; в цене он считается половиной модуля
 * (допущение).
 */
import { GRAMMAR } from "../grammar/index.ts";
import { contact, footprint } from "./geometry.ts";
import type { ModulePlacement, Project } from "./types.ts";

export interface FactoryModule {
  id: string;
  cubeIds: [string, string];
  tier: number;
}

export interface FactoryGrouping {
  modules: FactoryModule[];
  unpairedCubeIds: string[];
  cubes: number;
}

/** Два кубика образуют заводской модуль: один ярус, один поворот, стык по всей длинной грани без смещения. */
export function canPair(a: ModulePlacement, b: ModulePlacement): boolean {
  if (a.tier !== b.tier || a.rot % 180 !== b.rot % 180) return false;
  const c = contact(footprint(a), footprint(b));
  return !!c && c.offsetMm === 0 && c.lengthMm === GRAMMAR.factoryModule.joinFaceMm;
}

/** Максимальное паросочетание кубиков в модули (детерминированно, n ≤ 16). */
export function factoryModules(p: Project): FactoryGrouping {
  const cubes = [...p.modules].sort((a, b) => a.tier - b.tier || a.yMm - b.yMm || a.xMm - b.xMm);
  const n = cubes.length;
  const adj = cubes.map((a) =>
    cubes.map((b, j) => (a !== b && canPair(a, b) ? j : -1)).filter((j) => j >= 0),
  );
  let best: [number, number][] = [];
  const used = new Array<boolean>(n).fill(false);
  const cur: [number, number][] = [];
  const dfs = (i: number) => {
    if (cur.length + Math.floor((n - i) / 2) <= best.length) return;
    while (i < n && used[i]) i++;
    if (i >= n) {
      if (cur.length > best.length) best = [...cur];
      return;
    }
    used[i] = true;
    for (const j of adj[i]) {
      if (used[j] || j < i) continue;
      used[j] = true;
      cur.push([i, j]);
      dfs(i + 1);
      cur.pop();
      used[j] = false;
    }
    dfs(i + 1); // кубик i без пары
    used[i] = false;
  };
  dfs(0);
  const paired = new Set(best.flat());
  return {
    modules: best.map(([i, j], k) => ({
      id: `FM${k + 1}`,
      cubeIds: [cubes[i].id, cubes[j].id],
      tier: cubes[i].tier,
    })),
    unpairedCubeIds: cubes.filter((_, i) => !paired.has(i)).map((c) => c.id),
    cubes: n,
  };
}

/** Рейсов трала: по умолчанию 4 кубика (2 модуля) на трал 18 м. */
export function trucksForCubes(cubes: number): number {
  return Math.ceil(cubes / GRAMMAR.transport.cubesPerTruck);
}
