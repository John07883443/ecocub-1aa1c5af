/**
 * Канонический формат проекта дома EcoCub.
 *
 * Зачем он нужен отдельно от `src/lib/constructor`. Публичный конструктор
 * считает модуль квадратом 3 × 3 м с шагом 0,5 м — это удобная клиентская
 * абстракция, и трогать её незачем. Но воспроизвести по ней реальный дом
 * нельзя: заводской модуль 3200 × 3420 мм, стена 210, и на доме из восьми
 * модулей разница набегает в метры. Поэтому у CAD Light своя модель, и она
 * ведётся в миллиметрах.
 *
 * Единицы. Все линейные размеры — целые миллиметры. Это не педантизм:
 * 3420 / 2 = 1710 точно, а 3,42 / 2 в двоичной плавающей точке — уже нет,
 * и на сотне операций поворота и стыковки координаты «уплывают». Площади
 * считаются из миллиметров и отдаются в м² с округлением.
 *
 * Источник истины. Опубликованный дом — это `HouseProject`, а не картинка и
 * не GLB. Обложка лишь иллюстрация: из модели заново считаются габарит,
 * площадь, число модулей и этажность, и они не хранятся вторым числом рядом
 * (кроме явно помеченного маркетингового значения в `publication`).
 *
 * Версионирование. `schemaVersion` растёт при несовместимом изменении формы
 * данных; `migrate` в serialize.ts поднимает старые записи до текущей версии
 * при чтении. Массовая миграция базы не выполняется — старая запись просто
 * читается новым кодом.
 */

/** Миллиметры, целое число. */
export type Mm = number;

/** Текущая версия схемы модели. */
export const SCHEMA_VERSION = 1;

/** Статус проекта. Удаления нет: снятое с публикации уходит в архив. */
export type ProjectStatus = "draft" | "published" | "archived";

/**
 * Грани модуля в его локальной системе координат.
 *
 * Обозначения взяты с развёрток архитектурного альбома (листы 12–15), чтобы
 * проектировщик, сверяющийся с чертежом, читал в редакторе те же имена.
 * Р-1 и Р-3 — грани длиной в ширину модуля (3200), Р-2 и Р-4 — в его глубину
 * (3420). Это соответствие проверяется тестом против `MODULE` из стандарта.
 */
export type FaceId = "Р-1" | "Р-2" | "Р-3" | "Р-4";

export const FACE_IDS: FaceId[] = ["Р-1", "Р-2", "Р-3", "Р-4"];

/** Допустимые повороты модуля. Произвольный угол невозможен — изделие заводское. */
export type RotationDeg = 0 | 90 | 180 | 270;

/** Тип проёма. */
export type OpeningKind = "window" | "door" | "panoramic" | "passage";

/** Сторона открывания двери. Для окон и проёмов не задаётся. */
export type DoorSwing = "in-left" | "in-right" | "out-left" | "out-right";

/**
 * Экземпляр модуля в доме.
 *
 * `positionMm` — левый нижний угол наружного габарита в плане, после поворота.
 * То есть занимаемый прямоугольник всегда `[x, x + footprintWidth]` ×
 * `[y, y + footprintDepth]`, и при повороте на 90° ширина с глубиной
 * меняются местами. Так координата в инспекторе совпадает с тем, что человек
 * измеряет на чертеже линейкой, и не зависит от того, где у модуля «перед».
 *
 * `z` не хранится: отметка низа модуля выводится из этажа и высоты модуля,
 * а ручная поправка живёт в `elevationOffsetMm`. Хранить её вторым числом
 * значило бы допустить расхождение «этаж 1, а z как у нулевого».
 */
export interface ModuleInstance {
  id: string;
  /** Идентификатор типа из справочника `MODULE_DEFINITIONS`. */
  moduleTypeId: string;
  /** Этаж, 0 — первый. */
  floor: number;
  positionMm: { x: Mm; y: Mm };
  rotationDeg: RotationDeg;
  /**
   * Зеркальное отражение. Разрешено только типам с `mirrorAllowed`: у модуля
   * с несимметричной мокрой зоной отражение меняет разводку, и молча
   * допускать его нельзя.
   */
  mirrored?: boolean;
  /** Ручная поправка отметки низа модуля относительно расчётной, мм. */
  elevationOffsetMm?: Mm;
  /** Заметка проектировщика: чем этот модуль отличается на чертеже. */
  note?: string;
}

/**
 * Проём в грани модуля.
 *
 * `offsetMm` отсчитывается вдоль грани от её начала в локальной системе
 * модуля (см. `faceGeometry` в geometry.ts) — так же, как читается размерная
 * цепочка на развёртке: слева направо.
 *
 * `sillMm` — отметка низа проёма от чистого пола этажа. Для двери 0,
 * для окна — высота подоконника.
 */
export interface OpeningInstance {
  id: string;
  moduleId: string;
  faceId: FaceId;
  kind: OpeningKind;
  offsetMm: Mm;
  widthMm: Mm;
  heightMm: Mm;
  sillMm: Mm;
  swing?: DoorSwing;
  /**
   * Идентификатор варианта высоты из стандарта (`OPENING_HEIGHTS`), если
   * размер взят оттуда. Пусто — размер введён вручную и требует проверки
   * конструктором; валидация помечает такой проём предупреждением.
   */
  variantId?: string;
  note?: string;
}

/**
 * Основание дома.
 *
 * Варианты ограничены теми, что встречаются в реальных проектах: по фасадам
 * альбома низ конструкции основания на отметке −0.500, то есть сваи с
 * просветом. Плита добавлена как второй существующий тип. Декоративных
 * вариантов здесь нет намеренно.
 */
export interface FoundationConfig {
  kind: "piles" | "slab" | "none";
  /** Просвет от земли до низа плиты пола первого этажа, мм. */
  clearanceMm: Mm;
  /** Шаг сетки свай, мм. Пусто — сваи расставляет конструктор по месту. */
  pileGridMm?: Mm;
  /** Показывать основание в 3D. На геометрию дома не влияет. */
  visible: boolean;
}

/** Модель дома — единственный источник истины о геометрии. */
export interface HouseModel {
  units: "mm";
  modules: ModuleInstance[];
  openings: OpeningInstance[];
  foundation: FoundationConfig;
  /** Общая отметка чистого пола первого этажа относительно земли, мм. */
  groundOffsetMm: Mm;
}

/** Настройки подложки-чертежа. Хранятся в черновике, наружу не публикуются. */
export interface UnderlayConfig {
  /** data: URL или путь к изображению. */
  src: string;
  /** К какому этажу относится лист. */
  floor: number;
  /** Масштаб: сколько миллиметров модели в одном пикселе изображения. */
  mmPerPx: number;
  /** Сдвиг левого верхнего угла изображения в координатах модели, мм. */
  offsetMm: { x: Mm; y: Mm };
  rotationDeg: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  /**
   * Калибровка по двум точкам: пиксельные координаты и известное расстояние
   * между ними. Хранится, чтобы масштаб можно было пересчитать и проверить,
   * а не подбирать заново ползунком.
   */
  calibration?: {
    aPx: { x: number; y: number };
    bPx: { x: number; y: number };
    knownMm: Mm;
  };
}

/** Данные карточки каталога. */
export interface PublicationData {
  coverImage?: string;
  gallery: string[];
  highlights: string[];
  tags: string[];
  priceFrom?: number;
  currency: "RUB";
  /**
   * Маркетинговая площадь, если она отличается от расчётной. Помечена явно и
   * никогда не подменяет расчёт: карточка показывает оба числа.
   */
  marketingAreaM2?: number;
  isFeatured: boolean;
}

/** Откуда взят дом: ссылки на исходные документы и список неясностей. */
export interface SourceData {
  referenceHouseName?: string;
  referenceDocumentIds: string[];
  notes?: string;
  unresolvedQuestions: string[];
}

export interface HouseProject {
  id: string;
  schemaVersion: number;
  status: ProjectStatus;
  title: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  /**
   * Номер версии записи. Растёт при каждом сохранении и служит
   * оптимистичной блокировкой: сохранение со старым номером отклоняется,
   * и вкладка, провисевшая открытой сутки, не затирает свежую модель.
   */
  version: number;
  model: HouseModel;
  underlay?: UnderlayConfig;
  publication: PublicationData;
  source: SourceData;
}

/** Короткая форма для списков: без модели, но с посчитанными числами. */
export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  status: ProjectStatus;
  description?: string;
  updatedAt: string;
  publishedAt?: string;
  version: number;
  coverImage?: string;
  priceFrom?: number;
  tags: string[];
  highlights: string[];
  metrics: HouseMetrics;
}

/** Всё, что считается из геометрии. Ни одно из этих чисел не вводится руками. */
export interface HouseMetrics {
  moduleCount: number;
  floors: number;
  /** Тёплый контур: сумма наружных площадей модулей, м². */
  warmAreaM2: number;
  /** Жилая площадь по правилу подачи EcoCub (тёплый контур, округление вверх). */
  livingAreaM2: number;
  /** Площадь застройки — модули первого этажа, м². */
  footprintAreaM2: number;
  /** Габарит по наружным граням всех этажей, мм. */
  boundsMm: { widthMm: Mm; depthMm: Mm };
  /** Высота от чистого пола первого этажа до верха плиты кровли, мм. */
  heightMm: Mm;
  openings: { windows: number; doors: number; panoramic: number; passages: number };
}

/** Проблема модели. `error` блокирует публикацию, `warning` требует подтверждения. */
export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  /** К чему относится: модуль, проём, проект целиком. */
  targetId?: string;
}
