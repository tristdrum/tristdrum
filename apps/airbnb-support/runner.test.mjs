import assert from "node:assert/strict";
import test from "node:test";
import { collectBookingLifecycleMessages, collectConversationMessages } from "./gmail.mjs";
import { verifiedLiveWebsiteFacts } from "./live-website-facts.mjs";

import {
  actionableOperationalRequests,
  applyReplyRouteGuard,
  canReuseStoredDecision,
  collectWithTransientMailboxRetry,
  earlierOfRecentCursor,
  mailboxFailureDiagnostic,
  runSupport,
  summarizeDeliveryOutcomes,
  transientMailboxError,
} from "./runner.mjs";

const liveDecision = {
  decisionSource: "adaptive_agent",
  decisionVersion: 3,
  shadowMode: false,
};

function emptyMailboxDatabase({ evidence = {}, scans = {} } = {}) {
  const receipts = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    const scope = values.includes("jane") ? "jane" : "tristan";
    if (/select max\(occurred_at\)/.test(query)) return [{ latest: evidence[scope] ?? null }];
    if (/select max\(started_at\)/.test(query)) return [{ latest: scans[scope] ?? null }];
    if (query.includes("update airbnb.job_runs")) {
      receipts.push(...values.filter((value) => value?.schemaVersion === 1));
    }
    return [];
  };
  sql.begin = async (callback) => callback(sql);
  sql.json = (value) => value;
  return { sql, receipts, householdId: async () => "22222222-2222-4222-8222-222222222222" };
}

const configuredJane = {
  AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.invalid",
  AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "local-test-only",
};

for (const mailbox of ["canonical", "supplemental", "lifecycle"]) {
  test(`${mailbox} SEARCH failure cannot become a successful empty mailbox watermark`, async () => {
    const database = emptyMailboxDatabase();
    let failedSearches = 0;
    const createClient = () => ({
      usable: true,
      async connect() {},
      async getMailboxLock() { return { release() {} }; },
      async search() { failedSearches += 1; return false; },
      async logout() {},
      close() {},
    });
    const run = runSupport({
      database,
      env: {
        ...configuredJane,
        AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test",
        AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "test-only",
      },
      collectMessages: async (options) => {
        if ((mailbox === "canonical" && options.mailboxScope === "tristan")
          || (mailbox === "supplemental" && options.mailboxScope === "jane")) {
          return collectConversationMessages({ ...options, createClient });
        }
        return { messages: [], envelopesFound: 0 };
      },
      collectLifecycleMessages: async (options) => mailbox === "lifecycle"
        ? collectBookingLifecycleMessages({ ...options, createClient })
        : { messages: [], envelopesFound: 0 },
      decide: async () => assert.fail("No guest decision is needed for this fixture."),
    });
    if (mailbox === "supplemental") {
      const receipt = await run;
      assert.equal(receipt.supplementalMailboxStatus.status, "error");
      assert.equal(receipt.autonomousRepliesEnabled, false);
    } else {
      await assert.rejects(run, { code: "IMAP_SEARCH_FAILED" });
      assert.equal(database.receipts[0].status, "error");
    }
    assert.equal(failedSearches, 1, "an unclassified SEARCH failure is not automatically retried");
    assert.ok(database.receipts[0].mailboxFailures.some((failure) =>
      failure.mailbox === mailbox && failure.code === "IMAP_SEARCH_FAILED"));
  });
}

test("empty Jane mailbox resumes from a successful scan instead of repeating first import", async () => {
  const startedAt = new Date("2026-09-11T13:20:00.000Z");
  const database = emptyMailboxDatabase({ scans: { jane: "2026-09-11T13:15:00.000Z" } });
  const imports = [];
  const receipt = await runSupport({
    now: () => startedAt,
    database,
    env: configuredJane,
    collectMessages: async ({ mailboxScope, since }) => {
      imports.push({ mailboxScope, since: since.toISOString() });
      return { messages: [], envelopesFound: 0 };
    },
    collectLifecycleMessages: async () => ({ messages: [], envelopesFound: 0 }),
    decide: async () => assert.fail("An empty mailbox must not invoke the model."),
  });

  assert.equal(imports.find((item) => item.mailboxScope === "jane").since, "2026-09-11T07:15:00.000Z");
  assert.equal(imports.find((item) => item.mailboxScope === "tristan").since, "2026-06-13T13:20:00.000Z");
  assert.equal(receipt.supplementalSearchSince, "2026-09-11T07:15:00.000Z");
  assert.equal(database.receipts[0].supplementalSearchSince, receipt.supplementalSearchSince);
});

test("a new support decision receives optional live facts without a browser action or guest send", async () => {
  const candidate = {
    id: "thread-1", providerThreadId: "airbnb-thread-1", sourceFingerprint: "fingerprint-1",
    latestEventAt: "2026-09-24T10:00:00.000Z", guestMessage: "Is my booking confirmed?",
    guestDisplayName: "Guest", listingName: "Jasmine Studio Stay", facts: {},
    stayLabel: "Oct 5 - 7, 2026", replyCapable: true,
    existingDecision: null, conversationContext: [],
  };
  const websiteFacts = { source: "airbnb_ui", providerThreadId: "airbnb-thread-1",
    observedAt: "2026-09-24T10:04:00.000Z",
    reservation: { listingName: "Jasmine Studio Stay", checkIn: "2026-10-05",
      checkOut: "2026-10-07", status: "confirmed", verified: true, complete: true } };
  const database = emptyMailboxDatabase();
  const originalSql = database.sql;
  database.sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("from airbnb.guest_threads thread")) return [candidate];
    if (query.includes("insert into airbnb.reply_deliveries")) return [{ id: "delivery-1", status: "needs_approval" }];
    return originalSql(strings, ...values);
  };
  database.sql.begin = async (callback) => callback(database.sql);
  database.sql.json = (value) => value;
  let readerCalls = 0;
  let decisionCalls = 0;
  let clockCalls = 0;
  const receipt = await runSupport({
    database, now: () => new Date(clockCalls++ === 0
      ? "2026-09-24T10:00:00.000Z" : "2026-09-24T10:05:00.000Z"),
    collectMessages: async () => ({ messages: [], envelopesFound: 0 }),
    collectLifecycleMessages: async () => ({ messages: [], envelopesFound: 0 }),
    loadLiveWebsiteFacts: async ({ candidate: selected, now }) => {
      readerCalls += 1;
      assert.equal(selected.id, candidate.id);
      assert.equal(now.toISOString(), "2026-09-24T10:05:00.000Z");
      return websiteFacts;
    },
    decide: async ({ liveWebsiteFacts, providerThreadId, now }) => {
      decisionCalls += 1;
      assert.equal(providerThreadId, candidate.providerThreadId);
      assert.deepEqual(liveWebsiteFacts, websiteFacts);
      assert.equal(now.toISOString(), "2026-09-24T10:05:00.000Z");
      assert.ok(verifiedLiveWebsiteFacts(liveWebsiteFacts,
        { providerThreadId, listingName: candidate.listingName, now }));
      return { topic: "adaptive_support", riskTier: "low", replyNeeded: true,
        summary: "Verified answer.", draft: "The booking is confirmed.",
        decisionSource: "adaptive_agent", decisionVersion: 3,
        autoReply: true, status: "approved_for_guard", alertManagement: false };
    },
  });
  assert.equal(readerCalls, 1);
  assert.equal(decisionCalls, 1);
  assert.equal(receipt.deliveredReplyCount, 0);
});

test("Ping retries run without new guest mail and cannot send in shadow mode", async () => {
  for (const mode of ["shadow", "live"]) {
    const database = emptyMailboxDatabase();
    const calls = [];
    const receipt = await runSupport({ mode, database,
      env: { ...configuredJane, AIRBNB_SUPPORT_EXTERNAL_WRITES_ENABLED: "true",
        AIRBNB_SUPPORT_LIVE_CONFIRMATION: "ENABLE_AIRBNB_SUPPORT_WRITES",
        AIRBNB_SUPPORT_MANAGEMENT_ALERTS_ENABLED: "true" },
      retryManagementPings: async ({limit}) => {
        calls.push("ping"); assert.equal(limit, 1);
        return {notifications: [{pingStatus: "accepted"}], error: null};
      },
      collectMessages: async () => { calls.push("mail"); return {messages: [], envelopesFound: 0}; },
      collectLifecycleMessages: async () => ({messages: [], envelopesFound: 0}),
      notifyManagement: async () => [],
    });
    assert.equal(receipt.managementPingAcceptedCount, mode === "live" ? 1 : 0);
    if (mode === "live") assert.equal(calls[0], "ping");
    else assert.ok(!calls.includes("ping"));
  }
});

test("selected Jane searchSince survives a failed whole run with unchanged two-attempt retry", async () => {
  const database = emptyMailboxDatabase({ scans: { jane: "2026-09-11T13:15:00.000Z" } });
  let canonicalAttempts = 0;
  await assert.rejects(runSupport({
    now: () => new Date("2026-09-11T13:20:00.000Z"),
    database,
    env: configuredJane,
    collectMessages: async ({ mailboxScope }) => {
      if (mailboxScope === "jane") return { messages: [], envelopesFound: 0 };
      canonicalAttempts += 1;
      throw Object.assign(new Error("Local timeout fixture"), { code: "IMAP_IMPORT_DEADLINE" });
    },
    collectLifecycleMessages: async () => assert.fail("Canonical failure must skip lifecycle import."),
  }), { code: "IMAP_IMPORT_DEADLINE" });
  assert.equal(canonicalAttempts, 2);
  assert.equal(database.receipts[0].status, "error");
  assert.equal(database.receipts[0].supplementalSearchSince, "2026-09-11T07:15:00.000Z");
  assert.doesNotMatch(JSON.stringify(database.receipts[0]), /jane@example|local-test-only/);
});

test("disabled Jane does not scan and records a null searchSince", async () => {
  const database = emptyMailboxDatabase();
  const receipt = await runSupport({
    database,
    env: {},
    collectMessages: async ({ mailboxScope }) => {
      assert.equal(mailboxScope, "tristan");
      return { messages: [], envelopesFound: 0 };
    },
    collectLifecycleMessages: async () => ({ messages: [], envelopesFound: 0 }),
  });
  assert.deepEqual(receipt.supplementalMailboxStatus, { status: "disabled" });
  assert.equal(receipt.supplementalSearchSince, null);
  assert.equal(database.receipts[0].supplementalSearchSince, null);
});

test("support cursor overlap bounds repeated Gmail work without weakening first import", () => {
  const now = new Date("2026-08-28T18:25:00.000Z");
  const cursor = new Date("2026-08-28T17:57:13.000Z");
  assert.equal(
    earlierOfRecentCursor(now, cursor, 90, 360).toISOString(),
    "2026-08-28T11:57:13.000Z",
  );
  assert.equal(
    earlierOfRecentCursor(now, cursor, 90, 30).toISOString(),
    "2026-08-28T16:57:13.000Z",
  );
  assert.equal(
    earlierOfRecentCursor(now, null, 90, 360).toISOString(),
    new Date(now.getTime() - 90 * 86_400_000).toISOString(),
  );
});

test("transient mailbox failures get one fresh-client retry", async () => {
  let attempts = 0;
  let retries = 0;
  const result = await collectWithTransientMailboxRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("Airbnb support Gmail import exceeded 45000ms."), {
        code: "IMAP_IMPORT_DEADLINE",
      });
    }
    return { messages: [], envelopesFound: 0 };
  }, { maxAttempts: 2, onRetry: () => { retries += 1; } });

  assert.deepEqual(result, { messages: [], envelopesFound: 0 });
  assert.equal(attempts, 2);
  assert.equal(retries, 1);
  assert.equal(transientMailboxError(Object.assign(new Error("Socket timeout"), { code: "ETIMEOUT" })), true);
});

test("non-transient mailbox failures are never retried", async () => {
  let attempts = 0;
  await assert.rejects(
    collectWithTransientMailboxRetry(async () => {
      attempts += 1;
      throw Object.assign(new Error("Authentication failed"), { code: "EAUTH" });
    }, { maxAttempts: 2 }),
    { code: "EAUTH" },
  );
  assert.equal(attempts, 1);
});

test("authentication failures never retry even when the provider also reports a timeout", () => {
  assert.equal(transientMailboxError(Object.assign(new Error("Socket timeout during authentication"), {
    code: "ETIMEOUT", authenticationFailed: true,
  })), false);
});

test("mailbox diagnostics retain failure identity without provider text or credentials", () => {
  const error = Object.assign(new Error("password=do-not-log@example.test"), {
    code: "IMAP_IMPORT_DEADLINE", responseText: "private provider response",
  });
  assert.deepEqual(mailboxFailureDiagnostic(error, "canonical", 1), {
    mailbox: "canonical", attempt: 1, code: "IMAP_IMPORT_DEADLINE", name: "Error",
    retryable: true, authenticationFailed: false,
  });
  assert.doesNotMatch(JSON.stringify(mailboxFailureDiagnostic(error, "canonical", 1)), /password|private|example/);
});

test("only successful adaptive decisions from the same runtime mode are cached", () => {
  assert.equal(canReuseStoredDecision({...liveDecision,alertManagement:true,managementSummary:null},
    "live",{replyCapable:false}),false);
  assert.equal(canReuseStoredDecision({...liveDecision,alertManagement:true,managementSummary:"Alex needs a reply in Airbnb."},
    "live",{replyCapable:false}),true);
  assert.equal(canReuseStoredDecision(liveDecision, "live"), true);
  assert.equal(canReuseStoredDecision({ ...liveDecision, shadowMode: true }, "shadow"), true);
  assert.equal(canReuseStoredDecision({ ...liveDecision, shadowMode: true }, "live"), false);
  assert.equal(canReuseStoredDecision({ decisionSource: "decision_error" }, "live"), false);
  assert.equal(canReuseStoredDecision({ ...liveDecision, decisionVersion: 1 }, "live"), false);
  assert.equal(canReuseStoredDecision({
    ...liveDecision,
    deterministicGuard: "initial_inquiry_requires_airbnb_ui",
  }, "live", { replyCapable: true }), false);
  const withWebsiteFacts = { ...liveDecision, liveWebsiteFacts: {
    observedAt: "2026-09-24T10:00:00.000Z",
  } };
  assert.equal(canReuseStoredDecision(withWebsiteFacts, "live", null,
    new Date("2026-09-24T10:04:59.000Z")), true);
  assert.equal(canReuseStoredDecision(withWebsiteFacts, "live", null,
    new Date("2026-09-24T10:05:01.000Z")), false);
});

test("initial inquiries without an SMTP reply route are held and escalated", () => {
  const guarded = applyReplyRouteGuard({
    replyNeeded: true,
    autoReply: true,
    status: "approved_for_guard",
    alertManagement: false,
    riskTier: "low",
    draft: "A useful monthly-rate acknowledgement.",
  }, {
    sourceKind: "initial_inquiry",
    replyRequired: true,
    replyCapable: false,
  });
  assert.equal(guarded.replyNeeded, true);
  assert.equal(guarded.autoReply, false);
  assert.equal(guarded.alertManagement, true);
  assert.equal(guarded.deterministicGuard, "initial_inquiry_requires_airbnb_ui");
  assert.equal(guarded.draft, "A useful monthly-rate acknowledgement.");
});

test("early-arrival and bag-drop operations can be captured independently", () => {
  const early = { requestType: "early_checkin", createsOperationalRequest: true };
  const bags = { requestType: "bag_drop", createsOperationalRequest: true };
  assert.deepEqual(actionableOperationalRequests({
    operationalRequest: early,
    bagDropRequest: bags,
  }), [early, bags]);
  assert.deepEqual(actionableOperationalRequests({
    operationalRequest: { requestType: "early_checkin", createsOperationalRequest: false },
    bagDropRequest: bags,
  }), [bags]);
});

test("retry-safe guard failures are not reported as delivery ambiguity", () => {
  assert.deepEqual(summarizeDeliveryOutcomes([
    { action: "sent" },
    { action: "mark_sent" },
    { action: "ambiguous" },
    { action: "guard_error" },
    { action: "not_claimed" },
  ]), {
    deliveredReplyCount: 1,
    reconciledReplyCount: 1,
    deliveryAmbiguousCount: 1,
    deliveryGuardErrorCount: 1,
  });
});
