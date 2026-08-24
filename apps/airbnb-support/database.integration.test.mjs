import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { parseAirbnbConversationEmail } from "@tristdrum/airbnb-core";
import { createAirbnbDatabase } from "@tristdrum/airbnb-db";
import {
  applyDeliveryGuardDecision,
  cancelActiveGuestTimeRequests,
  claimDeliveryForGuard,
  ingestConversation,
  ingestSupplementalConversation,
  loadDeliveryGuardCandidates,
  loadSuppressedSupportAlerts,
  loadShadowCandidates,
  loadAwaitingReadyRequests,
  loadActiveGuestTimeRequestsForReplacement,
  loadDueReadinessRequests,
  loadReadyTimeRequests,
  markSupportAlertNotified,
  recordAmbiguousDeliveryFailure,
  recordDeliveryAttempt,
  storeOperationalGuestReply,
  storeShadowDraft,
  upsertGuestTimeRequest,
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

function emailFixture({
  mailboxScope,
  providerMessageId,
  occurredAt,
  providerThreadId = "9876543210",
  listingName = "Jasmine Studio Stay",
  entries = [{ name: "Guest Fixture", role: "Guest", text: "Hello, could you help?" }],
}) {
  return {
    mailboxScope,
    providerMessageId,
    subject: `RE: Reservation for ${listingName}, Aug 22 - 23`,
    from: "express@airbnb.com",
    replyTo: "express@airbnb.com",
    references: ["<older@example.test>"],
    inReplyTo: "<older@example.test>",
    occurredAt,
    body: [
      `Reservation for ${listingName}, Aug 22 - 23`,
      `https://www.airbnb.test/hosting/thread/${providerThreadId}`,
      ...entries.flatMap((entry) => [entry.name, entry.role, entry.text]),
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
      values (${householdId}, 3, 'Jasmine Studio Stay', 'Jasmine'),
             (${householdId}, 2, 'The Spekboom Studio', 'Spekboom')
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
    const timingRequest = await upsertGuestTimeRequest(database.sql, {
      householdId,
      candidate: candidates[0],
      request: {
        requestType: "early_checkin",
        action: "accept_conditional",
        stayDate: "2026-08-22",
        requestedTime: "13:00",
        effectiveTime: "13:00",
        unitNumber: 3,
        cleanerNoteEn: "Early check-in requested for 13:00.",
        cleanerNoteXh: "Kucelwe ukungena kwangethuba ngo-13:00.",
        readinessCheckAt: "2026-08-22T10:00:00.000Z",
      },
      now: new Date("2026-08-21T12:00:00.000Z"),
    });
    assert.equal(timingRequest.status, "accepted");
    await admin`
      update airbnb.guest_time_requests
      set status = 'cleaners_notified', cleaners_notified_at = '2026-08-22T09:00:00.000Z'
      where household_id = ${householdId} and id = ${timingRequest.id}
    `;
    assert.equal((await loadDueReadinessRequests(database.sql, {
      householdId,
      now: new Date("2026-08-22T10:00:00.000Z"),
    }))[0].id, timingRequest.id);
    assert.equal((await loadDueReadinessRequests(database.sql, {
      householdId,
      now: new Date("2026-08-23T10:00:00.000Z"),
    })).some((request) => request.id === timingRequest.id), false);
    await admin`
      update airbnb.guest_time_requests
      set status = 'awaiting_ready', readiness_prompted_at = '2026-08-22T10:00:00.000Z'
      where household_id = ${householdId} and id = ${timingRequest.id}
    `;
    assert.equal((await loadAwaitingReadyRequests(database.sql, {
      householdId,
      now: new Date("2026-08-23T10:00:00.000Z"),
    })).some((request) => request.id === timingRequest.id), false);
    await admin`
      update airbnb.guest_time_requests
      set status = 'ready', ready_at = '2026-08-22T10:01:00.000Z'
      where household_id = ${householdId} and id = ${timingRequest.id}
    `;
    assert.equal((await loadReadyTimeRequests(database.sql, {
      householdId,
      now: new Date("2026-08-22T11:01:00.000Z"),
    }))[0].id, timingRequest.id);
    assert.equal((await loadReadyTimeRequests(database.sql, {
      householdId,
      now: new Date("2026-08-23T11:01:00.000Z"),
    })).some((request) => request.id === timingRequest.id), false);
    const operationalReply = await storeOperationalGuestReply(database.sql, {
      householdId,
      requestId: timingRequest.id,
      threadId: candidates[0].id,
      draft: "The studio is ready.",
      now: new Date("2026-08-22T11:01:00.000Z"),
    });
    assert.ok(operationalReply?.id);
    assert.equal(await storeOperationalGuestReply(database.sql, {
      householdId,
      requestId: timingRequest.id,
      threadId: candidates[0].id,
      draft: "The studio is ready.",
      now: new Date("2026-08-22T11:02:00.000Z"),
    }), null);
    const replacementRequest = await upsertGuestTimeRequest(database.sql, {
      householdId,
      candidate: { ...candidates[0], sourceFingerprint: "replacement-time-fingerprint" },
      request: {
        requestType: "early_checkin",
        action: "accept_conditional",
        stayDate: "2026-08-22",
        requestedTime: "14:00",
        effectiveTime: "14:00",
        unitNumber: 3,
        cleanerNoteEn: "Early check-in requested for 14:00.",
        cleanerNoteXh: "Kucelwe ukungena kwangethuba ngo-14:00.",
        readinessCheckAt: "2026-08-22T11:00:00.000Z",
      },
      now: new Date("2026-08-22T11:02:00.000Z"),
    });
    assert.equal(replacementRequest.supersededCount, 1);
    assert.equal(replacementRequest.replacesPrevious, true);
    const replacementRetry = await upsertGuestTimeRequest(database.sql, {
      householdId,
      candidate: { ...candidates[0], sourceFingerprint: "replacement-time-fingerprint" },
      request: {
        requestType: "early_checkin",
        action: "accept_conditional",
        stayDate: "2026-08-22",
        requestedTime: "14:00",
        effectiveTime: "14:00",
        unitNumber: 3,
        cleanerNoteEn: "Early check-in requested for 14:00.",
        cleanerNoteXh: "Kucelwe ukungena kwangethuba ngo-14:00.",
        readinessCheckAt: "2026-08-22T11:00:00.000Z",
      },
      now: new Date("2026-08-22T11:02:30.000Z"),
    });
    assert.equal(replacementRetry.supersededCount, 0);
    assert.equal(replacementRetry.replacesPrevious, true);
    assert.equal((await admin`
      select status
      from airbnb.guest_time_requests
      where household_id = ${householdId} and id = ${timingRequest.id}
    `)[0].status, "cancelled");
    const returnToStandardCandidate = {
      ...candidates[0],
      sourceFingerprint: "return-to-standard-fingerprint",
    };
    assert.deepEqual(
      (await loadActiveGuestTimeRequestsForReplacement(database.sql, {
        householdId,
        candidate: returnToStandardCandidate,
        requestType: "early_checkin",
      })).map((request) => request.id),
      [replacementRequest.id],
    );
    assert.equal((await cancelActiveGuestTimeRequests(database.sql, {
      householdId,
      candidate: returnToStandardCandidate,
      requestType: "early_checkin",
      now: new Date("2026-08-22T11:03:00.000Z"),
    })).length, 1);
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

    const chronologyThreadId = "9876543212";
    const newerEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<newer-${randomUUID()}@example.test>`,
      providerThreadId: chronologyThreadId,
      occurredAt: "2026-08-21T16:00:00.000Z",
      entries: [
        { name: "Host Fixture", role: "Host", text: "How can we help?" },
        { name: "New Guest", role: "Guest", text: "Could I check in early?" },
      ],
    });
    const newerParsed = parseAirbnbConversationEmail(newerEmail);
    const newerIngested = await ingestConversation(database.sql, {
      householdId,
      email: newerEmail,
      parsed: newerParsed,
    });
    const chronologyCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 20 }))
      .find((candidate) => candidate.providerThreadId === chronologyThreadId);
    const chronologyDraft = await storeShadowDraft(database.sql, {
      householdId,
      candidate: chronologyCandidate,
      classification: {
        topic: "early_check_in",
        riskTier: "low",
        confidence: 0.9,
        factsVerified: true,
        replyNeeded: true,
        summary: "A safe draft awaits review.",
        draft: "Thanks, we are checking.",
        autoReply: false,
        status: "drafted",
        alertManagement: false,
      },
      now: new Date("2026-08-21T16:01:00.000Z"),
    });
    const olderHostEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<older-${randomUUID()}@example.test>`,
      providerThreadId: chronologyThreadId,
      occurredAt: "2026-08-21T15:00:00.000Z",
      listingName: "The Spekboom Studio",
      entries: [
        { name: "Old Guest", role: "Guest", text: "An older guest question." },
        { name: "Host Fixture", role: "Host", text: "An older host reply." },
      ],
    });
    const olderResult = await ingestConversation(database.sql, {
      householdId,
      email: olderHostEmail,
      parsed: parseAirbnbConversationEmail(olderHostEmail),
    });
    assert.equal(newerIngested.latestDirection, "guest");
    assert.equal(olderResult.latestDirection, "guest");
    const chronologyState = (await admin`
      select thread.status, thread.property_id, thread.guest_display_name,
             thread.source_fingerprint, delivery.status as delivery_status
      from airbnb.guest_threads thread
      join airbnb.reply_deliveries delivery
        on delivery.household_id = thread.household_id
       and delivery.thread_id = thread.id
      where thread.household_id = ${householdId}
        and thread.provider_thread_id = ${chronologyThreadId}
        and delivery.id = ${chronologyDraft.id}
    `)[0];
    assert.deepEqual({ ...chronologyState }, {
      status: "needs_human",
      property_id: chronologyCandidate.propertyId,
      guest_display_name: "New Guest",
      source_fingerprint: newerParsed.sourceFingerprint,
      delivery_status: "needs_approval",
    });
  } finally {
    await database?.close();
    await admin.end({ timeout: 5 });
  }
});
