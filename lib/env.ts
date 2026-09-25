/**
 * Minimal .env loader for the worker and seed script (Next loads its own).
 * No dependency, no --env-file flag to forget.
 */

import fs from "node:fs";
import path from "node:path";

const FILES = [".env", ".env.local"];

export function loadEnv(cwd = process.cwd()): void {
  for (const file of FILES) {
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) continue;

    for (const raw of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue; // real env wins

      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) process.env[key] = value;
    }
  }
}
