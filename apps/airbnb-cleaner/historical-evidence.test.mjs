import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildMessage,
  classifyUnits,
  collectReservations,
  confidenceCheck,
  mergeReservations,
  parseISODate,
  parseReservation,
  runReport,
} from "./report.mjs";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/historical-evidence.json", import.meta.url), "utf8")
);

const dryWeather = {
  available: true,
  attempts: 1,
  rainPossible: false,
  rainSummary: "none currently showing",
  maxProbability: 0,
  maxPrecipitation: 0,
  dryingHoursCount: 12,
};

function activeSummary(reservation) {
  return {
    confirmationCode: reservation.confirmationCode,
    unitId: reservation.unitId,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    guestName: reservation.guestName,
    guests: reservation.guests,
  };
}

for (const fixture of fixtures) {
  test(`historical evidence: ${fixture.id}`, () => {
    const targetDate = parseISODate(fixture.targetDate);
    const evidence = fixture.evidence
      .filter((message) => Date.parse(message.date) <= Date.parse(fixture.cutoff))
      .map((message) => parseReservation(message, message.body, targetDate))
      .filter(Boolean);

    assert.deepEqual(
      evidence.map((reservation) => reservation.evidenceKind),
      fixture.expected.evidenceKinds
    );

    const active = mergeReservations(evidence);
    assert.deepEqual(active.map(activeSummary), fixture.expected.active);

    const unitReports = classifyUnits(active, targetDate);
    assert.deepEqual(
      unitReports.map((report) => report.action),
      fixture.expected.actions
    );

    const confidence = confidenceCheck({
      reservations: active,
      unitReports,
      weather: dryWeather,
      envelopesRead: evidence.length,
    });
    assert.equal(confidence.ok, true, confidence.blockers.join("; "));

    const message = buildMessage({ targetDate, unitReports, weather: dryWeather });
    for (const expected of fixture.expected.messageIncludes ?? []) assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const excluded of fixture.expected.messageExcludes ?? []) assert.doesNotMatch(message, new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("impossible same-unit occupancy blocks delivery confidence", () => {
  const targetDate = parseISODate("2026-08-14");
  const reservations = [
    {
      confirmationCode: "HMOVER01",
      unitId: 3,
      checkIn: "2026-08-13",
      checkOut: "2026-08-15",
      guestName: "Stayover Guest",
      guests: "2 adults",
    },
    {
      confirmationCode: "HMOVER02",
      unitId: 3,
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      guestName: "Overlapping Guest",
      guests: "1 adult",
    },
  ];
  const unitReports = classifyUnits(reservations, targetDate);
  const confidence = confidenceCheck({
    reservations,
    unitReports,
    weather: dryWeather,
    envelopesRead: 2,
  });

  assert.equal(confidence.ok, false);
  assert.match(confidence.blockers.join(" "), /Unit 3.*impossible occupancy overlap/i);
});

test("an explicit update without its confirmation anchor blocks delivery", () => {
  const confidence = confidenceCheck({
    reservations: [],
    unitReports: classifyUnits([], parseISODate("2026-08-14")),
    weather: dryWeather,
    envelopesRead: 1,
    unmatchedUpdateCount: 1,
  });

  assert.equal(confidence.ok, false);
  assert.match(confidence.blockers.join(" "), /missing its confirmed booking anchor/i);
});

test("an unrelated historical update without an anchor does not block the target date", async () => {
  const collected = await collectReservations(
    parseISODate("2026-08-14"),
    90,
    80,
    async () => ({
      envelopesFound: 1,
      messages: [{
        envelope: { id: "old-update", date: "2026-08-01T10:00:00Z", subject: "Reservation updated for HMOLD001" },
        body: "Bougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 1, 2026\nAugust 2, 2026\nCONFIRMATION CODE\nHMOLD001",
      }],
    })
  );

  assert.equal(collected.unmatchedUpdateCount, 0);
});

test("collection includes the seven-day stock horizon without widening the cleaner target", async () => {
  let subjectFilter;
  const collected = await collectReservations(
    parseISODate("2026-08-14"),
    90,
    80,
    async (options) => {
      subjectFilter = options.subjectMayTouchTarget;
      return { envelopesFound: 0, messages: [] };
    },
  );

  assert.equal(subjectFilter("Reservation confirmed - Future Guest arrives Aug 20"), true);
  assert.equal(subjectFilter("Reservation confirmed - Later Guest arrives Aug 21"), false);
  assert.deepEqual(collected.reservations, []);
  assert.deepEqual(collected.evidence, []);
});

test("a blocked overlap performs no WhatsApp write", async () => {
  const priorEnv = {
    baseUrl: process.env.MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL,
    apiKey: process.env.MINCOOL_CUSTOMER_WHATSAPP_API_KEY,
    accountId: process.env.AIRBNB_WHATSAPP_ACCOUNT_ID,
    chatId: process.env.AIRBNB_WHATSAPP_CHAT_ID,
  };
  process.env.MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL = "https://customer-api.example";
  process.env.MINCOOL_CUSTOMER_WHATSAPP_API_KEY = "test-key";
  process.env.AIRBNB_WHATSAPP_ACCOUNT_ID = "test-account";
  process.env.AIRBNB_WHATSAPP_CHAT_ID = "test-chat";
  const writes = [];
  try {
    const result = await runReport({
      mode: "live",
      targetDate: "2026-08-14",
      collectMessagesFn: async () => ({
        envelopesFound: 2,
        messages: [
          {
            envelope: { id: "overlap-one", date: "2026-08-13T08:00:00Z", subject: "Reservation confirmed - Stayover Guest arrives Aug 13" },
            body: "NEW BOOKING CONFIRMED! STAYOVER GUEST ARRIVES AUG 13.\nJasmine Studio Stay\nCheck-in Checkout\nAugust 13, 2026\nAugust 15, 2026\nGUESTS\n2 adults\nCONFIRMATION CODE\nHMOVER01",
          },
          {
            envelope: { id: "overlap-two", date: "2026-08-13T09:00:00Z", subject: "Reservation confirmed - Overlapping Guest arrives Aug 14" },
            body: "NEW BOOKING CONFIRMED! OVERLAPPING GUEST ARRIVES AUG 14.\nJasmine Studio Stay\nCheck-in Checkout\nAugust 14, 2026\nAugust 16, 2026\nGUESTS\n1 adult\nCONFIRMATION CODE\nHMOVER02",
          },
        ],
      }),
      fetchWeatherFn: async () => dryWeather,
      fetchChatMessagesFn: async () => [],
      whatsappSendFn: async (request) => {
        writes.push(request);
        return { status: 200 };
      },
      loadLedgerRecordsFn: () => [],
      appendLedgerFn: () => writes.push("ledger"),
      workDir: "/tmp",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.confidence.ok, false);
    assert.deepEqual(writes, []);
  } finally {
    for (const [name, value] of [
      ["MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL", priorEnv.baseUrl],
      ["MINCOOL_CUSTOMER_WHATSAPP_API_KEY", priorEnv.apiKey],
      ["AIRBNB_WHATSAPP_ACCOUNT_ID", priorEnv.accountId],
      ["AIRBNB_WHATSAPP_CHAT_ID", priorEnv.chatId],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
