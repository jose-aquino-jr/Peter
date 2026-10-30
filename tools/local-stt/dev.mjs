import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sttDir = resolve(root, "tools/local-stt");
const modelDir = resolve(sttDir, "model");
const modelReady = existsSync(resolve(modelDir, "final.mdl")) ||
  existsSync(resolve(modelDir, "am/final.mdl"));
const python = resolve(sttDir, ".venv/Scripts/python.exe");
let sttProcess;

if (modelReady && existsSync(python)) {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(600) });
    if (response.ok) console.log("[Peter] Serviço de fala local já está ativo.");
    else sttProcess = startSpeechService();
  } catch {
    sttProcess = startSpeechService();
  }
} else {
  console.warn("[Peter] Transcrição local não instalada. Execute tools/local-stt/setup.ps1 uma vez.");
}

const vite = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (sttProcess && !sttProcess.killed) sttProcess.kill(signal);
  if (!vite.killed) vite.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
vite.on("error", (error) => {
  console.error("[Peter] Não foi possível iniciar o Vite:", error.message);
  shutdown("SIGTERM");
  process.exitCode = 1;
});
vite.on("exit", (code) => {
  if (sttProcess && !sttProcess.killed) sttProcess.kill("SIGTERM");
  process.exitCode = code ?? 0;
});

function startSpeechService() {
  console.log("[Peter] Iniciando reconhecimento offline em português...");
  const child = spawn(python, [resolve(sttDir, "server.py")], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => console.error("[Peter] Falha ao iniciar o serviço de fala:", error.message));
  return child;
}
