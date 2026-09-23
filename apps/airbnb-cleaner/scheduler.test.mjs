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
const hardeningPath = readdirSync(MIGRATIONS_DIR).find(
  (name) => name.endsWith("_airbnb_operational_hardening.sql"),
);
assert.ok(hardeningPath, "expected Airbnb operational hardening migration");
const hardeningSql = readFileSync(resolve(MIGRATIONS_DIR, hardeningPath), "utf8");
const hardeningNormalized = hardeningSql.replace(/\s+/g, " ").trim();
const hardeningLowered = hardeningNormalized.toLowerCase();

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

test("monitor hardening requires readback after every send result and reuses one live key", () => {
  for (const expected of [
    "failurealert' ->> 'verifiedfromchat'",
    "('idempotency-key', idempotency_key)::extensions.http_header",
    "alert_url || '?limit=20'",
    "outbound.message ->> 'from_me'",
    "outbound.message ->> 'text' = alert_text",
    "'verifiedfromchat', true",
    "alert was not found in chat after all retries",
  ]) {
    assert.ok(hardeningLowered.includes(expected), `missing hardening contract: ${expected}`);
  }
  assert.doesNotMatch(hardeningLowered, /idempotency_key\s*\|\|\s*':attempt-'/);
  assert.doesNotMatch(hardeningLowered, /'alerted',\s*true\s*\)\s*;\s*end/);
});

const evidenceMigrations = readdirSync(MIGRATIONS_DIR).filter(
  (name) => name.endsWith("_airbnb_cleaner_monitor_evidence.sql"),
);
assert.equal(evidenceMigrations.length, 1, "expected exactly one cleaner monitor evidence migration");
const evidenceSql = readFileSync(resolve(MIGRATIONS_DIR, evidenceMigrations[0]), "utf8");
const helperDefinition = evidenceSql.match(
  /create or replace function internal\.airbnb_cleaner_delivery_evidence\([\s\S]*?\$function\$;/i,
)?.[0];
const monitorDefinition = evidenceSql.match(
  /create or replace function internal\.monitor_airbnb_cleaner\([\s\S]*?\$function\$;/i,
)?.[0];

test("evidence migration defines a stable SQL-only helper without writes, secrets, or network access", () => {
  assert.ok(helperDefinition, "expected the new delivery evidence helper");
  assert.match(helperDefinition, /checked_at timestamptz default now\(\)/i);
  assert.match(helperDefinition, /language plpgsql\s+stable\s+set search_path = ''/i);
  assert.doesNotMatch(helperDefinition, /\bsecurity\s+definer\b/i);
  assert.match(helperDefinition, /from airbnb\.job_runs\b/i);
  assert.match(helperDefinition, /from airbnb\.cleaner_plans\b/i);
  assert.doesNotMatch(helperDefinition, /\b(?:insert|update|delete|merge|truncate|execute|perform)\b/i);
  assert.doesNotMatch(helperDefinition, /\b(?:net|extensions|vault|cron)\./i);
  assert.doesNotMatch(helperDefinition, /https?:\/\//i);
  assert.match(evidenceSql, /revoke all on function internal\.airbnb_cleaner_delivery_evidence\(uuid, date, timestamptz, timestamptz\)\s+from public, anon, authenticated/i);
  assert.doesNotMatch(evidenceSql, /\bcron\./i);
});

test("evidence monitor returns database verification before reading secrets or making HTTP requests", () => {
  assert.ok(monitorDefinition, "expected the replacement monitor");
  const normalizedMonitor = monitorDefinition.replace(/\s+/g, " ").toLowerCase();
  assert.ok(normalizedMonitor.includes("count(distinct identity.household_id) = 1"));
  assert.ok(normalizedMonitor.includes("where identity.service = 'cleaner'"));
  const verified = normalizedMonitor.indexOf("if database_state = 'verified' then");
  const returned = normalizedMonitor.indexOf("return pg_catalog.jsonb_build_object", verified);
  const secrets = normalizedMonitor.indexOf("from vault.decrypted_secrets");
  const http = normalizedMonitor.indexOf("from extensions.http(");
  assert.ok(verified >= 0 && returned > verified && secrets > returned && http > returned);
  assert.match(normalizedMonitor.slice(returned, secrets), /'evidencesource', 'database'/);
  assert.match(normalizedMonitor.slice(returned, secrets), /'alerted', false/);
  assert.match(normalizedMonitor, /if database_state in \('blocked', 'error', 'unverified', 'running'\) then receipt := database_evidence -> 'receipt';/);
  assert.match(normalizedMonitor, /else begin select response\.\* into status_response from extensions\.http/);
  assert.match(normalizedMonitor, /coalesce\(receipt_status, ''\) not in \('blocked', 'error', 'unverified', 'running'\)/);
});

test("evidence monitor describes unconfirmed delivery without claiming the schedule did not run", () => {
  assert.ok(monitorDefinition);
  assert.match(monitorDefinition, /a successful, verified delivery for this cleaning window could not be confirmed/i);
  assert.match(monitorDefinition, /Check the delivery records before sending another plan/);
  assert.doesNotMatch(monitorDefinition, /(?:schedule|scheduled run).*(?:did not run|has not run|missing)/i);
});
