#!/usr/bin/env node
/**
 * Production runner: `npm run start:all`
 *
 *   1. builds the app if there's no build yet (or with --build to force)
 *   2. runs setup (db) on first run, like dev.mjs
 *   3. starts `next start` and the job worker together, each supervised:
 *      if one crashes it is restarted (capped exponential backoff), so a
 *      transient failure doesn't take the site or the render queue down.
 *
 * This is the lightweight process manager. On a VPS you can instead run the two
 * `npm run start` / `npm run worker` commands under pm2 or systemd; this script
 * is the zero-dependency, cross-platform option. Ctrl+C stops both.
 *
 * Set MEDIA_ROOT to a path outside the repo (a mounted volume) so renders and
 * uploads survive redeploys.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const PORT = Number(process.env.PORT ?? 3000);

const color = { app: "\x1b[36m", worker: "\x1b[33m", cadence: "\x1b[35m", reset: "\x1b[0m" };
const say = (m) => console.log(`${color.cadence}[cadence]${color.reset} ${m}`);

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
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

// ── first-run setup ─────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(root, "node_modules"))) {
  runOnce("installing dependencies (first run)…", ["install"]);
}
if (!fs.existsSync(path.join(root, ".env")) && fs.existsSync(path.join(root, ".env.example"))) {
  fs.copyFileSync(path.join(root, ".env.example"), path.join(root, ".env"));
  say("created .env from .env.example — set APP_PASSWORD and your keys before going public");
}
if (!fs.existsSync(path.join(root, "prisma", "dev.db"))) {
  runOnce("creating the database and demo workspace (first run)…", ["run", "setup"]);
}

const needBuild = process.argv.includes("--build") || !fs.existsSync(path.join(root, ".next", "BUILD_ID"));
if (needBuild) {
  runOnce("building the app for production…", ["run", "build"]);
}

if (await portInUse(PORT)) {
  say(`port ${PORT} is already in use — stop the other process first.`);
  process.exit(1);
}

// ── supervised processes ────────────────────────────────────────────────────
let stopping = false;
const managed = [];

function supervise(name, args) {
  const state = { name, args, child: null, restarts: 0, backoff: 1000 };
  managed.push(state);
  launch(state);
}

function launch(state) {
  if (stopping) return;
  const child = spawn(npm, state.args, {
    cwd: root,
    shell: isWin,
    env: { ...process.env, NODE_ENV: "production", FORCE_COLOR: "1" },
  });
  state.child = child;
  const prefix = `${color[state.name]}[${state.name}]${color.reset} `;
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
    if (stopping) return;
    // A clean, healthy run resets the backoff; rapid repeated crashes slow it.
    const uptime = Date.now() - state.startedAt;
    if (uptime > 30_000) state.backoff = 1000;
    state.restarts++;
    say(`${state.name} exited (code ${code}); restarting in ${(state.backoff / 1000).toFixed(0)}s (restart #${state.restarts})`);
    setTimeout(() => launch(state), state.backoff);
    state.backoff = Math.min(state.backoff * 2, 30_000);
  });
  state.startedAt = Date.now();
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const s of managed) {
    const child = s.child;
    if (!child || child.exitCode !== null) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

say(`starting production: app on http://localhost:${PORT} and the job worker (supervised)…`);
supervise("app", ["run", "start"]);
supervise("worker", ["run", "worker"]);

const started = Date.now();
while (Date.now() - started < 120_000) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await portInUse(PORT)) {
    say(`ready — http://localhost:${PORT}   (Ctrl+C stops app + worker)`);
    break;
  }
}
