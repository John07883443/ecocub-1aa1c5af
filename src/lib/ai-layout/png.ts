/**
 * Минимальный растеризатор и PNG-энкодер без внешних зависимостей.
 *
 * Зачем свой: снимок контура должен строиться на сервере — детерминированно,
 * без DOM и без скриншота интерфейса. Тянуть canvas-библиотеку ради четырёх
 * примитивов (заливка, прямоугольник, линия, засечка) в проект, где графика
 * до сих пор обходилась SVG, несоразмерно. Нужен ровно один формат вывода:
 * непрозрачный RGB-PNG без интерлейса.
 *
 * Сжатие — node:zlib (deflate), CRC32 и Adler32 считаются здесь же.
 */

export interface Canvas {
  width: number;
  height: number;
  /** RGB, три байта на пиксель, строка за строкой. */
  data: Uint8Array;
}

export type RGB = [number, number, number];

export function createCanvas(width: number, height: number, background: RGB): Canvas {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
  }
  return { width, height, data };
}

function setPixel(c: Canvas, x: number, y: number, color: RGB) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 3;
  c.data[i] = color[0];
  c.data[i + 1] = color[1];
  c.data[i + 2] = color[2];
}

/** Прямоугольная заливка. Координаты в пикселях, границы округляются. */
export function fillRect(c: Canvas, x: number, y: number, w: number, h: number, color: RGB): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + w);
  const y1 = Math.round(y + h);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) setPixel(c, px, py, color);
  }
}

/**
 * Отрезок заданной толщины. Линии плана строго ортогональны, поэтому
 * достаточно прямоугольника по направлению — без сглаживания, чтобы
 * результат был побайтово воспроизводимым.
 */
export function drawLine(
  c: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  color: RGB,
): void {
  const t = Math.max(1, Math.round(thickness));
  const half = t / 2;
  if (Math.abs(y1 - y2) < 0.5) {
    const from = Math.min(x1, x2);
    const to = Math.max(x1, x2);
    fillRect(c, from - half, y1 - half, to - from + t, t, color);
    return;
  }
  if (Math.abs(x1 - x2) < 0.5) {
    const from = Math.min(y1, y2);
    const to = Math.max(y1, y2);
    fillRect(c, x1 - half, from - half, t, to - from + t, color);
    return;
  }
  // Наклонных линий на плане нет, но безопасный запасной путь пусть будет.
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= steps; i += 1) {
    const px = x1 + ((x2 - x1) * i) / steps;
    const py = y1 + ((y2 - y1) * i) / steps;
    fillRect(c, px - half, py - half, t, t, color);
  }
}

/* ------------------------------------------------------------------ */
/* Кодирование PNG                                                     */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + payload.length);
  body.set(typeBytes, 0);
  body.set(payload, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(payload.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** Кодирует холст в PNG (8 бит, truecolor, без альфы). */
export async function encodePng(c: Canvas): Promise<Uint8Array> {
  // Фильтр 0 в начале каждой строки: без предсказания, зато предсказуемо.
  const raw = new Uint8Array(c.height * (1 + c.width * 3));
  for (let y = 0; y < c.height; y += 1) {
    const rowStart = y * (1 + c.width * 3);
    raw[rowStart] = 0;
    raw.set(c.data.subarray(y * c.width * 3, (y + 1) * c.width * 3), rowStart + 1);
  }

  const { deflateSync } = await import("node:zlib");
  const compressed = new Uint8Array(deflateSync(raw, { level: 9 }));

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(c.width), 0);
  ihdr.set(u32(c.height), 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 2; // truecolor
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // фильтрация
  ihdr[12] = 0; // без интерлейса

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Проверка сигнатуры — используется валидацией ответа провайдера. */
export function isPng(bytes: Uint8Array): boolean {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return sig.every((b, i) => bytes[i] === b);
}
