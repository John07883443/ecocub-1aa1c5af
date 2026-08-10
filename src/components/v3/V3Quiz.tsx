/**
 * Шаги вопросов новой версии: короткий базовый квиз и адаптивные
 * lifestyle-вопросы. Уже известные ответы (из главного квиза сайта или
 * сохранённого проекта) повторно не спрашиваются — они показаны сводкой
 * с возможностью исправить.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Answers, LifestyleQuestion, QuizQuestion } from "@/lib/v3/profile";
import { BASE_QUESTIONS } from "@/lib/v3/profile";
import { ChoiceButton, StepShell } from "./shared";

/* ------------------------------------------------------------------ */
/* Базовый квиз                                                         */
/* ------------------------------------------------------------------ */

export function V3BaseQuiz({
  initialAnswers,
  onDone,
  onFirstAnswer,
}: {
  initialAnswers: Answers;
  onDone: (answers: Answers) => void;
  onFirstAnswer?: () => void;
}) {
  const prefilledIds = useMemo(
    () => BASE_QUESTIONS.filter((q) => initialAnswers[q.id] !== undefined).map((q) => q.id),
    [initialAnswers],
  );
  const [editAll, setEditAll] = useState(false);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [index, setIndex] = useState(0);
  const [answeredOnce, setAnsweredOnce] = useState(false);

  const questions = useMemo(
    () => (editAll ? BASE_QUESTIONS : BASE_QUESTIONS.filter((q) => !prefilledIds.includes(q.id))),
    [editAll, prefilledIds],
  );

  if (!questions.length) {
    // Всё уже известно — подтверждаем сводку и идём дальше.
    return (
      <StepShell
        stage={0}
        eyebrow="Ваши ответы"
        title="Мы уже знаем базовые параметры"
        intro="Ответы перенесены из квиза на главной — повторно не спрашиваем."
      >
        <PrefilledSummary answers={answers} />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            size="lg"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => onDone(answers)}
          >
            Всё верно, продолжить <ArrowRight />
          </Button>
          <Button size="lg" variant="outline" onClick={() => setEditAll(true)}>
            <Pencil className="size-4" /> Исправить ответы
          </Button>
        </div>
      </StepShell>
    );
  }

  const q = questions[Math.min(index, questions.length - 1)];

  const pick = (value: string) => {
    if (!answeredOnce) {
      setAnsweredOnce(true);
      onFirstAnswer?.();
    }
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    window.setTimeout(() => {
      if (index + 1 >= questions.length) onDone(next);
      else setIndex(index + 1);
    }, 220);
  };

  return (
    <StepShell
      stage={0}
      eyebrow={`Вопрос ${index + 1} из ${questions.length} · ${q.eyebrow}`}
      title={q.title}
    >
      {prefilledIds.length > 0 && !editAll && index === 0 && (
        <div className="mb-5 rounded-sm border border-accent/30 bg-accent/5 p-4 text-xs text-muted-foreground">
          Часть ответов перенесена из квиза на главной и не спрашивается повторно.{" "}
          <button
            type="button"
            className="font-medium text-accent underline"
            onClick={() => setEditAll(true)}
          >
            Показать и исправить
          </button>
        </div>
      )}
      <QuestionChoices q={q} selected={answers[q.id]} onPick={pick} />
      {index > 0 && (
        <button
          type="button"
          onClick={() => setIndex(index - 1)}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
      )}
    </StepShell>
  );
}

function PrefilledSummary({ answers }: { answers: Answers }) {
  return (
    <div className="flex flex-wrap gap-2">
      {BASE_QUESTIONS.map((q) =>
        answers[q.id] ? (
          <span
            key={q.id}
            className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {String(answers[q.id])}
          </span>
        ) : null,
      )}
    </div>
  );
}

function QuestionChoices({
  q,
  selected,
  onPick,
}: {
  q: QuizQuestion;
  selected: string | string[] | undefined;
  onPick: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {q.choices.map((c) => (
        <ChoiceButton
          key={c.value}
          label={c.value}
          hint={c.hint}
          active={selected === c.value}
          onClick={() => onPick(c.value)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lifestyle-вопросы                                                    */
/* ------------------------------------------------------------------ */

export function V3Lifestyle({
  questions,
  initialAnswers,
  onDone,
}: {
  questions: LifestyleQuestion[];
  initialAnswers: Answers;
  onDone: (answers: Answers, freeText: string) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [index, setIndex] = useState(0);
  const [freeText, setFreeText] = useState("");

  const isFreeTextStep = index >= questions.length;

  const advance = (next: Answers) => {
    setAnswers(next);
    window.setTimeout(() => setIndex((i) => i + 1), 220);
  };

  if (isFreeTextStep) {
    return (
      <StepShell
        stage={1}
        eyebrow="Последний штрих"
        title="Расскажите своими словами, каким вы представляете дом"
        intro="Необязательно. Мы учтём пожелания при подборе — например баню, камин, гараж или панорамные окна."
      >
        <Textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Например: хотим утром пить кофе на террасе, нужен камин и место для двух машин…"
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => onDone(answers, freeText.trim())}
          >
            Подобрать дом <ArrowRight />
          </Button>
          <button
            type="button"
            onClick={() => setIndex(index - 1)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Назад
          </button>
        </div>
      </StepShell>
    );
  }

  const q = questions[index];

  return (
    <StepShell
      stage={1}
      eyebrow={`Вопрос ${index + 1} из ${questions.length} · ${q.eyebrow}`}
      title={q.title}
      intro="Отвечайте про жизнь, а не про квадратные метры — планировку подберём мы."
    >
      <QuestionChoices
        q={q}
        selected={answers[q.id]}
        onPick={(v) => advance({ ...answers, [q.id]: v })}
      />
      <div className="mt-6 flex items-center gap-4">
        {index > 0 && (
          <button
            type="button"
            onClick={() => setIndex(index - 1)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Назад
          </button>
        )}
        <button
          type="button"
          onClick={() => setIndex(index + 1)}
          className="text-sm font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Пропустить вопрос
        </button>
      </div>
    </StepShell>
  );
}
