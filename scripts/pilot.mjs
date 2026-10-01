/**
 * `npm run pilot` — поднимает сервер пилота (ключи, голос, чат, рендеры, заявки)
 * и dev-сервер сайта. Открыть: адрес, который напечатает vite, плюс /pilot.
 * Только локально. Боевой сайт и его конфиг не трогаются.
 */
import { spawn } from "node:child_process";
import { startPilotServer } from "./pilot-server.mjs";

startPilotServer();
const vite = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_PILOT: "1" },
});
vite.on("exit", (code) => process.exit(code ?? 0));
console.log("\n[pilot] Откройте http://localhost:<порт vite>/pilot — порт vite печатает ниже.\n");
