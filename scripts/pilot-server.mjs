/**
 * Голосовой релей конструктора v4: браузер ↔ этот процесс ↔ InWorld Realtime.
 * Ключ InWorld (общий с МедиаМашиной) живёт только здесь, в браузер не уходит.
 * Чистый мост, как realtime-server.js МедиаМашины; логика диалога — в браузере
 * (src/constructor-v4/ui/voice.ts).
 *
 * Чат, рендеры и заявки идут через маршруты сайта /api/pilot/* — им этот процесс не нужен.
 *
 * Локально: поднимается `npm run pilot` (ws://localhost:8790/voice).
 * На VPS (по решению владельца, отдельным шагом): pm2-процесс
 *   PILOT_PORT=8790 PILOT_ALLOWED_ORIGINS=https://eco-cub.ru node scripts/pilot-server.mjs
 * и в nginx location /pilot-voice → http://127.0.0.1:8790 с Upgrade-заголовками;
 * сайту — PILOT_VOICE_URL=wss://eco-cub.ru/pilot-voice. См. docs/CONSTRUCTOR_V4_DEPLOY.md.
 *
 * Ключи берутся из окружения или из .env.pilot.local (в git не попадает).
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
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

const env = { ...loadPilotEnv(), ...process.env };
const PORT = Number(env.PILOT_PORT || 8790);
const INWORLD_KEY = env.INWORLD_API_KEY_BASE64 || "";
const VOICE_MINUTES = Number(env.PILOT_VOICE_MINUTES || 10);
const MAX_SESSIONS = Number(env.PILOT_VOICE_MAX_SESSIONS || 20);
const ALLOWED = (env.PILOT_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), "[pilot-voice]", ...a);
let active = 0;

function originOk(origin) {
  if (!ALLOWED.length)
    return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ALLOWED.includes(origin || "");
}

export function startPilotServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.endsWith("/health")) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, inworld: !!INWORLD_KEY, active }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (!/\/(pilot-)?voice$/.test(url.pathname)) return socket.destroy();
    if (!originOk(req.headers.origin)) {
      log("отклонён Origin", req.headers.origin);
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (browser) => {
      if (!INWORLD_KEY) return browser.close(4500, "no-inworld-key");
      if (active >= MAX_SESSIONS) return browser.close(4429, "voice-busy");
      active++;
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
      log(`браузер подключился, активных ${active}`);
      upstream.on("open", () => {
        for (const m of queue.splice(0)) upstream.send(m);
      });
      upstream.on("message", (data, isBinary) => {
        if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
      });
      upstream.on("close", (code, reason) => {
        log(`InWorld закрыл ${code} ${reason || ""}`);
        clearTimeout(deadline);
        // Причину показываем всегда (урок МедиаМашины: «тихий» обрыв был квотой).
        if (browser.readyState === WebSocket.OPEN)
          browser.close(code === 1000 ? 1000 : 4502, String(reason || code).slice(0, 120));
      });
      upstream.on("error", (e) => log("ошибка InWorld", e.message));
      browser.on("message", (data, isBinary) => {
        const m = isBinary ? data : data.toString();
        if (upstream.readyState === WebSocket.OPEN) upstream.send(m);
        else queue.push(m);
      });
      browser.on("close", () => {
        active--;
        clearTimeout(deadline);
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)
          upstream.close();
        log(`сессия ${Math.round((Date.now() - started) / 1000)} с`);
      });
    });
  });

  server.listen(PORT, "127.0.0.1", () =>
    log(`голосовой релей: ws://localhost:${PORT}/voice  inworld=${!!INWORLD_KEY}`),
  );
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  startPilotServer();
