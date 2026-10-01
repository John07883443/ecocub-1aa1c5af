/**
 * `npm run pilot` — локальный запуск конструктора v4: голосовой релей + dev-сервер сайта.
 * Конструктор: http://localhost:<порт vite>/constructor (бета), старый — /constructor/classic.
 * Ключи из .env.pilot.local пробрасываются в dev-сервер (маршруты /api/pilot/*).
 */
import { spawn } from "node:child_process";
import { loadPilotEnv, startPilotServer } from "./pilot-server.mjs";

startPilotServer();
const vite = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...loadPilotEnv(), PILOT_LOCAL_VOICE: "1" },
});
vite.on("exit", (code) => process.exit(code ?? 0));
console.log(
  "\n[pilot] Откройте http://localhost:<порт vite>/constructor — порт vite печатает ниже.\n",
);
