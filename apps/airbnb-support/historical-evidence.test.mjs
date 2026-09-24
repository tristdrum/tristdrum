import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalConversationActor,
  conversationEntryKey,
  finalSendDecision,
  parseAirbnbConversationEmail,
} from "@tristdrum/airbnb-core";
import { decideGuestResponse } from "./agent.mjs";

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/historical-support.json", import.meta.url), "utf8"),
);

const ADJUDICATED_DECISIONS = Object.freeze({
  greeting: {
    alertManagement: false,
    draft: "Hello! We’re looking forward to hosting you.",
  },
  wifi: {
    alertManagement: false,
    draft: "Of course, I’ll resend the verified Wi-Fi details now.",
  },
  directions: {
    alertManagement: false,
    draft: "Of course, I’ll send the verified directions to the studio now.",
  },
  "check-in-time": {
    alertManagement: false,
    draft: "Standard check-in is from 15:00.",
  },
  "unanswered-request": {
    alertManagement: true,
    draft: "I’m sorry you’ve been waiting. Please bear with us while we arrange a proper response from the hosts.",
  },
  "booking-question": {
    alertManagement: true,
    draft: "Thanks for checking. We’ve asked the hosts to review the requested change; nothing has been changed yet.",
  },
  complaint: {
    alertManagement: true,
    draft: "I’m sorry the studio wasn’t clean. We’re arranging help so this can be handled quickly.",
  },
  "exception-request": {
    alertManagement: false,
    draft: "I’m sorry, but we can’t offer a late check-out. Standard check-out is by 10:00.",
  },
  "early-check-in-conditional": {
    alertManagement: false,
    draft: "We’ll do our best to have the studio ready by 13:00, depending on cleaning, but the earlier time can’t be guaranteed.",
  },
  "late-checkout-eleven": {
    alertManagement: false,
    draft: "I’m sorry, but we can’t offer a late check-out. Standard check-out is by 10:00.",
  },
  "late-checkout-after-eleven": {
    alertManagement: false,
    draft: "I’m sorry, but we can’t offer a late check-out. Standard check-out is by 10:00.",
  },
});

function modelDecision(value) {
  return async () => ({
    ok: true,
    async json() {
      return { output_text: JSON.stringify(value) };
    },
  });
}

function parseFixture(fixture) {
  return parseAirbnbConversationEmail({
    providerMessageId: fixture.providerMessageId,
    subject: fixture.subject,
    body: fixture.bodyLines.join("\n"),
    from: "express@airbnb.com",
    occurredAt: fixture.occurredAt,
  });
}

test("historical support corpus is bounded and explicitly anonymized", () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.anonymization.rawMailboxContentCopied, false);
  assert.ok(corpus.conversations.length >= 9 && corpus.conversations.length <= 12);
  assert.equal(corpus.sendRaces.length, 4);

  const ids = new Set();
  for (const fixture of corpus.conversations) {
    assert.match(fixture.providerMessageId, /^<support-fixture-\d+@example\.test>$/);
    assert.match(fixture.providerThreadId, /^990000\d{4}$/);
    assert.equal(ids.has(fixture.providerThreadId), false);
    ids.add(fixture.providerThreadId);
    assert.doesNotMatch(fixture.bodyLines.join("\n"), /\b(?:Jane|Tristan)\b/i);
  }
});

for (const fixture of corpus.conversations) {
  test(`historical support evidence: ${fixture.id}`, async () => {
    const parsed = parseFixture(fixture);
    assert.ok(parsed, "fixture must parse as a trusted Airbnb conversation");
    assert.equal(parsed.providerThreadId, fixture.providerThreadId);
    assert.equal(parsed.listingName, fixture.listingName);
    assert.deepEqual(parsed.entries.map((entry) => entry.direction), fixture.expected.directions);

    const latest = parsed.entries.at(-1);
    assert.equal(latest.name, fixture.expected.latestName);
    assert.equal(latest.text, fixture.expected.latestText);

    const entryKeys = parsed.entries.map((entry) => conversationEntryKey(parsed.providerThreadId, entry));
    assert.equal(new Set(entryKeys).size, entryKeys.length);
    assert.deepEqual(
      entryKeys,
      parsed.entries.map((entry) => conversationEntryKey(parsed.providerThreadId, entry)),
      "conversation keys must be stable across replay",
    );

    for (const entry of parsed.entries.filter((item) => item.direction === "host")) {
      assert.deepEqual(canonicalConversationActor({
        airbnbRoleLabel: `${entry.name} / ${entry.role}`,
      }), {
        direction: "host",
        hostIdentity: null,
      });
    }

    if (fixture.expected.supportCandidate === false) {
      assert.equal(latest.direction, "host");
      assert.equal(fixture.expected.hostIdentity, null);
      return;
    }

    assert.equal(latest.direction, "guest");
    const adjudicated = ADJUDICATED_DECISIONS[fixture.id];
    assert.ok(adjudicated, `fixture ${fixture.id} needs an adjudicated adaptive decision`);
    const decision = await decideGuestResponse({
      guestMessage: latest.text,
      guestName: latest.name,
      listingName: parsed.listingName,
      stayLabel: parsed.stayLabel,
      latestEventAt: fixture.occurredAt,
      conversationContext: parsed.entries.map((entry) => ({
        direction: entry.direction,
        text: entry.text,
      })),
      facts: {
        checkInTime: "15:00",
        checkOutTime: "10:00",
        earliestCheckInTime: "13:00",
        wifi: "Verified fixture Wi-Fi details",
        directions: "Verified fixture directions",
      },
      env: { OPENAI_API_KEY: "test-key" },
      fetchFn: modelDecision({
        replyNeeded: true,
        sendReply: true,
        alertManagement: adjudicated.alertManagement,
        summary: `Adjudicated historical case: ${fixture.id}`,
        draft: adjudicated.draft,
      }),
    });
    assert.equal(decision.autoReply, true);
    assert.equal(decision.alertManagement, adjudicated.alertManagement);
    assert.equal(decision.status, "approved_for_guard");
  });
}

for (const fixture of corpus.sendRaces) {
  test(`historical support final-send race: ${fixture.id}`, () => {
    assert.match(fixture.outboundMessageId, /^<support-race-[a-z]+@example\.test>$/);
    assert.deepEqual(finalSendDecision(fixture), fixture.expected);
  });
}
