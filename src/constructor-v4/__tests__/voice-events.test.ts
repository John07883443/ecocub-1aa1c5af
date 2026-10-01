/**
 * Голос: разбор событий InWorld Realtime и «сказал — значит сделал».
 * fixtures/inworld-voice-edit.json — запись живой сессии (scripts/voice-e2e.ts,
 * openai/gpt-5.4-mini, 01.10.2026): 7 реплик, все инструменты дошли до сессии,
 * каждая реплика вызвала свою команду.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealtimeToolRouter, stripToolLeak } from "../ui/voice-events.ts";
import { TurnLedger, claimsChange } from "../ui/truth.ts";
import { realtimeTools, chatTools } from "../ui/architect.ts";
import { COMMAND_TOOLS } from "../engine/commands.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/inworld-voice-edit.json", import.meta.url), "utf8"),
) as { model: string; utterances: string[]; events: Record<string, unknown>[] };
const known = new Set<string>(realtimeTools().map((t) => t.name));

test("все команды правки дома доходят до сессии голоса и чата", () => {
  const rt = new Set<string>(realtimeTools().map((t) => t.name));
  const ct = new Set<string>(chatTools().map((t) => t.function.name));
  for (const t of COMMAND_TOOLS as readonly { name: string }[]) {
    assert.ok(rt.has(t.name), `голос: ${t.name}`);
    assert.ok(ct.has(t.name), `чат: ${t.name}`);
  }
  for (const n of ["undo", "redo", "accept_offer", "show_variants"]) assert.ok(rt.has(n), n);
  // В записи живой сессии InWorld подтвердил все инструменты.
  const upd = fixture.events.find((e) => e.type === "session.updated") as {
    session: { tools: unknown[] };
  };
  assert.ok(upd.session.tools.length >= 30);
});

test("запись живой сессии: каждый вызов исполняется один раз, хотя приходит тремя путями", () => {
  const router = new RealtimeToolRouter(known);
  const calls: string[] = [];
  const sent: unknown[][] = [];
  for (const e of fixture.events) {
    for (const c of router.ingest(e)) {
      calls.push(c.name);
      router.complete(c.callId, "ГОТОВО, дом изменён: тест.");
    }
    if (e.type === "response.done") {
      const out = router.flush("инструкции");
      if (out.length) sent.push(out);
    }
  }
  assert.deepEqual(calls, [
    "set_finish",
    "add_room",
    "edit_window",
    "add_second_tier",
    "undo",
    "resize_house",
    "edit_door",
  ]);
  // На каждый вызов — function_call_output, свежие инструкции и ровно один response.create.
  assert.equal(sent.length, calls.length);
  for (const batch of sent) {
    const types = batch.map((m) => (m as { type: string }).type);
    assert.equal(types.filter((t) => t === "response.create").length, 1);
    assert.equal(types[types.length - 1], "response.create");
    assert.ok(types.includes("session.update"), "контекст дома обновлён после правки");
    const out = batch.find(
      (m) => (m as { item?: { type?: string } }).item?.type === "function_call_output",
    );
    assert.ok(out, "результат вернулся модели");
  }
});

test("имя функции только в output_item.added — всё равно исполняем", () => {
  const r = new RealtimeToolRouter(known);
  r.ingest({ type: "response.created", response: { id: "r1" } });
  r.ingest({
    type: "response.output_item.added",
    item: {
      id: "it1",
      type: "function_call",
      call_id: "c1",
      name: "add_room",
      status: "in_progress",
    },
  });
  const calls = r.ingest({
    type: "response.function_call_arguments.done",
    item_id: "it1",
    call_id: "c1",
    arguments: '{"room":"bedroom","side":"S"}',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "add_room");
  assert.deepEqual(calls[0].args, { room: "bedroom", side: "S" });
  // Дубль тем же call_id в output_item.done — не исполняется второй раз.
  assert.equal(
    r.ingest({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "c1",
        name: "add_room",
        arguments: "{}",
        status: "completed",
      },
    }).length,
    0,
  );
});

test("ответ модели отдаём только после response.done и после исполнения; отменённый ответ — не повод", () => {
  const r = new RealtimeToolRouter(known);
  r.ingest({ type: "response.created", response: { id: "r1" } });
  const [c] = r.ingest({
    type: "response.function_call_arguments.done",
    call_id: "c9",
    name: "rotate_house",
    arguments: '{"deg":90}',
  });
  assert.deepEqual(r.flush(), [], "до response.done ничего не шлём");
  r.ingest({ type: "response.done", response: { status: "completed", output: [] } });
  assert.deepEqual(r.flush(), [], "вызов ещё исполняется");
  r.complete(c.callId, "ГОТОВО");
  assert.equal(r.flush().length, 2);
  // Отменённый (superseded) ответ без вызовов — ничего не отправляем.
  r.ingest({ type: "response.created", response: { id: "r2" } });
  r.ingest({ type: "response.done", response: { status: "cancelled", output: [] } });
  assert.deepEqual(r.flush(), []);
});

test("вызов, напечатанный текстом, тоже исполняется, а из речи вырезается", () => {
  const r = new RealtimeToolRouter(known);
  const text = 'Сейчас добавлю. functions.add_room({"room":"study","side":"E"})';
  const calls = r.leakedCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "add_room");
  assert.equal(calls[0].args.room, "study");
  assert.equal(stripToolLeak(text, known), "Сейчас добавлю.");
  assert.equal(r.leakedCalls("Добавил комнату (как вы хотели)").length, 0);
});

test("«сказал — сделал»: заявленная правка без применённой команды — поправка", () => {
  assert.ok(claimsChange("Готово, фасад сделал светлее."));
  assert.ok(claimsChange("Добавил спальню с юга."));
  assert.ok(!claimsChange("Могу добавить спальню с юга — показать?"));
  assert.ok(!claimsChange("Могу поставить колонны под свес."));
  assert.ok(!claimsChange("Не получилось: окно не помещается."));
  assert.ok(!claimsChange("Я не добавил спальню: нет места."));
  const l = new TurnLedger();
  l.begin();
  assert.match(l.check("Фасад сделал светлее.") ?? "", /не менялся/);
  l.record("set_finish", false, "НЕ СДЕЛАНО: Так уже есть — дом не изменился.");
  assert.match(l.check("Сделал!") ?? "", /Не получилось: Так уже есть/);
  l.record("set_finish", true, "ГОТОВО");
  assert.equal(l.check("Сделал: фасад белый."), null);
  l.begin();
  assert.equal(l.check("Какой участок у вас?"), null);
});
