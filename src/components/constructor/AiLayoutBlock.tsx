import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { analyticsAiLayout } from "@/lib/analytics";
import { buildFootprint } from "@/lib/ai-layout/footprint";
import { EXTRA_ROOM_LABELS, EXTRA_ROOMS, type ExtraRoom } from "@/lib/ai-layout/prompt";
import { ENTRANCE_LABELS, type EntranceSide } from "@/lib/ai-layout/footprint";
import type { ModuleItem } from "@/lib/constructor/types";
import { FootprintOverlay } from "./FootprintOverlay";

/**
 * Блок «Планировка вашего дома» под конструктором.
 *
 * Показывается только если сервер отвечает, что функция включена: пока флаг
 * выключен, посетитель этого блока не видит вовсе — не кнопку в неактивном
 * состоянии, а именно ничего. Обещать то, чего нет, хуже, чем промолчать.
 *
 * К платному API отсюда не ходит ничего: браузер отправляет геометрию и число
 * комнат на свой же сервер, там собирается промпт и живут ключи.
 */

type JobStatus = "pending" | "completed" | "failed" | "queued_manual";

interface PublicConfig {
  available: boolean;
  isMock: boolean;
  isManual: boolean;
  freePerVisitor: number;
}

interface JobResponse {
  ok: boolean;
  key?: string;
  status?: JobStatus;
  imageUrl?: string | null;
  isMock?: boolean;
  reason?: string | null;
}

const ENTRANCES: EntranceSide[] = ["north", "east", "south", "west"];

/** Тексты отказов. Коды приходят с сервера из закрытого списка. */
const REASONS: Record<string, string> = {
  limit_visitor: "Бесплатная генерация уже использована.",
  limit_daily: "На сегодня лимит генераций исчерпан. Попробуйте завтра.",
  timeout: "Сервис не ответил вовремя. Попробуйте ещё раз.",
  network: "Не удалось связаться с сервисом генерации.",
  rejected: "Сервис отклонил запрос.",
  empty_result: "Сервис вернул пустой ответ.",
  provider_failed: "Генерация не удалась на стороне сервиса.",
  too_many_modules: "Слишком много модулей для одной планировки.",
  no_modules: "Сначала соберите дом из модулей.",
};

const reasonText = (code?: string | null) =>
  (code && REASONS[code]) || "Не получилось. Попробуйте ещё раз.";

export interface AiLayoutBlockProps {
  modules: ModuleItem[];
  /** Открыть форму заявки: сюда уходит посетитель, исчерпавший лимит. */
  onRequestQuote?: (summary: string) => void;
}

export function AiLayoutBlock({ modules, onRequestQuote }: AiLayoutBlockProps) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(1);
  const [extras, setExtras] = useState<ExtraRoom[]>([]);
  const [entrance, setEntrance] = useState<EntranceSide | null>(null);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);

  const startedAt = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownOnce = useRef(false);

  const footprint = useMemo(() => buildFootprint(modules), [modules]);

  // Доступность спрашиваем один раз: ответ зависит только от настроек сервера.
  useEffect(() => {
    let alive = true;
    fetch("/api/ai-layout")
      .then((r) => r.json())
      .then((data: { config?: PublicConfig }) => {
        if (alive && data.config) setConfig(data.config);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (config?.available && !shownOnce.current) {
      shownOnce.current = true;
      analyticsAiLayout.shown();
    }
  }, [config]);

  // Опрос прекращаем при размонтировании: иначе таймер переживёт уход
  // со страницы и продолжит дёргать сервер.
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const finish = useCallback((data: JobResponse) => {
    setImageUrl(data.imageUrl ?? null);
    setIsMock(!!data.isMock);
    setStatus("done");
    analyticsAiLayout.succeeded(Math.round((Date.now() - startedAt.current) / 1000));
  }, []);

  const fail = useCallback((code?: string | null) => {
    setError(reasonText(code));
    setStatus("error");
    analyticsAiLayout.failed(code || "unknown");
  }, []);

  const poll = useCallback(
    (key: string, attempt: number) => {
      // Ждём заведомо дольше самой генерации (по замерам — около двух минут),
      // но не бесконечно: зависшее задание должно закончиться внятной ошибкой.
      if (attempt > 60) return fail("timeout");
      pollTimer.current = setTimeout(() => {
        fetch(`/api/ai-layout?key=${encodeURIComponent(key)}`)
          .then((r) => r.json())
          .then((data: JobResponse) => {
            if (data.status === "completed") return finish(data);
            if (data.status === "failed") return fail(data.reason);
            if (data.status === "queued_manual") {
              setStatus("done");
              setImageUrl(null);
              return;
            }
            poll(key, attempt + 1);
          })
          .catch(() => poll(key, attempt + 1));
      }, 3000);
    },
    [fail, finish],
  );

  const generate = useCallback(async () => {
    if (!footprint.modules.length) return;
    setStatus("working");
    setError(null);
    setImageUrl(null);
    startedAt.current = Date.now();
    analyticsAiLayout.requested(footprint.modules.length, bedrooms, bathrooms);

    try {
      const res = await fetch("/api/ai-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modules: modules.map((m) => ({ id: m.id, x: m.x, z: m.z, floor: m.floor })),
          bedrooms,
          bathrooms,
          extraRooms: extras,
          entrance,
        }),
      });
      const data = (await res.json()) as JobResponse;

      if (!data.ok) {
        if (data.reason === "limit_visitor" || data.reason === "limit_daily") {
          setLimited(true);
          analyticsAiLayout.limitReached(data.reason === "limit_daily" ? "daily" : "visitor");
        }
        return fail(data.reason);
      }
      if (data.status === "completed") return finish(data);
      if (data.status === "failed") return fail(data.reason);
      if (data.status === "queued_manual") {
        setStatus("done");
        return;
      }
      if (data.key) poll(data.key, 0);
    } catch {
      fail("network");
    }
  }, [bathrooms, bedrooms, entrance, extras, fail, finish, footprint, modules, poll]);

  if (!config?.available) return null;

  const busy = status === "working";
  const empty = footprint.modules.length === 0;

  return (
    <section className="mt-6 rounded-sm border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Планировка вашего дома
        </h3>
        <span className="text-xs text-muted-foreground">
          {config.freePerVisitor === 1
            ? "одна генерация бесплатно"
            : `бесплатных генераций: ${config.freePerVisitor}`}
        </span>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Соберём эскизную идею планировки по контуру вашего дома. Это не проект и не рабочая
        документация: расстановку комнат уточняет инженер после обращения.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Counter label="Спален" value={bedrooms} min={1} max={6} onChange={setBedrooms} />
        <Counter label="Санузлов" value={bathrooms} min={1} max={4} onChange={setBathrooms} />
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">
          Дополнительно (до трёх)
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXTRA_ROOMS.map((room) => {
            const active = extras.includes(room);
            return (
              <Chip
                key={room}
                active={active}
                disabled={!active && extras.length >= 3}
                onClick={() =>
                  setExtras((prev) =>
                    prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room],
                  )
                }
              >
                {EXTRA_ROOM_LABELS[room]}
              </Chip>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">
          Вход с какой стороны
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip active={entrance === null} onClick={() => setEntrance(null)}>
            не важно
          </Chip>
          {ENTRANCES.map((side) => (
            <Chip key={side} active={entrance === side} onClick={() => setEntrance(side)}>
              {ENTRANCE_LABELS[side].replace(/ой$/, "ая")}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={busy || empty || limited} className="gap-2">
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {busy ? "Рисуем планировку…" : "Создать AI-планировку"}
        </Button>
        {empty && <span className="text-xs text-muted-foreground">Сначала соберите дом.</span>}
        {busy && (
          <span className="text-xs text-muted-foreground">
            Обычно занимает около двух минут — страницу можно не закрывать.
          </span>
        )}
      </div>

      {status === "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-sm border border-border bg-background p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-foreground">{error}</p>
            {limited && (
              <button
                type="button"
                className="mt-2 text-sm font-medium text-foreground underline underline-offset-4"
                onClick={() => {
                  analyticsAiLayout.leadClicked();
                  onRequestQuote?.(
                    `Хочу планировку дома: ${footprint.modules.length} модулей, ` +
                      `${footprint.areaM2} м², ${bedrooms} спальни, ${bathrooms} санузла.`,
                  );
                }}
              >
                Оставить заявку — пришлём планировку и расчёт
              </button>
            )}
          </div>
        </div>
      )}

      {status === "done" && !imageUrl && (
        <p className="mt-4 rounded-sm border border-border bg-background p-3 text-sm text-foreground">
          Запрос принят. Планировку подготовит наш инженер и пришлёт вместе с расчётом.
        </p>
      )}

      {status === "done" && imageUrl && (
        <figure className="mt-4">
          <div className="relative mx-auto w-full max-w-[560px] overflow-hidden rounded-sm border border-border">
            <img
              src={imageUrl}
              alt="Эскизная планировка дома"
              className="block w-full"
              width={1024}
              height={1024}
            />
            {/* Поверх результата — точный контур из конструктора. Он источник
                истины: если модель где-то вышла за границы, видно будет сразу. */}
            <FootprintOverlay footprint={footprint} />
          </div>
          <figcaption className="mt-2 text-xs text-muted-foreground">
            {isMock
              ? "Демонстрационный режим: генерация выключена, показан контур вашего дома без планировки."
              : "Эскизная концепция, сгенерирована автоматически. Контур дома наложен из конструктора и точен; расстановка комнат — идея, а не проект."}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Мелкие элементы управления                                          */
/* ------------------------------------------------------------------ */

function Counter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-sm border border-border bg-background px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 p-0 text-lg leading-none"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          aria-label={`${label}: меньше`}
        >
          −
        </Button>
        <span className="w-4 text-center text-sm font-semibold text-foreground">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 p-0 text-lg leading-none"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          aria-label={`${label}: больше`}
        >
          +
        </Button>
      </div>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-sm border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:border-foreground/40",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}
