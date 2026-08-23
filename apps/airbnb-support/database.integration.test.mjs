import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { parseAirbnbConversationEmail } from "@tristdrum/airbnb-core";
import { createAirbnbDatabase } from "@tristdrum/airbnb-db";
import {
  applyDeliveryGuardDecision,
  claimDeliveryForGuard,
  ingestConversation,
  ingestSupplementalConversation,
  loadDeliveryGuardCandidates,
  loadSuppressedSupportAlerts,
  loadShadowCandidates,
  markSupportAlertNotified,
  recordAmbiguousDeliveryFailure,
  recordDeliveryAttempt,
  storeShadowDraft,
} from "./repository.mjs";

const adminUrl = process.env.AIRBNB_INTEGRATION_DATABASE_URL;
const householdId = randomUUID();
const ownerId = randomUUID();
const localPassword = "airbnb-support-local-integration-only";

function isLoopbackDatabase(url) {
  const hostname = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

if (adminUrl && !isLoopbackDatabase(adminUrl)) {
  throw new Error("AIRBNB_INTEGRATION_DATABASE_URL must target a loopback database.");
}

function roleUrl(url) {
  const parsed = new URL(url);
  parsed.username = "airbnb_support_delivery_runtime_test";
  parsed.password = localPassword;
  return parsed.toString();
}

function emailFixture({ mailboxScope, providerMessageId, occurredAt, providerThreadId = "9876543210" }) {
  return {
    mailboxScope,
    providerMessageId,
    subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    from: "express@airbnb.com",
    replyTo: "express@airbnb.com",
    references: ["<older@example.test>"],
    inReplyTo: "<older@example.test>",
    occurredAt,
    body: [
      "Reservation for Jasmine Studio Stay, Aug 22 - 23",
      `https://www.airbnb.test/hosting/thread/${providerThreadId}`,
      "Guest Fixture",
      "Guest",
      "Hello, could you help?",
    ].join("\n"),
  };
}

test("support repository keeps Jane supplemental, stages alerts once, and guards delivery atomically", {
  skip: !adminUrl,
}, async () => {
  const admin = postgres(adminUrl, { max: 1, prepare: false });
  let database;
  try {
    await admin.unsafe(`
      do $roles$
      begin
        if not exists (select 1 from pg_roles where rolname = 'airbnb_support_delivery_runtime_test') then
          create role airbnb_support_delivery_runtime_test login password '${localPassword}';
        else
          alter role airbnb_support_delivery_runtime_test password '${localPassword}';
        end if;
      end
      $roles$;
      grant airbnb_support_worker to airbnb_support_delivery_runtime_test;
    `);
    await admin`
      insert into auth.users (id, email)
      values (${ownerId}, ${`airbnb-support-${ownerId}@example.invalid`})
    `;
    await admin`
      insert into public.households (id, name, created_by)
      values (${householdId}, 'Airbnb Support Integration Household', ${ownerId})
    `;
    await admin`
      insert into airbnb.worker_identities (role_name, household_id, service)
      values ('airbnb_support_delivery_runtime_test', ${householdId}, 'support')
      on conflict (role_name)
      do update set household_id = excluded.household_id, service = excluded.service
    `;
    await admin`
      insert into airbnb.properties (household_id, unit_number, listing_name, common_name)
      values (${householdId}, 3, 'Jasmine Studio Stay', 'Jasmine')
    `;
    database = createAirbnbDatabase({
      postgresFactory: postgres,
      url: roleUrl(adminUrl),
      env: { AIRBNB_HOUSEHOLD_ID: householdId, AIRBNB_SERVICE_NAME: "airbnb-support-integration" },
    });

    const canonicalEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<canonical-${randomUUID()}@example.test>`,
      occurredAt: "2026-08-21T12:00:00.000Z",
    });
    const parsed = parseAirbnbConversationEmail(canonicalEmail);
    await ingestConversation(database.sql, { householdId, email: canonicalEmail, parsed });
    const beforeSupplement = (await admin`
      select
        (select count(*)::integer from airbnb.guest_threads where household_id = ${householdId}) as threads,
        (select count(*)::integer from airbnb.guest_messages where household_id = ${householdId}) as messages
    `)[0];

    const supplementalEmail = emailFixture({
      mailboxScope: "jane",
      providerMessageId: `<supplemental-${randomUUID()}@example.test>`,
      occurredAt: "2026-08-21T12:01:00.000Z",
    });
    const supplemental = await ingestSupplementalConversation(database.sql, {
      householdId,
      email: supplementalEmail,
      parsed: parseAirbnbConversationEmail(supplementalEmail),
    });
    assert.ok(supplemental.canonicalThreadId);
    const afterSupplement = (await admin`
      select
        (select count(*)::integer from airbnb.guest_threads where household_id = ${householdId}) as threads,
        (select count(*)::integer from airbnb.guest_messages where household_id = ${householdId}) as messages,
        (select count(*)::integer from airbnb.evidence where household_id = ${householdId} and mailbox_scope = 'jane') as jane_evidence
    `)[0];
    assert.deepEqual({
      threads: afterSupplement.threads,
      messages: afterSupplement.messages,
      janeEvidence: afterSupplement.jane_evidence,
    }, {
      threads: beforeSupplement.threads,
      messages: beforeSupplement.messages,
      janeEvidence: 1,
    });

    const candidates = await loadShadowCandidates(database.sql, { householdId, limit: 8 });
    assert.equal(candidates.length, 1);
    const classification = {
      topic: "unknown",
      riskTier: "unknown",
      confidence: 0,
      factsVerified: false,
      replyNeeded: true,
      summary: "Needs review.",
      draft: null,
      autoReply: false,
      status: "needs_human",
      alertManagement: true,
    };
    const checkedAt = new Date("2026-08-21T13:01:00.000Z");
    const draft = await storeShadowDraft(database.sql, {
      householdId,
      candidate: candidates[0],
      classification,
      now: checkedAt,
    });
    await storeShadowDraft(database.sql, {
      householdId,
      candidate: candidates[0],
      classification,
      now: checkedAt,
    });
    assert.deepEqual(draft.alertStages, ["immediate", "reminder", "overdue"]);
    const alerts = await admin`
      select details->>'stage' as stage
      from airbnb.alerts
      where household_id = ${householdId}
      order by details->>'stage'
    `;
    assert.deepEqual(alerts.map((row) => row.stage).sort(), ["immediate", "overdue", "reminder"]);
    const suppressedAlerts = await loadSuppressedSupportAlerts(database.sql, { householdId });
    const overdueAlert = suppressedAlerts.find((alert) => alert.details.stage === "overdue");
    await markSupportAlertNotified(database.sql, {
      householdId,
      alertId: overdueAlert.id,
      now: new Date("2026-08-21T13:01:30.000Z"),
    });
    const alertStates = await admin`
      select status, count(*)::integer as count
      from airbnb.alerts
      where household_id = ${householdId}
      group by status
      order by status
    `;
    assert.deepEqual(alertStates.map((row) => ({ ...row })), [
      { status: "notified", count: 1 },
      { status: "resolved", count: 2 },
    ]);

    await admin`
      update airbnb.reply_deliveries
      set status = 'approved', final_text = 'A reviewed reply.',
          approved_by = ${ownerId}, approved_at = '2026-08-21T13:01:30.000Z'
      where household_id = ${householdId} and id = ${draft.id}
    `;
    const claimed = await claimDeliveryForGuard(database.sql, {
      householdId,
      deliveryId: draft.id,
      now: new Date("2026-08-21T13:02:00.000Z"),
    });
    assert.equal(claimed.action, "claimed");
    assert.equal(claimed.sourceEvents.length, 1);
    const simultaneousClaim = await claimDeliveryForGuard(database.sql, {
      householdId,
      deliveryId: draft.id,
      now: new Date("2026-08-21T13:02:01.000Z"),
    });
    assert.equal(simultaneousClaim, null);
    await recordDeliveryAttempt(database.sql, {
      householdId,
      deliveryId: draft.id,
      now: new Date("2026-08-21T13:02:30.000Z"),
    });
    await applyDeliveryGuardDecision(database.sql, {
      householdId,
      deliveryId: draft.id,
      decision: { action: "handled_by_human", reason: "newer_host_event" },
      now: new Date("2026-08-21T13:03:00.000Z"),
    });
    const delivery = (await admin`
      select status, send_attempt_count
      from airbnb.reply_deliveries
      where household_id = ${householdId} and id = ${draft.id}
    `)[0];
    assert.deepEqual({ ...delivery }, { status: "handled_by_human", send_attempt_count: 0 });

    const ambiguousEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<ambiguous-${randomUUID()}@example.test>`,
      providerThreadId: "9876543211",
      occurredAt: "2026-08-21T14:00:00.000Z",
    });
    await ingestConversation(database.sql, {
      householdId,
      email: ambiguousEmail,
      parsed: parseAirbnbConversationEmail(ambiguousEmail),
    });
    const ambiguousCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 8 }))
      .find((candidate) => candidate.providerThreadId === "9876543211");
    const ambiguousDraft = await storeShadowDraft(database.sql, {
      householdId,
      candidate: ambiguousCandidate,
      classification,
      now: new Date("2026-08-21T14:01:00.000Z"),
    });
    await admin`
      update airbnb.reply_deliveries
      set status = 'approved', final_text = 'A reviewed reply.',
          approved_by = ${ownerId}, approved_at = '2026-08-21T14:01:30.000Z'
      where household_id = ${householdId} and id = ${ambiguousDraft.id}
    `;
    assert.equal((await loadDeliveryGuardCandidates(database.sql, {
      householdId,
      now: new Date("2026-08-21T14:02:00.000Z"),
      limit: 8,
    })).some((candidate) => candidate.id === ambiguousDraft.id), true);
    await claimDeliveryForGuard(database.sql, {
      householdId,
      deliveryId: ambiguousDraft.id,
      now: new Date("2026-08-21T14:02:00.000Z"),
    });
    await recordDeliveryAttempt(database.sql, {
      householdId,
      deliveryId: ambiguousDraft.id,
      now: new Date("2026-08-21T14:02:01.000Z"),
    });
    await recordAmbiguousDeliveryFailure(database.sql, {
      householdId,
      deliveryId: ambiguousDraft.id,
      error: new Error("SMTP connection closed after DATA"),
      now: new Date("2026-08-21T14:02:02.000Z"),
    });
    assert.equal((await admin`
      select status
      from airbnb.reply_deliveries
      where household_id = ${householdId} and id = ${ambiguousDraft.id}
    `)[0].status, "ambiguous");
    const ambiguousAlerts = await loadSuppressedSupportAlerts(database.sql, { householdId });
    assert.equal(
      ambiguousAlerts.some((alert) => (
        alert.details.stage === "delivery_ambiguous"
        && alert.details.replyDeliveryId === ambiguousDraft.id
      )),
      true,
    );
    assert.equal((await loadDeliveryGuardCandidates(database.sql, {
      householdId,
      now: new Date("2026-08-21T15:00:00.000Z"),
      limit: 8,
    })).some((candidate) => candidate.id === ambiguousDraft.id), false);
    assert.equal(await claimDeliveryForGuard(database.sql, {
      householdId,
      deliveryId: ambiguousDraft.id,
      now: new Date("2026-08-21T15:00:00.000Z"),
    }), null);
    assert.equal((await admin`
      select count(*)::integer as count
      from airbnb.audit_events
      where household_id = ${householdId} and actor_id = 'support'
    `)[0].count, 5);
  } finally {
    await database?.close();
    await admin.end({ timeout: 5 });
  }
});
