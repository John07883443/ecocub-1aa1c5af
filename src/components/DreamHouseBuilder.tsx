import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Baby,
  Bath,
  Blocks,
  BookOpen,
  Box,
  Boxes,
  Car,
  Check,
  Dog,
  DoorOpen,
  Dumbbell,
  Flame,
  Home,
  KeyRound,
  Laptop,
  MapPin,
  Maximize,
  MessageCircle,
  Mountain,
  Package,
  PanelsTopLeft,
  Phone,
  Send,
  Shirt,
  Sparkles,
  Square,
  Trees,
  TreePine,
  Triangle,
  Users,
  UsersRound,
  Warehouse,
  WashingMachine,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { analytics } from "@/lib/analytics";
import { buildAttribution, attributionSummary } from "@/lib/attribution";
import {
  DREAM_PROFILE_EVENT,
  loadDreamProfile,
  persistDreamProfile,
  type DreamAnswers,
} from "@/lib/dreamProfile";
import { site } from "@/lib/site";

/**
 * DreamHouseBuilder — второй уровень воронки: «Собрать дом мечты».
 *
 * Быстрый квиз (HouseQuiz) ловит лид за минуту. Этот блок — для самых горячих:
 * подробная карта потребностей (образ жизни, санузлы, мастер-спальня, гости,
 * открытые зоны, парковка, стиль, крыша, остекление), а наградой — живое
 * превью «дома из кубиков», которое собирается прямо по ответам, без ИИ и без
 * задержек (детерминированная изометрия из модулей EcoCub).
 *
 * В конце — заявка в тот же пайплайн (Telegram /api/notify + submissions с
 * атрибуцией) и приглашение в Telegram-группу. Это задел под Этап 3: полноценный
 * ИИ-рендер дома мечты, который придёт человеку после регистрации и подписки.
 * Пока рендер собирает инженер — обещание мягкое и честное.
 */

/* ------------------------------------------------------------------ */
/* Вопросы                                                             */
/* ------------------------------------------------------------------ */

type Choice = {
  value: string;
  hint?: string;
  icon: LucideIcon;
};

type Question = {
  id: string;
  eyebrow: string;
  title: string;
  /** Множественный выбор — не автопереход, нужна кнопка «Далее». */
  multi?: boolean;
  /** Условный показ шага (например, число машин — только если есть парковка). */
  showIf?: (a: Answers) => boolean;
  choices: Choice[];
};

type Answers = Record<string, string | string[]>;

const QUESTIONS: Question[] = [
  {
    id: "purpose",
    eyebrow: "Назначение",
    title: "Для чего дом?",
    choices: [
      { value: "ПМЖ — живём круглый год", hint: "тёплый дом на каждый день", icon: Home },
      { value: "Дача — сезон и выходные", hint: "отдых за городом", icon: TreePine },
      { value: "Сдача в аренду", hint: "дом, который зарабатывает", icon: KeyRound },
      { value: "Гостевой дом", hint: "дополнительный блок", icon: Users },
    ],
  },
  {
    id: "size",
    eyebrow: "Масштаб",
    title: "Какой дом собираем?",
    choices: [
      { value: "Компактный", hint: "1–2 человека · ≈ 54–72 м²", icon: Box },
      { value: "Семейный", hint: "3–4 человека · ≈ 108–144 м²", icon: Boxes },
      { value: "Просторный", hint: "5+ / два поколения · ≈ 180–288 м²", icon: Blocks },
    ],
  },
  {
    id: "floors",
    eyebrow: "Этажность",
    title: "Сколько этажей?",
    choices: [
      { value: "1 этаж", hint: "всё на одном уровне", icon: Box },
      { value: "2 этажа", hint: "классика для семьи", icon: Boxes },
      { value: "3 этажа", hint: "максимум пространства", icon: Blocks },
    ],
  },
  {
    id: "bathrooms",
    eyebrow: "Санузлы",
    title: "Сколько санузлов нужно?",
    choices: [
      { value: "1 санузел", hint: "компактный формат", icon: Bath },
      { value: "2 санузла", hint: "гостевой + приватный", icon: Bath },
      { value: "3+ санузла", hint: "к спальням и на этажах", icon: Bath },
    ],
  },
  {
    id: "master",
    eyebrow: "Мастер-спальня",
    title: "Насколько важна мастер-спальня?",
    choices: [
      {
        value: "Обязательно: с гардеробной и санузлом",
        hint: "личная зона родителей",
        icon: DoorOpen,
      },
      { value: "Желательно", hint: "отдельная спальня побольше", icon: Home },
      { value: "Не принципиально", hint: "равнозначные комнаты", icon: Square },
    ],
  },
  {
    id: "guests",
    eyebrow: "Гости и родители",
    title: "Как часто приезжают гости или родители?",
    choices: [
      {
        value: "Часто и надолго — нужна гостевая",
        hint: "отдельная спальня + санузел",
        icon: UsersRound,
      },
      { value: "Иногда, на выходные", hint: "гостевая-кабинет", icon: Users },
      { value: "Редко", hint: "обойдёмся диваном", icon: Home },
    ],
  },
  {
    id: "lifestyle",
    eyebrow: "Образ жизни",
    title: "Кто и как живёт в доме?",
    multi: true,
    choices: [
      { value: "Собака", hint: "тамбур, мойка лап", icon: Dog },
      { value: "Маленькие дети", hint: "спальни рядом", icon: Baby },
      { value: "Подростки", hint: "личные комнаты", icon: Users },
      { value: "Пожилые родители", hint: "спальня на 1 этаже", icon: UsersRound },
      { value: "Работаю из дома", hint: "кабинет", icon: Laptop },
    ],
  },
  {
    id: "rooms",
    eyebrow: "Помещения",
    title: "Какие помещения нужны?",
    multi: true,
    choices: [
      { value: "Баня / сауна", hint: "своя парная", icon: Waves },
      { value: "Постирочная", hint: "стирка и сушка отдельно", icon: WashingMachine },
      { value: "Котельная / бойлерная", hint: "инженерия в отдельной комнате", icon: Flame },
      { value: "Гардеробная", hint: "хранение вещей", icon: Shirt },
      { value: "Кладовая", hint: "запасы и хозблок", icon: Package },
      { value: "Прихожая / тамбур", hint: "тёплый вход", icon: DoorOpen },
      { value: "Кабинет", hint: "рабочее место", icon: BookOpen },
      { value: "Спортзал / хобби", hint: "комната под увлечения", icon: Dumbbell },
    ],
  },
  {
    id: "openzones",
    eyebrow: "Открытые зоны",
    title: "Веранда или терраса?",
    choices: [
      { value: "Веранда", hint: "крытая зона у входа", icon: Trees },
      { value: "Терраса на кровле", hint: "эксплуатируемая крыша", icon: Maximize },
      { value: "И веранда, и терраса", hint: "по максимуму", icon: Sparkles },
      { value: "Без открытых зон", hint: "закрытый объём", icon: Square },
    ],
  },
  {
    id: "parking",
    eyebrow: "Автомобиль",
    title: "Гараж или навес для машины?",
    choices: [
      { value: "Гараж", hint: "закрытый, отапливаемый", icon: Warehouse },
      { value: "Навес (карпорт)", hint: "открытый козырёк", icon: Car },
      { value: "Не нужно", hint: "парковка на участке", icon: MapPin },
    ],
  },
  {
    id: "cars",
    eyebrow: "Автопарк",
    title: "Сколько машин?",
    showIf: (a) => a.parking === "Гараж" || a.parking === "Навес (карпорт)",
    choices: [
      { value: "1 машина", hint: "одно место", icon: Car },
      { value: "2 машины", hint: "два места", icon: Car },
      { value: "3+ машины", hint: "широкий фронт", icon: Car },
    ],
  },
  {
    id: "style",
    eyebrow: "Стиль",
    title: "Какая архитектура нравится?",
    choices: [
      { value: "Минимализм", hint: "чистые формы, светлые стены", icon: Square },
      { value: "Барнхаус", hint: "тёмный фасад, скатная крыша", icon: Mountain },
      { value: "Хай-тек", hint: "стекло и графит", icon: PanelsTopLeft },
      { value: "Скандинавский", hint: "тёплое дерево, уют", icon: Home },
    ],
  },
  {
    id: "roof",
    eyebrow: "Крыша",
    title: "Какая крыша по душе?",
    choices: [
      { value: "Плоская", hint: "эксплуатируемая кровля", icon: Square },
      { value: "Двускатная", hint: "классический силуэт", icon: Triangle },
      { value: "Односкатная", hint: "современный наклон", icon: Mountain },
    ],
  },
  {
    id: "windows",
    eyebrow: "Остекление",
    title: "Какие окна предпочитаете?",
    choices: [
      { value: "Компактные", hint: "уютно и тепло", icon: Square },
      { value: "Средние", hint: "баланс света", icon: Square },
      { value: "Большие", hint: "много света", icon: Maximize },
      { value: "Панорамные в пол", hint: "стеклянный фасад", icon: PanelsTopLeft },
    ],
  },
];

const CHANNELS: { value: string; icon: LucideIcon }[] = [
  { value: "Телефонный звонок", icon: Phone },
  { value: "WhatsApp", icon: MessageCircle },
  { value: "Telegram", icon: Send },
];

const phoneRe = /^[+0-9\s\-()]+$/;

/* ------------------------------------------------------------------ */
/* Превью «дом из кубиков» — детерминированная изометрия                */
/* ------------------------------------------------------------------ */

type Spec = {
  cols: number;
  rows: number;
  floors: number;
  roof: "flat" | "gable" | "shed";
  window: number; // доля остекления фасада 0..1
  veranda: boolean;
  terrace: boolean;
  parking: "garage" | "carport" | "none";
  carW: number; // ширина парковки в модулях
  palette: Palette;
};

type Palette = {
  top: string;
  left: string;
  right: string;
  roof: string;
  glass: string;
  wood: string;
};

const PALETTES: Record<string, Palette> = {
  Минимализм: {
    top: "#eef0f2",
    left: "#ccd2d8",
    right: "#aeb6bf",
    roof: "#5b626b",
    glass: "#8fb9cf",
    wood: "#c9b184",
  },
  Барнхаус: {
    top: "#454951",
    left: "#2d3037",
    right: "#1f2127",
    roof: "#181a1e",
    glass: "#e0b475",
    wood: "#8a6a45",
  },
  "Хай-тек": {
    top: "#e2e7ec",
    left: "#b6c0ca",
    right: "#909ba8",
    roof: "#2f3641",
    glass: "#8fd6e2",
    wood: "#b7bcc2",
  },
  Скандинавский: {
    top: "#f2e9db",
    left: "#dcc9ab",
    right: "#c1a984",
    roof: "#6d5c45",
    glass: "#accfe4",
    wood: "#caa06a",
  },
};

const specFromAnswers = (a: Answers): Spec => {
  const size = a.size;
  const cols = size === "Просторный" ? 2 : size === "Семейный" ? 2 : 1;
  const rows = size === "Просторный" ? 2 : 1;
  const floors = a.floors === "3 этажа" ? 3 : a.floors === "2 этажа" ? 2 : 1;
  const roof: Spec["roof"] =
    a.roof === "Двускатная" ? "gable" : a.roof === "Односкатная" ? "shed" : "flat";
  const window =
    a.windows === "Панорамные в пол"
      ? 0.9
      : a.windows === "Большие"
        ? 0.68
        : a.windows === "Средние"
          ? 0.5
          : 0.34;
  const veranda = a.openzones === "Веранда" || a.openzones === "И веранда, и терраса";
  const terrace = a.openzones === "Терраса на кровле" || a.openzones === "И веранда, и терраса";
  const parking: Spec["parking"] =
    a.parking === "Гараж" ? "garage" : a.parking === "Навес (карпорт)" ? "carport" : "none";
  const carW = a.cars === "3+ машины" ? 2.3 : a.cars === "2 машины" ? 1.7 : 1.1;
  const palette = PALETTES[(a.style as string) ?? ""] ?? PALETTES["Минимализм"];
  return { cols, rows, floors, roof, window, veranda, terrace, parking, carW, palette };
};

// Площадь и цена — та же модель, что в быстром квизе (консистентность цифр).
const AREA_BY_SIZE: Record<string, number> = {
  Компактный: 63,
  Семейный: 126,
  Просторный: 216,
};
const formatRub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
const estimate = (a: Answers) => {
  const area = AREA_BY_SIZE[(a.size as string) ?? ""] ?? 0;
  const price = area * site.basePricePerM2;
  const priceMax = Math.round(area * 1.15) * site.basePricePerM2;
  return { area, price, priceMax };
};

const isAnswered = (v: string | string[] | undefined) =>
  v !== undefined && (!Array.isArray(v) || v.length > 0);

// Индекс первого незаполненного активного вопроса (учитывая условные шаги).
const firstUnansweredStep = (ans: Answers): number => {
  const active = QUESTIONS.filter((q) => !q.showIf || q.showIf(ans));
  const idx = active.findIndex((q) => !isAnswered(ans[q.id]));
  return idx === -1 ? active.length : idx;
};

// Изометрия 2:1.
const TW = 40;
const TH = 20;
const LEV = 46;
const RH = 42;

type P = { x: number; y: number };
const iso = (gx: number, gy: number, z = 0): P => ({ x: (gx - gy) * TW, y: (gx + gy) * TH - z });
const poly = (arr: P[]) => arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const shrink = (face: P[], s: number): P[] => {
  const cx = face.reduce((n, p) => n + p.x, 0) / face.length;
  const cy = face.reduce((n, p) => n + p.y, 0) / face.length;
  return face.map((p) => ({ x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s }));
};

function HousePreview({ spec, answered }: { spec: Spec; answered: number }) {
  const { cols, rows, floors, roof, window: win, veranda, terrace, parking, carW, palette } = spec;
  const faces: { pts: string; fill: string; stroke?: string; opacity?: number }[] = [];

  // Кубики-модули: рисуем от дальних к ближним, снизу вверх (painter's algorithm).
  const cells: { gx: number; gy: number; f: number }[] = [];
  for (let f = 0; f < floors; f++)
    for (let gx = 0; gx < cols; gx++) for (let gy = 0; gy < rows; gy++) cells.push({ gx, gy, f });
  cells.sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.f - b.f);

  for (const { gx, gy, f } of cells) {
    const zt = (f + 1) * LEV;
    const zb = f * LEV;
    const A = iso(gx, gy, zt);
    const B = iso(gx + 1, gy, zt);
    const C = iso(gx + 1, gy + 1, zt);
    const D = iso(gx, gy + 1, zt);
    const Bb = iso(gx + 1, gy, zb);
    const Cb = iso(gx + 1, gy + 1, zb);
    const Db = iso(gx, gy + 1, zb);
    faces.push({ pts: poly([A, B, C, D]), fill: palette.top });
    const rightFace = [B, C, Cb, Bb];
    const leftFace = [D, C, Cb, Db];
    faces.push({ pts: poly(rightFace), fill: palette.right });
    faces.push({ pts: poly(leftFace), fill: palette.left });
    // Окна: восточная стена (gx == cols-1) и южная (gy == rows-1).
    if (gx === cols - 1) {
      const w = shrink(rightFace, Math.min(0.94, win));
      faces.push({ pts: poly(w), fill: palette.glass, opacity: 0.92 });
    }
    if (gy === rows - 1) {
      const w = shrink(leftFace, Math.min(0.94, win));
      faces.push({ pts: poly(w), fill: palette.glass, opacity: 0.86 });
    }
  }

  // Крыша поверх верхнего этажа.
  const H = floors * LEV;
  const c00 = iso(0, 0, H);
  const c10 = iso(cols, 0, H);
  const c11 = iso(cols, rows, H);
  const c01 = iso(0, rows, H);
  if (roof === "flat") {
    faces.push({ pts: poly([c00, c10, c11, c01]), fill: palette.roof });
    if (terrace) {
      const deck = shrink([c00, c10, c11, c01], 0.72);
      faces.push({ pts: poly(deck), fill: palette.wood, opacity: 0.85 });
    }
  } else if (roof === "gable") {
    if (cols >= rows) {
      const r0 = iso(0, rows / 2, H + RH);
      const r1 = iso(cols, rows / 2, H + RH);
      faces.push({ pts: poly([c00, c10, r1, r0]), fill: palette.roof, opacity: 0.92 });
      faces.push({ pts: poly([c01, c11, r1, r0]), fill: palette.roof });
      faces.push({ pts: poly([c00, c01, r0]), fill: palette.left });
      faces.push({ pts: poly([c10, c11, r1]), fill: palette.right });
    } else {
      const r0 = iso(cols / 2, 0, H + RH);
      const r1 = iso(cols / 2, rows, H + RH);
      faces.push({ pts: poly([c00, c01, r1, r0]), fill: palette.roof, opacity: 0.92 });
      faces.push({ pts: poly([c10, c11, r1, r0]), fill: palette.roof });
      faces.push({ pts: poly([c00, c10, r0]), fill: palette.right });
      faces.push({ pts: poly([c01, c11, r1]), fill: palette.left });
    }
  } else {
    // Односкатная: задняя кромка (gy=0) поднята.
    const bn0 = iso(0, 0, H + RH);
    const bn1 = iso(cols, 0, H + RH);
    faces.push({ pts: poly([c00, c10, bn1, bn0]), fill: palette.roof, opacity: 0.9 });
    faces.push({ pts: poly([bn0, bn1, c11, c01]), fill: palette.roof });
    faces.push({ pts: poly([c00, bn0, c01]), fill: palette.left, opacity: 0.85 });
    faces.push({ pts: poly([c10, bn1, c11]), fill: palette.right, opacity: 0.85 });
  }

  // Веранда: крытый настил перед фасадом.
  if (veranda) {
    const vy1 = rows + 0.85;
    const d0 = iso(0, rows, 6);
    const d1 = iso(cols, rows, 6);
    const d2 = iso(cols, vy1, 6);
    const d3 = iso(0, vy1, 6);
    faces.push({ pts: poly([d0, d1, d2, d3]), fill: palette.wood, opacity: 0.9 });
    // Тонкий козырёк на стойках.
    const ct = 0.62 * LEV;
    const k0 = iso(0, rows, ct);
    const k1 = iso(cols, rows, ct);
    const k2 = iso(cols, vy1, ct);
    const k3 = iso(0, vy1, ct);
    faces.push({ pts: poly([k0, k1, k2, k3]), fill: palette.roof, opacity: 0.55 });
    const p2 = iso(cols, vy1, 6);
    const p3 = iso(0, vy1, 6);
    postLines(faces, [p2, p3], ct - 6, palette.right);
  }

  // Парковка слева-впереди: гараж (короб с воротами) или карпорт (навес на стойках).
  if (parking !== "none") {
    const gx1 = -0.25;
    const gx0 = gx1 - carW;
    const gy0 = rows - 0.05;
    const gy1 = rows + 0.95;
    if (parking === "garage") {
      const gh = 0.72 * LEV;
      const t0 = iso(gx0, gy0, gh);
      const t1 = iso(gx1, gy0, gh);
      const t2 = iso(gx1, gy1, gh);
      const t3 = iso(gx0, gy1, gh);
      const b1 = iso(gx1, gy0, 0);
      const b2 = iso(gx1, gy1, 0);
      const b3 = iso(gx0, gy1, 0);
      faces.push({ pts: poly([t0, t1, t2, t3]), fill: palette.top, opacity: 0.95 });
      const front = [t2, t1, b1, b2]; // южная стена — ворота
      const side = [t3, t2, b2, b3];
      faces.push({ pts: poly(side), fill: palette.left });
      faces.push({ pts: poly(front), fill: palette.right });
      faces.push({ pts: poly(shrink(front, 0.78)), fill: palette.roof, opacity: 0.6 });
    } else {
      const ch = 0.7 * LEV;
      const t0 = iso(gx0, gy0, ch);
      const t1 = iso(gx1, gy0, ch);
      const t2 = iso(gx1, gy1, ch);
      const t3 = iso(gx0, gy1, ch);
      faces.push({ pts: poly([t0, t1, t2, t3]), fill: palette.roof, opacity: 0.8 });
      postLines(faces, [t0, t1, t2, t3], ch, palette.right);
    }
  }

  // Габариты вьюпорта подбираем под самый крупный вариант, чтобы дом не «прыгал».
  return (
    <svg
      viewBox="-260 -250 520 470"
      className="h-full w-full"
      role="img"
      aria-label="Превью дома, собранного по вашим ответам"
    >
      <ellipse cx="0" cy="118" rx="180" ry="46" fill="currentColor" opacity="0.06" />
      {faces.map((f, i) => (
        <polygon
          key={i}
          points={f.pts}
          fill={f.fill}
          fillOpacity={f.opacity ?? 1}
          stroke="rgba(0,0,0,0.14)"
          strokeWidth={0.75}
          strokeLinejoin="round"
        />
      ))}
      {answered === 0 && (
        <text x="0" y="150" textAnchor="middle" fill="currentColor" opacity="0.4" fontSize="13">
          Отвечайте — дом собирается на глазах
        </text>
      )}
    </svg>
  );
}

// Вертикальные стойки под настилом/навесом.
function postLines(
  faces: { pts: string; fill: string; opacity?: number }[],
  tops: P[],
  height: number,
  fill: string,
) {
  for (const t of tops) {
    const b = { x: t.x, y: t.y + height };
    faces.push({
      pts: poly([
        { x: t.x - 1.5, y: t.y },
        { x: t.x + 1.5, y: t.y },
        { x: b.x + 1.5, y: b.y },
        { x: b.x - 1.5, y: b.y },
      ]),
      fill,
      opacity: 0.9,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Основной компонент                                                  */
/* ------------------------------------------------------------------ */

export function DreamHouseBuilder() {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState(CHANNELS[2].value); // Telegram по умолчанию — под воронку
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; consent?: string }>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const startedRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef<Answers>(answers);
  answersRef.current = answers;

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  // Мержим профиль из памяти/квиза: уже данные пользователем ответы не затираем.
  const applyProfile = useCallback((incoming: DreamAnswers, jump: boolean) => {
    if (!incoming || Object.keys(incoming).length === 0) return;
    const merged: Answers = { ...incoming, ...answersRef.current };
    answersRef.current = merged;
    setAnswers(merged);
    setPrefilled(true);
    if (jump && !startedRef.current) setStep(firstUnansweredStep(merged));
  }, []);

  // Предзаполнение: из localStorage при монтировании + живое событие после квиза.
  useEffect(() => {
    applyProfile(loadDreamProfile(), true);
    const onProfile = (e: Event) => applyProfile((e as CustomEvent).detail as DreamAnswers, true);
    window.addEventListener(DREAM_PROFILE_EVENT, onProfile);
    return () => window.removeEventListener(DREAM_PROFILE_EVENT, onProfile);
  }, [applyProfile]);

  // Автосейв прогресса конфигуратора (без диспатча события — не зацикливаемся).
  useEffect(() => {
    if (Object.keys(answers).length > 0) persistDreamProfile(answers);
  }, [answers]);

  // Активные вопросы с учётом условных шагов.
  const activeQuestions = useMemo(
    () => QUESTIONS.filter((q) => !q.showIf || q.showIf(answers)),
    [answers],
  );
  const total = activeQuestions.length + 1; // +1 — результат
  const isResult = step >= activeQuestions.length;
  const current = activeQuestions[Math.min(step, activeQuestions.length - 1)];
  const progress = Math.round(
    (Math.min(step, activeQuestions.length) / activeQuestions.length) * 100,
  );

  const spec = useMemo(() => specFromAnswers(answers), [answers]);
  const est = useMemo(() => estimate(answers), [answers]);
  const answeredCount = Object.keys(answers).length;

  const kickAnalytics = () => {
    if (!startedRef.current) {
      startedRef.current = true;
      analytics.quizStart();
      analytics.formStart("dream", "home-dream");
    }
  };

  const pickSingle = (q: Question, value: string) => {
    kickAnalytics();
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    analytics.quizStep(q.id, value);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => setStep((s) => s + 1), 240);
  };

  const toggleMulti = (q: Question, value: string) => {
    kickAnalytics();
    setAnswers((prev) => {
      const cur = Array.isArray(prev[q.id]) ? (prev[q.id] as string[]) : [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [q.id]: next };
    });
  };

  const next = () => {
    if (current && current.multi) analytics.quizStep(current.id, "далее");
    setStep((s) => s + 1);
  };
  const back = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setStep((s) => Math.max(s - 1, 0));
  };

  const validate = () => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = "Введите имя";
    if (phone.trim().length < 5 || !phoneRe.test(phone.trim())) e.phone = "Введите телефон";
    if (!consent) e.consent = "Нужно согласие";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Человекочитаемый бриф — уходит менеджеру и в БД. Это же — сид будущего
  // ИИ-промпта: собран из ответов так, чтобы конструктор/модель могли предложить
  // конкретную компоновку дома.
  const buildSummary = () => {
    const lines: string[] = ["Дом мечты — карта потребностей:"];
    for (const q of QUESTIONS) {
      const v = answers[q.id];
      if (!v || (Array.isArray(v) && v.length === 0)) continue;
      lines.push(`• ${q.eyebrow}: ${Array.isArray(v) ? v.join(", ") : v}`);
    }
    lines.push(`• Связь: ${channel}`);
    lines.push("Хочет ИИ-визуализацию дома мечты.");
    return lines.join("\n");
  };

  // Промпт на естественном языке — задел под Этап 3 (генерация рендера).
  const buildPrompt = () => {
    const g = (id: string) => {
      const v = answers[id];
      return Array.isArray(v) ? v.join(", ") : (v as string | undefined);
    };
    const parts: string[] = [];
    parts.push(
      `Модульный бетонный дом EcoCub${g("size") ? `, ${(g("size") as string).toLowerCase()} формат` : ""}${g("floors") ? `, ${g("floors")}` : ""}.`,
    );
    if (g("purpose")) parts.push(`Назначение: ${g("purpose")}.`);
    if (g("style")) parts.push(`Архитектурный стиль: ${g("style")}.`);
    if (g("roof")) parts.push(`Крыша: ${(g("roof") as string).toLowerCase()}.`);
    if (g("windows")) parts.push(`Остекление: ${(g("windows") as string).toLowerCase()}.`);
    if (g("openzones") && g("openzones") !== "Без открытых зон")
      parts.push(`Открытые зоны: ${g("openzones")}.`);
    if (g("parking") && g("parking") !== "Не нужно")
      parts.push(`Парковка: ${g("parking")}${g("cars") ? ` на ${g("cars")}` : ""}.`);
    if (g("rooms")) parts.push(`Помещения: ${g("rooms")}.`);
    if (g("bathrooms")) parts.push(`Санузлы: ${g("bathrooms")}.`);
    if (g("master")) parts.push(`Мастер-спальня: ${(g("master") as string).toLowerCase()}.`);
    if (g("guests")) parts.push(`Гости/родители: ${(g("guests") as string).toLowerCase()}.`);
    if (g("lifestyle")) parts.push(`Образ жизни: ${g("lifestyle")}.`);
    return parts.join(" ");
  };

  const submit = async () => {
    if (!validate()) {
      analytics.formError("dream", errors.name ? "name" : errors.phone ? "phone" : "consent");
      return;
    }
    setPending(true);
    try {
      const message = buildSummary();
      const attribution = await buildAttribution();

      const notified = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formType: "dream",
          name: name.trim(),
          phone: phone.trim(),
          message,
          sourcePage: typeof window !== "undefined" ? window.location.pathname : undefined,
          attributionSummary: attributionSummary(attribution),
        }),
      })
        .then((r) => r.ok)
        .catch(() => false);

      const { error } = await supabase.from("submissions").insert({
        form_type: "dream",
        name: name.trim(),
        phone: phone.trim(),
        email: null,
        message,
        project_slug: null,
        source_page: typeof window !== "undefined" ? window.location.pathname : null,
        status: "new",
        payload: {
          ...attribution,
          dream: answers,
          prompt: buildPrompt(),
          preferredChannel: channel,
        } as never,
      });
      if (error) console.warn("Дом мечты: заявка не записана в БД:", error.message);
      if (!notified && error) throw error;

      analytics.quizComplete();
      analytics.formSubmit("dream", "home-dream");
      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Попробуйте ещё раз";
      toast.error("Не удалось отправить", { description: msg });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-sm border border-border bg-card shadow-sm">
      {/* Прогресс */}
      <div className="rounded-t-sm border-b border-border px-6 py-4 md:px-8">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span>
            {done ? "Готово" : isResult ? "Последний шаг" : `Шаг ${step + 1} из ${total}`}
          </span>
          <span className="text-accent">{done ? "100%" : `${progress}%`}</span>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${done ? 100 : progress}%` }}
          />
        </div>
        {prefilled && !done && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Check className="size-3.5 text-accent" /> Учли ваши ответы из квиза — можно менять на
            любом шаге.
          </p>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-[1.05fr_1fr]">
        {/* Живое превью «дом из кубиков» — на мобиле липнет к верху при прокрутке */}
        <div className="sticky top-16 z-20 flex min-h-[240px] items-center justify-center border-b border-border bg-secondary p-4 text-foreground md:static md:min-h-[440px] md:border-b-0 md:border-r">
          <HousePreview spec={spec} answered={answeredCount} />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
            <Blocks className="size-3.5 text-accent" /> Ваш дом из кубиков
          </span>
          {est.area > 0 && (
            <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-2 rounded-sm border border-border bg-card/85 px-3 py-2 backdrop-blur">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Площадь</p>
                <p className="text-sm font-bold leading-tight">≈ {est.area} м²</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Под ключ
                </p>
                <p className="text-sm font-bold leading-tight text-accent">
                  от {formatRub(est.price)} ₽
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Вопрос / результат */}
        <div className="p-6 md:p-8">
          {done ? (
            <SuccessState />
          ) : isResult ? (
            <ResultStep
              answers={answers}
              name={name}
              phone={phone}
              channel={channel}
              consent={consent}
              errors={errors}
              pending={pending}
              onName={setName}
              onPhone={setPhone}
              onChannel={setChannel}
              onConsent={setConsent}
              onBack={back}
              onSubmit={submit}
            />
          ) : (
            current && (
              <QuestionStep
                question={current}
                stepIndex={step}
                answers={answers}
                onPickSingle={pickSingle}
                onToggleMulti={toggleMulti}
                onNext={next}
                onBack={step > 0 ? back : undefined}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionStep({
  question,
  stepIndex,
  answers,
  onPickSingle,
  onToggleMulti,
  onNext,
  onBack,
}: {
  question: Question;
  stepIndex: number;
  answers: Answers;
  onPickSingle: (q: Question, v: string) => void;
  onToggleMulti: (q: Question, v: string) => void;
  onNext: () => void;
  onBack?: () => void;
}) {
  const selected = answers[question.id];
  const selectedArr = Array.isArray(selected) ? selected : [];
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
        {String(stepIndex + 1).padStart(2, "0")} · {question.eyebrow}
      </p>
      <h3 className="mt-3 text-xl font-bold uppercase tracking-tight md:text-2xl">
        {question.title}
      </h3>
      {question.multi && (
        <p className="mt-1.5 text-xs text-muted-foreground">Можно выбрать несколько.</p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {question.choices.map((c) => {
          const Icon = c.icon;
          const active = question.multi ? selectedArr.includes(c.value) : selected === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() =>
                question.multi ? onToggleMulti(question, c.value) : onPickSingle(question, c.value)
              }
              aria-pressed={active}
              className={[
                "group flex items-center gap-3.5 rounded-sm border p-4 text-left transition-all",
                active
                  ? "border-accent bg-accent/10 ring-1 ring-accent"
                  : "border-border bg-card hover:border-accent hover:bg-accent/5",
              ].join(" ")}
            >
              <span
                className={[
                  "flex size-10 shrink-0 items-center justify-center rounded-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-accent group-hover:bg-accent/15",
                ].join(" ")}
              >
                {active ? (
                  <Check className="size-5" />
                ) : (
                  <Icon className="size-5" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug">{c.value}</span>
                {c.hint && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{c.hint}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {question.multi && (
          <Button
            type="button"
            onClick={onNext}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            Далее <ArrowRight className="size-4" />
          </Button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Назад
          </button>
        )}
      </div>
    </div>
  );
}

function ResultStep({
  answers,
  name,
  phone,
  channel,
  consent,
  errors,
  pending,
  onName,
  onPhone,
  onChannel,
  onConsent,
  onBack,
  onSubmit,
}: {
  answers: Answers;
  name: string;
  phone: string;
  channel: string;
  consent: boolean;
  errors: { name?: string; phone?: string; consent?: string };
  pending: boolean;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onChannel: (v: string) => void;
  onConsent: (v: boolean) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const chips: string[] = [];
  for (const q of QUESTIONS) {
    const v = answers[q.id];
    if (!v || (Array.isArray(v) && v.length === 0)) continue;
    chips.push(Array.isArray(v) ? v.join(" · ") : (v as string));
  }
  const est = estimate(answers);
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Дом мечты собран</p>
      <h3 className="mt-3 text-xl font-bold uppercase tracking-tight md:text-2xl">
        Осталось получить визуализацию
      </h3>

      {est.area > 0 && (
        <div className="mt-5 rounded-sm border-l-2 border-accent bg-secondary p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Ориентировочная площадь
              </p>
              <p className="mt-1 text-3xl font-bold">
                ≈ {est.area} <span className="text-lg font-normal">м²</span>
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Стоимость под ключ
              </p>
              <p className="mt-1 text-3xl font-bold text-accent">от {formatRub(est.price)} ₽</p>
              <p className="text-xs text-muted-foreground">
                ≈ {(est.price / 1_000_000).toFixed(1)}–{(est.priceMax / 1_000_000).toFixed(1)} млн ₽
                под предчистовую отделку
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((c, i) => (
          <span key={i} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {c}
          </span>
        ))}
      </div>

      <p className="mt-5 text-sm text-muted-foreground">
        Оставьте контакты и вступайте в наш Telegram — соберём по вашей карте потребностей
        визуализацию дома мечты и пришлём вам. Инженер подготовит планировку и точный расчёт под
        ключ. Не понравится компоновка — соберём вместе свой вариант из кубиков с нуля.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Имя</label>
          <Input
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Как к вам обращаться"
            aria-invalid={!!errors.name}
          />
          {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Телефон</label>
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
            aria-invalid={!!errors.phone}
          />
          {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone}</p>}
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-medium">Как удобнее связаться?</label>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((ch) => {
            const Icon = ch.icon;
            const active = channel === ch.value;
            return (
              <button
                key={ch.value}
                type="button"
                onClick={() => onChannel(ch.value)}
                aria-pressed={active}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-accent hover:text-foreground",
                ].join(" ")}
              >
                <Icon className={active ? "size-4 text-accent" : "size-4"} /> {ch.value}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 rounded border-input"
          checked={consent}
          onChange={(e) => onConsent(e.target.checked)}
        />
        <span className="text-xs text-muted-foreground">
          Согласен на обработку персональных данных
        </span>
      </label>
      {errors.consent && <p className="mt-1 text-xs text-destructive">{errors.consent}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          disabled={pending}
          onClick={onSubmit}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          {pending ? "Отправка…" : "Получить визуализацию"}
          {!pending && <ArrowRight />}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
      </div>
    </div>
  );
}

function SuccessState() {
  return (
    <div className="py-6 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Check className="size-7" />
      </span>
      <h3 className="mt-5 text-xl font-bold uppercase tracking-tight md:text-2xl">
        Заявка принята
      </h3>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        Собираем визуализацию вашего дома мечты по карте потребностей. Инженер свяжется в течение
        часа и пришлёт планировку с расчётом под ключ.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
          <a href={site.telegramHref} target="_blank" rel="noopener noreferrer">
            <Send className="size-4" /> Вступить в Telegram
          </a>
        </Button>
        <Button asChild size="lg" variant="outline" className="border-border hover:border-accent">
          <a href={site.phoneHref}>{site.phone}</a>
        </Button>
      </div>
    </div>
  );
}
