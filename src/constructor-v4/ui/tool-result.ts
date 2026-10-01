/**
 * Текст результата инструмента для модели (голос и чат одинаково). Успех — с
 * конкретным диффом, который Лев обязан пересказать; отказ — с причиной,
 * подсказкой и альтернативой, и прямым запретом говорить «сделал».
 */
import type { CommandResult } from "../engine/commands.ts";

export function formatResult(res: CommandResult): string {
  if (res.ok)
    return `ГОТОВО, дом изменён: ${res.message} Изменения: ${res.diff.summary}. Скажи человеку одной короткой живой фразой, что поменялось (главное — что и где; цифры только из «Изменений», ничего сверх них).`;
  return [
    `НЕ СДЕЛАНО: ${res.reason.replace(/\.$/, "")}.`,
    ...res.violations.slice(0, 2),
    res.suggestion ?? "",
    res.alternative
      ? `Предложи человеку: «${res.alternative.text}» (кнопка уже на экране; «да» — вызови accept_offer).`
      : "",
    "Дом НЕ менялся — не говори, что сделал.",
  ]
    .filter(Boolean)
    .join(" ");
}

export const isApplied = (text: string) => text.startsWith("ГОТОВО");
