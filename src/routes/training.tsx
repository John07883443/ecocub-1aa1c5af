import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";

import { PlanView } from "@/components/constructor/plan/PlanView";
import { houseFromModules } from "@/lib/planner/zoning";
import {
  buildBatch,
  REJECT_LABELS,
  REJECT_REASONS,
  type RejectReason,
} from "@/lib/planner/training";
import { errors } from "@/lib/planner/audit";

/**
 * Страница обучения планировщика.
 *
 * Инварианты ловят то, что записывается формулой. «Планировка выглядит глупо»
 * формулой не записывается — это видит человек. Здесь партия домов
 * показывается сразу целиком, владелец отмечает годные и называет причину
 * отказа, а разбор потом ищет общее у забракованных.
 *
 * Страница закрыта от поисковиков и не ведёт ни на какие действия с деньгами.
 * Пароля нет намеренно: разметка ничего не меняет в боевом сайте, правило
 * переносится в код руками после разбора.
 */
export const Route = createFileRoute("/training")({
  component: TrainingPage,
  head: () => ({
    meta: [
      { title: "Обучение планировщика — EcoCub" },
      // Страница служебная: в поиске ей делать нечего.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

/**
 * Своя причина отказа — текстом или голосом.
 *
 * Закрытый список причин быстрее в разметке, но он всегда неполон: владелец
 * первым же прогоном нашёл дефект, которого в списке нет (перегородки внутри
 * модуля не двигаются). Свободное поле такие случаи ловит.
 *
 * Диктовка — через встроенное распознавание речи браузера. Работает не везде,
 * поэтому кнопка появляется только там, где оно есть, а поле остаётся обычным
 * текстовым: голос здесь удобство, а не единственный способ ввода.
 */
function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [listening, setListening] = useState(false);

  type RecognitionCtor = new () => {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    start: () => void;
    stop: () => void;
    onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
  };
  const Recognition =
    typeof window === "undefined"
      ? undefined
      : (((window as unknown as Record<string, unknown>).SpeechRecognition ??
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as
          | RecognitionCtor
          | undefined);

  const dictate = () => {
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "ru-RU";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (e) => {
      const said = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ")
        .trim();
      const merged = text ? `${text} ${said}` : said;
      setText(merged);
      onChange(merged);
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  return (
    <div className="mt-2 flex gap-1">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text)}
        placeholder="Своя причина"
        className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 text-[12px]"
      />
      {Boolean(Recognition) && (
        <button
          type="button"
          onClick={dictate}
          title="Надиктовать причину"
          aria-label="Надиктовать причину"
          className={`h-8 w-8 shrink-0 rounded-sm border text-sm ${
            listening ? "border-rose-600 bg-rose-600 text-white" : "border-border"
          }`}
        >
          ●
        </button>
      )}
    </div>
  );
}

function TrainingPage() {
  // Сегменты по числу кубиков: дефекты у дома из трёх модулей и из двадцати
  // двух разные, и размечать их вперемешку бессмысленно.
  const [sizes, setSizes] = useState<number[]>([3, 4, 5, 6]);
  const [perSize, setPerSize] = useState(4);
  const [run, setRun] = useState(() => `run-${Date.now()}`);
  const [seed, setSeed] = useState(1);
  const [marks, setMarks] = useState<
    Record<string, { approved: boolean; reasons: RejectReason[]; note: string }>
  >({});
  const [saved, setSaved] = useState(0);

  const batch = useMemo(() => buildBatch({ sizes, perSize, seed }), [sizes, perSize, seed]);

  const send = useCallback(
    async (
      caseId: string,
      features: string[],
      approved: boolean,
      reasons: RejectReason[],
      note = "",
    ) => {
      setMarks((m) => ({ ...m, [caseId]: { approved, reasons, note } }));
      try {
        await fetch("/api/planner-training", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, run, approved, reasons, features, note }),
        });
        setSaved((n) => n + 1);
      } catch {
        // Молча: разметка не должна прерываться из-за сети, отметка уже на экране.
      }
    },
    [run],
  );

  const done = Object.keys(marks).length;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-10">
      <h1 className="text-2xl font-semibold">Обучение планировщика</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Партия домов собрана перебором форм. Отметьте, где планировка приемлема, а где нет, и
        назовите причину отказа. Общее у забракованного разбирается отдельно и превращается в
        правило — вручную, после разбора.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-sm border border-border p-4">
        <label className="text-sm">
          Кубиков в доме (один этаж)
          <div className="mt-1 flex max-w-[520px] flex-wrap gap-1">
            {Array.from({ length: 21 }, (_, i) => i + 2).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() =>
                  setSizes((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort()))
                }
                className={`h-8 w-8 rounded-sm border text-sm ${
                  sizes.includes(n)
                    ? "border-foreground bg-foreground text-background"
                    : "border-border"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </label>

        <label className="text-sm">
          Домов каждого размера
          <input
            type="number"
            min={1}
            max={24}
            value={perSize}
            onChange={(e) => setPerSize(Number(e.target.value) || 1)}
            className="mt-1 block h-8 w-20 rounded-sm border border-border bg-background px-2"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setSeed((s) => s + 1);
            setRun(`run-${Date.now()}`);
            setMarks({});
            setSaved(0);
          }}
          className="h-8 rounded-sm border border-border px-3 text-sm hover:border-accent"
        >
          Новая партия
        </button>

        <span className="text-sm text-muted-foreground">
          {batch.length} домов · отмечено {done} · сохранено {saved}
        </span>

        <p className="w-full text-xs text-muted-foreground">
          До девяти кубиков формы перебираются полностью, выше — детерминированная выборка: при
          двенадцати модулях форм уже полмиллиона. Партия повторяется при том же зерне, поэтому
          прогоны можно сравнивать между собой.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {batch.map((c) => {
          const mark = marks[c.id];
          const hard = errors(c.findings);
          return (
            <article
              key={c.id}
              className={`rounded-sm border p-3 ${
                mark ? (mark.approved ? "border-emerald-600" : "border-rose-600") : "border-border"
              }`}
            >
              <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                <span>{c.moduleCount} модулей</span>
                {hard.length > 0 && <span className="text-rose-600">аудит: {hard.length}</span>}
              </div>

              <div className="mt-2 overflow-hidden rounded-sm bg-background">
                <PlanView house={houseFromModules(c.modules)} />
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => send(c.id, c.features, true, [], mark?.note ?? "")}
                  className={`h-8 flex-1 rounded-sm border text-sm ${
                    mark?.approved
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-border"
                  }`}
                >
                  Годится
                </button>
                <button
                  type="button"
                  onClick={() =>
                    send(c.id, c.features, false, mark?.reasons ?? [], mark?.note ?? "")
                  }
                  className={`h-8 flex-1 rounded-sm border text-sm ${
                    mark && !mark.approved
                      ? "border-rose-600 bg-rose-600 text-white"
                      : "border-border"
                  }`}
                >
                  Нет
                </button>
              </div>

              {mark && !mark.approved && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {REJECT_REASONS.map((r) => {
                    const on = mark.reasons.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() =>
                          send(
                            c.id,
                            c.features,
                            false,
                            on ? mark.reasons.filter((x) => x !== r) : [...mark.reasons, r],
                            mark.note,
                          )
                        }
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          on ? "border-foreground bg-foreground text-background" : "border-border"
                        }`}
                      >
                        {REJECT_LABELS[r]}
                      </button>
                    );
                  })}
                </div>
              )}

              {mark && !mark.approved && (
                <NoteField
                  value={mark.note}
                  onChange={(note) => send(c.id, c.features, false, mark.reasons, note)}
                />
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
