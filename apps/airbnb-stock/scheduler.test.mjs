import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(APP_DIR, "../../supabase/migrations");
const migrationPath = readdirSync(MIGRATIONS_DIR).find(
  (name) => name.endsWith("_airbnb_operational_hardening.sql"),
);

assert.ok(migrationPath, "expected Airbnb operational hardening migration");
const sql = readFileSync(resolve(MIGRATIONS_DIR, migrationPath), "utf8")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

test("Tuesday full review cannot collide exactly with the ordinary 09:00 stock poll", () => {
  assert.ok(sql.includes("jobname = 'airbnb-stock-weekly-review-0700-utc'"));
  assert.ok(sql.includes("cron.alter_job(stock_review_job_id, schedule := '5 7 * * 2')"));
  assert.ok(sql.includes("raise exception 'airbnb stock weekly review job is missing.'"));
});
