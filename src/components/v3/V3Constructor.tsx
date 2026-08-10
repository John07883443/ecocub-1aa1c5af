/**
 * Оркестратор /constructor-ai-v3: последовательное раскрытие
 * вход → квиз → образ жизни → подбор → варианты → редактор → участок →
 * фасад → проект. Держит проект (V3Project), автосохраняет его в
 * localStorage после каждого шага и восстанавливает по возвращении.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Blocks, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsV3 } from "@/lib/analytics";
import { loadDreamProfile } from "@/lib/dreamProfile";
import { site } from "@/lib/site";
import type { ModuleItem } from "@/lib/constructor/types";
import type { Answers, LifestyleQuestion } from "@/lib/v3/profile";
import {
  normalizeProfile,
  pickLifestyleQuestions,
  seedAnswersFromDreamProfile,
} from "@/lib/v3/profile";
import { PLAN_LIBRARY, findPlan } from "@/lib/v3/plans";
import { recommend } from "@/lib/v3/recommend";
import { createProject, projectStore } from "@/lib/v3/project";
import { useV3Builder } from "@/lib/v3/useV3Builder";
import type { Recommendation, RenderJob, V3Project } from "@/lib/v3/types";
import type { RenderMood } from "@/lib/v3/render";
import { V3BaseQuiz, V3Lifestyle } from "./V3Quiz";
import { V3Results } from "./V3Results";
import { V3Editor } from "./V3Editor";
import { V3Plot } from "./V3Plot";
import { V3Facade } from "./V3Facade";
import { V3Final } from "./V3Final";
import { StepShell } from "./shared";

type Step =
  | "entry"
  | "quiz"
  | "lifestyle"
  | "matching"
  | "results"
  | "editor"
  | "plot"
  | "facade"
  | "final";

export function V3Constructor() {
  const [step, setStep] = useState<Step>("entry");
  const [project, setProject] = useState<V3Project>(() => createProject());
  const [savedProject, setSavedProject] = useState<V3Project | null>(null);
  const [lifestyleQuestions, setLifestyleQuestions] = useState<LifestyleQuestion[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [seededAnswers, setSeededAnswers] = useState<Answers>({});

  const projectRef = useRef(project);
  projectRef.current = project;

  /** Обновить проект и сразу сохранить. */
  const patchProject = useCallback((patch: Partial<V3Project>) => {
    setProject((prev) => {
      const next = { ...prev, ...patch };
      projectStore.save(next);
      return next;
    });
  }, []);

  // Автосохранение конфигурации из редактора.
  const onBuilderChange = useCallback(
    (modules: ModuleItem[], designId: string, actionLabel?: string) => {
      const applied =
        actionLabel &&
        !["undo", "redo", "design"].includes(actionLabel) &&
        !actionLabel.startsWith("load:")
          ? [...projectRef.current.appliedActions, actionLabel]
          : projectRef.current.appliedActions;
      patchProject({ modules, designId, appliedActions: applied });
    },
    [patchProject],
  );

  const builder = useV3Builder(site.basePricePerM2, onBuilderChange);

  // Восстановление и префилл — один раз на клиенте.
  useEffect(() => {
    analyticsV3.opened();
    const saved = projectStore.load();
    if (saved && (saved.modules.length || Object.keys(saved.answers).length)) {
      setSavedProject(saved);
    }
    setSeededAnswers(seedAnswersFromDreamProfile(loadDreamProfile()));
  }, []);

  /* ---------------- переходы ---------------- */

  const startGuided = () => {
    analyticsV3.pathSelected("guided");
    setStep("quiz");
  };

  const startManual = () => {
    analyticsV3.pathSelected("manual");
    patchProject({ basePlanId: null });
    builder.loadPlan("template-cube");
    setStep("editor");
  };

  const resumeSaved = () => {
    if (!savedProject) return;
    analyticsV3.pathSelected("resume");
    analyticsV3.projectRestored(savedProject.id);
    setProject(savedProject);
    builder.restore(savedProject.modules, savedProject.designId);
    if (savedProject.leadSubmitted || savedProject.renderJobs.length) setStep("facade");
    else if (savedProject.plot) setStep("plot");
    else if (savedProject.modules.length) setStep("editor");
    else setStep("quiz");
  };

  const quizDone = (answers: Answers) => {
    analyticsV3.quizCompleted();
    const questions = pickLifestyleQuestions(answers);
    setLifestyleQuestions(questions);
    patchProject({ answers: { ...project.answers, ...answers } });
    analyticsV3.lifestyleStarted();
    setStep("lifestyle");
  };

  const lifestyleDone = (answers: Answers, freeText: string) => {
    const all = { ...project.answers, ...answers };
    analyticsV3.lifestyleCompleted(lifestyleQuestions.length);
    const profile = normalizeProfile(all, freeText);
    patchProject({ answers: all, freeText: freeText || undefined, profile });
    setStep("matching");
  };

  // Этап «подбор»: короткая честная анимация, затем результаты.
  useEffect(() => {
    if (step !== "matching") return;
    const profile = projectRef.current.profile;
    if (!profile) {
      setStep("quiz");
      return;
    }
    const { recommendations: recs } = recommend(PLAN_LIBRARY, profile);
    const t = window.setTimeout(() => {
      setRecommendations(recs);
      analyticsV3.recommendationsShown(recs.length, recs[0]?.plan.id);
      setStep("results");
    }, 2200);
    return () => window.clearTimeout(t);
  }, [step]);

  const selectPlan = (rec: Recommendation) => {
    analyticsV3.planSelected(rec.plan.id, rec.kind);
    patchProject({ basePlanId: rec.plan.id });
    builder.loadPlan(rec.plan.id);
    setStep("editor");
  };

  const editorNext = () => {
    analyticsV3.plotStarted();
    setStep("plot");
  };

  const plotDone = (plot: V3Project["plot"], fits: boolean) => {
    analyticsV3.plotCompleted(fits);
    patchProject({ plot });
    setStep("facade");
  };

  const facadeDone = (job: RenderJob | null, _mood: RenderMood) => {
    analyticsV3.facadeSelected(builder.designId);
    if (job) patchProject({ renderJobs: [...project.renderJobs, job] });
    setStep("final");
  };

  /* ---------------- рендер шагов ---------------- */

  const basePlan = useMemo(
    () => (project.basePlanId ? (findPlan(project.basePlanId) ?? null) : null),
    [project.basePlanId],
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
          initialAnswers={{ ...seededAnswers, ...project.answers }}
          onFirstAnswer={() => analyticsV3.quizStarted()}
          onDone={quizDone}
        />
      );
    case "lifestyle":
      return (
        <V3Lifestyle
          questions={
            lifestyleQuestions.length ? lifestyleQuestions : pickLifestyleQuestions(project.answers)
          }
          initialAnswers={project.answers}
          onDone={lifestyleDone}
        />
      );
    case "matching":
      return <Matching />;
    case "results":
      return (
        <V3Results recommendations={recommendations} onSelect={selectPlan} onManual={startManual} />
      );
    case "editor":
      return (
        <V3Editor
          api={builder}
          planName={basePlan?.name ?? null}
          needsReview={basePlan?.needsReview ?? false}
          onNext={editorNext}
          onAction={(key, ok) => {
            analyticsV3.planModified(key, project.basePlanId ?? undefined);
            if (!ok) analyticsV3.error("editor", key);
          }}
        />
      );
    case "plot":
      return <V3Plot modules={builder.modules} initial={project.plot} onDone={plotDone} />;
    case "facade":
      return (
        <V3Facade
          projectId={project.id}
          modules={builder.modules}
          designId={builder.designId}
          onDesign={builder.setDesignId}
          onRenderRequested={(provider) => analyticsV3.renderRequested(project.id, provider)}
          onDone={facadeDone}
        />
      );
    case "final":
      return (
        <V3Final
          project={{ ...project, modules: builder.modules, designId: builder.designId }}
          onLeadSubmitted={() => {
            analyticsV3.leadSubmitted(project.id, project.basePlanId ?? undefined);
            patchProject({ leadSubmitted: true });
          }}
          onTelegramClick={() => analyticsV3.telegramClicked(project.id)}
        />
      );
  }
}

/* ------------------------------------------------------------------ */
/* Входной экран                                                        */
/* ------------------------------------------------------------------ */

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
      eyebrow="Персональный AI-конструктор · эксперимент"
      title="Расскажите, как вы хотите жить, — EcoCub соберёт подходящий дом"
      intro="Несколько вопросов о семье и образе жизни — и мы предложим до трёх домов из проверенных модульных решений EcoCub. Выбранный дом можно изменить, посадить на участок и получить проект с расчётом."
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
            Основной путь: короткий квиз, живые вопросы, до трёх подходящих планов с объяснением.
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
            Сразу в конструктор: модули 3×3 м, крупные действия, участок и фасад — без вопросов.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground group-hover:text-foreground">
            Открыть конструктор <ArrowRight className="size-4" />
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

/* ------------------------------------------------------------------ */
/* Анимация подбора                                                     */
/* ------------------------------------------------------------------ */

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
      550,
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
              className="size-5 animate-pulse rounded-[3px] bg-accent/70"
              style={{ animationDelay: `${(i % 4) * 150}ms` }}
            />
          ))}
        </div>
        <p aria-live="polite" className="mt-6 text-sm text-muted-foreground">
          {MATCHING_PHRASES[phase]}
        </p>
        <p className="mt-2 text-xs text-muted-foreground/60">
          Подбор идёт по библиотеке реальных решений EcoCub — прямо в вашем браузере.
        </p>
      </div>
    </StepShell>
  );
}
