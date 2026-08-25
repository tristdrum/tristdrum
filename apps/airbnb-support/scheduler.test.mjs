import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260825125026_airbnb_support_live.sql", import.meta.url),
  "utf8",
);

test("support live scheduler retires shadow polling and uses the guarded live endpoint", () => {
  assert.match(migration, /airbnb-support-shadow-poll-5m/);
  assert.match(migration, /alter_job\(shadow_job_id, active := false\)/);
  assert.match(migration, /airbnb-support-live-poll-5m/);
  assert.match(migration, /body := '\{"mode":"live"\}'::jsonb/);
  assert.match(migration, /alter_job\([\s\S]*live_job_id[\s\S]*active := true/);
  assert.doesNotMatch(migration, /\b(?:insert into|update|delete from)\s+cron\.job\b/i);
});
