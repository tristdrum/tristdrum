import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTOMATED_REPLY_FOOTER,
  canonicalConversationActor,
  conversationEntryKey,
  finalSendDecision,
  parseAirbnbConversationEmail,
  supportDisposition,
  withAutomatedReplyFooter,
} from "@tristdrum/airbnb-core";

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/historical-support.json", import.meta.url), "utf8"),
);

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
  test(`historical support evidence: ${fixture.id}`, () => {
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
    const disposition = supportDisposition(fixture.classification);
    assert.equal(disposition.autoReply, fixture.expected.autoReply);
    assert.equal(disposition.status, fixture.expected.status);
    assert.equal(disposition.alertManagement, fixture.expected.alertManagement);

    if (disposition.autoReply) {
      const rendered = withAutomatedReplyFooter(fixture.classification.draft);
      assert.ok(rendered.endsWith(AUTOMATED_REPLY_FOOTER));
      assert.equal(withAutomatedReplyFooter(rendered), rendered);
    }
  });
}

for (const fixture of corpus.sendRaces) {
  test(`historical support final-send race: ${fixture.id}`, () => {
    assert.match(fixture.outboundMessageId, /^<support-race-[a-z]+@example\.test>$/);
    assert.deepEqual(finalSendDecision(fixture), fixture.expected);
  });
}
