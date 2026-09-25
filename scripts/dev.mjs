#!/usr/bin/env node
/**
 * One command to run everything: `npm run dev:all`
 *
 *   1. installs dependencies if node_modules is missing
 *   2. creates + seeds the database if prisma/dev.db is missing
 *   3. starts the Next.js app and the job worker side by side
 *   4. opens the browser once the app answers (pass --open)
 *
 * Output from both processes is prefixed ([app] / [worker]). Ctrl+C stops
 * both; if either one exits, the other is stopped too.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: this project's folder has a space in it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const PORT = Number(process.env.PORT ?? 3000);
const openBrowser = process.argv.includes("--open");

const color = { app: "\x1b[36m", worker: "\x1b[33m", cadence: "\x1b[35m", reset: "\x1b[0m" };
const say = (msg) => console.log(`${color.cadence}[cadence]${color.reset} ${msg}`);

function runOnce(label, args) {
  say(label);
  const r = spawnSync(npm, args, { cwd: root, stdio: "inherit", shell: isWin });
  if (r.status !== 0) {
    say(`"npm ${args.join(" ")}" failed — fix the error above and run again.`);
    process.exit(r.status ?? 1);
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

// ── first-run setup ─────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(root, "node_modules"))) {
  runOnce("installing dependencies (first run)…", ["install"]);
}
if (!fs.existsSync(path.join(root, ".env")) && fs.existsSync(path.join(root, ".env.example"))) {
  fs.copyFileSync(path.join(root, ".env.example"), path.join(root, ".env"));
  say("created .env from .env.example (MOCK=true, no keys needed)");
}
if (!fs.existsSync(path.join(root, "prisma", "dev.db"))) {
  runOnce("creating the database and demo workspace (first run)…", ["run", "setup"]);
}

if (await portInUse(PORT)) {
  say(`port ${PORT} is already in use — Cadence (or something else) is already running.`);
  say(`close that window first, or open http://localhost:${PORT}`);
  process.exit(1);
}

// ── run app + worker ────────────────────────────────────────────────────────
const children = [];
let shuttingDown = false;

function start(name, args) {
  const child = spawn(npm, args, {
    cwd: root,
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  const prefix = `${color[name]}[${name}]${color.reset} `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (shuttingDown) return;
    say(`${name} exited (code ${code}) — stopping everything.`);
    stopAll(code ?? 1);
  });
  children.push(child);
  return child;
}

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

say(`starting app on http://localhost:${PORT} and the job worker…`);
start("app", ["run", "dev"]);
start("worker", ["run", "worker"]);

// Wait for the app to answer, then say so (and open the browser if asked).
const started = Date.now();
while (Date.now() - started < 120_000) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await portInUse(PORT)) {
    say(`ready — http://localhost:${PORT}   (Ctrl+C stops app + worker)`);
    if (openBrowser) {
      const url = `http://localhost:${PORT}/calendar`;
      if (isWin) spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
      else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true });
    }
    break;
  }
}
