/**
 * Сервер пилота конструктора v4 — ТОЛЬКО для локального запуска (`npm run pilot`).
 * На боевой сайт не попадает и прод-конфиг не трогает.
 *
 * Держит ключи на своей стороне — в браузер они не уходят:
 *  - POST /chat    → rgrouter.ru chat/completions (текстовый «Архитектор Лев» с инструментами);
 *  - POST /render  → rgrouter.ru images/generations (рендеры по промпту, лимит на сессию);
 *  - POST /lead    → Telegram (заявка с паспортом проекта);
 *  - WS   /voice   → InWorld Realtime (общий ключ с МедиаМашиной), чистый мост как в
 *                    realtime-server.js МедиаМашины.
 *
 * Ключи — в .env.pilot.local (в .gitignore), образец — .env.pilot.example.
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadPilotEnv() {
  const file = path.join(ROOT, ".env.pilot.local");
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

const env = { ...loadPilotEnv(), ...process.env };
const PORT = Number(env.PILOT_PORT || 8790);
const RG_KEY = env.RGROUTER_API_KEY || "";
const RG_BASE = env.RGROUTER_BASE_URL || "https://rgrouter.ru/v1";
const INWORLD_KEY = env.INWORLD_API_KEY_BASE64 || "";
const TG_TOKEN = env.PILOT_TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = env.PILOT_TELEGRAM_CHAT_ID || "";
const CHAT_MODEL = env.PILOT_CHAT_MODEL || "rg-google-gemini-3.8-flash";
const IMAGE_MODEL = env.PILOT_IMAGE_MODEL || "rg-gpt-image-2.5";
const RENDER_RUNS = Number(env.PILOT_RENDER_RUNS || 2);
const VOICE_MINUTES = Number(env.PILOT_VOICE_MINUTES || 10);

const renderRuns = new Map(); // sessionId → запусков
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), "[pilot]", ...a);

function send(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Pilot-Session",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("Слишком большой запрос");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function rg(pathname, body) {
  if (!RG_KEY) throw new Error("Нет RGROUTER_API_KEY в .env.pilot.local");
  const r = await fetch(`${RG_BASE}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RG_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rgrouter ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function handleChat(req, res) {
  const { messages = [], tools = [], system = "" } = await readJson(req);
  const t = Date.now();
  const out = await rg("/chat/completions", {
    model: CHAT_MODEL,
    messages: [{ role: "system", content: system }, ...messages.slice(-30)],
    tools: tools.length ? tools : undefined,
    temperature: 0.4,
  });
  const msg = out.choices?.[0]?.message ?? {};
  log(`chat ${Date.now() - t} мс, tools=${msg.tool_calls?.length ?? 0}`);
  send(res, 200, { message: msg, usage: out.usage ?? null });
}

async function handleRender(req, res) {
  const session = String(req.headers["x-pilot-session"] || "anon");
  const used = renderRuns.get(session) || 0;
  if (used >= RENDER_RUNS)
    return send(res, 429, { error: `Лимит рендеров на сессию: ${RENDER_RUNS}` });
  renderRuns.set(session, used + 1);
  const { shots = [] } = await readJson(req);
  const results = await Promise.all(
    shots.slice(0, 3).map(async (s) => {
      try {
        const t = Date.now();
        const out = await rg("/images/generations", {
          model: IMAGE_MODEL,
          prompt: s.prompt,
          size: "1536x1024",
          n: 1,
        });
        const d = out.data?.[0] ?? {};
        log(`render ${s.id} ${Date.now() - t} мс`);
        return { id: s.id, url: d.url ?? null, b64: d.b64_json ?? null };
      } catch (e) {
        return { id: s.id, error: String(e.message || e) };
      }
    }),
  );
  send(res, 200, { results, runsLeft: RENDER_RUNS - used - 1 });
}

async function tg(method, form) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    body: form,
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram: ${j.description}`);
}

async function handleLead(req, res) {
  if (!TG_TOKEN || !TG_CHAT)
    return send(res, 500, { error: "Нет PILOT_TELEGRAM_* в .env.pilot.local" });
  const {
    name = "",
    phone = "",
    comment = "",
    summary = "",
    passport = null,
  } = await readJson(req);
  if (!String(phone).trim() && !String(name).trim())
    return send(res, 400, { error: "Нужны имя или телефон" });
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = [
    "<b>Заявка из пилота конструктора v4</b> (тест, не прод)",
    `Имя: ${esc(name)}`,
    `Телефон: ${esc(phone)}`,
    comment ? `Комментарий: ${esc(comment)}` : "",
    "",
    esc(summary).slice(0, 3000),
  ]
    .filter((x) => x !== "")
    .join("\n");
  const f1 = new FormData();
  f1.set("chat_id", TG_CHAT);
  f1.set("text", text);
  f1.set("parse_mode", "HTML");
  await tg("sendMessage", f1);
  if (passport) {
    const f2 = new FormData();
    f2.set("chat_id", TG_CHAT);
    f2.set("caption", "Паспорт проекта (JSON) — для проектировщика");
    f2.set(
      "document",
      new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" }),
      `passport-${Date.now()}.json`,
    );
    await tg("sendDocument", f2);
  }
  log("lead → Telegram");
  send(res, 200, { ok: true });
}

export function startPilotServer() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const url = new URL(req.url, "http://x");
      if (req.method === "GET" && url.pathname === "/health")
        return send(res, 200, {
          ok: true,
          rgrouter: !!RG_KEY,
          inworld: !!INWORLD_KEY,
          telegram: !!(TG_TOKEN && TG_CHAT),
          chatModel: CHAT_MODEL,
          imageModel: IMAGE_MODEL,
        });
      if (req.method === "POST" && url.pathname === "/chat") return await handleChat(req, res);
      if (req.method === "POST" && url.pathname === "/render") return await handleRender(req, res);
      if (req.method === "POST" && url.pathname === "/lead") return await handleLead(req, res);
      send(res, 404, { error: "not found" });
    } catch (e) {
      log("ошибка:", e.message);
      send(res, 500, { error: String(e.message || e) });
    }
  });

  // Голос: браузер ↔ этот сервер ↔ InWorld. Ключ только здесь.
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/voice") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (browser) => {
      if (!INWORLD_KEY) {
        browser.close(4500, "no-inworld-key");
        return;
      }
      const started = Date.now();
      const queue = [];
      const upstream = new WebSocket(
        `wss://api.inworld.ai/api/v1/realtime/session?key=ecocub-pilot-${started}&protocol=realtime`,
        { headers: { Authorization: `Basic ${INWORLD_KEY}` } },
      );
      const deadline = setTimeout(
        () => browser.close(4408, "voice-time-over"),
        VOICE_MINUTES * 60_000,
      );
      log("voice: браузер подключился");
      upstream.on("open", () => {
        for (const m of queue.splice(0)) upstream.send(m);
      });
      upstream.on("message", (data, isBinary) => {
        if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
      });
      upstream.on("close", (code, reason) => {
        log(`voice: InWorld закрыл ${code} ${reason || ""}`);
        clearTimeout(deadline);
        // Причину показываем всегда (урок МедиаМашины: «тихий» обрыв был квотой).
        if (browser.readyState === WebSocket.OPEN)
          browser.close(code === 1000 ? 1000 : 4502, String(reason || code).slice(0, 120));
      });
      upstream.on("error", (e) => log("voice: ошибка InWorld", e.message));
      browser.on("message", (data, isBinary) => {
        const m = isBinary ? data : data.toString();
        if (upstream.readyState === WebSocket.OPEN) upstream.send(m);
        else queue.push(m);
      });
      browser.on("close", () => {
        clearTimeout(deadline);
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)
          upstream.close();
        log(`voice: сессия ${Math.round((Date.now() - started) / 1000)} с`);
      });
    });
  });

  server.listen(PORT, () =>
    log(
      `сервер пилота: http://localhost:${PORT}  rgrouter=${!!RG_KEY} inworld=${!!INWORLD_KEY} telegram=${!!(TG_TOKEN && TG_CHAT)}`,
    ),
  );
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  startPilotServer();
