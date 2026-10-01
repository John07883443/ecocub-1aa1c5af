import { buildProject } from "../engine/derive.ts";
import type { ModulePlacement, Project, Room } from "../engine/types.ts";

const mod = (id: string, x: number, y: number, roomId: string, tier = 1): ModulePlacement => ({
  id,
  xMm: x,
  yMm: y,
  rot: 0,
  tier,
  roomId,
});

/** Один ярус: кухня-гостиная на двух модулях, две угловые спальни, санузел. */
export function singleTier(): Project {
  const modules = [
    mod("m1", 0, 0, "kitchen"),
    mod("m2", 3200, 0, "kitchen"),
    mod("m3", 0, 3420, "bed1"),
    mod("m4", 3200, 3420, "bed2"),
    mod("m5", 6400, 0, "wet"),
  ];
  const rooms: Room[] = [
    { id: "kitchen", type: "kitchen-living", tier: 1, moduleIds: ["m1", "m2"] },
    { id: "bed1", type: "bedroom", tier: 1, moduleIds: ["m3"] },
    { id: "bed2", type: "bedroom", tier: 1, moduleIds: ["m4"] },
    { id: "wet", type: "wet-core", tier: 1, moduleIds: ["m5"] },
  ];
  return buildProject({
    id: "fx-single",
    modules,
    rooms,
    plot: { widthM: 30, depthM: 30, northDeg: 0 },
  });
}

/** Два яруса: внизу кухня-гостиная и санузел, наверху холл с лестницей и спальня; dx — сдвиг верхнего яруса. */
export function twoTier(dx = 0, extra: ModulePlacement[] = [], extraRooms: Room[] = []): Project {
  const modules = [
    mod("m1", 0, 0, "kitchen"),
    mod("m2", 3200, 0, "kitchen"),
    mod("m3", 6400, 0, "wet"),
    mod("u1", 0 + dx, 0, "hall", 2),
    mod("u2", 3200 + dx, 0, "bed1", 2),
    ...extra,
  ];
  const rooms: Room[] = [
    { id: "kitchen", type: "kitchen-living", tier: 1, moduleIds: ["m1", "m2"] },
    { id: "wet", type: "wet-core", tier: 1, moduleIds: ["m3"] },
    { id: "hall", type: "hall", tier: 2, moduleIds: ["u1"] },
    { id: "bed1", type: "bedroom", tier: 2, moduleIds: ["u2"] },
    ...extraRooms,
  ];
  return buildProject({
    id: "fx-two",
    modules,
    rooms,
    plot: { widthM: 30, depthM: 30, northDeg: 0 },
  });
}
