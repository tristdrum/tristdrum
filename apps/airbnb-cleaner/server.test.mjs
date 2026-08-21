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
  const server = createAirbnbCleanerServer(dependencies);
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

test("run persists and returns a sanitized receipt", async () => {
  await withServer({
    runReport: async ({ mode, deliveryAttemptId }) => {
      assert.match(deliveryAttemptId, /^[0-9a-f-]{36}$/);
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
  const dependencies = {
    runReport: async () => { throw new Error("safe test failure"); },
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
});
