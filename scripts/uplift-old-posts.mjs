/**
 * Разовая техническая подтяжка старых статей блога (27–28.11.2026, план
 * согласован с Дирижёром, выкатка по «да» владельца). Текст статей НЕ
 * меняется, адреса статей НЕ меняются.
 *
 *  1. Кадры с Тильды (static.tildacdn.com) → public/images/blog/<адрес>-<n>.webp
 *     (≤ 300 КБ); свои кадры и обложки тяжелее 300 КБ → рядом .webp.
 *     Старые файлы не удаляются: на них могут ссылаться снаружи.
 *  2. Пустой alt → «<подзаголовок раздела> — <заголовок статьи>» (без ИИ).
 *  3. Ссылки https://eco-cub.ru/tpost/<uid>… → /blog/<адрес> (по legacyUid).
 *  4. Рубрики — по списку CATEGORY_FIX (владелец подтверждает списком).
 *  5. seoDescription длиннее 160 → по границе фразы (или слова с «…»).
 *
 *   node --experimental-strip-types scripts/uplift-old-posts.mjs --dry
 *   node --experimental-strip-types scripts/uplift-old-posts.mjs
 * Отчёт «было/стало» — uplift-report.json в корне (в git не идёт).
 */

import { existsSync, statSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toWebp, MAX_WEBP_BYTES } from "../src/lib/image-webp.ts";

const DRY = process.argv.includes("--dry");
const ROOT = path.resolve(import.meta.dirname, "..");
const POSTS = path.join(ROOT, "content", "blog");
const IMAGES = path.join(ROOT, "public", "images", "blog");

/** Предложение рубрик (владелец подтверждает). Нет в списке — рубрика прежняя. */
const CATEGORY_FIX = {
  "energoeffektivnost-modulnih-domov-skolko-mozhno-sekonomit": "tech",
  "doma-s-nizkim-energopotrebleniem-stoit-li-pereplachivat": "tech",
  "montazh-modulnogo-doma-kak-perevozyat-betonnie-moduli": "tech",
  "sovremennie-doma-hai-tek-minimalizm-i-panoramnie-okna": "tech",
  "poetapnaya-oplata-stroitelstva-kak-eto-rabotaet": "guides",
  "nuzhen-li-uklon-uchastka-dlya-panoramnogo-doma": "guides",
  "zhizn-v-kube-dom-bez-dolgov-i-ipotechnih-riskov": "guides",
  "modulnie-doma-na-2-semi-primeri-planirovok": "guides",
  "kak-vibrat-uchastok-pod-modulnii-dom-7-pravil": "guides",
  "podklyuchenie-kommunikatsii-k-domu-chto-uchest-zaranee": "guides",
  "skolko-stoit-modulnii-dom-v-podmoskove": "guides",
  "modulnii-dom-v-podmoskove-osobennosti-i-tseni": "guides",
  "investitsii-v-betonnii-modulnii-dom-likvidnost-i-kapitalizat": "guides",
  "ot-80-tysyach-za-metr-mif": "guides",
  "dom-s-terrasoi-i-panoramnimi-oknami-komfort-tehnologii-i-sti": "tech",
  "modulnie-betonnie-doma-dlya-kruglogodichnogo-prozhivaniya-ra": "tech",
  "dom-pod-klyuch-za-5-dnei-pravda-ili-marketing": "tech",
  "sovremennii-minimalizm-zahvatil-novuyu-rigu": "news",
  "modulnyy-dom-na-sklone-kak-otsenit-uchastok-do-pokupki-zh5tog": "guides",
  "stoimost-modulnogo-doma-kak-premialnaya-otdelka-izmenila-sme-h0k72o": "guides",
  "kak-vybrat-uchastok-pod-modulnyy-dom-chek-list-pered-pokupko-z72z1j": "guides",
  "kak-uchastok-u-reki-i-dom-ekokub-izmenili-moy-obraz-zhizni-phhr6l": "cases",
};

const field = (front, name) => front.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
const unquote = (v) => v.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
const yamlString = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const plain = (md) =>
  md.replace(/<[^>]+>/g, "").replace(/[*_`#]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

function setField(front, name, value) {
  const line = `${name}: ${value}`;
  return new RegExp(`^${name}:.*$`, "m").test(front)
    ? front.replace(new RegExp(`^${name}:.*$`, "m"), line)
    : front.replace(/\n---\s*$/, `\n${line}\n---`);
}

/** Описание ≤ 160: целые предложения; первое длиннее — по слову с «…». */
function shorten(text, max = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?…]+[.!?…]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  if (out.trim().length >= 70) return out.trim();
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,.;:—-]+$/, "")}…`;
}

async function webpFrom(source, target) {
  if (existsSync(target)) return true;
  if (DRY) return true;
  try {
    const data = (await toWebp(source)).data;
    await writeFile(target, data);
    return true;
  } catch (error) {
    console.warn(`  не перегнался ${path.basename(target)}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/** Адрес кадра → свой WebP. null — оставить как есть. */
async function localize(src, slug, n) {
  if (/^https:\/\/static\.tildacdn\.com\//.test(src)) {
    const name = `${slug}-${n}.webp`;
    const target = path.join(IMAGES, name);
    if (!existsSync(target) && !DRY) {
      const response = await fetch(src, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!response?.ok) {
        console.warn(`  Тильда не отдала кадр (${response?.status ?? "сеть"}): ${src}`);
        return null;
      }
      if (!(await webpFrom(Buffer.from(await response.arrayBuffer()), target))) return null;
    }
    return `/images/blog/${name}`;
  }
  const local = /^\/images\/blog\/([^/]+)\.(png|jpe?g)$/i.exec(src);
  if (local) {
    const file = path.join(IMAGES, `${local[1]}.${local[2]}`);
    if (!existsSync(file) || statSync(file).size <= MAX_WEBP_BYTES) return null;
    const target = path.join(IMAGES, `${local[1]}.webp`);
    return (await webpFrom(await readFile(file), target)) ? `/images/blog/${local[1]}.webp` : null;
  }
  return null;
}

const files = (await readdir(POSTS)).filter((f) => f.endsWith(".md"));
const uidToSlug = new Map();
const texts = new Map();
for (const file of files) {
  const text = await readFile(path.join(POSTS, file), "utf8");
  texts.set(file, text);
  const uid = field(text.split(/\n---/)[0], "legacyUid");
  if (uid) uidToSlug.set(uid, file.replace(/\.md$/, ""));
}

const report = { images: 0, alts: 0, links: 0, unresolvedLinks: [], categories: [], descriptions: [] };
for (const file of files) {
  const text = texts.get(file);
  const match = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?([\s\S]*)$/.exec(text);
  if (!match) continue;
  let [, front, body] = match;
  if (field(front, "mmUpdatedAt")) continue; // статьи нового синка уже в порядке
  const slug = file.replace(/\.md$/, "");
  const title = unquote(field(front, "title"));

  // 1–2. Кадры и alt — по строкам, чтобы знать подзаголовок раздела.
  let heading = "";
  let n = 0;
  const usedAlts = new Map();
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const h = /^#{2,3}\s+(.+)$/.exec(lines[i]);
    if (h) heading = plain(h[1]).replace(/[:.]$/, "");
    const images = [...lines[i].matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
    let line = lines[i];
    for (const [whole, alt, src] of images) {
      n += 1;
      const local = await localize(src, slug, n);
      if (local) report.images += 1;
      let nextAlt = alt;
      if (!alt.trim()) {
        const baseAlt = heading && heading !== title ? `${heading} — ${title}` : `${title}: иллюстрация`;
        const seen = usedAlts.get(baseAlt) ?? 0;
        usedAlts.set(baseAlt, seen + 1);
        nextAlt = (seen ? `${baseAlt} (${seen + 1})` : baseAlt).replace(/[[\]]/g, "");
        report.alts += 1;
      }
      line = line.replace(whole, `![${nextAlt}](${local ?? src})`);
    }
    lines[i] = line;
  }
  body = lines.join("\n");

  // 3. /tpost/ → прямой адрес.
  body = body.replace(/https?:\/\/(?:www\.)?eco-cub\.ru\/tpost\/([a-z0-9]+)[^"'\s)<]*/g, (whole, uid) => {
    const target = uidToSlug.get(uid);
    if (!target) {
      report.unresolvedLinks.push(`${slug}: ${whole}`);
      return whole;
    }
    report.links += 1;
    return `/blog/${target}`;
  });

  // Обложка.
  const cover = field(front, "cover");
  const coverLocal = cover ? await localize(cover, slug, 0) : null;
  if (coverLocal) {
    front = setField(front, "cover", coverLocal);
    report.images += 1;
  }

  // 4. Рубрика.
  const before = field(front, "category");
  const after = CATEGORY_FIX[slug];
  if (after && after !== before) {
    front = setField(front, "category", after);
    report.categories.push({ slug, title, before, after });
  }

  // 5. Описание для поиска.
  const desc = unquote(field(front, "seoDescription")) || unquote(field(front, "excerpt"));
  if (desc.length > 160) {
    const short = shorten(desc);
    front = setField(front, "seoDescription", yamlString(short));
    report.descriptions.push({ slug, before: desc, after: short });
  }

  const out = `${front}\n${body}`;
  if (out !== text && !DRY) await writeFile(path.join(POSTS, file), out, "utf8");
}

await writeFile(path.join(ROOT, "uplift-report.json"), JSON.stringify(report, null, 2));
console.log(
  `${DRY ? "Пробно: " : ""}кадров ${report.images}, alt ${report.alts}, ссылок ${report.links} (не нашлось ${report.unresolvedLinks.length}), рубрик ${report.categories.length}, описаний ${report.descriptions.length}`,
);
