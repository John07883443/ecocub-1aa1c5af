/**
 * «Сказал — значит сделал». Лев может описывать только те изменения, которые
 * реально применил инструмент (ok и дифф). Журнал хода: что применено и что
 * отклонено с момента последней реплики человека. Если Лев объявил правку,
 * а применённых нет — поправка в чат и модели: дом не менялся.
 */

/** Глаголы «сделанного» в прошедшем времени, без «не» перед ними. */
const CLAIM =
  /(?<!не\s)(?<!\p{L})(добавил[аи]?|убрал[аи]?|удалил[аи]?|перен[её]с(ла|ли)?|сделал[аи]?|поменял[аи]?|заменил[аи]?|развернул[аи]?|повернул[аи]?|увеличил[аи]?|уменьшил[аи]?|расширил[аи]?|вернул[аи]?|поставил[аи]?|переставил[аи]?|осветлил[аи]?|затемнил[аи]?|подпер(ла|ли)?|посадил[аи]?|пристроил[аи]?|готово)(?!\p{L})/iu;

/** Объявлена ли в реплике правка дома. Вопросы и предложения («могу добавить?») — не правка. */
export function claimsChange(text: string): boolean {
  const t = text.replace(/ё/g, "е");
  // Предложение и вопрос — не утверждение о сделанном.
  const sentences = t.split(/(?<=[.!?])\s+/);
  return sentences.some(
    (s) =>
      !/\?\s*$/.test(s) &&
      !/^(могу|можно|хотите|давайте|предлагаю|если)(?!\p{L})/iu.test(s.trim()) &&
      CLAIM.test(s),
  );
}

export interface LedgerEntry {
  tool: string;
  ok: boolean;
  text: string;
}

export class TurnLedger {
  private entries: LedgerEntry[] = [];

  /** Человек сказал новое — начинаем новый ход. */
  begin() {
    this.entries = [];
  }

  record(tool: string, ok: boolean, text: string) {
    this.entries.push({ tool, ok, text });
  }

  get applied(): LedgerEntry[] {
    return this.entries.filter((e) => e.ok);
  }

  get failed(): LedgerEntry[] {
    return this.entries.filter((e) => !e.ok);
  }

  /**
   * Проверка реплики Льва. null — всё честно; строка — поправка, которую надо
   * показать человеку и передать модели.
   */
  check(text: string): string | null {
    if (!claimsChange(text) || this.applied.length) return null;
    const f = this.failed[0];
    return f
      ? `Не получилось: ${f.text.replace(/^НЕ СДЕЛАНО:\s*/, "").slice(0, 220)} Дом не менялся.`
      : "Дом не менялся: правка не выполнялась. Скажите ещё раз — сделаю командой.";
  }
}
