/**
 * Финал v3.1: сводка проекта и заявка.
 *
 * Всё полезное человек уже увидел бесплатно — план, объём, площадь, цену и
 * посадку. Здесь он получает пакет проекта: заявка уходит в боевой пайплайн
 * POST /api/lead (база + Telegram) со снимком конфигурации, участка, фасада
 * и версии прайса.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepShell } from "@/components/v3/shared";
import { analyticsV31 } from "@/lib/analytics";
import { attributionSummary, buildAttribution } from "@/lib/attribution";
import { ROOM_TYPES } from "@/lib/v31/constants";
import { roomCounts } from "@/lib/v31/rooms";
import { findFacadeStyle } from "@/lib/v31/facade";
import { findPlan } from "@/lib/v3/plans";
import type { WorkspaceApi } from "@/lib/v31/useWorkspace";
import { site as siteInfo } from "@/lib/site";

const phoneRe = /^[+0-9\s\-()]+$/;
const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

export function FinalStep({ api, onBack }: { api: WorkspaceApi; onBack: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; consent?: string }>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const { project, areas, price, site } = api;
  const plan = project.basePlanId ? findPlan(project.basePlanId) : undefined;
  const style = findFacadeStyle(project.facadeStyleId);

  const summary = useMemo(() => {
    const rooms = roomCounts(api.house)
      .map((r) => `${ROOM_TYPES[r.type].label}: ${r.count}`)
      .join(", ");
    const lines = [
      `Проект конструктора V3.1 · код ${project.id}`,
      plan ? `База: план «${plan.name}»` : "База: сборка с нуля",
      `Площадь дома: ${areas.totalAreaM2} м² (жилая ${areas.livingAreaM2} м²)${
        areas.terraceAreaM2 ? `, террасы ${areas.terraceAreaM2} м²` : ""
      }`,
      `Модулей: ${areas.moduleCount}, этажей: ${areas.floors}, высота потолков ${project.ceilingHeightM
        .toFixed(2)
        .replace(".", ",")} м`,
      `Помещения: ${rooms || "—"}`,
      `Участок: ${site.widthM}×${site.depthM} м, въезд ${site.accessSide}, дом ${site.houseX}/${site.houseZ} м, поворот ${site.houseRotation}°`,
      style ? `Фасад: ${style.name}` : "Фасад: не выбран",
      `Ориентир стоимости: от ${fmt(price.price)} ₽ (${price.priceVersion})`,
    ];
    if (project.appliedActions.length) {
      lines.push(`Изменения: ${project.appliedActions.slice(-8).join("; ")}`);
    }
    if (project.freeText) lines.push(`Пожелания: ${project.freeText.slice(0, 300)}`);
    return lines.join("\n");
  }, [api.house, project, plan, style, areas, price, site]);

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
          sourcePage: "/constructor-ai-v3-1",
          projectSlug: plan?.slug,
          payload: {
            ...attribution,
            v31Project: {
              id: project.id,
              basePlanId: project.basePlanId,
              answers: project.answers,
              profile: project.profile,
              house: project.house,
              site: project.site,
              facadeStyleId: project.facadeStyleId,
              ceilingHeightM: project.ceilingHeightM,
              appliedActions: project.appliedActions,
              areas,
              priceVersion: price.priceVersion,
              estimate: { price: price.price, max: price.max },
            },
          },
          attributionSummary: attributionSummary(attribution),
        }),
      });
      if (!res.ok) throw new Error("Сервер не принял заявку");
      api.patchProject({ leadSubmitted: true });
      analyticsV31.leadSubmitted(project.id, project.basePlanId ?? undefined);
      setDone(true);
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
            Мы получили вашу конфигурацию (код проекта <b>{project.id}</b>): планировку, посадку на
            участок и выбранный фасад. Инженер проверит решение, подготовит расчёт и свяжется с вами
            в течение рабочего дня.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-[#2AABEE] text-white hover:bg-[#229ED9]">
              <a
                href={siteInfo.telegramHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => analyticsV31.telegramClicked(project.id)}
              >
                <Send className="size-4" /> Написать в Telegram
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={siteInfo.phoneHref}>
                <Phone className="size-4" /> {siteInfo.phone}
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
      intro="Планировки с площадями, состав помещений, посадка на участок, выбранный фасад и ориентировочная комплектация — с консультацией инженера."
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
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{price.disclaimer}</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Вернуться к фасаду
          </button>
        </div>

        <div className="space-y-4">
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
    </StepShell>
  );
}
