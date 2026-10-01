/**
 * StyleProfile — что человек хочет по виду дома, собранное из слов и референсов.
 * Слова разбираются здесь детерминированно (базовый словарь); фото референсов
 * разбирает модель зрения на сервере и возвращает объект той же схемы
 * (`StyleAspect`), который сливается с текстовым. Профиль выбирает отделки
 * из каталога и уходит в промпт рендеров фасада и интерьера.
 */
import { FINISHES, findStyle } from "../grammar/index.ts";
import type { FinishCategory } from "../grammar/index.ts";
import type { Finishes } from "./types.ts";

export type ReferenceKind = "exterior" | "interior";
export type ReferenceMime = "image/jpeg" | "image/png" | "image/webp";

export interface StyleReference {
  id: string;
  kind: ReferenceKind;
  mime: string;
  bytes: number;
  widthPx?: number;
  heightPx?: number;
  /** Дата удаления оригинала с сервера (ISO). */
  deleteAfter?: string;
}

export interface StyleAspect {
  tags: string[];
  /** Цвета в hex. */
  palette: string[];
  materials: string[];
  facadeColor?: string;
  cladding?: string;
  windowFrames?: string;
  roof?: string;
  mood?: string;
}

export interface StyleProfile {
  version: 1;
  source: "text" | "images" | "mixed";
  text?: string;
  exterior: StyleAspect;
  interior: StyleAspect;
  references: StyleReference[];
  matchedStyleId: string | null;
  /** Выбор из каталога отделок. Только id, которые есть в finishes.json. */
  finishes: Partial<Record<FinishCategory, string>>;
  /** 0..1 — насколько уверенно поняли. Ниже 0,5 — архитектор переспрашивает. */
  confidence: number;
}

/** Ограничения на загрузку референсов (приватность и расход). */
export const REFERENCE_LIMITS = {
  maxFiles: 6,
  maxBytes: 8 * 1024 * 1024,
  maxSidePx: 4096,
  mimes: ["image/jpeg", "image/png", "image/webp"] as ReferenceMime[],
  /** Оригиналы удаляются, остаётся только извлечённый профиль. */
  retentionDays: 30,
  stripExif: true,
};

export function validateReferences(refs: StyleReference[]): string[] {
  const errs: string[] = [];
  if (refs.length > REFERENCE_LIMITS.maxFiles)
    errs.push(`Не больше ${REFERENCE_LIMITS.maxFiles} картинок за раз.`);
  for (const r of refs) {
    if (!REFERENCE_LIMITS.mimes.includes(r.mime as ReferenceMime))
      errs.push(`${r.id}: принимаем только JPG, PNG или WebP.`);
    if (r.bytes > REFERENCE_LIMITS.maxBytes) errs.push(`${r.id}: файл больше 8 МБ.`);
    if (
      (r.widthPx ?? 0) > REFERENCE_LIMITS.maxSidePx ||
      (r.heightPx ?? 0) > REFERENCE_LIMITS.maxSidePx
    )
      errs.push(
        `${r.id}: сторона больше ${REFERENCE_LIMITS.maxSidePx} px — уменьшим перед отправкой.`,
      );
  }
  return errs;
}

interface Lexeme {
  words: string[];
  set?: Partial<Record<FinishCategory, string>>;
  aspect?: "exterior" | "interior";
  tag?: string;
  material?: string;
  color?: { name: string; hex: string };
}

/** Базовый словарь: слова человека → отделки каталога. Расширяется данными, не кодом логики. */
const LEXICON: Lexeme[] = [
  {
    words: ["термодерев", "тёмное дерево", "темное дерево"],
    set: { facade: "planken-thermo" },
    material: "термодерево",
    tag: "тёплый",
  },
  {
    words: ["планкен", "лиственниц", "дерев фасад", "фасад дерев"],
    set: { facade: "planken-larch" },
    material: "дерево",
  },
  {
    words: ["бетон", "фиброцемент", "серый фасад"],
    set: { facade: "fiber-cement" },
    material: "бетон",
    tag: "строгий",
  },
  {
    words: ["металл", "кассет", "хай-тек", "хайтек"],
    set: { facade: "metal-panel" },
    material: "металл",
    tag: "технологичный",
  },
  {
    words: ["штукатур", "белый фасад", "белый дом", "светлый фасад"],
    set: { facade: "plaster-white" },
    color: { name: "белый", hex: "#F4F2EE" },
  },
  {
    words: ["чёрные рамы", "черные рамы", "чёрные окна", "черные окна", "чёрный профиль"],
    set: { windowFrames: "frame-black" },
    color: { name: "чёрный", hex: "#1C1C1C" },
  },
  {
    words: ["графит"],
    set: { windowFrames: "frame-graphite" },
    color: { name: "графит", hex: "#3A3D40" },
  },
  {
    words: ["деревянные рамы", "дерево-алюмин", "деревянные окна"],
    set: { windowFrames: "frame-wood-alu" },
    material: "дерево",
  },
  {
    words: ["зелен кровл", "зелен крыш", "газон крыш", "трав крыш"],
    set: { roof: "flat-green" },
    tag: "эко",
  },
  {
    words: ["террас крыш", "эксплуатируем", "крыша-терраса"],
    set: { roof: "flat-exploitable-deck" },
  },
  {
    words: ["микроцемент", "лофт"],
    set: { interior: "interior-concrete" },
    aspect: "interior",
    material: "микроцемент",
  },
  {
    words: ["светлый дуб", "светлый интерьер", "белый интерьер"],
    set: { interior: "interior-light-oak" },
    aspect: "interior",
  },
  {
    words: ["тёплый интерьер", "теплый интерьер", "много дерева внутри"],
    set: { interior: "interior-warm-wood" },
    aspect: "interior",
  },
  {
    words: ["льнян", "бежев", "джапанди"],
    set: { interior: "interior-japandi" },
    aspect: "interior",
    color: { name: "бежевый", hex: "#D8CBB5" },
  },
  { words: ["панорам", "в пол", "много стекл"], tag: "панорамное остекление" },
  {
    words: ["тёмный фасад", "темный фасад", "чёрный фасад", "черный фасад"],
    color: { name: "тёмный", hex: "#2B2724" },
    tag: "тёмный фасад",
  },
];

/** ё → е и нижний регистр: человек пишет как придётся. */
export const norm = (s: string) => ` ${s.toLowerCase().replace(/ё/g, "е")} `;

/** Все основы слова-записи встречаются в тексте («зелен кровл» ловит «зелёную кровлю»). */
const matches = (q: string, entry: string) =>
  norm(entry)
    .trim()
    .split(/\s+/)
    .every((stem) => q.includes(stem));

const emptyAspect = (): StyleAspect => ({ tags: [], palette: [], materials: [] });

export function styleProfileFromText(text: string): StyleProfile {
  const q = norm(text);
  const ext = emptyAspect();
  const int = emptyAspect();
  const finishes: Partial<Record<FinishCategory, string>> = {};
  let hits = 0;
  const style = FINISHES.styles.find((s) => s.aliases.some((a) => matches(q, a))) ?? null;
  for (const lx of LEXICON) {
    if (!lx.words.some((w) => matches(q, w))) continue;
    hits++;
    const a = lx.aspect === "interior" ? int : ext;
    for (const [k, v] of Object.entries(lx.set ?? {})) {
      const cat = k as FinishCategory;
      if (!finishes[cat]) finishes[cat] = v;
    }
    if (lx.tag && !a.tags.includes(lx.tag)) a.tags.push(lx.tag);
    if (lx.material && !a.materials.includes(lx.material)) a.materials.push(lx.material);
    if (lx.color && !a.palette.includes(lx.color.hex)) a.palette.push(lx.color.hex);
    if (lx.set?.facade) ext.cladding = lx.set.facade;
    if (lx.set?.windowFrames) ext.windowFrames = lx.set.windowFrames;
    if (lx.set?.roof) ext.roof = lx.set.roof;
    if (lx.color && !lx.aspect && !lx.set?.windowFrames) ext.facadeColor = lx.color.name;
  }
  if (style) hits++;
  return {
    version: 1,
    source: "text",
    text,
    exterior: ext,
    interior: int,
    references: [],
    matchedStyleId: style?.id ?? null,
    finishes,
    confidence: Math.min(1, hits / 3),
  };
}

/** Слияние: текст человека важнее фото, фото дополняют пропуски. */
export function mergeProfiles(text: StyleProfile, images: StyleProfile): StyleProfile {
  const mergeAspect = (a: StyleAspect, b: StyleAspect): StyleAspect => ({
    tags: [...new Set([...a.tags, ...b.tags])],
    palette: [...new Set([...a.palette, ...b.palette])].slice(0, 8),
    materials: [...new Set([...a.materials, ...b.materials])],
    facadeColor: a.facadeColor ?? b.facadeColor,
    cladding: a.cladding ?? b.cladding,
    windowFrames: a.windowFrames ?? b.windowFrames,
    roof: a.roof ?? b.roof,
    mood: a.mood ?? b.mood,
  });
  return {
    version: 1,
    source: "mixed",
    text: text.text,
    exterior: mergeAspect(text.exterior, images.exterior),
    interior: mergeAspect(text.interior, images.interior),
    references: [...text.references, ...images.references],
    matchedStyleId: text.matchedStyleId ?? images.matchedStyleId,
    finishes: { ...images.finishes, ...text.finishes },
    confidence: Math.max(text.confidence, images.confidence),
  };
}

/** Отделки проекта по профилю: сначала базовый стиль, поверх — явные пожелания. Неизвестные id отбрасываются. */
export function applyStyleProfile(current: Finishes, profile: StyleProfile): Finishes {
  const base = profile.matchedStyleId ? findStyle(profile.matchedStyleId) : undefined;
  const out: Finishes = base
    ? {
        styleId: base.id,
        facade: base.facade,
        roof: base.roof,
        windowFrames: base.windowFrames,
        interior: base.interior,
      }
    : { ...current, styleId: null };
  for (const [k, v] of Object.entries(profile.finishes)) {
    const cat = k as FinishCategory;
    if (v && FINISHES.categories[cat].some((f) => f.id === v)) out[cat] = v;
  }
  return out;
}
