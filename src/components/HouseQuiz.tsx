import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Box,
  Boxes,
  Check,
  Clock3,
  Compass,
  CreditCard,
  Eye,
  HelpCircle,
  Home,
  KeyRound,
  Landmark,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Send,
  TreePine,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { analytics } from "@/lib/analytics";
import { buildAttribution, attributionSummary } from "@/lib/attribution";
import { site } from "@/lib/site";

/**
 * HouseQuiz — нативный квиз подбора проекта.
 *
 * Логика по исследованию квиз-маркетинга: короткие вопросы с готовыми
 * вариантами — лестница микро-обязательств. Порядок от лёгкого («для чего
 * дом») к денежному (способ оплаты) и к «горячему» (сроки) прямо перед
 * контактами, а в конце — награда: ориентировочная площадь и цена под ключ.
 * Одиночный выбор автопереключает шаг. Из ответов вытаскиваем максимум
 * полезного для менеджера: цель, размер, этажность, участок, бюджетный
 * сценарий, сроки и предпочтительный канал связи. «Откуда узнали» не
 * спрашиваем — источник и так пишется в атрибуции автоматически.
 *
 * Карточки размера показывают рендеры домов (public/images/quiz-house-*.webp),
 * с деградацией до иконки, если файл ещё не залит. Заявка уходит в тот же
 * пайплайн, что и форма контактов: POST /api/lead — база и Telegram,
 * с атрибуцией.
 */

type Choice = {
  value: string;
  /** Короткая подпись под заголовком варианта. */
  hint?: string;
  icon: LucideIcon;
  /** Представительная площадь м² — только у вопроса о размере. */
  area?: number;
  /** Путь к рендеру для карточки-картинки (иначе рисуется иконка). */
  image?: string;
};

type Question = {
  id: string;
  /** Слово-указатель слева от заголовка (номер шага рисуется отдельно). */
  eyebrow: string;
  title: string;
  choices: Choice[];
};

const QUESTIONS: Question[] = [
  {
    id: "purpose",
    eyebrow: "Задача",
    title: "Для чего вы строите дом?",
    choices: [
      { value: "Круглогодичное проживание (ПМЖ)", hint: "тёплый дом на каждый день", icon: Home },
      { value: "Загородная дача", hint: "отдых в сезон и на выходных", icon: TreePine },
      { value: "Гостевой дом / баня", hint: "дополнительный блок на участке", icon: Users },
      { value: "Аренда / инвестиция", hint: "дом, который зарабатывает", icon: KeyRound },
    ],
  },
  {
    id: "size",
    eyebrow: "Размер",
    title: "Какой дом вам ближе?",
    choices: [
      {
        value: "1–2 человека · компактный",
        hint: "≈ 54–72 м²",
        icon: Box,
        area: 63,
        image: "/images/quiz-house-compact.webp",
      },
      {
        value: "3–4 человека · семейный",
        hint: "≈ 108–144 м²",
        icon: Boxes,
        area: 126,
        image: "/images/quiz-house-family.webp",
      },
      {
        value: "5+ или два поколения · просторный",
        hint: "≈ 180–288 м²",
        icon: Blocks,
        area: 216,
        image: "/images/quiz-house-estate.webp",
      },
    ],
  },
  {
    id: "floors",
    eyebrow: "Этажность",
    title: "Сколько этажей планируете?",
    choices: [
      { value: "1 этаж", hint: "всё на одном уровне", icon: Box },
      { value: "2 этажа", hint: "классика для семьи", icon: Boxes },
      { value: "3 этажа", hint: "максимум пространства", icon: Blocks },
    ],
  },
  {
    id: "plot",
    eyebrow: "Участок",
    title: "Как обстоят дела с участком?",
    choices: [
      { value: "Участок уже есть", hint: "можно считать проект", icon: MapPin },
      { value: "Выбираю участок", hint: "поможем с требованиями", icon: Compass },
      { value: "Участка пока нет", hint: "подскажем, что искать", icon: Search },
    ],
  },
  {
    id: "budget",
    eyebrow: "Оплата",
    title: "Как планируете оплачивать?",
    choices: [
      { value: "Собственные средства", hint: "оплата напрямую", icon: Wallet },
      { value: "Ипотека", hint: "поможем с одобрением", icon: Landmark },
      { value: "Рассрочка от компании", hint: "платежами по этапам", icon: CreditCard },
      { value: "Ещё не решил", hint: "подберём вариант", icon: HelpCircle },
    ],
  },
  {
    id: "timing",
    eyebrow: "Сроки",
    title: "Когда планируете начать?",
    choices: [
      { value: "В ближайший сезон", hint: "готов приступить", icon: Zap },
      { value: "Через 3–6 месяцев", hint: "планирую заранее", icon: Clock3 },
      { value: "Пока изучаю варианты", hint: "собираю информацию", icon: Eye },
    ],
  },
];

const CHANNELS: { value: string; icon: LucideIcon }[] = [
  { value: "Телефонный звонок", icon: Phone },
  { value: "WhatsApp", icon: MessageCircle },
  { value: "Telegram", icon: Send },
];

const TOTAL_STEPS = QUESTIONS.length + 1; // +1 — шаг результата с контактами

const formatRub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

const phoneRe = /^[+0-9\s\-()]+$/;

export function HouseQuiz() {
  const [step, setStep] = useState(0); // 0..QUESTIONS.length (последний — результат)
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState(CHANNELS[0].value);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; consent?: string }>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const startedRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  const isResult = step === QUESTIONS.length;
  const progress = Math.round((step / (TOTAL_STEPS - 1)) * 100);

  // Оценка площади и цены — из ответа о размере, с запасным значением.
  const sizeChoice = QUESTIONS[1].choices.find((c) => c.value === answers.size);
  const estArea = sizeChoice?.area ?? 126;
  const estPrice = estArea * site.basePricePerM2;
  const estPriceMax = Math.round(estArea * 1.15) * site.basePricePerM2;

  const pick = (q: Question, choice: Choice) => {
    if (!startedRef.current) {
      startedRef.current = true;
      analytics.quizStart();
    }
    setAnswers((prev) => ({ ...prev, [q.id]: choice.value }));
    analytics.quizStep(q.id, choice.value);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      setStep((s) => Math.min(s + 1, QUESTIONS.length));
    }, 260);
  };

  const back = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setStep((s) => Math.max(s - 1, 0));
  };

  const validate = () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = "Введите имя";
    if (phone.trim().length < 5 || !phoneRe.test(phone.trim())) next.phone = "Введите телефон";
    if (!consent) next.consent = "Нужно согласие";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setPending(true);
    try {
      const summaryLines = QUESTIONS.map((q) => {
        const label = q.title.replace(/[?？]$/, "");
        return `${label}: ${answers[q.id] ?? "—"}`;
      });
      summaryLines.push(`Удобная связь: ${channel}`);
      summaryLines.push(
        `Ориентир: ≈ ${estArea} м², от ${formatRub(estPrice)} ₽ под предчистовую отделку`,
      );
      const message = summaryLines.join("\n");

      const attribution = await buildAttribution();

      // Одна точка приёма: сервер кладёт заявку в базу и шлёт уведомление
      // в Telegram. Ошибку вернёт, только если не сработало ни то, ни другое.
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formType: "quiz",
          name: name.trim(),
          phone: phone.trim(),
          message,
          sourcePage: typeof window !== "undefined" ? window.location.pathname : undefined,
          payload: {
            ...attribution,
            quiz: answers,
            preferredChannel: channel,
            estimate: { area: estArea, price: estPrice },
          },
          attributionSummary: attributionSummary(attribution),
        }),
      });
      if (!res.ok) throw new Error("Сервер не принял заявку");

      analytics.quizComplete();
      analytics.formSubmit("quiz", "home-quiz");
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
      <div className="border-b border-border px-6 py-4 md:px-8">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span>
            {done ? "Готово" : isResult ? "Последний шаг" : `Шаг ${step + 1} из ${TOTAL_STEPS}`}
          </span>
          <span className="text-accent">{done ? "100%" : `${progress}%`}</span>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${done ? 100 : progress}%` }}
          />
        </div>
      </div>

      <div className="p-6 md:p-8">
        {done ? (
          <SuccessState estArea={estArea} estPrice={estPrice} channel={channel} />
        ) : isResult ? (
          <ResultStep
            estArea={estArea}
            estPrice={estPrice}
            estPriceMax={estPriceMax}
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
          <QuestionStep
            question={QUESTIONS[step]}
            selected={answers[QUESTIONS[step].id]}
            stepIndex={step}
            onPick={pick}
            onBack={step > 0 ? back : undefined}
          />
        )}
      </div>
    </div>
  );
}

function QuestionStep({
  question,
  selected,
  stepIndex,
  onPick,
  onBack,
}: {
  question: Question;
  selected?: string;
  stepIndex: number;
  onPick: (q: Question, c: Choice) => void;
  onBack?: () => void;
}) {
  const hasImages = question.choices.some((c) => c.image);
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
        {String(stepIndex + 1).padStart(2, "0")} · {question.eyebrow}
      </p>
      <h3 className="mt-3 text-xl font-bold uppercase tracking-tight md:text-2xl">
        {question.title}
      </h3>

      {hasImages ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {question.choices.map((c) => (
            <ImageChoiceCard
              key={c.value}
              choice={c}
              active={selected === c.value}
              onClick={() => onPick(question, c)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {question.choices.map((c) => {
            const Icon = c.icon;
            const active = selected === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => onPick(question, c)}
                aria-pressed={active}
                className={[
                  "group flex items-center gap-4 rounded-sm border p-4 text-left transition-all",
                  active
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-border bg-card hover:border-accent hover:bg-accent/5",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex size-11 shrink-0 items-center justify-center rounded-sm transition-colors",
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
      )}

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
      )}
    </div>
  );
}

function ImageChoiceCard({
  choice,
  active,
  onClick,
}: {
  choice: Choice;
  active: boolean;
  onClick: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const Icon = choice.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "group flex flex-col overflow-hidden rounded-sm border text-left transition-all",
        active
          ? "border-accent ring-1 ring-accent"
          : "border-border hover:border-accent hover:shadow-sm",
      ].join(" ")}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary">
        {choice.image && imgOk ? (
          <img
            src={choice.image}
            alt={choice.value}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-accent">
            <Icon className="size-10" strokeWidth={1.25} />
          </span>
        )}
        {active && (
          <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-accent text-accent-foreground shadow">
            <Check className="size-4" />
          </span>
        )}
      </div>
      <div
        className={["flex-1 p-4 transition-colors", active ? "bg-accent/10" : "bg-card"].join(" ")}
      >
        <span className="block text-sm font-semibold leading-snug">{choice.value}</span>
        {choice.hint && (
          <span className="mt-0.5 block text-xs text-muted-foreground">{choice.hint}</span>
        )}
      </div>
    </button>
  );
}

function ResultStep({
  estArea,
  estPrice,
  estPriceMax,
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
  estArea: number;
  estPrice: number;
  estPriceMax: number;
  answers: Record<string, string>;
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
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Ваш ориентир</p>
      <h3 className="mt-3 text-xl font-bold uppercase tracking-tight md:text-2xl">
        Проект под вас почти готов
      </h3>

      {/* Оценка-награда */}
      <div className="mt-6 rounded-sm border-l-2 border-accent bg-secondary p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Ориентировочная площадь
            </p>
            <p className="mt-1 text-3xl font-bold">
              ≈ {estArea} <span className="text-lg font-normal">м²</span>
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Стоимость под ключ
            </p>
            <p className="mt-1 text-3xl font-bold text-accent">от {formatRub(estPrice)} ₽</p>
            <p className="text-xs text-muted-foreground">
              ≈ {(estPrice / 1_000_000).toFixed(1)}–{(estPriceMax / 1_000_000).toFixed(1)} млн ₽ под
              предчистовую отделку
            </p>
          </div>
        </div>
      </div>

      {/* Сводка ответов */}
      <div className="mt-4 flex flex-wrap gap-2">
        {QUESTIONS.map((q) =>
          answers[q.id] ? (
            <span
              key={q.id}
              className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
            >
              {answers[q.id]}
            </span>
          ) : null,
        )}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Оставьте контакты — инженер подберёт готовый проект под ваш запрос, пришлёт планировки и
        точный расчёт. Свяжемся в течение часа, без навязчивых звонков.
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

      {/* Предпочтительный канал связи */}
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
          {pending ? "Отправка…" : "Получить проект и расчёт"}
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

function SuccessState({
  estArea,
  estPrice,
  channel,
}: {
  estArea: number;
  estPrice: number;
  channel: string;
}) {
  return (
    <div className="py-6 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Check className="size-7" />
      </span>
      <h3 className="mt-5 text-xl font-bold uppercase tracking-tight md:text-2xl">
        Заявка принята
      </h3>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        Мы подбираем проект под ваш запрос: ориентир ≈ {estArea} м², от {formatRub(estPrice)} ₽ под
        ключ. Инженер свяжется с вами в течение часа ({channel}) и пришлёт планировки с точным
        расчётом.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg" variant="outline" className="border-border hover:border-accent">
          <a href={site.whatsappHref} target="_blank" rel="noopener noreferrer">
            Написать в WhatsApp
          </a>
        </Button>
        <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
          <a href={site.phoneHref}>{site.phone}</a>
        </Button>
      </div>
    </div>
  );
}
