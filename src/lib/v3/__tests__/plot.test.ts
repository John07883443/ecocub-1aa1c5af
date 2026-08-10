import { test } from "node:test";
import assert from "node:assert/strict";
import {
  centerHouse,
  defaultPlot,
  houseBounds,
  houseFitsPlot,
  placementFits,
  placementRange,
} from "../plot.ts";
import type { ModuleItem } from "../../constructor/types.ts";

const house: ModuleItem[] = [
  { id: "a", x: 0, z: 0, floor: 0, role: "living" },
  { id: "b", x: 3, z: 0, floor: 0, role: "kitchen" },
  { id: "c", x: 0, z: 3, floor: 0, role: "bedroom" },
  { id: "d", x: 0, z: 0, floor: 1, role: "bedroom" },
];

test("габарит дома считается по первому этажу", () => {
  const b = houseBounds(house);
  assert.deepEqual(b, { minX: 0, minZ: 0, w: 6, d: 6 });
});

test("посадка в границах с отступами проходит, за границами — нет", () => {
  const plot = { ...defaultPlot(house), widthM: 20, depthM: 20, setbackM: 3 };
  const centered = { ...plot, ...centerHouse(house, plot) };
  assert.equal(placementFits(house, centered), true);
  assert.equal(placementFits(house, { ...plot, houseX: 0, houseZ: 0 }), false);
  assert.equal(placementFits(house, { ...plot, houseX: 12, houseZ: 3 }), false);
});

test("диапазон смещений согласован с проверкой посадки", () => {
  const plot = { ...defaultPlot(house), widthM: 20, depthM: 24, setbackM: 3 };
  const r = placementRange(house, plot);
  assert.equal(placementFits(house, { ...plot, houseX: r.minX, houseZ: r.minZ }), true);
  assert.equal(placementFits(house, { ...plot, houseX: r.maxX, houseZ: r.maxZ }), true);
  assert.equal(placementFits(house, { ...plot, houseX: r.maxX + 1, houseZ: r.minZ }), false);
});

test("узкий участок честно признаётся непригодным", () => {
  const plot = {
    widthM: 11,
    depthM: 30,
    setbackM: 3,
    entranceSide: "south" as const,
    houseX: 0,
    houseZ: 0,
  };
  assert.equal(houseFitsPlot(house, plot), false);
  assert.equal(houseFitsPlot(house, { ...plot, widthM: 12, depthM: 12 }), true);
});
