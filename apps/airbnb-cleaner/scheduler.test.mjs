import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(APP_DIR, "../../supabase/migrations");
const matches = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith("_airbnb_cleaner_scheduler.sql"));

assert.equal(matches.length, 1, "expected exactly one Airbnb cleaner scheduler migration");

const sql = readFileSync(resolve(MIGRATIONS_DIR, matches[0]), "utf8");
const normalized = sql.replace(/\s+/g, " ").trim();
const lowered = normalized.toLowerCase();

test("scheduler migration defines the proven six attempts and two monitors", () => {
  const attempts = [...sql.matchAll(
    /\(\s*'(airbnb-cleaner-[^']+)'\s*,\s*'([^']+)'\s*,\s*'(today|tomorrow)'\s*,\s*(true|false)\s*\)/gi,
  )].map((match) => match.slice(1));
  assert.deepEqual(attempts, [
    ["airbnb-cleaner-today-1000-utc", "0 10 * * *", "today", "false"],
    ["airbnb-cleaner-today-1010-utc", "10 10 * * *", "today", "false"],
    ["airbnb-cleaner-today-1020-utc-final", "20 10 * * *", "today", "true"],
    ["airbnb-cleaner-tomorrow-1130-utc", "30 11 * * *", "tomorrow", "false"],
    ["airbnb-cleaner-tomorrow-1140-utc", "40 11 * * *", "tomorrow", "false"],
    ["airbnb-cleaner-tomorrow-1150-utc-final", "50 11 * * *", "tomorrow", "true"],
  ]);

  const monitors = [...sql.matchAll(
    /\(\s*'(airbnb-cleaner-(?:today|tomorrow)-monitor-[^']+)'\s*,\s*'([^']+)'\s*,\s*(0|1)\s*,\s*'(today|tomorrow)'\s*\)/gi,
  )].map((match) => match.slice(1));
  assert.deepEqual(monitors, [
    ["airbnb-cleaner-today-monitor-1050-utc", "50 10 * * *", "0", "today"],
    ["airbnb-cleaner-tomorrow-monitor-1220-utc", "20 12 * * *", "1", "tomorrow"],
  ]);
});

test("scheduler migration targets only the personal runtime and named Vault secrets", () => {
  assert.equal((sql.match(/https:\/\/tristdrum-airbnb-cleaner\.fly\.dev\/run/g) ?? []).length, 1);
  assert.match(lowered, /https:\/\/tristdrum-airbnb-cleaner\.fly\.dev\/status\?date=/);
  assert.doesNotMatch(lowered, /mincool-airbnb-cleaner\.fly\.dev/);
  assert.ok(lowered.includes("where name = 'tristdrum_airbnb_cleaner_scheduler_secret'"));
  assert.ok(lowered.includes("where name = 'tristdrum_airbnb_cleaner_monitor_config'"));
  assert.ok(lowered.match(/tristdrum_airbnb_cleaner_scheduler_secret/g)?.length >= 2);
  assert.ok(!lowered.includes("vault.create_secret"));
  assert.ok(!lowered.includes("bearer"));
});

test("scheduler migration keeps jobs inactive until the guarded cutover", () => {
  assert.ok(lowered.includes("create extension if not exists pg_cron;"));
  assert.ok(lowered.includes("create extension if not exists pg_net;"));
  assert.ok(lowered.includes("create extension if not exists http with schema extensions;"));
  assert.ok(lowered.includes("cron.schedule("));
  assert.ok(lowered.includes("cron.alter_job(job_id, active := false)"));
  assert.doesNotMatch(lowered, /\b(?:insert into|update|delete from) cron\.job\b/);
});

test("independent monitor checks success, blockers, and verified private alerts", () => {
  for (const expected of [
    "create or replace function internal.monitor_airbnb_cleaner",
    "'sent', 'duplicate_skipped'",
    "coalesce(receipt_status, '') <> 'blocked'",
    "receipt -> 'previoussuccess'",
    "successful_receipt_started_at >= window_started_at",
    "blocked by an occupancy confidence check",
    "for alert_attempt in 1..3 loop",
    "pg_catalog.pg_sleep(alert_attempt * 2)",
    "idempotency_key || ':attempt-' || alert_attempt",
    "alert_url || '?limit=20'",
    "outbound.message ->> 'from_me'",
    "outbound.message ->> 'text' = alert_text",
    "'verifiedfromchat', true",
    "time '12:00'",
    "time '13:30'",
    "revoke all on function internal.monitor_airbnb_cleaner",
  ]) {
    assert.ok(lowered.includes(expected), `missing monitor contract: ${expected}`);
  }
  assert.ok(normalized.includes("'X-Airbnb-Cleaner-Scheduler-Secret'"));
  assert.ok(normalized.includes("'mode', 'live'"));
  assert.ok(normalized.includes("'target', %L"));
  assert.ok(normalized.includes("'finalAttempt', %s"));
  assert.ok(normalized.includes("timeout_milliseconds := 180000"));
});
