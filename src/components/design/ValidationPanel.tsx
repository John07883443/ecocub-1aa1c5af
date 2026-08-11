import { AlertTriangle, CircleAlert, CircleCheck, HelpCircle } from "lucide-react";
import { OPEN_QUESTIONS } from "@/lib/house-project/catalog";
import type { ValidationIssue } from "@/lib/house-project/types";
import { cn } from "@/lib/utils";

/**
 * Результат проверки модели.
 *
 * Ошибки и предупреждения разведены не только цветом, но и смыслом, и это
 * написано прямо на панели: ошибка блокирует публикацию, предупреждение —
 * нет. Иначе через неделю оба вида начинают восприниматься как «красное
 * что-то», и человек либо чинит несущественное, либо перестаёт читать вовсе.
 *
 * Внизу — список того, чего система не знает из исходных документов. Он
 * висит постоянно: неопределённость, спрятанная в интерфейсе, превращается
 * в уверенность, которой нет оснований.
 */
export function ValidationPanel({
  issues,
  onFocus,
}: {
  issues: ValidationIssue[];
  onFocus?: (targetId: string) => void;
}) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <div className="space-y-4 text-sm">
      <div
        className={cn(
          "flex items-start gap-2 rounded-sm p-3",
          errors.length
            ? "bg-destructive/10 text-destructive"
            : warnings.length
              ? "bg-amber-500/10 text-amber-700"
              : "bg-emerald-500/10 text-emerald-700",
        )}
      >
        {errors.length ? (
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
        ) : warnings.length ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        ) : (
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
        )}
        <p className="text-[13px] leading-relaxed">
          {errors.length
            ? `Ошибок: ${errors.length}. Публикация заблокирована, пока они есть.`
            : warnings.length
              ? `Ошибок нет. Предупреждений: ${warnings.length} — публикацию они не блокируют, но требуют решения инженера.`
              : "Модель проходит проверку без замечаний."}
        </p>
      </div>

      {[
        { list: errors, title: "Ошибки", tone: "text-destructive" },
        { list: warnings, title: "Предупреждения", tone: "text-amber-700" },
      ].map(({ list, title, tone }) =>
        list.length ? (
          <div key={title}>
            <h4 className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", tone)}>
              {title}
            </h4>
            <ul className="space-y-1.5">
              {list.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>
                  <button
                    type="button"
                    disabled={!issue.targetId || !onFocus}
                    onClick={() => issue.targetId && onFocus?.(issue.targetId)}
                    className={cn(
                      "w-full rounded-sm border border-border px-2.5 py-2 text-left text-[12px] leading-relaxed",
                      issue.targetId && onFocus ? "hover:border-accent" : "cursor-default",
                    )}
                  >
                    {issue.message}
                    <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                      {issue.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}

      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <HelpCircle className="size-3.5" /> Чего нет в исходниках
        </h4>
        <ul className="space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {OPEN_QUESTIONS.map((q) => (
            <li key={q.id} className="rounded-sm bg-muted/50 px-2.5 py-2">
              {q.question}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
