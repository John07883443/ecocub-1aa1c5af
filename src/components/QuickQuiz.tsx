import { useRef, useState } from "react";
import { ArrowLeft, Check, MessageCircle, PhoneCall, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { openMessenger, type Messenger } from "@/lib/messengers";
import { START_PRICE_PER_M2_RUB } from "@/lib/site";
import { priceLabel } from "@/lib/seo";

/**
 * Короткий квиз на главной: три вопроса без полей ввода — площадь, сроки,
 * участок. В конце — ориентир цены под ключ и выход в мессенджер с готовым
 * текстом либо к форме заявки внизу страницы (текст переносится в неё).
 *
 * Зачем рядом с большим квизом (#quiz, 6 шагов + контакты): в сентябре было
 * 0 заявок. Здесь путь до диалога — три тапа, а не девять.
 *
 * Ориентир считается по START_PRICE_PER_M2_RUB (под ключ: отделка, доставка,
 * фундамент) — той же цифре, что в сниппете поиска. Конструктор и
 * калькулятор считают по другой ставке (site.basePricePerM2, под предчистовую
 * отделку); их формулы сознательно не тронуты.
 */

type Q = { id: string; title: string; choices: { value: string; area?: number }[] };

const QUESTIONS: Q[] = [
  {
    id: "area",
    title: "Какая площадь нужна?",
    choices: [
      { value: "до 60 м²", area: 50 },
      { value: "60–100 м²", area: 80 },
      { value: "100–150 м²", area: 125 },
      { value: "больше 150 м²", area: 170 },
    ],
  },
  {
    id: "timing",
    title: "Когда хотите заехать?",
    choices: [
      { value: "В этом сезоне" },
      { value: "Через 3–6 месяцев" },
      { value: "Через год" },
      { value: "Пока изучаю" },
    ],
  },
  {
    id: "plot",
    title: "Участок уже есть?",
    choices: [{ value: "Да, есть" }, { value: "Выбираю" }, { value: "Пока нет" }],
  },
];

const fmtMln = (n: number) => (n / 1_000_000).toFixed(1).replace(".", ",");

export function QuickQuiz({ onForm }: { onForm?: (summary: string) => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const started = useRef(false);
  const completed = useRef(false);

  const done = step >= QUESTIONS.length;
  const area = QUESTIONS[0].choices.find((c) => c.value === answers.area)?.area ?? 80;
  const price = area * START_PRICE_PER_M2_RUB;

  const pick = (q: Q, value: string) => {
    if (!started.current) {
      started.current = true;
      analytics.quickQuizStart();
    }
    analytics.quickQuizStep(q.id, value);
    setAnswers((a) => ({ ...a, [q.id]: value }));
    const next = step + 1;
    setStep(next);
    if (next >= QUESTIONS.length && !completed.current) {
      completed.current = true;
      analytics.quickQuizComplete();
    }
  };

  const summary = () =>
    [
      "Здравствуйте! Прошёл быстрый подбор на eco-cub.ru:",
      ...QUESTIONS.map((q) => `• ${q.title.replace(/\?$/, "")}: ${answers[q.id] ?? "—"}`),
      `• Ориентир: ≈ ${fmtMln(price)} млн ₽ под ключ (${priceLabel.replace(/\u00a0/g, " ")})`,
      "Хочу точный расчёт.",
    ].join("\n");

  const toMessenger = (channel: Messenger) => {
    analytics.quickQuizLead(channel);
    void openMessenger(channel, summary()).then((copied) => {
      if (copied) {
        toast.success("Ответы скопированы", {
          description: "Если текст не подставился в чат — просто вставьте его.",
        });
      }
    });
  };

  const toForm = () => {
    analytics.quickQuizLead("form");
    onForm?.(summary());
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm md:p-7">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span>{done ? "Ваш ориентир" : `Вопрос ${step + 1} из ${QUESTIONS.length}`}</span>
        <span className="flex gap-1">
          {QUESTIONS.map((q, i) => (
            <span
              key={q.id}
              className={[
                "h-1 w-6 rounded-full transition-colors",
                i < step ? "bg-accent" : "bg-border",
              ].join(" ")}
            />
          ))}
        </span>
      </div>

      {!done ? (
        <div className="mt-4">
          <h3 className="text-lg font-bold uppercase tracking-tight md:text-xl">
            {QUESTIONS[step].title}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {QUESTIONS[step].choices.map((c) => {
              const active = answers[QUESTIONS[step].id] === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => pick(QUESTIONS[step], c.value)}
                  aria-pressed={active}
                  className={[
                    "flex min-h-12 items-center justify-between gap-2 rounded-sm border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    active
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-accent hover:bg-accent/5",
                  ].join(" ")}
                >
                  {c.value}
                  {active && <Check className="size-4 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Назад
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">
            {answers.area} · {answers.timing} · участок: {answers.plot?.toLowerCase()}
          </p>
          <p className="mt-2 text-3xl font-bold text-accent">≈ {fmtMln(price)} млн ₽</p>
          <p className="text-xs text-muted-foreground">
            под ключ, с отделкой, доставкой и фундаментом · {priceLabel}. Точная смета — по участку.
          </p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            <Button
              size="lg"
              className="gap-2 bg-[#229ED9] text-white hover:bg-[#229ED9]/90"
              onClick={() => toMessenger("telegram")}
            >
              <Send className="size-4" /> Расчёт в Telegram
            </Button>
            <Button
              size="lg"
              className="gap-2 bg-[#25D366] text-white hover:bg-[#25D366]/90"
              onClick={() => toMessenger("whatsapp")}
            >
              <MessageCircle className="size-4" /> Расчёт в WhatsApp
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={toForm}
              className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:text-accent hover:underline"
            >
              <PhoneCall className="size-4" /> Лучше перезвоните мне
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(0);
                setAnswers({});
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Пройти заново
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
