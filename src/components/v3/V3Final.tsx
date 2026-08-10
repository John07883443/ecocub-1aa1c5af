/**
 * Финал: бесплатный результат уже показан (варианты, планировка, 3D, цена,
 * посадка) — здесь пакет проекта и целевое действие. Приоритет — Telegram
 * с кодом проекта; альтернативы — телефон и WhatsApp. Заявка уходит в
 * боевой пайплайн POST /api/lead (SQLite + Telegram-уведомление) с полным
 * снимком проекта в payload.
 */

import { useMemo, useState } from "react";
import { Check, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildAttribution, attributionSummary } from "@/lib/attribution";
import { ROLE_ORDER, ROLES } from "@/lib/constructor/constants";
import { estimateModules } from "@/lib/v3/pricing";
import type { V3Project } from "@/lib/v3/types";
import { findPlan } from "@/lib/v3/plans";
import { site } from "@/lib/site";
import { fmtRub, StepShell } from "./shared";

const phoneRe = /^[+0-9\s\-()]+$/;

export function V3Final({
  project,
  onLeadSubmitted,
  onTelegramClick,
}: {
  project: V3Project;
  onLeadSubmitted: () => void;
  onTelegramClick: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; consent?: string }>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const plan = project.basePlanId ? findPlan(project.basePlanId) : undefined;
  const estimate = useMemo(() => estimateModules(project.modules), [project.modules]);

  const summary = useMemo(() => {
    const roleCounts = ROLE_ORDER.map((r) => {
      const count = project.modules.filter((m) => m.role === r).length;
      return count ? `${ROLES[r].label}: ${count}` : null;
    })
      .filter(Boolean)
      .join(", ");
    const floors = project.modules.length
      ? Math.max(...project.modules.map((m) => m.floor)) + 1
      : 0;
    const lines = [
      `Проект AI-конструктора V3 · код ${project.id}`,
      plan
        ? `База: план «${plan.name}»${plan.needsReview ? " (схема условная)" : ""}`
        : "База: сборка с нуля",
      `Модулей: ${project.modules.length}, этажей: ${floors}`,
      `Состав: ${roleCounts || "—"}`,
      project.plot
        ? `Участок: ${project.plot.widthM}×${project.plot.depthM} м, въезд: ${project.plot.entranceSide}`
        : "Участок: не задан",
      `Ориентир стоимости: от ${fmtRub(estimate.price)} ₽ (${estimate.priceVersion})`,
    ];
    if (project.appliedActions.length) {
      lines.push(`Изменения: ${project.appliedActions.slice(-8).join("; ")}`);
    }
    if (project.renderJobs.length) {
      lines.push(`Задание на AI-рендер: подготовлено (${project.renderJobs.length})`);
    }
    if (project.freeText) lines.push(`Пожелания: ${project.freeText.slice(0, 300)}`);
    return lines.join("\n");
  }, [project, plan, estimate]);

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
      const attribution = await buildAttribution();
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formType: "project",
          name: name.trim(),
          phone: phone.trim(),
          message: summary,
          sourcePage: "/constructor-ai-v3",
          projectSlug: plan?.slug,
          payload: {
            ...attribution,
            v3Project: {
              id: project.id,
              basePlanId: project.basePlanId,
              answers: project.answers,
              profile: project.profile,
              modules: project.modules,
              plot: project.plot,
              designId: project.designId,
              appliedActions: project.appliedActions,
              renderJobs: project.renderJobs.map((j) => ({
                jobId: j.jobId,
                state: j.state,
                facade: j.manualTask?.facade,
                prompt: j.manualTask?.prompt,
                invariants: j.manualTask?.invariants,
              })),
              priceVersion: project.priceVersion,
              estimate: { price: estimate.price, max: estimate.max },
            },
          },
          attributionSummary: attributionSummary(attribution),
        }),
      });
      if (!res.ok) throw new Error("Сервер не принял заявку");
      setDone(true);
      onLeadSubmitted();
    } catch (e) {
      toast.error("Не удалось отправить", {
        description: e instanceof Error ? e.message : "Попробуйте ещё раз",
      });
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <StepShell stage={7} eyebrow="Готово" title="Проект у инженера EcoCub">
        <div className="max-w-xl">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Check className="size-7" />
          </span>
          <p className="mt-5 text-sm text-muted-foreground">
            Мы получили вашу конфигурацию (код проекта <b>{project.id}</b>). Инженер проверит
            планировку и посадку, подготовит точный расчёт{" "}
            {project.renderJobs.length > 0 && "и AI-рендер фасада "}и свяжется с вами в течение
            рабочего дня.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <TelegramButton projectId={project.id} onClick={onTelegramClick} />
            <Button asChild size="lg" variant="outline">
              <a href={site.whatsappHref} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={site.phoneHref}>
                <Phone className="size-4" /> {site.phone}
              </a>
            </Button>
          </div>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      stage={7}
      eyebrow="Пакет проекта"
      title="Получите проект и точный расчёт"
      intro="Всё, что вы собрали, уже видно бесплатно. Пакет проекта — планировки с площадями, состав, посадка, ориентировочная комплектация, HD-рендер фасада и консультация по точному расчёту."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="rounded-sm bg-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Сводка вашего проекта
            </p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
              {summary}
            </pre>
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {estimate.disclaimer}
          </p>

          <div className="mt-5 rounded-sm border border-accent/30 bg-accent/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Send className="size-4 text-accent" /> Быстрее всего — в Telegram
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Напишите нам в Telegram и пришлите код проекта <b>{project.id}</b> — менеджер привяжет
              конфигурацию и пришлёт пакет прямо в чат.
            </p>
            <TelegramButton
              projectId={project.id}
              onClick={onTelegramClick}
              className="mt-3 w-full"
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Или оставьте контакты — пришлём сами</p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Имя</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (___) ___-__-__"
                aria-invalid={!!errors.phone}
              />
              {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone}</p>}
            </div>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-4 rounded border-input"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">
                Согласен на обработку персональных данных
              </span>
            </label>
            {errors.consent && <p className="text-xs text-destructive">{errors.consent}</p>}
            <Button
              size="lg"
              disabled={pending}
              onClick={submit}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {pending ? "Отправка…" : "Отправить проект менеджеру"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Телефона достаточно — email и подписки не требуем.
            </p>
          </div>
        </div>
      </div>
    </StepShell>
  );
}

function TelegramButton({
  projectId,
  onClick,
  className,
}: {
  projectId: string;
  onClick: () => void;
  className?: string;
}) {
  // Deep link без всего проекта в URL: только короткий код, по которому
  // менеджер находит заявку. Серверных короткоживущих токенов на сайте пока
  // нет — это честное ограничение текущей инфраструктуры.
  return (
    <Button
      asChild
      size="lg"
      className={["bg-[#2AABEE] text-white hover:bg-[#229ED9]", className ?? ""].join(" ")}
    >
      <a href={site.telegramHref} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        <Send className="size-4" /> Получить проект в Telegram
      </a>
    </Button>
  );
}
