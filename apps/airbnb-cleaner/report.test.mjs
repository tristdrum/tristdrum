import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDelivery,
  buildMessage,
  candidateEnvelope,
  chatContainsMessage,
  chatLedgerRecords,
  classifyUnits,
  deliveryIdempotencyKey,
  fetchChatMessages,
  guestComposition,
  guestCountLabel,
  infantCountLabel,
  mergeReservations,
  parseReservation,
  parseISODate,
  planDelivery,
  runReport,
  subjectMayTouchTarget,
  whatsappSend,
  xhosaGuestCountLabel,
  xhosaInfantCountLabel,
} from "./report.mjs";

const targetDate = parseISODate("2026-07-28");
const dryWeather = {
  available: true,
  rainPossible: false,
  rainSummary: "none currently showing",
  maxProbability: 0,
};
const rainyWeather = {
  available: true,
  rainPossible: true,
  rainSummary: "10 a.m.-noon",
  maxProbability: 80,
};

function reservation({
  unitId,
  guestName,
  guests,
  checkIn = "2026-07-27",
  checkOut = "2026-07-28",
}) {
  return {
    unitId,
    guestName,
    guests,
    checkIn,
    checkOut,
  };
}

function checkoutReservations() {
  return [
    reservation({ unitId: 1, guestName: "Checkout One", guests: "1 adult" }),
    reservation({ unitId: 2, guestName: "Checkout Two", guests: "1 adult" }),
    reservation({ unitId: 3, guestName: "Checkout Three", guests: "2 adults" }),
  ];
}

function turnoverReservations() {
  return [
    ...checkoutReservations(),
    reservation({
      unitId: 1,
      guestName: "Arrival One",
      guests: "1 adult, 1 child",
      checkIn: "2026-07-28",
      checkOut: "2026-07-29",
    }),
    reservation({
      unitId: 2,
      guestName: "Arrival Two",
      guests: "1 adult",
      checkIn: "2026-07-28",
      checkOut: "2026-07-31",
    }),
    reservation({
      unitId: 3,
      guestName: "Arrival Three",
      guests: "1 adult",
      checkIn: "2026-07-28",
      checkOut: "2026-07-29",
    }),
  ];
}

function resultFor(delivery) {
  return {
    status: "preview",
    targetDate: delivery.targetDateKey,
    messageHash: delivery.hash,
  };
}

function fakeSender(calls) {
  return async (request) => {
    calls.push(request);
    return {
      status: 200,
      dryRun: request.dryRun,
      mutatesWhatsappState: request.dryRun ? "false" : "true",
    };
  };
}

test("counts adults and singular or plural children, excluding infants", () => {
  assert.deepEqual(guestComposition({ guests: "1 adult, 1 child, 1 infant" }), {
    adultCount: 1,
    childCount: 1,
    infantCount: 1,
    explicitGuestCount: 0,
    mainGuestCount: 2,
  });
  assert.equal(guestCountLabel({ guests: "1 adult, 1 child" }), "2 guests");
  assert.equal(guestCountLabel({ guests: "2 adults, 2 children" }), "4 guests");
  assert.equal(xhosaGuestCountLabel({ guests: "1 adult" }), "1 undwendwe");
  assert.equal(infantCountLabel({ guests: "1 adult, 1 infant" }), "1 infant");
  assert.equal(xhosaInfantCountLabel({ guests: "1 adult, 2 infants" }), "2 iintsana");
});

test("defaults an unknown incoming count to two", () => {
  assert.equal(guestCountLabel(null), "2 guests");
  assert.equal(xhosaGuestCountLabel(null), "2 iindwendwe");
});

test("fetches date-less cancellations and updates for body-level reconciliation", () => {
  assert.equal(subjectMayTouchTarget("Canceled: Reservation HM123456", targetDate), true);
  assert.equal(subjectMayTouchTarget("Reservation updated for HM123456", targetDate), true);

  const cancellation = parseReservation(
    { id: "cancel", date: "2026-07-27T12:00:00Z", subject: "Canceled: Reservation HM123456" },
    "CONFIRMATION CODE\nHM123456",
    targetDate
  );
  assert.equal(cancellation.cancelled, true);
  assert.equal(cancellation.confirmationCode, "HM123456");
  assert.equal(cancellation.unitId, null);
});

test("the newest active confirmation revision replaces old dates and guest counts", () => {
  const merged = mergeReservations([
    {
      ...reservation({ unitId: 2, guestName: "Guest Name", guests: "2 adults, 1 child", checkIn: "2026-07-28", checkOut: "2026-07-31" }),
      sourceEnvelopeId: "old",
      sourceTimestamp: 100,
      confirmationCode: "HM123456",
      cancelled: false,
    },
    {
      ...reservation({ unitId: 2, guestName: "", guests: "1 adult", checkIn: "2026-07-29", checkOut: "2026-07-31" }),
      sourceEnvelopeId: "new",
      sourceTimestamp: 200,
      confirmationCode: "HM123456",
      cancelled: false,
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].checkIn, "2026-07-29");
  assert.equal(merged[0].guests, "1 adult");
  assert.equal(merged[0].guestName, "Guest Name");
});

test("a date-less cancellation removes the matching active confirmation", () => {
  const active = {
    ...reservation({ unitId: 3, guestName: "Guest Name", guests: "2 adults" }),
    sourceEnvelopeId: "active",
    sourceTimestamp: 100,
    confirmationCode: "HM123456",
    cancelled: false,
  };
  const cancellation = {
    sourceEnvelopeId: "cancel",
    sourceTimestamp: 200,
    confirmationCode: "HM123456",
    unitId: null,
    checkIn: null,
    checkOut: null,
    cancelled: true,
  };
  assert.deepEqual(mergeReservations([active, cancellation]), []);
});

test("reproduces the July 28 checkout-only and turnover timeline", () => {
  const checkoutReports = classifyUnits(checkoutReservations(), targetDate);
  assert.deepEqual(checkoutReports.map((report) => report.action), ["checkout", "checkout", "checkout"]);

  const checkoutMessage = buildMessage({
    targetDate,
    unitReports: checkoutReports,
    weather: dryWeather,
  });
  assert.match(checkoutMessage, /Unit 1\n- 2 guests/);
  assert.match(checkoutMessage, /Unit 2\n- 2 guests/);
  assert.match(checkoutMessage, /Unit 3\n- 2 guests/);

  const turnoverReports = classifyUnits(turnoverReservations(), targetDate);
  assert.deepEqual(turnoverReports.map((report) => report.action), ["turnover", "turnover", "turnover"]);

  const updatedMessage = buildMessage({
    targetDate,
    unitReports: turnoverReports,
    weather: dryWeather,
    isUpdate: true,
  });
  assert.match(updatedMessage, /Updated Airbnb plan for \*Tuesday, 28 July 2026\*/);
  assert.match(updatedMessage, /Unit 1\n- 2 guests; Arrival One/);
  assert.match(updatedMessage, /Unit 2\n- 1 guest; Arrival Two/);
  assert.match(updatedMessage, /Unit 3\n- 1 guest; Arrival Three/);
  assert.match(updatedMessage, /Unit 1\n- 2 iindwendwe; Arrival One\./);
  assert.match(updatedMessage, /Unit 2\n- 1 undwendwe; Arrival Two\./);
  assert.match(updatedMessage, /Unit 3\n- 1 undwendwe; Arrival Three\./);
  assert.doesNotMatch(updatedMessage, /tomorrow|ngomso/i);
});

test("duplicate midday content skips the live send and ledger append", async () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const first = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: [] });
  const duplicate = planDelivery({
    targetDate,
    unitReports,
    weather: dryWeather,
    ledgerRecords: [{ targetDate: first.targetDateKey, messageHash: first.hash }],
  });
  const calls = [];
  const appended = [];

  const result = await applyDelivery({
    mode: "live",
    result: resultFor(duplicate),
    message: duplicate.message,
    idempotencyKey: "duplicate-test",
    duplicate: duplicate.duplicate,
    whatsappSendFn: fakeSender(calls),
    appendLedgerFn: (record) => appended.push(record),
  });

  assert.equal(result.status, "duplicate_skipped");
  assert.equal(calls.filter((call) => call.dryRun === false).length, 0);
  assert.equal(calls.filter((call) => call.dryRun === true).length, 1);
  assert.equal(appended.length, 0);
});

test("booking and rain changes each produce exactly one live update", async () => {
  const checkoutReports = classifyUnits(checkoutReservations(), targetDate);
  const turnoverReports = classifyUnits(turnoverReservations(), targetDate);
  const original = planDelivery({
    targetDate,
    unitReports: checkoutReports,
    weather: dryWeather,
    ledgerRecords: [],
  });
  const priorLedger = [{ targetDate: original.targetDateKey, messageHash: original.hash }];

  for (const delivery of [
    planDelivery({ targetDate, unitReports: turnoverReports, weather: dryWeather, ledgerRecords: priorLedger }),
    planDelivery({ targetDate, unitReports: checkoutReports, weather: rainyWeather, ledgerRecords: priorLedger }),
  ]) {
    assert.equal(delivery.isUpdate, true);
    assert.equal(delivery.duplicate, undefined);
    assert.match(delivery.message, /^Updated Airbnb plan/);

    const calls = [];
    const appended = [];
    const result = await applyDelivery({
      mode: "live",
      result: resultFor(delivery),
      message: delivery.message,
      idempotencyKey: "update-test",
      duplicate: delivery.duplicate,
      whatsappSendFn: fakeSender(calls),
      appendLedgerFn: (record) => appended.push(record),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    assert.equal(result.status, "sent");
    assert.equal(calls.filter((call) => call.dryRun === false).length, 1);
    assert.equal(calls.filter((call) => call.dryRun === true).length, 1);
    assert.equal(appended.length, 1);
  }
});

test("a plan that reverts to older content sends one new update", () => {
  const checkoutReports = classifyUnits(checkoutReservations(), targetDate);
  const turnoverReports = classifyUnits(turnoverReservations(), targetDate);
  const first = planDelivery({ targetDate, unitReports: checkoutReports, weather: dryWeather, ledgerRecords: [] });
  const changed = planDelivery({
    targetDate,
    unitReports: turnoverReports,
    weather: dryWeather,
    ledgerRecords: [{ targetDate: first.targetDateKey, messageHash: first.hash, sentAt: "2026-07-27T11:30:00Z" }],
  });
  const reverted = planDelivery({
    targetDate,
    unitReports: checkoutReports,
    weather: dryWeather,
    ledgerRecords: [
      { targetDate: first.targetDateKey, messageHash: first.hash, sentAt: "2026-07-27T11:30:00Z" },
      { targetDate: changed.targetDateKey, messageHash: changed.hash, sentAt: "2026-07-28T09:00:00Z" },
    ],
  });

  assert.equal(reverted.isUpdate, true);
  assert.equal(reverted.duplicate, undefined);
  assert.match(reverted.message, /^Updated Airbnb plan/);

  const unchanged = planDelivery({
    targetDate,
    unitReports: checkoutReports,
    weather: dryWeather,
    ledgerRecords: [
      { targetDate: first.targetDateKey, messageHash: first.hash, sentAt: "2026-07-27T11:30:00Z" },
      { targetDate: changed.targetDateKey, messageHash: changed.hash, sentAt: "2026-07-28T09:00:00Z" },
      { targetDate: reverted.targetDateKey, messageHash: reverted.hash, sentAt: "2026-07-28T09:10:00Z" },
    ],
  });
  assert.equal(unchanged.duplicate?.messageHash, reverted.hash);
});

test("dry-run never appends the ledger", async () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const delivery = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: [] });
  const calls = [];
  const appended = [];

  const result = await applyDelivery({
    mode: "dry-run",
    result: resultFor(delivery),
    message: delivery.message,
    idempotencyKey: "dry-run-test",
    duplicate: delivery.duplicate,
    whatsappSendFn: fakeSender(calls),
    appendLedgerFn: (record) => appended.push(record),
  });

  assert.equal(result.status, "dry_run_ok");
  assert.deepEqual(calls.map((call) => call.dryRun), [true]);
  assert.equal(appended.length, 0);
});

test("Supabase ledger input replaces the volume ledger for planning", async () => {
  const result = await runReport({
    mode: "preview",
    targetDate: "2026-07-28",
    collectMessagesFn: async () => ({ envelopesFound: 0, messages: [] }),
    fetchWeatherFn: async () => dryWeather,
    loadLedgerRecordsFn: () => [{
      targetDate: "2026-07-28",
      messageHash: "stale-volume-plan",
      sentAt: "2026-07-27T11:30:00.000Z",
    }],
    authoritativeLedgerRecords: [],
    workDir: "/tmp",
  });

  assert.equal(result.isUpdate, false);
  assert.deepEqual(result.ledger, { authority: "supabase", recordCount: 0 });
});

test("cleaners-chat history participates in duplicate detection", () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const message = buildMessage({ targetDate, unitReports, weather: dryWeather });
  const providerNormalizedMessage = message.replace(/\s+/g, " ");
  const chatMessages = [{ text: providerNormalizedMessage, timestamp: "2026-07-27T11:31:00Z", from_me: true }];
  const records = chatLedgerRecords(chatMessages, targetDate);
  const delivery = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: records });

  assert.equal(records.length, 1);
  assert.equal(delivery.duplicate?.source, "whatsapp_chat");
  assert.equal(delivery.isUpdate, false);
  assert.equal(chatContainsMessage(chatMessages, message), true);
});

test("chat-backed duplicate reconciles the durable ledger without a second live send", async () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const message = buildMessage({ targetDate, unitReports, weather: dryWeather });
  const records = chatLedgerRecords(
    [{ text: message.replace(/\s+/g, " "), timestamp: "2026-07-28T09:00:00Z", from_me: true }],
    targetDate
  );
  const delivery = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: records });
  const calls = [];
  const appended = [];

  const result = await applyDelivery({
    mode: "live",
    result: resultFor(delivery),
    message: delivery.message,
    idempotencyKey: "chat-reconciliation-test",
    duplicate: delivery.duplicate,
    whatsappSendFn: fakeSender(calls),
    appendLedgerFn: (record) => appended.push(record),
    now: () => new Date("2026-07-28T09:02:00.000Z"),
  });

  assert.equal(result.status, "duplicate_skipped");
  assert.equal(result.duplicateSource, "whatsapp_chat");
  assert.deepEqual(calls.map((call) => call.dryRun), [true]);
  assert.deepEqual(appended, [{
    targetDate: "2026-07-28",
    messageHash: delivery.hash,
    sentAt: "2026-07-28T09:02:00.000Z",
    reconciledFrom: "whatsapp_chat",
  }]);
});

test("cleaners-chat duplicate checks use the latest plan for the date", () => {
  const checkoutMessage = buildMessage({
    targetDate,
    unitReports: classifyUnits(checkoutReservations(), targetDate),
    weather: dryWeather,
  });
  const turnoverMessage = buildMessage({
    targetDate,
    unitReports: classifyUnits(turnoverReservations(), targetDate),
    weather: dryWeather,
    isUpdate: true,
  });
  const chatMessages = [
    { text: checkoutMessage, timestamp: "2026-07-27T11:30:00Z", from_me: true },
    { text: turnoverMessage, timestamp: "2026-07-28T09:00:00Z", from_me: true },
  ];

  assert.equal(chatContainsMessage(chatMessages, checkoutMessage), false);
  assert.equal(chatContainsMessage(chatMessages, turnoverMessage), true);
});

test("inbound quoted plans never prove delivery or create duplicate records", () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const message = buildMessage({ targetDate, unitReports, weather: dryWeather });
  const chatMessages = [{ text: message, timestamp: "2026-07-28T09:00:00Z", from_me: false }];

  assert.deepEqual(chatLedgerRecords(chatMessages, targetDate), []);
  assert.equal(chatContainsMessage(chatMessages, message), false);
});

test("candidate envelopes require a verified Airbnb sender domain", () => {
  const subject = "Reservation confirmed - Guest arrives Aug 7";
  assert.equal(candidateEnvelope({ from: { name: "Airbnb", addr: "automated@airbnb.com" }, subject }), true);
  assert.equal(candidateEnvelope({ from: { name: "Airbnb", addr: "alerts@mail.airbnb.com" }, subject }), true);
  assert.equal(candidateEnvelope({ from: { name: "Airbnb", addr: "airbnb@example.com" }, subject }), false);
  assert.equal(candidateEnvelope({ from: { name: "Airbnb", addr: "alerts@evilairbnb.com" }, subject }), false);
});

test("scheduled delivery attempts use distinct provider idempotency keys", () => {
  const shared = { targetDate, chatId: "cleaners-chat", messageHash: "message-hash" };
  const first = deliveryIdempotencyKey({ ...shared, deliveryAttemptId: "run-1" });
  const retry = deliveryIdempotencyKey({ ...shared, deliveryAttemptId: "run-2" });

  assert.notEqual(first, retry);
});

test("live WhatsApp sends defer retry to a reconciled scheduler run", async () => {
  let calls = 0;
  await assert.rejects(
    whatsappSend(
      { text: "test", dryRun: false, idempotencyKey: "run-1" },
      {
        env: {
          MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://customer-api.example",
          MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "test-key",
          AIRBNB_WHATSAPP_ACCOUNT_ID: "account-id",
          AIRBNB_WHATSAPP_CHAT_ID: "cleaners-chat",
        },
        fetchFn: async () => {
          calls += 1;
          return new Response("{}", { status: 503 });
        },
        waitFn: async () => {},
      }
    ),
    /HTTP 503/
  );
  assert.equal(calls, 1);
});

test("live duplicate fails closed when ledger content is absent from chat", async () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const delivery = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: [] });
  const calls = [];
  await assert.rejects(
    applyDelivery({
      mode: "live",
      result: resultFor(delivery),
      message: delivery.message,
      idempotencyKey: "unverified-duplicate",
      duplicate: { source: "ledger" },
      duplicateChatVerified: false,
      whatsappSendFn: fakeSender(calls),
    }),
    /could not be confirmed/
  );
  assert.deepEqual(calls.map((call) => call.dryRun), [true]);
});

test("live send appends only after cleaners-chat readback", async () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const delivery = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: [] });
  const order = [];
  const result = await applyDelivery({
    mode: "live",
    result: resultFor(delivery),
    message: delivery.message,
    idempotencyKey: "verified-send",
    whatsappSendFn: async ({ dryRun }) => {
      order.push(dryRun ? "dry-run" : "send");
      return { status: 200, dryRun, mutatesWhatsappState: dryRun ? "false" : "true" };
    },
    verifyChatFn: async () => {
      order.push("verify");
      return { found: true, attempts: 1 };
    },
    appendLedgerFn: () => order.push("append"),
  });

  assert.equal(result.status, "sent");
  assert.deepEqual(order, ["dry-run", "send", "verify", "append"]);
});

test("cleaners-chat reads retry transient provider failures", async () => {
  const calls = [];
  const messages = await fetchChatMessages(20, {
    env: {
      MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://customer-api.example",
      MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "test-key",
      AIRBNB_WHATSAPP_ACCOUNT_ID: "account-id",
      AIRBNB_WHATSAPP_CHAT_ID: "cleaners-chat",
    },
    fetchFn: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return new Response("{}", { status: 503 });
      return Response.json({ messages: [{ text: "latest" }] });
    },
    waitFn: async () => {},
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0], /limit=20/);
  assert.deepEqual(messages, [{ text: "latest" }]);
});
