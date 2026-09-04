import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "airbnb-cleaner-server-"));
process.env.AIRBNB_CLEANER_HOME = dataDir;
process.env.AIRBNB_CLEANER_SCHEDULER_SECRET = "test-scheduler-secret";

const { createAirbnbCleanerServer } = await import("./server.mjs");

after(() => rmSync(dataDir, { recursive: true, force: true }));

function successfulResult(mode = "live", targetDate = "2026-08-07") {
  return {
    status: mode === "preview" ? "preview" : "sent",
    mode,
    targetDate,
    targetDay: "Friday",
    unitReports: [{
      unit: "Unit 1",
      action: "turnover",
      arrivals: ["Private Guest (2 adults)"],
      checkouts: ["Another Guest (1 adult)"],
      stayovers: [],
    }],
    reservationsParsed: 2,
    envelopesFound: 3,
    envelopesRead: 3,
    searchAfterDate: "2026-05-09",
    weather: { available: true, rainPossible: false },
    confidence: { ok: true, blockers: [], warnings: [] },
    messageHash: "0123456789abcdef",
    legacyMessageHash: "fedcba9876543210",
    isUpdate: false,
    idempotencyKey: "contains-private-chat-id",
    message: "full private cleaner message",
    chatRead: { ok: true, messageCount: 4 },
    whatsappDryRun: { status: 200, dryRun: true, attempts: 1, body: { private: true } },
    whatsappLiveSend: { status: 200, dryRun: false, attempts: 1, body: { private: true } },
    whatsappVerification: { found: true, attempts: 1 },
  };
}

async function withServer(dependencies, callback) {
  const server = createAirbnbCleanerServer({
    loadDatabaseLedger: async () => ({ status: "disabled", records: [] }),
    loadReservations: async () => ({ status: "loaded", reservations: [] }),
    ...dependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Airbnb-Cleaner-Scheduler-Secret": "test-scheduler-secret",
  };
}

test("health is public while run and status require scheduler authentication", async () => {
  await withServer({ runReport: async () => successfulResult() }, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "airbnb-cleaner" });

    const run = await fetch(`${baseUrl}/run`, { method: "POST", body: "{}" });
    assert.equal(run.status, 401);
    const status = await fetch(`${baseUrl}/status`);
    assert.equal(status.status, 401);
  });
});

test("a loaded Supabase ledger is authoritative for the report run", async () => {
  const ledgerRecord = {
    targetDate: "2026-08-07",
    messageHash: "0123456789abcdef",
    sentAt: "2026-08-06T11:30:00.000Z",
    source: "supabase",
  };
  let received;
  await withServer({
    sharedLedgerRequired: true,
    loadDatabaseLedger: async ({ targetDate }) => {
      assert.equal(targetDate, "2026-08-07");
      return { status: "loaded", records: [ledgerRecord] };
    },
    runReport: async (options) => {
      received = options;
      return successfulResult(options.mode, options.targetDate);
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-07" }),
    });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(received.authoritativeLedgerRecords, [ledgerRecord]);
});

test("live delivery fails closed when its required Supabase ledger is unavailable", async () => {
  let reportCalled = false;
  await withServer({
    sharedLedgerRequired: true,
    loadDatabaseLedger: async () => ({ status: "disabled", records: [] }),
    runReport: async () => {
      reportCalled = true;
      return successfulResult();
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-07" }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).status, "error");
  });
  assert.equal(reportCalled, false);
});

test("a cleaner timing-note read failure blocks the report", async () => {
  let reportCalled = false;
  await withServer({
    loadOperationalNotes: async () => { throw new Error("safe timing-note test failure"); },
    runReport: async () => {
      reportCalled = true;
      return successfulResult();
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-07" }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).status, "error");
  });
  assert.equal(reportCalled, false);
});

test("stored reservations reach the report and appear only as a count in the receipt", async () => {
  const storedReservations = [{ sourceEnvelopeId: "database:private-booking", guestName: "Private Baseline Guest" }];
  await withServer({
    loadReservations: async ({ targetDate }) => {
      assert.equal(targetDate, "2026-09-04");
      return { status: "loaded", reservations: storedReservations };
    },
    runReport: async (options) => {
      assert.deepEqual(options.storedReservations, storedReservations);
      return successfulResult(options.mode, options.targetDate);
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-09-04" }),
    });
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.deepEqual(receipt.reservationBaseline, { status: "loaded", count: 1 });
    assert.doesNotMatch(JSON.stringify(receipt), /Private Baseline Guest|private-booking/);
  });
});

test("live delivery fails closed when required stored reservations cannot be loaded", async () => {
  for (const loadReservations of [
    async () => ({ status: "disabled", reservations: [] }),
    async () => { throw new Error("reservation baseline unavailable"); },
  ]) {
    let reportCalled = false;
    await withServer({
      sharedLedgerRequired: true,
      loadDatabaseLedger: async () => ({ status: "loaded", records: [] }),
      loadReservations,
      runReport: async () => { reportCalled = true; return successfulResult(); },
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/run`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ mode: "live", target: "2026-09-04" }),
      });
      assert.equal(response.status, 500);
      assert.equal(reportCalled, false);
    });
  }
});

test("run persists and returns a sanitized receipt", async () => {
  await withServer({
    runReport: async ({ mode, deliveryAttemptId }) => {
      assert.equal(deliveryAttemptId, undefined);
      return successfulResult(mode);
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-07", finalAttempt: false }),
    });
    assert.equal(response.status, 200);
    const receipt = await response.json();
    const serialized = JSON.stringify(receipt);
    assert.equal(receipt.status, "sent");
    assert.equal(receipt.units[0].arrivalCount, 1);
    assert.doesNotMatch(serialized, /Private Guest|Another Guest|full private|chat-id|private/);

    const status = await fetch(`${baseUrl}/status?date=2026-08-07`, { headers: authHeaders() });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).messageHash, "0123456789abcdef");
  });
});

test("only a final failed attempt sends the private failure alert", async () => {
  const alerts = [];
  const mirroredFailures = [];
  const dependencies = {
    runReport: async () => { throw new Error("safe test failure"); },
    syncFailureDatabase: async ({ receipt }) => {
      mirroredFailures.push(receipt);
      return { status: "synced", jobRunId: `job-${mirroredFailures.length}` };
    },
    sendFinalFailureAlert: async (value) => {
      alerts.push(value);
      return { sent: true, attempts: 1 };
    },
  };
  await withServer(dependencies, async (baseUrl) => {
    for (const finalAttempt of [false, true]) {
      const response = await fetch(`${baseUrl}/run`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mode: "live", target: "2026-08-07", finalAttempt }),
      });
      assert.equal(response.status, 500);
    }
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].targetDate, "2026-08-07");
  assert.equal(alerts[0].reason, "delivery");
  assert.equal(mirroredFailures.length, 2);
  assert.equal(mirroredFailures.every((receipt) => receipt.status === "error"), true);
});

test("a concurrent final RUN_IN_PROGRESS response never sends a private failure alert", async () => {
  const alerts = [];
  const mirroredFailures = [];
  let startRun;
  let finishRun;
  const runStarted = new Promise((resolve) => { startRun = resolve; });
  const runCanFinish = new Promise((resolve) => { finishRun = resolve; });
  const dependencies = {
    runReport: async ({ mode, targetDate }) => {
      startRun();
      await runCanFinish;
      return successfulResult(mode, targetDate);
    },
    sendFinalFailureAlert: async (value) => {
      alerts.push(value);
      return { sent: true, attempts: 1 };
    },
    syncFailureDatabase: async ({ receipt }) => {
      mirroredFailures.push(receipt);
      return { status: "synced" };
    },
  };

  await withServer(dependencies, async (baseUrl) => {
    const activeRun = fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-10" }),
    });
    await runStarted;

    const overlappingFinal = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-10", finalAttempt: true }),
    });
    assert.equal(overlappingFinal.status, 409);
    assert.equal((await overlappingFinal.json()).error.code, "RUN_IN_PROGRESS");
    const statusDuringActiveRun = await fetch(`${baseUrl}/status?date=2026-08-10`, { headers: authHeaders() });
    assert.equal(statusDuringActiveRun.status, 404);

    finishRun();
    assert.equal((await activeRun).status, 200);
  });

  assert.equal(alerts.length, 0);
  assert.equal(mirroredFailures.length, 0);
});

test("a final successful delivery privately alerts when its database mirror still fails", async () => {
  const alerts = [];
  const dependencies = {
    runReport: async () => successfulResult("live", "2026-08-08"),
    syncDatabase: async () => { throw new Error("safe database test failure"); },
    sendFinalFailureAlert: async (value) => {
      alerts.push(value);
      return { sent: true, attempts: 1 };
    },
  };
  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-08", finalAttempt: true }),
    });
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.status, "sent");
    assert.equal(receipt.databaseSync.status, "error");
    assert.equal(receipt.failureAlert.sent, true);
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].targetDate, "2026-08-08");
  assert.equal(alerts[0].reason, "database_sync");
});

test("status remains degraded when both the database mirror and its private alert fail", async () => {
  const dependencies = {
    runReport: async () => successfulResult("live", "2026-08-09"),
    syncDatabase: async () => { throw new Error("safe database test failure"); },
    sendFinalFailureAlert: async () => { throw new Error("safe alert test failure"); },
  };
  await withServer(dependencies, async (baseUrl) => {
    const run = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "2026-08-09", finalAttempt: true }),
    });
    assert.equal(run.status, 200);
    const status = await fetch(`${baseUrl}/status?date=2026-08-09`, { headers: authHeaders() });
    assert.equal(status.status, 503);
    const receipt = await status.json();
    assert.equal(receipt.status, "sent");
    assert.equal(receipt.databaseSync.status, "error");
    assert.equal(receipt.failureAlert.sent, false);
  });
});

test("relative final failures keep their calendar status and an earlier success", async () => {
  const targetDate = "2030-01-15";
  const fixedNow = new Date("2030-01-15T08:00:00.000Z");
  const alerts = [];
  let fail = false;
  const dependencies = {
    now: () => fixedNow,
    runReport: async ({ mode, targetDate: requestedTargetDate }) => {
      assert.equal(requestedTargetDate, targetDate);
      if (fail) throw new Error("safe relative-target failure");
      return successfulResult(mode, requestedTargetDate);
    },
    sendFinalFailureAlert: async (value) => {
      alerts.push(value);
      return { sent: true, attempts: 1 };
    },
  };

  await withServer(dependencies, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "today" }),
    });
    assert.equal(first.status, 200);

    fail = true;
    const finalFailure = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "today", finalAttempt: true }),
    });
    assert.equal(finalFailure.status, 500);

    const status = await fetch(`${baseUrl}/status?date=${targetDate}`, { headers: authHeaders() });
    assert.equal(status.status, 200);
    const receipt = await status.json();
    assert.equal(receipt.targetDate, targetDate);
    assert.equal(receipt.status, "error");
    assert.equal(receipt.failureAlert.sent, true);
    assert.equal(receipt.previousSuccess.status, "sent");
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].targetDate, targetDate);
  assert.equal(alerts[0].reason, "delivery");
});

test("a final retry failure does not alert after success in the same window", async () => {
  const targetDate = "2030-01-16";
  let currentTime = new Date("2030-01-16T10:00:00.000Z");
  const alerts = [];
  let fail = false;
  const dependencies = {
    now: () => currentTime,
    runReport: async ({ mode, targetDate: requestedTargetDate }) => {
      if (fail) throw new Error("safe later retry failure");
      return successfulResult(mode, requestedTargetDate);
    },
    sendFinalFailureAlert: async (value) => {
      alerts.push(value);
      return { sent: true, attempts: 1 };
    },
  };

  await withServer(dependencies, async (baseUrl) => {
    const success = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "today" }),
    });
    assert.equal(success.status, 200);

    fail = true;
    currentTime = new Date("2030-01-16T10:20:00.000Z");
    const finalFailure = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "today", finalAttempt: true }),
    });
    assert.equal(finalFailure.status, 500);

    const status = await fetch(`${baseUrl}/status?date=${targetDate}`, { headers: authHeaders() });
    const receipt = await status.json();
    assert.equal(receipt.previousSuccess.status, "sent");
    assert.equal(receipt.failureAlert, undefined);
  });

  assert.equal(alerts.length, 0);
});

test("a final semantic blocker alerts even after an earlier success", async () => {
  const targetDate = "2030-01-17";
  const fixedNow = new Date("2030-01-17T10:20:00.000Z");
  const alerts = [];
  let blocked = false;
  const dependencies = {
    now: () => fixedNow,
    runReport: async ({ mode, targetDate: requestedTargetDate }) => {
      const result = successfulResult(mode, requestedTargetDate);
      if (!blocked) return result;
      return {
        ...result,
        status: "blocked",
        confidence: { ok: false, blockers: ["Unit 3: impossible occupancy overlap."], warnings: [] },
      };
    },
    sendFinalFailureAlert: async (value) => {
      alerts.push(value);
      return { sent: true, attempts: 1 };
    },
  };

  await withServer(dependencies, async (baseUrl) => {
    const success = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "today" }),
    });
    assert.equal(success.status, 200);

    blocked = true;
    const finalBlocked = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "live", target: "today", finalAttempt: true }),
    });
    assert.equal(finalBlocked.status, 422);

    const status = await fetch(`${baseUrl}/status?date=${targetDate}`, { headers: authHeaders() });
    const receipt = await status.json();
    assert.equal(receipt.status, "blocked");
    assert.equal(receipt.previousSuccess.status, "sent");
    assert.equal(receipt.failureAlert.sent, true);
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].targetDate, targetDate);
  assert.equal(alerts[0].reason, "blocked");
});
