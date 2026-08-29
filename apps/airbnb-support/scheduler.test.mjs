import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260825125026_airbnb_support_live.sql", import.meta.url),
  "utf8",
);
const flyConfig = readFileSync(new URL("./fly.toml", import.meta.url), "utf8");

test("support live scheduler retires shadow polling and uses the guarded live endpoint", () => {
  assert.match(migration, /airbnb-support-shadow-poll-5m/);
  assert.match(migration, /alter_job\(shadow_job_id, active := false\)/);
  assert.match(migration, /airbnb-support-live-poll-5m/);
  assert.match(migration, /body := '\{"mode":"live"\}'::jsonb/);
  assert.match(migration, /alter_job\([\s\S]*live_job_id[\s\S]*active := true/);
  assert.doesNotMatch(migration, /\b(?:insert into|update|delete from)\s+cron\.job\b/i);
});

test("the five-minute support watcher keeps one Fly machine warm", () => {
  assert.match(flyConfig, /min_machines_running\s*=\s*1/);
});

test("the production Gmail import allows bounded transient latency", () => {
  assert.match(flyConfig, /AIRBNB_SUPPORT_GMAIL_IMPORT_DEADLINE_MS\s*=\s*"45000"/);
  assert.match(flyConfig, /AIRBNB_SUPPORT_GMAIL_OVERLAP_MINUTES\s*=\s*"360"/);
  assert.match(flyConfig, /AIRBNB_SUPPORT_GMAIL_ATTEMPTS\s*=\s*"2"/);
});
