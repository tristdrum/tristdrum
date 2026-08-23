import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(APP_DIR, "../../supabase/migrations");
const migrationPath = readdirSync(MIGRATIONS_DIR).find(
  (name) => name.endsWith("_airbnb_release_safety_followup.sql"),
);

assert.ok(migrationPath, "expected Airbnb release safety follow-up migration");
const sql = readFileSync(resolve(MIGRATIONS_DIR, migrationPath), "utf8")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

test("weekly review has two idempotent attempts before regular stock polling begins", () => {
  assert.ok(sql.includes("jobname = 'airbnb-stock-weekly-review-0700-utc'"));
  assert.ok(sql.includes("cron.alter_job(stock_review_job_id, schedule := '0,20 4 * * 2')"));
  assert.ok(sql.includes("raise exception 'airbnb stock scheduler inventory is incomplete.'"));
});

test("Management runs halfway between ordinary observation polls", () => {
  assert.ok(sql.includes("jobname = 'airbnb-stock-management-alerts-10-40'"));
  assert.ok(sql.includes("cron.alter_job(stock_management_job_id, schedule := '15,45 5-19 * * *')"));
  assert.ok(sql.includes("set lock_timeout = '5s'"));
  assert.ok(sql.includes("set statement_timeout = '60s'"));
});
