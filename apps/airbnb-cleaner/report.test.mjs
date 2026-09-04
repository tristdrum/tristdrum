import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDelivery,
  buildMessage,
  candidateEnvelope,
  chatContainsMessage,
  chatLedgerRecords,
  classifyUnits,
  collectReservations,
  deliveryIdempotencyKey,
  fetchChatMessages,
  guestComposition,
  guestCountLabel,
  infantCountLabel,
  mergeReservations,
  parseReservation,
  parseISODate,
  planSubstantiveHash,
  planDelivery,
  runReport,
  sendFinalFailureAlert,
  subjectMayTouchTarget,
  whatsappSend,
  weatherUpdateIsMaterial,
  xhosaGuestCountLabel,
  xhosaInfantCountLabel,
} from "./report.mjs";

const targetDate = parseISODate("2026-07-28");
const dryWeather = {
  available: true,
  rainPossible: false,
  rainSummary: "none currently showing",
  maxProbability: 0,
  maxPrecipitation: 0,
};
const rainyWeather = {
  available: true,
  rainPossible: true,
  rainSummary: "10 a.m.-noon",
  maxProbability: 80,
  maxPrecipitation: 1.2,
};
const lowRainWeather = {
  available: true,
  rainPossible: true,
  rainSummary: "noon-midnight",
  maxProbability: 17,
  maxPrecipitation: 0.2,
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
    contentOccurrence: delivery.contentOccurrence,
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
  assert.equal(subjectMayTouchTarget("Your reservation change was accepted", targetDate), true);

  const cancellation = parseReservation(
    { id: "cancel", date: "2026-07-27T12:00:00Z", subject: "Canceled: Reservation HM123456" },
    "CONFIRMATION CODE\nHM123456",
    targetDate
  );
  assert.equal(cancellation.cancelled, true);
  assert.equal(cancellation.confirmationCode, "HM123456");
  assert.equal(cancellation.unitId, null);
});

test("an accepted guest-count change unlocks one newer matching Airbnb thread count", () => {
  const confirmation = parseReservation(
    { id: "confirmed", date: "2026-08-27T06:29:00Z", subject: "Reservation confirmed - Alpha Guest arrives Aug 28" },
    "NEW BOOKING CONFIRMED! ALPHA GUEST ARRIVES AUG 28.\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n1 adult\nCONFIRMATION CODE\nHMCHANGE01",
    parseISODate("2026-08-28"),
  );
  const accepted = parseReservation(
    { id: "accepted", date: "2026-08-27T07:09:00Z", subject: "Your reservation change was accepted" },
    "ALPHA GUEST AGREED TO CHANGE THEIR RESERVATION\nBougainvillea Courtyard Studio\nhttps://airbnb.example/hosting/reservations/details/HMCHANGE01\nhttps://airbnb.example/messaging/thread/2647000000",
    parseISODate("2026-08-28"),
  );
  const discussion = parseReservation(
    { id: "discussion", date: "2026-08-27T06:31:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Aug 28 - 29" },
    "ALPHA GUEST\nBooker\nI am alone but someone may join me. Is that okay?\nReply\nhttps://airbnb.example/hosting/thread/2647000000\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n1 adult",
    parseISODate("2026-08-28"),
  );
  const changedThread = parseReservation(
    { id: "thread", date: "2026-08-27T07:11:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Aug 28 - 29" },
    "ALPHA GUEST\nBooker\nI will update the booking now.\nReply\nhttps://airbnb.example/hosting/thread/2647000000\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n2 adults",
    parseISODate("2026-08-28"),
  );

  assert.equal(accepted.evidenceSubtype, "update");
  assert.equal(accepted.guestCountChangeAccepted, true);
  assert.equal(discussion.guestCountChangeDiscussed, true);
  assert.equal(changedThread.guestCountChangeClaimed, true);
  const merged = mergeReservations([confirmation, discussion, accepted, changedThread]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].guests, "2 adults");
  assert.equal(merged[0].sourceEnvelopeId, "thread");
  assert.deepEqual(merged[0].sources, ["confirmed", "discussion", "accepted", "thread"]);
  assert.deepEqual(merged[0].guestCountChangeEvidence, {
    discussionEnvelopeId: "discussion",
    acceptedEnvelopeId: "accepted",
    countEnvelopeId: "thread",
  });
});

test("an accepted accommodation change uses the newer same-thread itinerary snapshot", () => {
  const referenceDate = parseISODate("2026-09-02");
  const confirmation = parseReservation(
    { id: "confirmed", date: "2026-08-28T17:53:00Z", subject: "Reservation confirmed - Anathi Gadini arrives Oct 30" },
    "NEW BOOKING CONFIRMED! ANATHI GADINI ARRIVES OCT 30.\nJasmine Studio Stay\nCheck-in Checkout\nOctober 30, 2026\nNovember 1, 2026\nGUESTS\n1 adult\nCONFIRMATION CODE\nHM5W2YSBPS",
    referenceDate,
  );
  const accepted = parseReservation(
    { id: "accepted", date: "2026-09-01T17:17:00Z", subject: "Your reservation change was accepted" },
    "ANATHI AGREED TO CHANGE THEIR RESERVATION\nBougainvillea Courtyard Studio\nhttps://airbnb.example/hosting/reservations/details/HM5W2YSBPS\nhttps://airbnb.example/messaging/thread/2649658578",
    referenceDate,
  );
  const snapshot = parseReservation(
    { id: "snapshot", date: "2026-09-01T17:21:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Sep 7 - 10" },
    "ANATHI\nBooker\nThank you\nReply\nhttps://airbnb.example/hosting/thread/2649658578\nBougainvillea Courtyard Studio\nCheck-in Checkout\nSeptember 7, 2026\nSeptember 10, 2026\nGUESTS\n1 adult",
    referenceDate,
  );

  const [merged] = mergeReservations([confirmation, accepted, snapshot]);
  assert.equal(merged.commonName, "Bougainvillea");
  assert.equal(merged.checkIn, "2026-09-07");
  assert.equal(merged.checkOut, "2026-09-10");
  assert.equal(merged.guestName, "Anathi Gadini");
  assert.equal(merged.guests, "1 adult");
  assert.deepEqual(merged.acceptedItineraryChangeEvidence, {
    acceptedEnvelopeId: "accepted",
    snapshotEnvelopeId: "snapshot",
  });
  assert.deepEqual(merged.sources, ["confirmed", "accepted", "snapshot"]);
});

test("accepted accommodation-change context does not expire before the updated stay", async () => {
  const referenceDate = parseISODate("2026-09-04");
  const confirmation = {
    envelope: {
      id: "confirmed",
      date: "2026-08-28T17:53:00Z",
      subject: "Reservation confirmed - Anathi Gadini arrives Oct 30",
    },
    body: "NEW BOOKING CONFIRMED! ANATHI GADINI ARRIVES OCT 30.\nJasmine Studio Stay\nCheck-in Checkout\nOctober 30, 2026\nNovember 1, 2026\nGUESTS\n1 adult\nCONFIRMATION CODE\nHM5W2YSBPS",
  };
  const accepted = {
    envelope: {
      id: "accepted",
      date: "2026-09-01T17:17:00Z",
      subject: "Your reservation change was accepted",
    },
    body: "ANATHI AGREED TO CHANGE THEIR RESERVATION\nBougainvillea Courtyard Studio\nhttps://airbnb.example/hosting/reservations/details/HM5W2YSBPS\nhttps://airbnb.example/messaging/thread/2649658578",
  };
  const snapshot = {
    envelope: {
      id: "snapshot",
      date: "2026-09-01T17:21:00Z",
      subject: "RE: Reservation for Bougainvillea Courtyard Studio, Sep 7 - 10",
    },
    body: "ANATHI\nBooker\nThank you\nReply\nhttps://airbnb.example/hosting/thread/2649658578\nBougainvillea Courtyard Studio\nCheck-in Checkout\nSeptember 7, 2026\nSeptember 10, 2026\nGUESTS\n1 adult",
  };
  let recoverAcceptedChangeContext = null;

  const collected = await collectReservations(referenceDate, 90, 80, async ({ describeEvidence }) => {
    recoverAcceptedChangeContext = describeEvidence(accepted).recoverAcceptedChangeContext;
    return { messages: [confirmation, accepted, snapshot], envelopesFound: 3 };
  });

  assert.equal(recoverAcceptedChangeContext, true);
  assert.deepEqual(
    collected.reservations.map(({ confirmationCode, unitId, checkIn, checkOut }) => ({
      confirmationCode,
      unitId,
      checkIn,
      checkOut,
    })),
    [{ confirmationCode: "HM5W2YSBPS", unitId: 1, checkIn: "2026-09-07", checkOut: "2026-09-10" }],
  );
});

test("an incomplete accepted accommodation change fails closed without a current itinerary snapshot", () => {
  const confirmation = {
    ...reservation({ unitId: 3, guestName: "Anathi Gadini", guests: "1 adult", checkIn: "2026-10-30", checkOut: "2026-11-01" }),
    sourceEnvelopeId: "confirmed",
    sourceTimestamp: 100,
    confirmationCode: "HM5W2YSBPS",
    evidenceKind: "confirmed",
  };
  const accepted = {
    sourceEnvelopeId: "accepted",
    sourceTimestamp: 200,
    confirmationCode: "HM5W2YSBPS",
    evidenceKind: "supplemental",
    evidenceSubtype: "update",
    guestCountChangeAccepted: true,
    providerThreadId: "2649658578",
    unitId: 1,
    checkIn: null,
    checkOut: null,
    guests: "",
  };

  assert.throws(
    () => mergeReservations([confirmation, accepted]),
    { code: "ACCEPTED_CHANGE_ITINERARY_UNRESOLVED" },
  );
});

test("an accepted change cannot turn a generic update-you reply into guest-count authority", () => {
  const confirmation = {
    ...reservation({ unitId: 1, guestName: "Alpha Guest", guests: "1 adult", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "confirmed",
    sourceTimestamp: 100,
    confirmationCode: "HMCHANGE02",
    evidenceKind: "confirmed",
  };
  const accepted = {
    sourceEnvelopeId: "accepted",
    sourceTimestamp: 200,
    confirmationCode: "HMCHANGE02",
    evidenceKind: "supplemental",
    evidenceSubtype: "update",
    guestCountChangeAccepted: true,
    providerThreadId: "2647000000",
    guests: "",
  };
  const discussion = {
    ...reservation({ unitId: 1, guestName: "Alpha Guest", guests: "1 adult", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "discussion",
    sourceTimestamp: 150,
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeDiscussed: true,
    providerThreadId: "2647000000",
  };
  const wifiReply = parseReservation(
    { id: "wifi", date: "2026-08-27T07:11:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Aug 28 - 29" },
    "ALPHA GUEST\nBooker\nLet me update you about the Wi-Fi later.\nReply\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n2 adults",
    parseISODate("2026-08-28"),
  );
  assert.equal(wifiReply.guestCountChangeClaimed, false);
  assert.equal(mergeReservations([confirmation, discussion, accepted, wifiReply])[0].guests, "1 adult");
});

test("date, arrival-time, and update-you replies cannot claim a guest-count change", () => {
  for (const [id, message] of [
    ["updated-you", "I’ve updated you about the plans."],
    ["arrival-time", "I will change the arrival time."],
    ["dates", "Let me change the dates."],
  ]) {
    const parsed = parseReservation(
      { id, date: "2026-08-27T07:11:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Aug 28 - 29" },
    `ALPHA GUEST\nBooker\n${message}\nReply\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n2 adults`,
      parseISODate("2026-08-28"),
    );
    assert.equal(parsed.guestCountChangeClaimed, false, id);
  }
});

test("a later explicit update preserves a previously paired accepted guest-count change", () => {
  const confirmation = {
    ...reservation({ unitId: 1, guestName: "Alpha Guest", guests: "1 adult", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "confirmed",
    sourceTimestamp: 100,
    confirmationCode: "HMCHANGE03",
    evidenceKind: "confirmed",
  };
  const accepted = {
    sourceEnvelopeId: "accepted",
    sourceTimestamp: 200,
    confirmationCode: "HMCHANGE03",
    evidenceKind: "supplemental",
    evidenceSubtype: "update",
    guestCountChangeAccepted: true,
    providerThreadId: "2647000000",
    guests: "",
  };
  const discussion = {
    ...reservation({ unitId: 1, guestName: "Alpha Guest", guests: "1 adult", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "discussion",
    sourceTimestamp: 150,
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeDiscussed: true,
    providerThreadId: "2647000000",
  };
  const countReply = {
    ...reservation({ unitId: 1, guestName: "Alpha Guest", guests: "2 adults", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "count",
    sourceTimestamp: 250,
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeClaimed: true,
    providerThreadId: "2647000000",
  };
  const laterDateUpdate = {
    sourceEnvelopeId: "later",
    sourceTimestamp: 300,
    confirmationCode: "HMCHANGE03",
    evidenceKind: "supplemental",
    evidenceSubtype: "update",
    checkIn: "2026-08-28",
    checkOut: "2026-08-30",
    guests: "",
  };
  const merged = mergeReservations([confirmation, discussion, accepted, countReply, laterDateUpdate]);
  assert.equal(merged[0].guests, "2 adults");
  assert.equal(merged[0].checkOut, "2026-08-30");
});

test("accepted guest-count evidence cannot cross into a same-date replacement guest", () => {
  const replacement = {
    ...reservation({ unitId: 1, guestName: "New Guest", guests: "1 adult", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "replacement",
    sourceTimestamp: 100,
    confirmationCode: "HMREPLACE01",
    evidenceKind: "confirmed",
  };
  const accepted = {
    sourceEnvelopeId: "accepted",
    sourceTimestamp: 200,
    confirmationCode: "HMREPLACE01",
    evidenceKind: "supplemental",
    evidenceSubtype: "update",
    guestCountChangeAccepted: true,
    providerThreadId: "new-thread",
    guests: "",
  };
  const oldGuestDiscussion = {
    ...reservation({ unitId: 1, guestName: "Old Guest", guests: "1 adult", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "old-discussion",
    sourceTimestamp: 150,
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeDiscussed: true,
    providerThreadId: "old-thread",
  };
  const oldGuestCount = {
    ...reservation({ unitId: 1, guestName: "Old Guest", guests: "2 adults", checkIn: "2026-08-28", checkOut: "2026-08-29" }),
    sourceEnvelopeId: "old-count",
    sourceTimestamp: 250,
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeClaimed: true,
    providerThreadId: "old-thread",
  };
  const merged = mergeReservations([replacement, oldGuestDiscussion, accepted, oldGuestCount]);
  assert.equal(merged[0].guestName, "New Guest");
  assert.equal(merged[0].guests, "1 adult");
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

test("accepted timing and bag-drop notes appear beneath the correct unit in English and Xhosa", () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const operationalNotes = [
    {
      unitId: 1,
      requestType: "bag_drop",
      effectiveTime: "10:00",
      english: "Bag drop expected from 10:00, but only after the previous guest has actually checked out. Luggage only; no room access before cleaning is complete.",
      xhosa: "Ukushiya iibhegi kulindeleke ukususela ngo-10:00, kodwa kuphela emva kokuba undwendwe lwangaphambili luphume ngokupheleleyo. Kukushiya iibhegi kuphela; akukho kungena egumbini ngaphambi kokuba ukucoca kugqitywe.",
    },
    {
      unitId: 2,
      requestType: "early_checkin",
      effectiveTime: "13:00",
      english: "Early check-in requested for 13:00. Please prioritise this unit; the time is not guaranteed yet.",
      xhosa: "Kucelwe ukungena kwangethuba ngo-13:00. Nceda ubeke le unit phambili; ixesha alikaqinisekiswa.",
    },
    {
      unitId: 3,
      requestType: "late_checkout",
      effectiveTime: "11:00",
      english: "Late check-out approved for 11:00. Please start cleaning after the guest leaves.",
      xhosa: "Ukuhamba kade ngo-11:00 kuvunyiwe. Nceda uqale ukucoca emva kokuba undwendwe luhambile.",
    },
  ];
  const message = buildMessage({ targetDate, unitReports, weather: dryWeather, operationalNotes });
  assert.match(message, /Unit 1\n- 2 guests; Arrival One\n- Bag drop expected from 10:00/);
  assert.match(message, /Unit 2\n- 1 guest; Arrival Two\n- Early check-in requested for 13:00/);
  assert.match(message, /Unit 3\n- 1 guest; Arrival Three\n- Late check-out approved for 11:00/);
  assert.match(message, /Unit 1\n- 2 iindwendwe; Arrival One\.\n- Ukushiya iibhegi kulindeleke ukususela ngo-10:00/);
  assert.match(message, /Unit 2\n- 1 undwendwe; Arrival Two\.\n- Kucelwe ukungena kwangethuba ngo-13:00/);
  assert.match(message, /Unit 3\n- 1 undwendwe; Arrival Three\.\n- Ukuhamba kade ngo-11:00/);

  const withoutNotes = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: [] });
  const withNotes = planDelivery({ targetDate, unitReports, weather: dryWeather, operationalNotes, ledgerRecords: [] });
  assert.notEqual(withNotes.hash, withoutNotes.hash);
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

test("booking and material rain changes each produce exactly one live update", async () => {
  const checkoutReports = classifyUnits(checkoutReservations(), targetDate);
  const turnoverReports = classifyUnits(turnoverReservations(), targetDate);
  const original = planDelivery({
    targetDate,
    unitReports: checkoutReports,
    weather: dryWeather,
    ledgerRecords: [],
  });
  const priorLedger = [{
    targetDate: original.targetDateKey,
    messageHash: original.hash,
    messageText: original.message,
    weather: dryWeather,
  }];

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

test("slight low-rain drift reuses the delivered plan without another live message", async () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const first = planDelivery({ targetDate, unitReports, weather: lowRainWeather, ledgerRecords: [] });
  const driftedWeather = {
    ...lowRainWeather,
    rainSummary: "3 p.m.-midnight",
    maxProbability: 11,
  };
  const drifted = planDelivery({
    targetDate,
    unitReports,
    weather: driftedWeather,
    ledgerRecords: [{
      targetDate: first.targetDateKey,
      messageHash: first.hash,
      messageText: first.message,
      weather: lowRainWeather,
      contentOccurrence: 1,
      sentAt: "2026-07-27T11:30:00Z",
      source: "supabase",
      isUpdate: false,
    }],
  });

  assert.equal(planSubstantiveHash(first.message), planSubstantiveHash(
    buildMessage({ targetDate, unitReports, weather: driftedWeather, isUpdate: true }),
  ));
  assert.equal(drifted.hash, first.hash);
  assert.equal(drifted.message, first.message);
  assert.equal(drifted.duplicate?.source, "non_substantive_weather");
  assert.equal(drifted.suppressedUpdate?.reason, "non_substantive_weather");

  const calls = [];
  const appended = [];
  const result = await applyDelivery({
    mode: "live",
    result: resultFor(drifted),
    message: drifted.message,
    idempotencyKey: "low-rain-drift",
    duplicate: drifted.duplicate,
    whatsappSendFn: fakeSender(calls),
    appendLedgerFn: (record) => appended.push(record),
  });
  assert.equal(result.status, "duplicate_skipped");
  assert.equal(result.duplicateSource, "non_substantive_weather");
  assert.equal(calls.filter((call) => call.dryRun === false).length, 0);
  assert.equal(appended.length, 0);
});

test("overnight-only timing and intensity drift in material rain reuses the delivered plan", () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const allDayRain = {
    ...rainyWeather,
    rainSummary: "midnight-midnight",
    maxProbability: 100,
    maxPrecipitation: 3,
  };
  const first = planDelivery({ targetDate, unitReports, weather: allDayRain, ledgerRecords: [] });
  const drifted = planDelivery({
    targetDate,
    unitReports,
    weather: {
      ...allDayRain,
      rainSummary: "midnight-3 a.m. and 6 a.m.-midnight",
      maxPrecipitation: 14.5,
    },
    ledgerRecords: [{
      targetDate: first.targetDateKey,
      messageHash: first.hash,
      messageText: first.message,
      weather: allDayRain,
      contentOccurrence: 1,
      sentAt: "2026-08-29T19:32:18Z",
      source: "supabase",
      isUpdate: true,
    }],
  });

  assert.equal(drifted.hash, first.hash);
  assert.equal(drifted.message, first.message);
  assert.equal(drifted.duplicate?.source, "non_substantive_weather");
  assert.equal(drifted.suppressedUpdate?.reason, "non_substantive_weather");
});

test("weather-only updates require operationally material rain", () => {
  assert.equal(weatherUpdateIsMaterial(lowRainWeather, {
    ...lowRainWeather,
    rainSummary: "3 p.m.-midnight",
    maxProbability: 11,
  }), false);
  const belowPrecipitationThreshold = {
    ...lowRainWeather,
    rainSummary: "10 a.m.-noon",
    maxProbability: 20,
    maxPrecipitation: 0.4,
  };
  const atPrecipitationThreshold = {
    ...belowPrecipitationThreshold,
    maxPrecipitation: 0.5,
  };
  assert.equal(weatherUpdateIsMaterial(belowPrecipitationThreshold, atPrecipitationThreshold), true);
  assert.equal(weatherUpdateIsMaterial(atPrecipitationThreshold, belowPrecipitationThreshold), true);
  assert.equal(weatherUpdateIsMaterial(dryWeather, rainyWeather), true);
  assert.equal(weatherUpdateIsMaterial({
    ...rainyWeather,
    maxProbability: 40,
  }, {
    ...rainyWeather,
    maxProbability: 90,
  }), false);
  assert.equal(weatherUpdateIsMaterial(rainyWeather, {
    ...rainyWeather,
    rainSummary: "3 p.m.-midnight",
  }), true);
  assert.equal(weatherUpdateIsMaterial({
    ...rainyWeather,
    rainSummary: "midnight-midnight",
    maxProbability: 100,
    maxPrecipitation: 3,
  }, {
    ...rainyWeather,
    rainSummary: "midnight-3 a.m. and 6 a.m.-midnight",
    maxProbability: 100,
    maxPrecipitation: 14.5,
  }), false);
  assert.equal(weatherUpdateIsMaterial({
    ...rainyWeather,
    rainSummary: "midnight-midnight",
  }, {
    ...rainyWeather,
    rainSummary: "7 p.m.-midnight",
  }), true);
  assert.equal(weatherUpdateIsMaterial(rainyWeather, {
    available: false,
    rainPossible: null,
  }), false);
});

test("booking and timing-note changes remain substantive regardless of low rain", () => {
  const checkoutReports = classifyUnits(checkoutReservations(), targetDate);
  const first = planDelivery({ targetDate, unitReports: checkoutReports, weather: lowRainWeather, ledgerRecords: [] });
  const ledgerRecords = [{
    targetDate: first.targetDateKey,
    messageHash: first.hash,
    messageText: first.message,
    weather: lowRainWeather,
    sentAt: "2026-07-27T11:30:00Z",
    source: "supabase",
  }];
  const bookingChange = planDelivery({
    targetDate,
    unitReports: classifyUnits(turnoverReservations(), targetDate),
    weather: { ...lowRainWeather, maxProbability: 11 },
    ledgerRecords,
  });
  const timingChange = planDelivery({
    targetDate,
    unitReports: checkoutReports,
    weather: { ...lowRainWeather, maxProbability: 11 },
    operationalNotes: [{
      unitId: 1,
      english: "Early check-in requested for 13:00.",
      xhosa: "Kucelwe ukungena kwangethuba ngo-13:00.",
    }],
    ledgerRecords,
  });
  for (const delivery of [bookingChange, timingChange]) {
    assert.equal(delivery.isUpdate, true);
    assert.equal(delivery.duplicate, undefined);
    assert.match(delivery.message, /^Updated Airbnb plan/);
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

test("B-C-B content reversion advances the provider occurrence while an unsent retry stays stable", () => {
  const checkoutReports = classifyUnits(checkoutReservations(), targetDate);
  const turnoverReports = classifyUnits(turnoverReservations(), targetDate);
  const initial = planDelivery({ targetDate, unitReports: checkoutReports, weather: dryWeather, ledgerRecords: [] });
  const initialRecord = {
    targetDate: initial.targetDateKey,
    messageHash: initial.hash,
    sentAt: "2026-07-27T11:30:00Z",
    source: "supabase",
  };
  const firstB = planDelivery({
    targetDate,
    unitReports: turnoverReports,
    weather: dryWeather,
    ledgerRecords: [initialRecord],
  });
  const firstBLedger = {
    targetDate: firstB.targetDateKey,
    messageHash: firstB.hash,
    sentAt: "2026-07-28T09:00:00Z",
    source: "supabase",
    contentOccurrence: 1,
  };
  const firstBChat = {
    ...firstBLedger,
    normalizedMessageHash: firstB.hash,
    source: "whatsapp_chat",
  };
  const changedC = planDelivery({
    targetDate,
    unitReports: turnoverReports,
    weather: rainyWeather,
    ledgerRecords: [initialRecord, firstBLedger, firstBChat],
  });
  const changedCRecord = {
    targetDate: changedC.targetDateKey,
    messageHash: changedC.hash,
    sentAt: "2026-07-28T09:10:00Z",
    source: "supabase",
  };
  const historyBeforeReversion = [initialRecord, firstBLedger, firstBChat, changedCRecord];
  const revertedB = planDelivery({
    targetDate,
    unitReports: turnoverReports,
    weather: dryWeather,
    ledgerRecords: historyBeforeReversion,
  });
  const retryB = planDelivery({
    targetDate,
    unitReports: turnoverReports,
    weather: dryWeather,
    ledgerRecords: historyBeforeReversion,
  });

  assert.equal(firstB.hash, revertedB.hash);
  assert.equal(firstB.contentOccurrence, 1);
  assert.equal(revertedB.contentOccurrence, 2);
  assert.equal(retryB.contentOccurrence, 2);

  const durableRetry = planDelivery({
    targetDate,
    unitReports: turnoverReports,
    weather: dryWeather,
    ledgerRecords: [
      initialRecord,
      firstBLedger,
      changedCRecord,
      { ...firstBLedger, contentOccurrence: 2, sentAt: "2026-07-28T09:20:00Z" },
    ],
  });
  assert.equal(durableRetry.duplicate?.contentOccurrence, 2);
  assert.equal(durableRetry.contentOccurrence, 2);

  const firstKey = deliveryIdempotencyKey({
    targetDate,
    chatId: "cleaners-chat",
    messageHash: firstB.hash,
    contentOccurrence: firstB.contentOccurrence,
  });
  const revertedKey = deliveryIdempotencyKey({
    targetDate,
    chatId: "cleaners-chat",
    messageHash: revertedB.hash,
    contentOccurrence: revertedB.contentOccurrence,
  });
  const retryKey = deliveryIdempotencyKey({
    targetDate,
    chatId: "cleaners-chat",
    messageHash: retryB.hash,
    contentOccurrence: retryB.contentOccurrence,
  });

  assert.notEqual(firstKey, revertedKey);
  assert.equal(revertedKey, retryKey);
  assert.match(revertedKey, /:occurrence-2$/);
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

function advanceBooking(overrides = {}) {
  return {
    sourceEnvelopeId: "database:advance-booking",
    sourceTimestamp: Date.parse("2026-06-03T17:14:47Z"),
    unitId: 3, unitLabel: "Unit 3", commonName: "Jasmine", listingName: "Jasmine Studio Stay",
    confirmationCode: "HMADVANCE", guestName: "Advance Guest", guests: "1 adult",
    checkIn: "2026-09-04", checkOut: "2026-09-07", evidenceKind: "confirmed",
    ...overrides,
  };
}

test("a confirmed advance booking survives the Gmail lookback and changes checkout-only to turnover", async () => {
  const checkout = advanceBooking({
    sourceEnvelopeId: "database:checkout", confirmationCode: "HMCHECKOUT", guestName: "Departing Guest",
    checkIn: "2026-09-03", checkOut: "2026-09-04", guests: "2 adults",
  });
  const result = await runReport({
    mode: "preview", targetDate: "2026-09-04", storedReservations: [checkout, advanceBooking()],
    collectMessagesFn: async ({ afterDate }) => {
      assert.equal(afterDate, "2026-06-06");
      return { envelopesFound: 0, messages: [] };
    },
    fetchWeatherFn: async () => dryWeather,
    authoritativeLedgerRecords: [], workDir: "/tmp",
  });
  assert.equal(result.confidence.ok, true);
  assert.equal(result.unitReports[2].action, "turnover");
  assert.deepEqual(result.unitReports[2].arrivals, ["Advance Guest (1 adult)"]);
  assert.deepEqual(result.reservationEvidence, []);
  const previous = planDelivery({
    targetDate: parseISODate("2026-09-04"),
    unitReports: classifyUnits([checkout], parseISODate("2026-09-04")), weather: dryWeather, ledgerRecords: [],
  });
  const updated = planDelivery({
    targetDate: parseISODate("2026-09-04"),
    unitReports: classifyUnits(result.reservations, parseISODate("2026-09-04")), weather: dryWeather,
    ledgerRecords: [{ targetDate: "2026-09-04", messageHash: previous.hash, messageText: previous.message, sentAt: "2026-09-03T11:30:00Z", weather: dryWeather }],
  });
  assert.equal(updated.isUpdate, true);
  assert.equal(updated.duplicate, undefined);
});

test("fresh cancellation still removes a stored advance booking", async () => {
  const collected = await collectReservations(parseISODate("2026-09-04"), 90, 80, async () => ({
    envelopesFound: 1,
    messages: [{
      envelope: { id: "fresh-cancellation", date: "2026-09-04T06:00:00Z", subject: "Canceled: Reservation HMADVANCE" },
      body: "The reservation was canceled.\nCONFIRMATION CODE\nHMADVANCE",
    }],
  }), 8, [advanceBooking()]);
  assert.deepEqual(collected.reservations, []);
  assert.equal(collected.evidence.length, 1);
});

test("stored cancellations and newer revisions cannot regress to older email snapshots", () => {
  const old = advanceBooking({ sourceEnvelopeId: "old-confirmation" });
  const cancelled = advanceBooking({ evidenceKind: "cancelled", cancelled: true, sourceTimestamp: Date.parse("2026-09-02T10:00:00Z") });
  assert.deepEqual(mergeReservations([cancelled, old]), []);
  const newer = advanceBooking({ sourceTimestamp: Date.parse("2026-09-02T10:00:00Z"), checkIn: "2026-09-07", checkOut: "2026-09-10", guests: "2 adults" });
  const [merged] = mergeReservations([newer, old]);
  assert.equal(merged.checkIn, "2026-09-07");
  assert.equal(merged.guests, "2 adults");
  const [updated] = mergeReservations([newer, {
    ...old, sourceEnvelopeId: "fresh-update", evidenceKind: "supplemental", evidenceSubtype: "update",
    sourceTimestamp: Date.parse("2026-09-04T06:00:00Z"), checkIn: "2026-09-08", checkOut: "2026-09-11", guests: "1 adult",
  }]);
  assert.equal(updated.checkIn, "2026-09-08");
  assert.equal(updated.guests, "1 adult");
});

test("cleaners-chat history participates in duplicate detection", () => {
  const unitReports = classifyUnits(turnoverReservations(), targetDate);
  const message = buildMessage({ targetDate, unitReports, weather: dryWeather });
  const providerNormalizedMessage = message.replace(/\s+/g, " ");
  const chatMessages = [{ text: providerNormalizedMessage, timestamp: "2026-07-27T11:31:00Z", from_me: true }];
  const records = chatLedgerRecords(chatMessages, targetDate);
  const delivery = planDelivery({ targetDate, unitReports, weather: dryWeather, ledgerRecords: records });

  assert.equal(records.length, 1);
  assert.equal(records[0].messageText, providerNormalizedMessage);
  assert.deepEqual(records[0].weather, dryWeather);
  assert.equal(records[0].isUpdate, false);
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
    contentOccurrence: 1,
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

test("scheduled delivery attempts reuse a content-occurrence provider idempotency key", () => {
  const shared = { targetDate, chatId: "cleaners-chat", messageHash: "message-hash" };
  const first = deliveryIdempotencyKey({ ...shared, deliveryAttemptId: "run-1" });
  const retry = deliveryIdempotencyKey({ ...shared, deliveryAttemptId: "run-2" });

  assert.equal(first, retry);
  assert.notEqual(first, deliveryIdempotencyKey({ ...shared, contentOccurrence: 2 }));
  assert.equal(
    deliveryIdempotencyKey({ ...shared, contentOccurrence: 2, deliveryAttemptId: "run-2" }),
    deliveryIdempotencyKey({ ...shared, contentOccurrence: 2, deliveryAttemptId: "run-3" }),
  );
  assert.notEqual(first, deliveryIdempotencyKey({ ...shared, messageHash: "changed-message" }));
  assert.notEqual(first, deliveryIdempotencyKey({ ...shared, chatId: "different-chat" }));
  assert.throws(() => deliveryIdempotencyKey({ ...shared, contentOccurrence: 0 }), /positive integer/);
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
  let ledgerRecord;
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
    appendLedgerFn: (record) => {
      ledgerRecord = record;
      order.push("append");
    },
  });

  assert.equal(result.status, "sent");
  assert.deepEqual(order, ["dry-run", "send", "verify", "append"]);
  assert.equal(ledgerRecord.contentOccurrence, 1);
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

test("private final-failure alerts require exact chat readback", async () => {
  const targetDate = "2026-08-24";
  const incidentId = `delivery:${targetDate}`;
  const expectedText = [
    `Airbnb cleaner report failed after the final cloud retry for ${targetDate}.`,
    `Incident: ${incidentId}`,
    "Check the private Fly status endpoint and sanitized run receipt.",
  ].join("\n");
  const calls = [];
  const result = await sendFinalFailureAlert(
    { targetDate },
    {
      env: {
        MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://customer-api.example",
        MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "test-key",
        AIRBNB_WHATSAPP_ACCOUNT_ID: "account-id",
        AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
        AIRBNB_WHATSAPP_ALERT_CHAT_ID: "management@g.us",
      },
      whatsappSendFn: async (request) => {
        calls.push(["send", request.dryRun, request.targetChatId, request.idempotencyKey]);
        return { attempts: 1 };
      },
      fetchChatMessagesFn: async (limit, options) => {
        calls.push(["read", limit, options.targetChatId]);
        return [{ from_me: true, text: expectedText }];
      },
    },
  );

  assert.equal(result.verifiedFromChat, true);
  assert.equal(result.incidentId, incidentId);
  assert.deepEqual(calls.map((call) => call[0]), ["send", "send", "read"]);
  assert.ok(calls.every((call) => call[0] !== "send" || call[2] === "management@g.us"));
  assert.equal(calls[2][2], "management@g.us");
  assert.equal(calls[0][3], calls[1][3]);
});

test("final-failure retries reuse one incident-scoped provider key across run IDs", async () => {
  const targetDate = "2026-08-24";
  const sends = [];
  let expectedText = "";
  const dependencies = {
    env: {
      MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://customer-api.example",
      MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "test-key",
      AIRBNB_WHATSAPP_ACCOUNT_ID: "account-id",
      AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
      AIRBNB_WHATSAPP_ALERT_CHAT_ID: "management@g.us",
    },
    whatsappSendFn: async (request) => {
      sends.push(request);
      if (!request.dryRun) expectedText = request.text;
      return { attempts: 1 };
    },
    fetchChatMessagesFn: async () => [{ from_me: true, text: expectedText }],
  };

  await sendFinalFailureAlert({ targetDate, runId: "first-run" }, dependencies);
  await sendFinalFailureAlert({ targetDate, runId: "retry-run" }, dependencies);

  const liveSends = sends.filter((request) => request.dryRun === false);
  assert.equal(liveSends.length, 2);
  assert.equal(liveSends[0].idempotencyKey, liveSends[1].idempotencyKey);
  assert.equal(liveSends[0].text, liveSends[1].text);
  assert.doesNotMatch(liveSends[0].text, /first-run|retry-run/);

  const databaseIncident = [];
  await sendFinalFailureAlert(
    { targetDate, runId: "database-run", reason: "database_sync" },
    {
      ...dependencies,
      whatsappSendFn: async (request) => {
        databaseIncident.push(request);
        if (!request.dryRun) expectedText = request.text;
        return { attempts: 1 };
      },
    },
  );
  assert.notEqual(liveSends[0].idempotencyKey, databaseIncident[1].idempotencyKey);
});
