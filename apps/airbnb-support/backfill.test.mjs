import assert from "node:assert/strict";
import test from "node:test";
import { backfillSupportHistory } from "./backfill.mjs";

test("historical import requires the live support schedule to be paused", async () => {
  await assert.rejects(
    backfillSupportHistory({ env: {}, database: { close: async () => {} } }),
    /RUN_WITH_SUPPORT_SCHEDULE_PAUSED/,
  );
});
