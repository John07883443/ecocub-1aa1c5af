/**
 * Сквозная проверка голосовой правки дома против НАСТОЯЩЕГО InWorld Realtime —
 * тот же набор инструментов, тот же промпт Льва, тот же движок правил и тот же
 * разбор событий (ui/voice-events.ts), что в браузере. Вместо микрофона —
 * текстовые реплики (conversation.item.create), остальное как в живой сессии.
 *
 *   INWORLD_API_KEY_BASE64=… node --experimental-strip-types scripts/voice-e2e.ts
 *   node --experimental-strip-types scripts/voice-e2e.ts --key-file <json с api_key_base64>
 *   … --record src/constructor-v4/__tests__/fixtures/inworld-voice-edit.json
 *   … --model openai/gpt-5.4-mini   (по умолчанию PILOT_REALTIME_MODEL или gpt-5.4-mini)
 *
 * Ключ не печатается. --record пишет события без аудио — их проигрывает
 * __tests__/voice-events.test.ts. Код выхода 0 — каждая реплика вызвала
 * инструмент, правка применилась, и Лев не объявил того, чего не было.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { WebSocket } from "ws";
import { solve } from "../src/constructor-v4/engine/solver.ts";
import { briefFromScenario, type LifeScenario } from "../src/constructor-v4/engine/scenario.ts";
import { applyCommand, toolCallToCommand } from "../src/constructor-v4/engine/commands.ts";
import type { Project } from "../src/constructor-v4/engine/types.ts";
import { projectContext, realtimeTools, systemPrompt } from "../src/constructor-v4/ui/architect.ts";
import { RealtimeToolRouter, stripToolLeak } from "../src/constructor-v4/ui/voice-events.ts";
import { formatResult } from "../src/constructor-v4/ui/tool-result.ts";
import { TurnLedger } from "../src/constructor-v4/ui/truth.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const keyFile = flag("--key-file");
const record = flag("--record");
const model = flag("--model") || process.env.PILOT_REALTIME_MODEL || "openai/gpt-5.4-mini";
let key = process.env.INWORLD_API_KEY_BASE64 || "";
if (!key && keyFile) key = JSON.parse(readFileSync(keyFile, "utf8")).api_key_base64 || "";
if (!key) {
  console.error("Нет ключа: INWORLD_API_KEY_BASE64 или --key-file");
  process.exit(2);
}

const UTTERANCES = argv.length
  ? argv
  : [
      "Сделай фасад светлее, белая штукатурка.",
      "Добавь спальню с южной стороны.",
      "Окна на южном фасаде сделай больше.",
      "Добавь второй этаж.",
      "Отмени последнее.",
      "Сделай дом больше на двадцать квадратов.",
      "Перенеси вход на восток.",
    ];

const SCENARIO: LifeScenario = {
  adults: 2,
  kids: 1,
  pets: { dogs: 0 },
  workFromHome: 0,
  guestsOften: false,
  sauna: false,
  storage: "normal",
  car: false,
  terrace: true,
  tiers: "any",
  desiredAreaM2: { min: 50, max: 90 },
  plot: { widthM: 25, depthM: 35, northDeg: 0 },
};

let house: Project = solve(briefFromScenario(SCENARIO)).variants[0].project;
const history: Project[] = [];
const ledger = new TurnLedger();
const tools = realtimeTools();
const known = new Set(tools.map((t) => t.name));
const router = new RealtimeToolRouter(known);
const instructions = () =>
  systemPrompt(
    projectContext(house, {
      canUndo: history.length > 0,
      interview: "Интервью завершено: правим дом.",
    }),
  );

/** Исполнить инструмент так же, как PilotApp.runTool (без React). */
function runTool(name: string, args: Record<string, unknown>): string {
  if (name === "undo") {
    const prev = history.pop();
    if (!prev) return "НЕ СДЕЛАНО: отменять нечего. Дом НЕ менялся.";
    house = prev;
    ledger.record(name, true, "отменено");
    return "ГОТОВО, дом изменён: последняя правка отменена.";
  }
  const parsed = toolCallToCommand(name, args);
  if (!parsed.ok) {
    const text = `НЕ СДЕЛАНО: ${parsed.error}. Дом НЕ менялся.`;
    ledger.record(name, false, text);
    return text;
  }
  const res = applyCommand(house, parsed.command);
  const text = formatResult(res);
  if (res.ok) {
    history.push(house);
    house = res.project;
  }
  ledger.record(name, res.ok, text);
  return text;
}

type Turn = { said: string; calls: string[]; results: string[]; lev: string; truth: string | null };
const turns: Turn[] = [];
const events: unknown[] = [];
const started = Date.now();
const ws = new WebSocket(
  `wss://api.inworld.ai/api/v1/realtime/session?key=ecocub-e2e-${started}&protocol=realtime`,
  { headers: { Authorization: `Basic ${key}` } },
);
const send = (o: unknown) => ws.send(JSON.stringify(o));
let idx = -1;
let cur: Turn | null = null;
let quietTimer: ReturnType<typeof setTimeout> | null = null;

function finish(code: number) {
  if (record)
    writeFileSync(
      record,
      JSON.stringify(
        { model, recordedAt: new Date().toISOString(), utterances: UTTERANCES, events },
        null,
        1,
      ),
      "utf8",
    );
  for (const t of turns)
    console.log(
      `\n🗣 ${t.said}\n  ⚙ ${t.calls.join(", ") || "— нет вызова —"}\n  ${t.results.map((r) => r.slice(0, 160)).join("\n  ")}\n  Лев: ${t.lev}\n  ${t.truth ? `⚠ ${t.truth}` : "✓ честно"}`,
    );
  const bad = turns.filter((t) => !t.calls.length || t.truth);
  console.log(
    `\nмодель ${model}; реплик ${turns.length}, без вызова или нечестно: ${bad.length}; событий ${events.length}`,
  );
  ws.close();
  process.exit(code || (bad.length ? 1 : 0));
}

function next() {
  idx++;
  if (idx >= UTTERANCES.length) return finish(0);
  cur = { said: UTTERANCES[idx], calls: [], results: [], lev: "", truth: null };
  turns.push(cur);
  ledger.begin();
  send({
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text: cur.said }] },
  });
  send({ type: "response.create" });
}

/** Ход закончен, если 2,5 с нет новых ответов и все вызовы исполнены. */
function settle() {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    if (router.pending) return settle();
    if (cur) cur.truth = ledger.check(cur.lev);
    next();
  }, 2500);
}

setTimeout(() => {
  console.error("Тайм-аут 4 мин");
  finish(1);
}, 240_000);

ws.on("message", (data) => {
  let msg: Record<string, unknown> & { type?: string };
  try {
    msg = JSON.parse(String(data));
  } catch {
    return;
  }
  const slim = { ...msg } as Record<string, unknown>;
  if (typeof slim.delta === "string" && /audio/.test(String(slim.type))) slim.delta = "<audio>";
  events.push({ t: Date.now() - started, ...slim });
  if (msg.type === "session.created") {
    send({
      type: "session.update",
      session: {
        type: "realtime",
        model,
        instructions: instructions(),
        output_modalities: ["text"],
        tools,
        tool_choice: "auto",
      },
    });
    return;
  }
  if (msg.type === "session.updated" && idx < 0) {
    const got = ((msg.session as { tools?: { name: string }[] })?.tools ?? []).length;
    console.log(`session.updated: инструментов в сессии ${got} из ${tools.length}`);
    if (got !== tools.length) console.error("⚠ не все инструменты дошли до сессии");
    next();
    return;
  }
  if (msg.type === "error")
    console.error("InWorld error:", JSON.stringify(msg.error ?? msg).slice(0, 300));
  for (const call of router.ingest(msg)) {
    cur?.calls.push(`${call.name}(${JSON.stringify(call.args)}) via ${call.via}`);
    const out = runTool(call.name, call.args);
    cur?.results.push(out);
    router.complete(call.callId, out);
  }
  if (
    msg.type === "response.output_text.done" ||
    msg.type === "response.output_audio_transcript.done"
  ) {
    const text = String(msg.text ?? msg.transcript ?? "");
    for (const call of router.leakedCalls(text)) {
      cur?.calls.push(`${call.name}(${JSON.stringify(call.args)}) via text-leak`);
      const out = runTool(call.name, call.args);
      cur?.results.push(out);
      router.complete(call.callId, out);
    }
    const clean = stripToolLeak(text, known);
    if (cur && clean) cur.lev = clean;
  }
  if (msg.type === "response.done") {
    for (const m of router.flush(instructions())) send(m);
    settle();
  }
});
ws.on("error", (e) => {
  console.error("ws error", e.message);
  finish(1);
});
