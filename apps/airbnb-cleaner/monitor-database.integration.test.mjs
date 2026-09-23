import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const url = process.env.AIRBNB_INTEGRATION_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.search || parsed.hash) {
    throw new Error("Cleaner monitor integration tests require a 127.0.0.1 database URL without query overrides.");
  }
}

const TARGET_DATE = "2026-09-24";
const WINDOW_STARTED_AT = "2026-09-23T13:30:00+02:00";
const CHECKED_AT = "2026-09-23T14:20:00+02:00";
const SENT_AT = "2026-09-23T13:31:00+02:00";
const RETRY_STARTED_AT = "2026-09-23T13:40:00+02:00";
const RETRY_COMPLETED_AT = "2026-09-23T13:40:10+02:00";
const MESSAGE_HASH = "cleaner-monitor-september-24-fixture";

async function withFixture(callback) {
  const admin = postgres(url, { max: 1, prepare: false, connect_timeout: 5 });
  const rollback = new Error("Roll back cleaner monitor evidence fixtures");
  const ownerId = randomUUID();
  const householdId = randomUUID();
  const otherHouseholdId = randomUUID();
  try {
    await assert.rejects(admin.begin(async (sql) => {
      await sql`set local statement_timeout = '5s'`;
      await sql`insert into auth.users (id, email)
        values (${ownerId}, ${`${ownerId}@example.invalid`})`;
      await sql`insert into public.households (id, name, created_by) values
        (${householdId}, 'Cleaner monitor fixture', ${ownerId}),
        (${otherHouseholdId}, 'Other cleaner monitor fixture', ${ownerId})`;
      await callback({ sql, householdId, otherHouseholdId });
      throw rollback;
    }), (error) => error === rollback);
    const [remaining] = await admin`select
      exists(select 1 from auth.users where id = ${ownerId}) as owner,
      exists(select 1 from public.households where id in (${householdId}, ${otherHouseholdId})) as households,
      exists(select 1 from airbnb.cleaner_plans where household_id in (${householdId}, ${otherHouseholdId})) as plans,
      exists(select 1 from airbnb.job_runs where household_id in (${householdId}, ${otherHouseholdId})) as runs`;
    assert.deepEqual(remaining, { owner: false, households: false, plans: false, runs: false });
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function insertPlan({ sql, householdId }, overrides = {}) {
  const plan = {
    id: randomUUID(), householdId, runId: randomUUID(), targetDate: TARGET_DATE,
    mode: "live", status: "sent", messageHash: MESSAGE_HASH, confidence: { ok: true },
    startedAt: WINDOW_STARTED_AT, completedAt: SENT_AT, sentAt: SENT_AT,
    ...overrides,
  };
  await sql`insert into airbnb.cleaner_plans (
    id, household_id, run_id, target_date, mode, delivery_status, message_hash,
    confidence, started_at, completed_at, sent_at
  ) values (
    ${plan.id}, ${plan.householdId}, ${plan.runId}, ${plan.targetDate}, ${plan.mode},
    ${plan.status}, ${plan.messageHash}, ${sql.json(plan.confidence)},
    ${plan.startedAt}, ${plan.completedAt}, ${plan.sentAt}
  )`;
  return plan;
}

async function insertRun({ sql, householdId }, plan, overrides = {}) {
  const run = {
    id: randomUUID(), householdId, service: "cleaner", runId: randomUUID(),
    targetDate: TARGET_DATE, status: "duplicate_skipped",
    startedAt: RETRY_STARTED_AT, completedAt: RETRY_COMPLETED_AT,
    ...overrides,
  };
  run.receipt = {
    runId: run.runId, mode: "live", status: run.status, targetDate: run.targetDate,
    startedAt: run.startedAt, completedAt: run.completedAt,
    messageHash: MESSAGE_HASH, confidence: { ok: true },
    databaseSync: { status: "synced", cleanerPlanId: plan?.id ?? randomUUID() },
    whatsappVerification: { found: true },
    ...overrides.receipt,
  };
  await sql`insert into airbnb.job_runs (
    id, household_id, service, job_name, run_id, target_date, status,
    receipt, started_at, completed_at
  ) values (
    ${run.id}, ${run.householdId}, ${run.service}, 'scheduled-report', ${run.runId},
    ${run.targetDate}, ${run.status}, ${sql.json(run.receipt)}, ${run.startedAt}, ${run.completedAt}
  )`;
  return run;
}

async function evidence({ sql, householdId }, overrides = {}) {
  const query = { householdId, targetDate: TARGET_DATE, windowStartedAt: WINDOW_STARTED_AT,
    checkedAt: CHECKED_AT, ...overrides };
  const [row] = await sql`select internal.airbnb_cleaner_delivery_evidence(
    ${query.householdId}::uuid, ${query.targetDate}::date,
    ${query.windowStartedAt}::timestamptz, ${query.checkedAt}::timestamptz
  ) as evidence`;
  return row.evidence;
}

function assertRunEvidence(actual, run, state) {
  assert.equal(actual.state, state);
  assert.equal(actual.runId, run.runId);
  assert.deepEqual(actual.receipt, run.receipt);
  assert.equal(Date.parse(actual.startedAt), Date.parse(run.startedAt));
  if (run.completedAt === null) assert.equal(actual.completedAt, null);
  else assert.equal(Date.parse(actual.completedAt), Date.parse(run.completedAt));
}

test("cleaner monitor verifies the September 24 plan sent at 13:31 and duplicate retry at 13:40 SAST", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const plan = await insertPlan(fixture);
    const sent = await insertRun(fixture, plan, { runId: plan.runId, status: "sent",
      startedAt: WINDOW_STARTED_AT, completedAt: SENT_AT });
    const first = await evidence(fixture, { checkedAt: SENT_AT });
    assertRunEvidence(first, sent, "verified");
    assert.equal(first.planId, plan.id);

    const retry = await insertRun(fixture, plan);
    assert.notEqual(retry.runId, plan.runId);
    const result = await evidence(fixture);
    assertRunEvidence(result, retry, "verified");
    assert.equal(result.planId, plan.id);
    const [stored] = await fixture.sql`select run_id, sent_at from airbnb.cleaner_plans where id = ${plan.id}`;
    assert.equal(stored.run_id, sent.runId);
    assert.equal(stored.sent_at.toISOString(), new Date(SENT_AT).toISOString());
  });
});

test("cleaner monitor accepts a synced duplicate-skipped ledger row and inclusive checked-at boundary", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const plan = await insertPlan(fixture, { status: "duplicate_skipped", sentAt: CHECKED_AT,
      completedAt: CHECKED_AT });
    const run = await insertRun(fixture, plan, { startedAt: CHECKED_AT, completedAt: CHECKED_AT });
    const result = await evidence(fixture);
    assertRunEvidence(result, run, "verified");
    assert.equal(result.planId, plan.id);
  });
});

const invalidEvidence = [
  ["ledger belongs to another household", (f) => ({ plan: { householdId: f.otherHouseholdId } })],
  ["ledger has another target date", () => ({ plan: { targetDate: "2026-09-25" } })],
  ["ledger message hash differs", () => ({ plan: { messageHash: "other-plan-hash" } })],
  ["ledger is not live", () => ({ plan: { mode: "preview" } })],
  ["ledger has no sent time", () => ({ plan: { sentAt: null } })],
  ["ledger send is after the check", () => ({ plan: { sentAt: "2026-09-23T14:20:01+02:00" } })],
  ["ledger is blocked", () => ({ plan: { status: "blocked" } })],
  ["ledger confidence failed", () => ({ plan: { confidence: { ok: false } } })],
  ["ledger confidence is absent", () => ({ plan: { confidence: {} } })],
  ["ledger confidence is a string instead of true", () => ({ plan: { confidence: { ok: "true" } } })],
  ["receipt status disagrees with job status", () => ({ run: { receipt: { status: "sent" } } })],
  ["job status is not a delivery status", () => ({ run: { status: "success" } })],
  ["receipt target date disagrees with job date", () => ({ run: { receipt: { targetDate: "2026-09-25" } } })],
  ["receipt message hash is absent", () => ({ run: { receipt: { messageHash: null } } })],
  ["receipt confidence is absent", () => ({ run: { receipt: { confidence: {} } } })],
  ["receipt confidence is a string instead of true", () => ({ run: { receipt: { confidence: { ok: "true" } } } })],
  ["WhatsApp readback failed", () => ({ run: { receipt: { whatsappVerification: { found: false } } } })],
  ["WhatsApp readback is absent", () => ({ run: { receipt: { whatsappVerification: null } } })],
  ["WhatsApp readback is a string instead of true", () => ({ run: { receipt: { whatsappVerification: { found: "true" } } } })],
  ["database sync failed", () => ({ run: { receipt: { databaseSync: { status: "error" } } } })],
  ["database sync is absent", () => ({ run: { receipt: { databaseSync: null } } })],
  ["database sync plan ID is absent", () => ({ run: { receipt: { databaseSync: { status: "synced" } } } })],
  ["database sync plan ID is malformed", () => ({ run: { receipt: { databaseSync: { status: "synced", cleanerPlanId: "not-a-uuid" } } } })],
  ["database sync points at a missing plan", () => ({ run: { receipt: { databaseSync: { status: "synced", cleanerPlanId: randomUUID() } } } })],
];

for (const [reason, configure] of invalidEvidence) {
  test(`cleaner monitor is unverified when ${reason}`, { skip: !url }, async () => {
    await withFixture(async (fixture) => {
      const config = configure(fixture);
      const plan = await insertPlan(fixture, config.plan);
      const run = await insertRun(fixture, plan, config.run);
      assertRunEvidence(await evidence(fixture), run, "unverified");
    });
  });
}

test("cleaner monitor requires a ledger row even when the live receipt claims success", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const run = await insertRun(fixture, null);
    assertRunEvidence(await evidence(fixture), run, "unverified");
  });
});

const excludedRuns = [
  ["another household", (f) => ({ householdId: f.otherHouseholdId })],
  ["another target date", () => ({ targetDate: "2026-09-25" })],
  ["another service", () => ({ service: "stock" })],
  ["preview mode", () => ({ receipt: { mode: "preview" } })],
  ["shadow mode", () => ({ receipt: { mode: "shadow" } })],
  ["dry-run mode", () => ({ receipt: { mode: "dry-run" } })],
  ["absent mode", () => ({ receipt: { mode: null } })],
  ["a start before the window despite completing inside it", () => ({ startedAt: "2026-09-23T13:29:59+02:00" })],
  ["a start after the check", () => ({ startedAt: "2026-09-23T14:20:01+02:00", completedAt: "2026-09-23T14:20:10+02:00" })],
];

for (const [reason, configure] of excludedRuns) {
  test(`cleaner monitor ignores ${reason} without falling back to the delivered plan`, { skip: !url }, async () => {
    await withFixture(async (fixture) => {
      const plan = await insertPlan(fixture);
      await insertRun(fixture, plan, configure(fixture));
      const result = await evidence(fixture);
      assert.equal(result.state, "missing");
      assert.equal(result.runId ?? null, null);
      assert.equal(result.planId ?? null, null);
    });
  });
}

test("cleaner monitor reports missing when there is no run or plan", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const result = await evidence(fixture);
    assert.equal(result.state, "missing");
    assert.equal(result.runId ?? null, null);
    assert.equal(result.planId ?? null, null);
  });
});

test("cleaner monitor ignores newer preview and shadow blockers after a verified live run", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const plan = await insertPlan(fixture);
    const live = await insertRun(fixture, plan);
    for (const mode of ["preview", "shadow"]) {
      await insertRun(fixture, plan, { status: "blocked", startedAt: "2026-09-23T13:50:00+02:00",
        completedAt: "2026-09-23T13:50:10+02:00", receipt: { mode, confidence: { ok: false } } });
    }
    assertRunEvidence(await evidence(fixture), live, "verified");
  });
});

for (const [status, completedAt, state] of [
  ["blocked", "2026-09-23T13:50:10+02:00", "blocked"],
  ["error", "2026-09-23T13:50:10+02:00", "error"],
  ["started", null, "running"],
  ["sent", null, "running"],
  ["duplicate_skipped", "2026-09-23T14:20:01+02:00", "running"],
]) {
  test(`cleaner monitor gives a later ${status} run (${completedAt ?? "uncompleted"}) precedence over success`, { skip: !url }, async () => {
    await withFixture(async (fixture) => {
      const plan = await insertPlan(fixture);
      const success = await insertRun(fixture, plan);
      const latest = await insertRun(fixture, plan, { status, completedAt,
        startedAt: "2026-09-23T13:50:00+02:00", receipt: { previousSuccess: success.receipt } });
      assertRunEvidence(await evidence(fixture), latest, state);
    });
  });
}

test("cleaner monitor does not fall back to success when the newest completed receipt lacks readback", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const plan = await insertPlan(fixture);
    const success = await insertRun(fixture, plan);
    const latest = await insertRun(fixture, plan, { startedAt: "2026-09-23T13:50:00+02:00",
      completedAt: "2026-09-23T13:50:10+02:00",
      receipt: { whatsappVerification: { found: false }, previousSuccess: success.receipt } });
    assertRunEvidence(await evidence(fixture), latest, "unverified");
  });
});

for (const [reason, receipt, state] of [
  ["receipt confidence failed", { confidence: { ok: false } }, "blocked"],
  ["receipt reports blocked", { status: "blocked" }, "blocked"],
  ["receipt reports error", { status: "error" }, "error"],
]) {
  test(`cleaner monitor gives ${reason} precedence over an older success`, { skip: !url }, async () => {
    await withFixture(async (fixture) => {
      const plan = await insertPlan(fixture);
      const success = await insertRun(fixture, plan);
      const latest = await insertRun(fixture, plan, { startedAt: "2026-09-23T13:50:00+02:00",
        completedAt: "2026-09-23T13:50:10+02:00", receipt: { ...receipt, previousSuccess: success.receipt } });
      assertRunEvidence(await evidence(fixture), latest, state);
    });
  });
}

test("cleaner monitor evidence helper is stable, invoker-only, and usable in a read-only transaction", { skip: !url }, async () => {
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 5 });
  try {
    await sql.begin("read only", async (tx) => {
      const [definition] = await tx`select provolatile, prosecdef, pronargdefaults, proconfig,
        has_function_privilege('anon', oid, 'EXECUTE') as anon,
        has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated
        from pg_catalog.pg_proc
        where oid = 'internal.airbnb_cleaner_delivery_evidence(uuid,date,timestamptz,timestamptz)'::regprocedure`;
      assert.equal(definition.provolatile, "s");
      assert.equal(definition.prosecdef, false);
      assert.equal(definition.pronargdefaults, 1);
      assert.ok(definition.proconfig.includes('search_path=""'));
      assert.equal(definition.anon, false);
      assert.equal(definition.authenticated, false);
      const [result] = await tx`select internal.airbnb_cleaner_delivery_evidence(
        ${randomUUID()}::uuid, ${TARGET_DATE}::date, ${WINDOW_STARTED_AT}::timestamptz
      ) as evidence`;
      assert.equal(result.evidence.state, "missing");
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("cleaner monitor orders by run start, not completion or fixture insertion order", { skip: !url }, async () => {
  await withFixture(async (fixture) => {
    const plan = await insertPlan(fixture);
    const latest = await insertRun(fixture, plan);
    await insertRun(fixture, plan, { status: "blocked", startedAt: WINDOW_STARTED_AT,
      completedAt: "2026-09-23T14:00:00+02:00" });
    assertRunEvidence(await evidence(fixture), latest, "verified");
  });
});
