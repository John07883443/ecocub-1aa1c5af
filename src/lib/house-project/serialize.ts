import { DEFAULT_MODULE_TYPE_ID } from "./catalog.ts";
import type {
  DoorSwing,
  FaceId,
  FoundationConfig,
  HouseModel,
  HouseProject,
  ModuleInstance,
  OpeningInstance,
  OpeningKind,
  ProjectStatus,
  PublicationData,
  RotationDeg,
  SourceData,
  UnderlayConfig,
} from "./types.ts";
import { FACE_IDS, SCHEMA_VERSION } from "./types.ts";

/**
 * Чтение и запись канонического проекта.
 *
 * Разбор общий для всех источников: файла-фикстуры, строки базы, импорта
 * JSON, тела HTTP-запроса. Одна функция — одна форма данных на выходе; иначе
 * расхождение можно внести правкой в одном месте, и оно всплывёт годом позже
 * при открытии старого проекта.
 *
 * Принцип разбора: неизвестное поле отбрасывается, некорректное значение
 * заменяется безопасным умолчанием, а отсутствие того, без чего проект не
 * проект (модель, id), — повод вернуть null. Молчаливо «чинить» геометрию
 * нельзя: лучше отказать в чтении, чем показать проектировщику дом, который
 * он не собирал.
 */

const ROTATIONS: RotationDeg[] = [0, 90, 180, 270];
const OPENING_KINDS: OpeningKind[] = ["window", "door", "panoramic", "passage"];
const SWINGS: DoorSwing[] = ["in-left", "in-right", "out-left", "out-right"];
const STATUSES: ProjectStatus[] = ["draft", "published", "archived"];

/**
 * Убрать ключи со значением undefined.
 *
 * Не косметика. `{ mirrored: undefined }` и `{}` для JSON.stringify одно и то
 * же, а для сравнения объектов — разные вещи. Без этой чистки проверка
 * «сохранили и открыли — получили то же самое» ловила бы несуществующее
 * расхождение при каждом чтении, и ей перестали бы верить.
 */
function compact<T>(obj: T): T {
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return obj;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** Миллиметры округляются до целого при каждом чтении: дробных мм в модели нет. */
function mm(v: unknown, fallback: number): number {
  return Math.round(num(v, fallback));
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function parseModule(raw: unknown): ModuleInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const pos = (r.positionMm ?? {}) as Record<string, unknown>;
  const rotation = num(r.rotationDeg, 0);
  return compact<ModuleInstance>({
    id,
    moduleTypeId: str(r.moduleTypeId) ?? DEFAULT_MODULE_TYPE_ID,
    floor: Math.max(0, Math.round(num(r.floor, 0))),
    positionMm: { x: mm(pos.x, 0), y: mm(pos.y, 0) },
    rotationDeg: (ROTATIONS.includes(rotation as RotationDeg) ? rotation : 0) as RotationDeg,
    mirrored: r.mirrored === true ? true : undefined,
    elevationOffsetMm: r.elevationOffsetMm == null ? undefined : mm(r.elevationOffsetMm, 0),
    note: str(r.note),
  });
}

function parseOpening(raw: unknown): OpeningInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const moduleId = str(r.moduleId);
  const faceId = str(r.faceId) as FaceId | undefined;
  if (!id || !moduleId || !faceId || !FACE_IDS.includes(faceId)) return null;
  const kind = str(r.kind) as OpeningKind | undefined;
  const swing = str(r.swing) as DoorSwing | undefined;
  return compact<OpeningInstance>({
    id,
    moduleId,
    faceId,
    kind: kind && OPENING_KINDS.includes(kind) ? kind : "window",
    offsetMm: mm(r.offsetMm, 0),
    widthMm: mm(r.widthMm, 0),
    heightMm: mm(r.heightMm, 0),
    sillMm: mm(r.sillMm, 0),
    swing: swing && SWINGS.includes(swing) ? swing : undefined,
    variantId: str(r.variantId),
    bandId: str(r.bandId),
    note: str(r.note),
  });
}

function parseFoundation(raw: unknown): FoundationConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = str(r.kind);
  return compact<FoundationConfig>({
    kind: kind === "slab" || kind === "none" ? kind : "piles",
    clearanceMm: Math.max(0, mm(r.clearanceMm, 500)),
    pileGridMm: r.pileGridMm == null ? undefined : mm(r.pileGridMm, 0),
    visible: r.visible !== false,
  });
}

function parseUnderlay(raw: unknown): UnderlayConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const src = str(r.src);
  if (!src) return undefined;
  const offset = (r.offsetMm ?? {}) as Record<string, unknown>;
  const calibRaw = r.calibration as Record<string, unknown> | undefined;
  let calibration: UnderlayConfig["calibration"];
  if (calibRaw && typeof calibRaw === "object") {
    const a = (calibRaw.aPx ?? {}) as Record<string, unknown>;
    const b = (calibRaw.bPx ?? {}) as Record<string, unknown>;
    calibration = {
      aPx: { x: num(a.x, 0), y: num(a.y, 0) },
      bPx: { x: num(b.x, 0), y: num(b.y, 0) },
      knownMm: mm(calibRaw.knownMm, 0),
    };
  }
  return compact<UnderlayConfig>({
    src,
    floor: Math.max(0, Math.round(num(r.floor, 0))),
    mmPerPx: Math.max(0.01, num(r.mmPerPx, 10)),
    offsetMm: { x: mm(offset.x, 0), y: mm(offset.y, 0) },
    rotationDeg: num(r.rotationDeg, 0),
    opacity: Math.min(1, Math.max(0, num(r.opacity, 0.5))),
    locked: r.locked === true,
    visible: r.visible !== false,
    calibration,
  });
}

export function parseModel(raw: unknown): HouseModel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const modules = Array.isArray(r.modules)
    ? r.modules.map(parseModule).filter((m): m is ModuleInstance => m !== null)
    : [];
  const known = new Set(modules.map((m) => m.id));
  const openings = Array.isArray(r.openings)
    ? r.openings
        .map(parseOpening)
        .filter((o): o is OpeningInstance => o !== null && known.has(o.moduleId))
    : [];
  return {
    units: "mm",
    modules,
    openings,
    foundation: parseFoundation(r.foundation),
    groundOffsetMm: mm(r.groundOffsetMm, 0),
  };
}

function parsePublication(raw: unknown): PublicationData {
  const r = (raw ?? {}) as Record<string, unknown>;
  return compact<PublicationData>({
    coverImage: str(r.coverImage),
    gallery: strArray(r.gallery),
    highlights: strArray(r.highlights),
    tags: strArray(r.tags),
    priceFrom: r.priceFrom == null ? undefined : Math.max(0, Math.round(num(r.priceFrom, 0))),
    currency: "RUB",
    marketingAreaM2: r.marketingAreaM2 == null ? undefined : Math.max(0, num(r.marketingAreaM2, 0)),
    isFeatured: r.isFeatured === true,
  });
}

function parseSource(raw: unknown): SourceData {
  const r = (raw ?? {}) as Record<string, unknown>;
  return compact<SourceData>({
    referenceHouseName: str(r.referenceHouseName),
    referenceDocumentIds: strArray(r.referenceDocumentIds),
    notes: str(r.notes),
    unresolvedQuestions: strArray(r.unresolvedQuestions),
  });
}

/**
 * Поднять запись до текущей версии схемы.
 *
 * Пока версия одна, и функция ничего не делает — но она вызывается уже
 * сейчас, на пустом месте. Так к моменту, когда версий станет две, точка
 * подъёма будет одна и уже встроена во все пути чтения, а не появится
 * наспех вместе с первой миграцией.
 */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = num(raw.schemaVersion, 1);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Проект сохранён схемой версии ${version}, а этот код знает только ${SCHEMA_VERSION}. ` +
        `Обновите приложение — открывать «как получится» нельзя, потеряется геометрия.`,
    );
  }
  return raw;
}

/** Разбор проекта из любого источника. null — запись нечитаема. */
export function parseProject(raw: unknown): HouseProject | null {
  if (!raw || typeof raw !== "object") return null;
  const r = migrate(raw as Record<string, unknown>);

  const id = str(r.id);
  const title = str(r.title);
  const slug = str(r.slug);
  const model = parseModel(r.model);
  if (!id || !title || !slug || !model) return null;

  const status = str(r.status) as ProjectStatus | undefined;
  const now = new Date().toISOString();

  return compact<HouseProject>({
    id,
    schemaVersion: SCHEMA_VERSION,
    status: status && STATUSES.includes(status) ? status : "draft",
    title,
    slug,
    description: str(r.description),
    createdAt: str(r.createdAt) ?? now,
    updatedAt: str(r.updatedAt) ?? now,
    publishedAt: str(r.publishedAt),
    version: Math.max(1, Math.round(num(r.version, 1))),
    model,
    underlay: parseUnderlay(r.underlay),
    publication: parsePublication(r.publication),
    source: parseSource(r.source),
  });
}

/**
 * Запись проекта в JSON-совместимую структуру.
 *
 * Отдельная функция, а не JSON.stringify по месту: сериализация обязана
 * терять всё, что не входит в канонический формат (служебные поля редактора,
 * временные выделения), иначе они утекут в базу и однажды будут прочитаны как
 * данные.
 */
export function serializeProject(p: HouseProject): Record<string, unknown> {
  return compact({
    id: p.id,
    schemaVersion: SCHEMA_VERSION,
    status: p.status,
    title: p.title,
    slug: p.slug,
    description: p.description,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt,
    version: p.version,
    model: {
      units: "mm",
      modules: p.model.modules,
      openings: p.model.openings,
      foundation: p.model.foundation,
      groundOffsetMm: p.model.groundOffsetMm,
    },
    underlay: p.underlay,
    publication: p.publication,
    source: p.source,
  });
}

/** Экспорт в текст — резервная копия и диагностика. */
export function exportProjectJson(p: HouseProject): string {
  return JSON.stringify(serializeProject(p), null, 2);
}

/** Импорт из текста. Бросает с внятным текстом, если файл не тот. */
export function importProjectJson(text: string): HouseProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Файл не является корректным JSON");
  }
  const project = parseProject(raw);
  if (!project) throw new Error("В файле нет проекта дома EcoCub (нет id, названия или модели)");
  return project;
}

/**
 * Проверка «сохранили — открыли — получили то же самое».
 *
 * Вызывается валидацией перед публикацией: единственный способ убедиться,
 * что модель переживёт круг через базу, — прогнать её через тот же разбор,
 * которым она будет прочитана.
 */
export function roundTripEquals(p: HouseProject): boolean {
  const again = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
  if (!again) return false;
  return JSON.stringify(serializeProject(again)) === JSON.stringify(serializeProject(p));
}
