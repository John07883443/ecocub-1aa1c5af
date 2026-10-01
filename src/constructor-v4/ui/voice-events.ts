/**
 * Разбор событий InWorld Realtime для вызова инструментов — без браузера и React,
 * чтобы проигрывать записанные события в тестах (__tests__/fixtures/inworld-*.json).
 *
 * Что выяснили на живом InWorld (01.10.2026, openai/gpt-5.4-mini):
 *  - вызов приходит тремя путями: response.function_call_arguments.done (с name),
 *    response.output_item.done (item.type=function_call) и в response.done.output;
 *    у других моделей name бывает только в item — берём из любого места, дубли по call_id;
 *  - результат отдаём ПОСЛЕ response.done: function_call_output на каждый вызов,
 *    затем свежие инструкции (дом поменялся) и ОДИН response.create. Два
 *    response.create подряд InWorld отменяет («superseded»);
 *  - модель иногда «печатает» вызов текстом (functions.add_room({...})) — такой
 *    вызов тоже исполняем, а из речи вырезаем.
 */

export interface RealtimeToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** Каким событием пришёл. */
  via: string;
  /** Вызов «утёк» в текст ответа, а не пришёл событием. */
  leaked?: boolean;
}

type Msg = Record<string, unknown> & { type?: string };

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export class RealtimeToolRouter {
  /** item_id / call_id → имя функции (из output_item.added). */
  private names = new Map<string, string>();
  private seen = new Set<string>();
  private inFlight = 0;
  private outputs: { callId: string; output: string; leaked?: boolean }[] = [];
  private responseDone = false;
  private callsThisResponse = 0;
  private leakSeq = 0;

  private known: Set<string>;

  constructor(known: Set<string>) {
    this.known = known;
  }

  /** Новое событие → вызовы, которые надо исполнить сейчас (уже без дублей). */
  ingest(msg: Msg): RealtimeToolCall[] {
    const out: RealtimeToolCall[] = [];
    const item = (msg.item ?? {}) as Record<string, unknown>;
    switch (msg.type) {
      case "response.created":
        this.responseDone = false;
        this.callsThisResponse = 0;
        break;
      case "response.output_item.added":
      case "conversation.item.added":
        if (item.type === "function_call" && typeof item.name === "string") {
          if (typeof item.id === "string") this.names.set(item.id, item.name);
          if (typeof item.call_id === "string") this.names.set(item.call_id, item.name);
        }
        break;
      case "response.function_call_arguments.done": {
        const callId = String(msg.call_id ?? "");
        const name =
          (typeof msg.name === "string" && msg.name) ||
          this.names.get(callId) ||
          this.names.get(String(msg.item_id ?? "")) ||
          "";
        this.push(out, callId, name, msg.arguments, msg.type);
        break;
      }
      case "response.output_item.done":
      case "conversation.item.done":
        if (item.type === "function_call" && item.status !== "in_progress")
          this.push(
            out,
            String(item.call_id ?? ""),
            String(item.name ?? ""),
            item.arguments,
            msg.type,
          );
        break;
      case "response.done": {
        const resp = (msg.response ?? {}) as {
          output?: Record<string, unknown>[];
          status?: string;
        };
        for (const o of resp.output ?? [])
          if (o.type === "function_call")
            this.push(
              out,
              String(o.call_id ?? ""),
              String(o.name ?? ""),
              o.arguments,
              "response.done",
            );
        // Отменённый (superseded) ответ — не повод отвечать модели.
        if (resp.status !== "cancelled") this.responseDone = true;
        break;
      }
    }
    return out;
  }

  private push(out: RealtimeToolCall[], callId: string, name: string, raw: unknown, via: string) {
    if (!callId || !name || this.seen.has(callId)) return;
    this.seen.add(callId);
    this.inFlight++;
    this.callsThisResponse++;
    out.push({ callId, name, args: parseArgs(raw), via });
  }

  /** Вызовы, напечатанные текстом: «functions.add_room({"room":"bedroom"})», «add_room(...)». */
  leakedCalls(text: string): RealtimeToolCall[] {
    const out: RealtimeToolCall[] = [];
    const re = /(?:functions\.)?([a-z_]{3,40})\s*(?:\.run)?\(\s*(\{[\s\S]*?\})?\s*\)/g;
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (!this.known.has(name)) continue;
      const callId = `leak-${++this.leakSeq}`;
      this.seen.add(callId);
      this.inFlight++;
      this.callsThisResponse++;
      out.push({ callId, name, args: parseArgs(m[2] ?? "{}"), via: "text-leak", leaked: true });
    }
    return out;
  }

  /** Результат инструмента готов. */
  complete(callId: string, output: string) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.outputs.push({ callId, output, leaked: callId.startsWith("leak-") });
  }

  /**
   * Что отправить модели: результаты, свежие инструкции и один response.create —
   * только когда ответ модели закончился и все вызовы исполнены.
   */
  flush(instructions?: string): unknown[] {
    if (!this.responseDone || this.inFlight > 0 || !this.outputs.length) return [];
    const send: unknown[] = [];
    for (const o of this.outputs.splice(0))
      send.push(
        o.leaked
          ? {
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `[служебное, не произноси] Результат команды: ${o.output}`,
                  },
                ],
              },
            }
          : {
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: o.callId, output: o.output },
            },
      );
    if (instructions)
      send.push({ type: "session.update", session: { type: "realtime", instructions } });
    send.push({ type: "response.create" });
    this.responseDone = false;
    return send;
  }

  get pending(): number {
    return this.inFlight;
  }
}

/** Вырезать из речи «напечатанный» вызов функции: всё до первого упоминания. */
export function stripToolLeak(text: string, known: Set<string>): string {
  let cut = text.length;
  for (const name of known) {
    const i = text.search(new RegExp(`(functions\\.)?${name}\\s*\\(`));
    if (i >= 0) cut = Math.min(cut, i);
  }
  return text.slice(0, cut).trim();
}
