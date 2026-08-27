import test from "node:test";
import assert from "node:assert/strict";

import { collectAirbnbMessages } from "./gmail.mjs";
import { parseISODate, parseReservation, reservationEvidenceKind } from "./report.mjs";

test("filters envelopes before fetching MIME bodies and always closes IMAP", async () => {
  const calls = [];
  const client = {
    usable: true,
    async connect() { calls.push("connect"); },
    async getMailboxLock(folder) {
      calls.push(`lock:${folder}`);
      return { release: () => calls.push("release") };
    },
    async search(query) {
      calls.push(`search:${query.from}`);
      return [11, 12];
    },
    async *fetch() {
      yield {
        uid: 11,
        internalDate: new Date("2026-08-06T10:00:00Z"),
        envelope: { subject: "Reservation confirmed - Guest arrives Aug 7", from: [{ name: "Airbnb", address: "automated@airbnb.com" }] },
      };
      yield {
        uid: 12,
        internalDate: new Date("2026-08-06T11:00:00Z"),
        envelope: { subject: "Receipt", from: [{ name: "Airbnb", address: "automated@airbnb.com" }] },
      };
    },
    async fetchOne(uid) {
      calls.push(`source:${uid}`);
      return { source: Buffer.from("From: Airbnb <automated@airbnb.com>\r\nSubject: Reservation\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nReservation body\r\n") };
    },
    async logout() { calls.push("logout"); },
    close() { calls.push("close"); },
  };

  const result = await collectAirbnbMessages({
    afterDate: "2026-05-09",
    maxRead: 10,
    env: { AIRBNB_GMAIL_USER: "test@example.com", AIRBNB_GMAIL_APP_PASSWORD: "not-a-real-secret" },
    createClient: () => client,
    candidateEnvelope: (envelope) => !/Receipt/.test(envelope.subject),
    subjectMayTouchTarget: () => true,
  });

  assert.equal(result.envelopesFound, 1);
  assert.equal(result.messages[0].body.trim(), "Reservation body");
  assert.deepEqual(calls, ["connect", "lock:[Gmail]/All Mail", "search:airbnb.com", "source:11", "release", "logout"]);
});

test("missing credentials fails before creating an IMAP client", async () => {
  let created = false;
  await assert.rejects(
    collectAirbnbMessages({
      afterDate: "2026-05-09",
      maxRead: 10,
      env: {},
      createClient: () => { created = true; },
      candidateEnvelope: () => true,
      subjectMayTouchTarget: () => true,
    }),
    /AIRBNB_GMAIL_USER/
  );
  assert.equal(created, false);
});

test("the MIME read cap preserves an older confirmation ahead of supplemental replies", async () => {
  const fetched = [];
  const envelopes = [
    { uid: 31, date: "2026-07-15T09:00:00Z", subject: "Reservation confirmed - Stephanie arrives Aug 25" },
    { uid: 32, date: "2026-08-24T15:43:00Z", subject: "RE: Reservation for Jasmine Studio Stay, Aug 25 - 30" },
    { uid: 33, date: "2026-08-25T11:43:00Z", subject: "RE: Reservation for Jasmine Studio Stay, Aug 25 - 30" },
  ];
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return envelopes.map(({ uid }) => uid); },
    async *fetch() {
      for (const envelope of envelopes) {
        yield {
          uid: envelope.uid,
          internalDate: new Date(envelope.date),
          envelope: { subject: envelope.subject, from: [{ address: "automated@airbnb.com" }] },
        };
      }
    },
    async fetchOne(uid) {
      fetched.push(uid);
      return { source: Buffer.from(`From: Airbnb <automated@airbnb.com>\r\nSubject: Airbnb\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nmessage ${uid}\r\n`) };
    },
    async logout() {},
    close() {},
  };
  const result = await collectAirbnbMessages({
    afterDate: "2026-05-27",
    maxRead: 2,
    env: { AIRBNB_GMAIL_USER: "test@example.com", AIRBNB_GMAIL_APP_PASSWORD: "not-a-real-secret" },
    createClient: () => client,
    candidateEnvelope: () => true,
    subjectMayTouchTarget: () => true,
    describeEvidence: ({ envelope }) => ({
      evidenceKind: /^Reservation confirmed/i.test(envelope.subject) ? "confirmed" : "supplemental",
      evidenceSubtype: /^Reservation confirmed/i.test(envelope.subject) ? "confirmed" : "reply",
    }),
  });

  assert.equal(result.envelopesFound, 2);
  assert.deepEqual(fetched, [33, 31]);
  assert.deepEqual(result.messages.map(({ envelope }) => envelope.id), ["33", "31"]);
});

test("collection includes a date-less accepted reservation change notice", async () => {
  const fetched = [];
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [51]; },
    async *fetch() {
      yield {
        uid: 51,
        internalDate: new Date("2026-08-27T07:09:00Z"),
        envelope: {
          subject: "Your reservation change was accepted",
          from: [{ address: "automated@airbnb.com" }],
        },
      };
    },
    async fetchOne(uid) {
      fetched.push(uid);
      return { source: Buffer.from(
        "From: Airbnb <automated@airbnb.com>\r\nSubject: Your reservation change was accepted\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhttps://airbnb.example/hosting/reservations/details/HMCHANGE01\r\n",
      ) };
    },
    async logout() {},
    close() {},
  };
  const result = await collectAirbnbMessages({
    afterDate: "2026-05-30",
    maxRead: 10,
    env: { AIRBNB_GMAIL_USER: "test@example.com", AIRBNB_GMAIL_APP_PASSWORD: "not-a-real-secret" },
    createClient: () => client,
    candidateEnvelope: () => true,
    subjectMayTouchTarget: (subject) => /reservation change was accepted/i.test(subject),
    describeEvidence: ({ envelope, body }) => ({
      evidenceKind: /accepted/i.test(envelope.subject) ? "supplemental" : "ignored",
      evidenceSubtype: /accepted/i.test(envelope.subject) ? "update" : "ignored",
      confirmationCode: /details\/([A-Z0-9]+)/i.exec(body)?.[1] ?? "",
    }),
  });

  assert.equal(result.envelopesFound, 1);
  assert.deepEqual(fetched, [51]);
  assert.equal(result.messages[0].envelope.subject, "Your reservation change was accepted");
});

test("an accepted change recovers its bounded matching Airbnb thread context beyond the read cap", async () => {
  const envelopes = new Map([
    [50, { uid: 50, date: "2026-08-27T06:29:00Z", subject: "Reservation confirmed - Alpha Guest arrives Aug 28", from: "automated@airbnb.com" }],
    [51, { uid: 51, date: "2026-08-27T07:09:00Z", subject: "Your reservation change was accepted", from: "automated@airbnb.com" }],
    [52, { uid: 52, date: "2026-08-27T06:31:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Aug 28 - 29", from: "express@airbnb.com" }],
    [53, { uid: 53, date: "2026-08-27T07:11:00Z", subject: "RE: Reservation for Bougainvillea Courtyard Studio, Aug 28 - 29", from: "express@airbnb.com" }],
  ]);
  const bodies = {
    50: "NEW BOOKING CONFIRMED! ALPHA GUEST ARRIVES AUG 28.\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n1 adult\nCONFIRMATION CODE\nHMCHANGE01",
    51: "ALPHA GUEST AGREED TO CHANGE THEIR RESERVATION\nBougainvillea Courtyard Studio\nhttps://airbnb.example/hosting/reservations/details/HMCHANGE01\nhttps://airbnb.example/messaging/thread/2647000000",
    52: "ALPHA GUEST\nBooker\nI am alone but someone may join me. Is that okay?\nReply\nhttps://airbnb.example/hosting/thread/2647000000\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n1 adult",
    53: "ALPHA GUEST\nBooker\nI will update the booking now.\nReply\nhttps://airbnb.example/hosting/thread/2647000000\nBougainvillea Courtyard Studio\nCheck-in Checkout\nAugust 28, 2026\nAugust 29, 2026\nGUESTS\n2 adults",
  };
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) {
      if (query.subject === "RE: Reservation") return [...envelopes.keys()];
      return [...envelopes.keys()];
    },
    async *fetch(uids) {
      for (const uid of uids) {
        const envelope = envelopes.get(uid);
        yield {
          uid,
          internalDate: new Date(envelope.date),
          envelope: { subject: envelope.subject, from: [{ address: envelope.from }] },
        };
      }
    },
    async fetchOne(uid) {
      const envelope = envelopes.get(uid);
      return { source: Buffer.from(
        `From: Airbnb <${envelope.from}>\r\nSubject: ${envelope.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${bodies[uid]}\r\n`,
      ) };
    },
    async logout() {},
    close() {},
  };
  const targetDate = parseISODate("2026-08-28");
  const describeEvidence = ({ envelope, body }) => {
    const evidenceKind = reservationEvidenceKind(envelope.subject, body);
    const parsed = body ? parseReservation(envelope, body, targetDate) : null;
    return {
      evidenceKind,
      evidenceSubtype: evidenceKind === "confirmed" ? "confirmed"
        : /accepted/i.test(envelope.subject) ? "update" : "reply",
      confirmationCode: parsed?.confirmationCode ?? "",
      providerThreadId: parsed?.providerThreadId ?? "",
      guestCountChangeAccepted: parsed?.guestCountChangeAccepted === true,
    };
  };
  const result = await collectAirbnbMessages({
    afterDate: "2026-05-30",
    maxRead: 2,
    env: { AIRBNB_GMAIL_USER: "test@example.com", AIRBNB_GMAIL_APP_PASSWORD: "not-a-real-secret" },
    createClient: () => client,
    candidateEnvelope: () => true,
    subjectMayTouchTarget: () => true,
    describeEvidence,
  });

  assert.equal(result.envelopesFound, 2);
  assert.deepEqual(new Set(result.messages.map(({ envelope }) => envelope.id)), new Set(["50", "51", "52", "53"]));
});

test("fetches the original confirmation when a target-date update changes the booking dates", async () => {
  const calls = [];
  const envelopes = [
    { uid: 21, date: "2026-08-13T10:00:00Z", subject: "Reservation updated for HMANCHOR1" },
    { uid: 22, date: "2026-08-01T10:00:00Z", subject: "Reservation confirmed - Anchor Guest arrives Aug 20" },
    { uid: 23, date: "2026-08-02T10:00:00Z", subject: "Reservation confirmed - Other Guest arrives Aug 18" },
  ];
  const bodies = {
    21: "Reservation update\nCONFIRMATION CODE\nHMANCHOR1",
    22: "Confirmed booking\nCONFIRMATION CODE\nHMANCHOR1",
    23: "Confirmed booking\nCONFIRMATION CODE\nHMOTHER1",
  };
  const source = (uid) => Buffer.from(
    `From: Airbnb <automated@airbnb.com>\r\nSubject: Reservation\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${bodies[uid]}\r\n`
  );
  const client = {
    usable: true,
    async connect() { calls.push("connect"); },
    async getMailboxLock() { return { release: () => calls.push("release") }; },
    async search() { return envelopes.map(({ uid }) => uid); },
    async *fetch() {
      for (const envelope of envelopes) {
        yield {
          uid: envelope.uid,
          internalDate: new Date(envelope.date),
          envelope: { subject: envelope.subject, from: [{ name: "Airbnb", address: "automated@airbnb.com" }] },
        };
      }
    },
    async fetchOne(uid) {
      calls.push(`source:${uid}`);
      return { source: source(uid) };
    },
    async logout() { calls.push("logout"); },
    close() { calls.push("close"); },
  };

  const describeEvidence = ({ envelope, body }) => {
    const evidenceKind = /updated/i.test(envelope.subject)
      ? "supplemental"
      : /confirmed/i.test(envelope.subject) ? "confirmed" : "ignored";
    return {
      evidenceKind,
      evidenceSubtype: evidenceKind === "supplemental" ? "update" : evidenceKind,
      confirmationCode: /CONFIRMATION CODE\s+([A-Z0-9]+)/i.exec(body)?.[1] ?? "",
    };
  };
  const result = await collectAirbnbMessages({
    afterDate: "2026-05-15",
    maxRead: 10,
    env: { AIRBNB_GMAIL_USER: "test@example.com", AIRBNB_GMAIL_APP_PASSWORD: "not-a-real-secret" },
    createClient: () => client,
    candidateEnvelope: () => true,
    subjectMayTouchTarget: (subject) => /updated/i.test(subject),
    describeEvidence,
  });

  assert.equal(result.envelopesFound, 1);
  assert.equal(result.missingConfirmationAnchorCount, 0);
  assert.deepEqual(result.messages.map(({ envelope }) => envelope.id), ["21", "22"]);
  assert.deepEqual(calls, ["connect", "source:21", "source:23", "source:22", "release", "logout"]);
});

test("recovers a confirmation anchor by code when it predates the ordinary lookback", async () => {
  const calls = [];
  let anchorQuery = null;
  const envelopes = new Map([
    [40, { uid: 40, date: "2026-01-10T10:00:00Z", subject: "Reservation confirmed - Historical Guest arrives Aug 20" }],
    [41, { uid: 41, date: "2026-08-25T10:00:00Z", subject: "Reservation updated for HMHISTORIC1" }],
  ]);
  const bodies = {
    40: "Confirmed booking\nCONFIRMATION CODE\nHMHISTORIC1",
    41: "Reservation update\nCONFIRMATION CODE\nHMHISTORIC1",
  };
  const client = {
    usable: true,
    async connect() { calls.push("connect"); },
    async getMailboxLock() { return { release: () => calls.push("release") }; },
    async search(query) {
      if (query.body) {
        anchorQuery = query;
        calls.push(`anchor-search:${query.body}`);
        return [40, 41];
      }
      calls.push("window-search");
      return [41];
    },
    async *fetch(uids) {
      for (const uid of uids) {
        const envelope = envelopes.get(uid);
        yield {
          uid,
          internalDate: new Date(envelope.date),
          envelope: { subject: envelope.subject, from: [{ name: "Airbnb", address: "automated@airbnb.com" }] },
        };
      }
    },
    async fetchOne(uid) {
      calls.push(`source:${uid}`);
      return { source: Buffer.from(
        `From: Airbnb <automated@airbnb.com>\r\nSubject: ${envelopes.get(uid).subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${bodies[uid]}\r\n`,
      ) };
    },
    async logout() { calls.push("logout"); },
    close() {},
  };
  const describeEvidence = ({ envelope, body }) => {
    const evidenceKind = /updated/i.test(envelope.subject)
      ? "supplemental"
      : /confirmed/i.test(envelope.subject) ? "confirmed" : "ignored";
    return {
      evidenceKind,
      evidenceSubtype: evidenceKind === "supplemental" ? "update" : evidenceKind,
      confirmationCode: /CONFIRMATION CODE\s+([A-Z0-9]+)/i.exec(body)?.[1] ?? "",
    };
  };

  const result = await collectAirbnbMessages({
    afterDate: "2026-05-27",
    maxRead: 10,
    env: { AIRBNB_GMAIL_USER: "test@example.com", AIRBNB_GMAIL_APP_PASSWORD: "not-a-real-secret" },
    createClient: () => client,
    candidateEnvelope: () => true,
    subjectMayTouchTarget: (subject) => /updated/i.test(subject),
    describeEvidence,
  });

  assert.equal(result.missingConfirmationAnchorCount, 0);
  assert.equal(anchorQuery.body, "HMHISTORIC1");
  assert.ok(anchorQuery.since < new Date("2026-05-27T00:00:00Z"));
  assert.deepEqual(result.messages.map(({ envelope }) => envelope.id), ["41", "40"]);
  assert.deepEqual(calls, [
    "connect",
    "window-search",
    "source:41",
    "anchor-search:HMHISTORIC1",
    "source:40",
    "release",
    "logout",
  ]);
});
