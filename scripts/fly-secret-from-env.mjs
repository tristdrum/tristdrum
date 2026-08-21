#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const [app, targetName, sourceName] = process.argv.slice(2);
const namePattern = /^[A-Z][A-Z0-9_]*$/;
if (!/^[a-z0-9-]+$/.test(app ?? "") || !namePattern.test(targetName ?? "") || !namePattern.test(sourceName ?? "")) {
  throw new Error("Usage: fly-secret-from-env.mjs <app> <TARGET_NAME> <SOURCE_NAME>");
}

const value = String(process.env[sourceName] ?? "");
if (!value || /[\r\n]/.test(value)) throw new Error(`Environment variable ${sourceName} is missing or invalid.`);

const result = spawnSync(
  "/Users/tristdrum/.local/bin/fly-personal",
  ["secrets", "import", "--stage", "--app", app],
  {
    input: `${targetName}=${value}\n`,
    encoding: "utf8",
  },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
