/**
 * Оркестратор /constructor-ai-v3-1.
 *
 * До редактора путь тот же, что в v3 (он признан удачным): вход → короткий
 * квиз → вопросы об образе жизни → подбор до трёх реальных планов. Дальше —
 * ОДНО рабочее пространство «Дом и участок» вместо цепочки экранов, затем
 * фасад и получение проекта.
 *
 * Компоненты квиза и выдачи переиспользуются из v3 без изменений, поэтому
 * исходная версия остаётся рабочей и доступной для сравнения.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Blocks, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsV3, analyticsV31 } from "@/lib/analytics";
import { loadDreamProfile } from "@/lib/dreamProfile";
import type { Answers, LifestyleQuestion } from "@/lib/v3/profile";
import {
  normalizeProfile,
  pickLifestyleQuestions,
  seedAnswersFromDreamProfile,
} from "@/lib/v3/profile";
import { PLAN_LIBRARY, findPlan } from "@/lib/v3/plans";
import { recommend } from "@/lib/v3/recommend";
import type { Recommendation } from "@/lib/v3/types";
import { V3BaseQuiz, V3Lifestyle } from "@/components/v3/V3Quiz";
import { V3Results } from "@/components/v3/V3Results";
import { StepShell } from "@/components/v3/shared";
import { houseFromPlan, starterHouse } from "@/lib/v31/plans31";
import { project31Store } from "@/lib/v31/project31";
import type { V31Project } from "@/lib/v31/project31";
import { useWorkspace } from "@/lib/v31/useWorkspace";
import { Workspace31 } from "./Workspace31";
import { FacadeStep } from "./FacadeStep";
import { FinalStep } from "./FinalStep";

type Step =
  | "entry"
  | "quiz"
  | "lifestyle"
  | "matching"
  | "results"
  | "workspace"
  | "facade"
  | "final";

export function V31Constructor() {
  const [step, setStep] = useState<Step>("entry");
  const [savedProject, setSavedProject] = useState<V31Project | null>(null);
  const [seededAnswers, setSeededAnswers] = useState<Answers>({});
  const [lifestyleQuestions, setLifestyleQuestions] = useState<LifestyleQuestion[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  const api = useWorkspace();

  useEffect(() => {
    analyticsV31.opened();
    const saved = project31Store.load();
    if (saved && (saved.house.modules.length || Object.keys(saved.answers).length)) {
      setSavedProject(saved);
    }
    setSeededAnswers(seedAnswersFromDreamProfile(loadDreamProfile()));
  }, []);

  /* ---------------- переходы ---------------- */

  const startGuided = () => {
    analyticsV31.pathSelected("guided");
    setStep("quiz");
  };

  const startManual = () => {
    analyticsV31.pathSelected("manual");
    api.loadHouse(starterHouse(), null, "Стартовый дом — меняйте под себя");
    setStep("workspace");
  };

  const resumeSaved = () => {
    if (!savedProject) return;
    analyticsV31.pathSelected("resume");
    analyticsV31.projectRestored(savedProject.id);
    api.restoreProject(savedProject);
    setStep(savedProject.house.modules.length ? "workspace" : "quiz");
  };

  const quizDone = useCallback(
    (answers: Answers) => {
      analyticsV31.quizCompleted();
      setLifestyleQuestions(pickLifestyleQuestions(answers));
      api.patchProject({ answers: { ...api.project.answers, ...answers } });
      setStep("lifestyle");
    },
    [api],
  );

  const lifestyleDone = useCallback(
    (answers: Answers, freeText: string) => {
      const all = { ...api.project.answers, ...answers };
      const profile = normalizeProfile(all, freeText);
      api.patchProject({ answers: all, freeText: freeText || undefined, profile });
      analyticsV31.lifestyleCompleted(lifestyleQuestions.length);
      setStep("matching");
    },
    [api, lifestyleQuestions.length],
  );

  // Подбор: короткая честная пауза, затем результаты из реальной библиотеки.
  useEffect(() => {
    if (step !== "matching") return;
    const profile = api.project.profile;
    if (!profile) {
      setStep("quiz");
      return;
    }
    const { recommendations: recs } = recommend(PLAN_LIBRARY, profile);
    const t = window.setTimeout(() => {
      setRecommendations(recs);
      analyticsV31.recommendationsShown(recs.length, recs[0]?.plan.id);
      setStep("results");
    }, 2000);
    return () => window.clearTimeout(t);
  }, [step, api.project.profile]);

  const selectPlan = (rec: Recommendation) => {
    analyticsV31.planSelected(rec.plan.id, rec.kind);
    api.loadHouse(
      houseFromPlan(rec.plan),
      rec.plan.id,
      `План «${rec.plan.name}» открыт в конструкторе`,
    );
    setStep("workspace");
  };

  const basePlan = useMemo(
    () => (api.project.basePlanId ? findPlan(api.project.basePlanId) : undefined),
    [api.project.basePlanId],
  );

  switch (step) {
    case "entry":
      return (
        <Entry
          hasSaved={!!savedProject}
          onGuided={startGuided}
          onManual={startManual}
          onResume={resumeSaved}
        />
      );
    case "quiz":
      return (
        <V3BaseQuiz
          initialAnswers={{ ...seededAnswers, ...api.project.answers }}
          onFirstAnswer={() => analyticsV31.quizStarted()}
          onDone={quizDone}
        />
      );
    case "lifestyle":
      return (
        <V3Lifestyle
          questions={
            lifestyleQuestions.length
              ? lifestyleQuestions
              : pickLifestyleQuestions(api.project.answers)
          }
          initialAnswers={api.project.answers}
          onDone={lifestyleDone}
        />
      );
    case "matching":
      return <Matching />;
    case "results":
      return (
        <V3Results recommendations={recommendations} onSelect={selectPlan} onManual={startManual} />
      );
    case "workspace":
      return (
        <div className="space-y-3">
          <WorkspaceHeader planName={basePlan?.name ?? null} needsReview={basePlan?.needsReview} />
          <Workspace31 api={api} onReady={() => setStep("facade")} />
        </div>
      );
    case "facade":
      return (
        <FacadeStep api={api} onBack={() => setStep("workspace")} onNext={() => setStep("final")} />
      );
    case "final":
      return <FinalStep api={api} onBack={() => setStep("facade")} />;
  }
}

/* ------------------------------------------------------------------ */

function WorkspaceHeader({
  planName,
  needsReview,
}: {
  planName: string | null;
  needsReview?: boolean;
}) {
  return (
    <div className="rounded-sm border border-border bg-secondary px-4 py-3 text-sm">
      <p className="font-medium">
        {planName ? `Дом и участок · за основу взят план «${planName}»` : "Дом и участок"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Комнаты, объём и посадка — на одном экране. Мебель расставляется автоматически: это
        предварительная концепция для понимания масштаба
        {needsReview ? ", а раскладку модулей подтверждает инженер EcoCub" : ""}.
      </p>
    </div>
  );
}

function Entry({
  hasSaved,
  onGuided,
  onManual,
  onResume,
}: {
  hasSaved: boolean;
  onGuided: () => void;
  onManual: () => void;
  onResume: () => void;
}) {
  return (
    <StepShell
      stage={-1}
      eyebrow="Персональный AI-конструктор · версия 3.1"
      title="Расскажите, как вы хотите жить, — EcoCub соберёт подходящий дом"
      intro="Несколько вопросов о семье и образе жизни — и мы предложим до трёх домов из проверенных решений EcoCub. Дальше вы правите планировку, сразу видите объём и ставите дом на участок в одном окне."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={onGuided}
          className="group rounded-sm border-2 border-accent bg-accent/5 p-6 text-left transition-all hover:bg-accent/10"
        >
          <Sparkles className="size-7 text-accent" strokeWidth={1.5} />
          <p className="mt-3 text-lg font-bold uppercase tracking-tight">
            Подобрать дом под мою семью
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Короткий квиз, живые вопросы и до трёх подходящих планов с объяснением.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
            Начать подбор{" "}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={onManual}
          className="group rounded-sm border border-border p-6 text-left transition-all hover:border-accent hover:bg-accent/5"
        >
          <Blocks className="size-7 text-accent" strokeWidth={1.5} />
          <p className="mt-3 text-lg font-bold uppercase tracking-tight">Собрать самостоятельно</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Сразу в редактор: секции 3 × 3 м с магнитной стыковкой, участок и объём рядом.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground group-hover:text-foreground">
            Открыть редактор <ArrowRight className="size-4" />
          </span>
        </button>
      </div>

      {hasSaved && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-secondary p-4">
          <p className="text-sm">
            <RotateCcw className="mr-1.5 inline size-4 text-accent" />У вас есть незаконченный
            проект в этом браузере.
          </p>
          <Button variant="outline" size="sm" onClick={onResume}>
            Продолжить проект
          </Button>
        </div>
      )}
    </StepShell>
  );
}

const MATCHING_PHRASES = [
  "Учитываем состав семьи…",
  "Ищем подходящие планировки EcoCub…",
  "Проверяем размещение на участке…",
  "Сравниваем стоимость и сценарии жизни…",
];

function Matching() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      () => setPhase((p) => Math.min(p + 1, MATCHING_PHRASES.length - 1)),
      500,
    );
    return () => window.clearInterval(t);
  }, []);
  return (
    <StepShell stage={2} eyebrow="Подбор" title="Собираем варианты под вашу семью">
      <div className="flex flex-col items-center py-10">
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className="size-5 animate-pulse rounded-[2px] bg-accent/70"
              style={{ animationDelay: `${(i % 4) * 150}ms` }}
            />
          ))}
        </div>
        <p aria-live="polite" className="mt-6 text-sm text-muted-foreground">
          {MATCHING_PHRASES[phase]}
        </p>
      </div>
    </StepShell>
  );
}

/** Реэкспорт: страница знает только о конструкторе. */
export { analyticsV3 };
