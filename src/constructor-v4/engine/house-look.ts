/**
 * Внешний вид дома из модели — одна правда для 3D, плана и промпта рендера.
 * Отделки (finishes) задают материал, профиль стиля (StyleProfile) — уточняет
 * цвет фасада, если человек назвал его словами. Лев сказал «фасад светлее» и
 * команда прошла — значит поменялся finishes.facade, и всё, что рисует дом,
 * берёт цвет отсюда, а не из своих таблиц.
 */
import { findFinish, findStyle } from "../grammar/index.ts";
import type { Project } from "./types.ts";

export type FacadeMaterial = "plaster" | "wood" | "concrete" | "metal" | "siding" | "dark-wood";

export interface HouseLook {
  facadeId: string;
  facadeLabel: string;
  material: FacadeMaterial;
  /** Основной цвет стен, hex. */
  wall: string;
  /** Акцент: вертикальные ламели (цвет) или null. */
  slats: string | null;
  roofId: string;
  roofLabel: string;
  roof: string;
  /** Зелёная или эксплуатируемая кровля. */
  roofKind: "membrane" | "green" | "deck";
  frames: string;
  framesLabel: string;
  interiorLabel: string;
  /** Английские слова для промпта рендера. */
  en: { facade: string; roof: string; frames: string; slats: string | null };
}

const FACADE: Record<string, { wall: string; material: FacadeMaterial; en: string }> = {
  "plaster-white": { wall: "#f1eee8", material: "plaster", en: "smooth white plaster" },
  "plaster-warm": { wall: "#e8dcc4", material: "plaster", en: "warm sand-coloured plaster" },
  "planken-larch": { wall: "#c39a6b", material: "wood", en: "natural larch plank cladding" },
  "planken-thermo": {
    wall: "#7a5638",
    material: "dark-wood",
    en: "thermo-treated dark wood planks",
  },
  "planken-dark-stone": {
    wall: "#4a3726",
    material: "dark-wood",
    en: "dark wood cladding with a stone plinth",
  },
  "fiber-cement": {
    wall: "#a7a7a2",
    material: "concrete",
    en: "light architectural concrete panels",
  },
  "metal-panel": { wall: "#45494d", material: "metal", en: "dark graphite metal cassettes" },
  "siding-light": { wall: "#e4dfd3", material: "siding", en: "light fibre-cement siding" },
};

const ROOF: Record<string, { color: string; kind: HouseLook["roofKind"]; en: string }> = {
  "flat-membrane": { color: "#d9d6cf", kind: "membrane", en: "thin flat roof slab with a fascia" },
  "flat-green": { color: "#6f8f4e", kind: "green", en: "flat green sedum roof" },
  "flat-exploitable-deck": {
    color: "#a07a52",
    kind: "deck",
    en: "flat accessible roof with a wooden deck and glass railing",
  },
};

const FRAMES: Record<string, { color: string; en: string }> = {
  "frame-graphite": { color: "#3a3d40", en: "graphite aluminium frames" },
  "frame-black": { color: "#1c1c1c", en: "black aluminium frames" },
  "frame-wood-alu": { color: "#8a6440", en: "wood-aluminium frames" },
};

const HEX = /^#[0-9a-f]{6}$/i;

export function houseLook(p: Pick<Project, "finishes" | "styleProfile">): HouseLook {
  const f = p.finishes;
  const fac = FACADE[f.facade] ?? FACADE["plaster-white"];
  const roof = ROOF[f.roof] ?? ROOF["flat-membrane"];
  const frames = FRAMES[f.windowFrames] ?? FRAMES["frame-graphite"];
  const style = f.styleId ? findStyle(f.styleId) : undefined;
  // Цвет словами человека — только если это hex и профиль совпадает с текущим фасадом.
  const named = p.styleProfile?.exterior.facadeColor;
  const profileFacade = p.styleProfile?.finishes.facade;
  const wall =
    named && HEX.test(named) && (!profileFacade || profileFacade === f.facade) ? named : fac.wall;
  const slats =
    style?.accent === "larch-slats" ||
    (p.styleProfile?.exterior.tags ?? []).some((t) => /ламел/.test(t))
      ? "#b98a5a"
      : null;
  return {
    facadeId: f.facade,
    facadeLabel: findFinish("facade", f.facade)?.label ?? f.facade,
    material: fac.material,
    wall,
    slats: fac.material === "wood" || fac.material === "dark-wood" ? null : slats,
    roofId: f.roof,
    roofLabel: findFinish("roof", f.roof)?.label ?? f.roof,
    roof: roof.color,
    roofKind: roof.kind,
    frames: frames.color,
    framesLabel: findFinish("windowFrames", f.windowFrames)?.label ?? f.windowFrames,
    interiorLabel: findFinish("interior", f.interior)?.label ?? f.interior,
    en: {
      facade: fac.en,
      roof: roof.en,
      frames: frames.en,
      slats:
        fac.material === "wood" || fac.material === "dark-wood" || !slats
          ? null
          : "vertical larch wood slats as accents",
    },
  };
}
