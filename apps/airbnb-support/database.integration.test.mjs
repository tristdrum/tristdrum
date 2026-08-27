import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  parseAirbnbConversationEmail,
  parseAirbnbInitialInquiryEmail,
} from "@tristdrum/airbnb-core";
import { createAirbnbDatabase } from "@tristdrum/airbnb-db";
import { processDeliveryGuard } from "./delivery.mjs";
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
  markDeliverySent,
  markSupportAlertNotified,
  reconcileBookingLifecycle,
  recordAmbiguousDeliveryFailure,
  recordDeliveryAttempt,
  storeSupportDraft,
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
    await storeShadowDraft(database.sql, {
      householdId,
      candidate: candidates[0],
      classification,
      now: new Date("2026-08-21T13:01:45.000Z"),
    });
    const retiredSiblingAlerts = await admin`
      select details->>'shadowMode' as shadow_mode
      from airbnb.alerts
      where household_id = ${householdId}
        and status = 'resolved'
      order by details->>'stage'
    `;
    assert.deepEqual(retiredSiblingAlerts.map((row) => row.shadow_mode), ["false", "false"]);

    await storeSupportDraft(database.sql, {
      householdId,
      candidate: candidates[0],
      classification,
      now: new Date("2026-08-21T13:02:00.000Z"),
      shadowMode: false,
    });
    assert.equal((await loadSuppressedSupportAlerts(database.sql, { householdId })).length, 0);

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

    const replyAndAlertThreadId = "9876543213";
    const replyAndAlertEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<reply-alert-${randomUUID()}@example.test>`,
      providerThreadId: replyAndAlertThreadId,
      occurredAt: "2026-08-21T17:00:00.000Z",
      entries: [{ name: "Guest Action", role: "Guest", text: "We are outside and need help." }],
    });
    await ingestConversation(database.sql, {
      householdId,
      email: replyAndAlertEmail,
      parsed: parseAirbnbConversationEmail(replyAndAlertEmail),
    });
    const replyAndAlertCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === replyAndAlertThreadId);
    const replyAndAlertDelivery = await storeSupportDraft(database.sql, {
      householdId,
      candidate: replyAndAlertCandidate,
      classification: {
        topic: "adaptive_support",
        riskTier: "low",
        decisionSource: "adaptive_agent",
        decisionVersion: 2,
        autoReply: true,
        replyNeeded: true,
        alertManagement: true,
        summary: "The guest needs immediate host help at the property.",
        draft: "We’ve seen your message and alerted the hosts so they can help quickly.",
      },
      now: new Date("2026-08-21T17:01:00.000Z"),
      shadowMode: false,
      automaticallyApprove: true,
    });
    assert.equal(replyAndAlertDelivery.status, "approved");
    await admin`
      update airbnb.reply_deliveries
      set status = 'sending'
      where household_id = ${householdId} and id = ${replyAndAlertDelivery.id}
    `;
    await markDeliverySent(database.sql, {
      householdId,
      deliveryId: replyAndAlertDelivery.id,
      providerMessageId: `<sent-${randomUUID()}@example.test>`,
      now: new Date("2026-08-21T17:02:00.000Z"),
    });
    const alertsAfterReply = await loadSuppressedSupportAlerts(database.sql, { householdId, limit: 50 });
    assert.equal(alertsAfterReply.some((alert) => (
      alert.details.threadId === replyAndAlertCandidate.id
      && alert.details.requiresManagementAction === true
    )), true);

    const actionOnlyThreadId = "9876543214";
    const actionOnlyEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<action-only-${randomUUID()}@example.test>`,
      providerThreadId: actionOnlyThreadId,
      occurredAt: "2026-08-21T18:00:00.000Z",
      entries: [{ name: "Guest Action", role: "Guest", text: "No reply needed, but the outside light is broken." }],
    });
    await ingestConversation(database.sql, {
      householdId,
      email: actionOnlyEmail,
      parsed: parseAirbnbConversationEmail(actionOnlyEmail),
    });
    const actionOnlyCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === actionOnlyThreadId);
    const actionOnlyDelivery = await storeSupportDraft(database.sql, {
      householdId,
      candidate: actionOnlyCandidate,
      classification: {
        topic: "adaptive_support",
        riskTier: "high",
        decisionSource: "adaptive_agent",
        decisionVersion: 2,
        autoReply: false,
        replyNeeded: false,
        alertManagement: true,
        summary: "Management needs to inspect a reported maintenance issue.",
        draft: null,
      },
      now: new Date("2026-08-21T18:01:00.000Z"),
      shadowMode: false,
    });
    assert.equal(actionOnlyDelivery.status, "cancelled");
    assert.equal((await admin`
      select status
      from airbnb.guest_threads
      where household_id = ${householdId} and id = ${actionOnlyCandidate.id}
    `)[0].status, "needs_human");
    const alertsAfterNoReply = await loadSuppressedSupportAlerts(database.sql, { householdId, limit: 50 });
    assert.equal(alertsAfterNoReply.some((alert) => (
      alert.details.threadId === actionOnlyCandidate.id
      && alert.details.requiresManagementAction === true
    )), true);

    const shadowThreadId = "9876543215";
    const shadowEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<shadow-live-${randomUUID()}@example.test>`,
      providerThreadId: shadowThreadId,
      occurredAt: "2026-08-21T19:00:00.000Z",
    });
    await ingestConversation(database.sql, {
      householdId,
      email: shadowEmail,
      parsed: parseAirbnbConversationEmail(shadowEmail),
    });
    const shadowCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === shadowThreadId);
    const adaptiveDecision = {
      topic: "adaptive_support",
      riskTier: "low",
      decisionSource: "adaptive_agent",
      decisionVersion: 2,
      autoReply: true,
      replyNeeded: true,
      alertManagement: false,
      summary: "A fresh adaptive reply.",
      draft: "Thanks for your message.",
    };
    const shadowDelivery = await storeSupportDraft(database.sql, {
      householdId,
      candidate: shadowCandidate,
      classification: { ...adaptiveDecision, alertManagement: true },
      now: new Date("2026-08-21T19:01:00.000Z"),
      shadowMode: true,
    });
    assert.equal(shadowDelivery.status, "needs_approval");
    const promotedDelivery = await storeSupportDraft(database.sql, {
      householdId,
      candidate: shadowCandidate,
      classification: adaptiveDecision,
      now: new Date("2026-08-21T19:02:00.000Z"),
      shadowMode: false,
      automaticallyApprove: true,
    });
    assert.equal(promotedDelivery.status, "approved");
    assert.deepEqual((await admin`
      select distinct status
      from airbnb.alerts
      where household_id = ${householdId}
        and details->>'threadId' = ${shadowCandidate.id}
    `).map((row) => row.status), ["resolved"]);

    const shadowNoReplyThreadId = "9876543216";
    const shadowNoReplyEmail = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<shadow-no-reply-${randomUUID()}@example.test>`,
      providerThreadId: shadowNoReplyThreadId,
      occurredAt: "2026-08-21T20:00:00.000Z",
      entries: [{ name: "Guest Action", role: "Guest", text: "Please note the outside light is broken." }],
    });
    await ingestConversation(database.sql, {
      householdId,
      email: shadowNoReplyEmail,
      parsed: parseAirbnbConversationEmail(shadowNoReplyEmail),
    });
    const shadowNoReplyCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === shadowNoReplyThreadId);
    const noReplyActionDecision = {
      topic: "adaptive_support",
      riskTier: "high",
      decisionSource: "adaptive_agent",
      decisionVersion: 2,
      autoReply: false,
      replyNeeded: false,
      alertManagement: true,
      summary: "Management needs to inspect the reported light.",
      draft: null,
    };
    const shadowNoReplyDelivery = await storeSupportDraft(database.sql, {
      householdId,
      candidate: shadowNoReplyCandidate,
      classification: noReplyActionDecision,
      now: new Date("2026-08-21T20:01:00.000Z"),
      shadowMode: true,
    });
    assert.equal(shadowNoReplyDelivery.status, "needs_approval");
    const liveNoReplyDelivery = await storeSupportDraft(database.sql, {
      householdId,
      candidate: shadowNoReplyCandidate,
      classification: noReplyActionDecision,
      now: new Date("2026-08-21T20:02:00.000Z"),
      shadowMode: false,
    });
    assert.equal(liveNoReplyDelivery.status, "cancelled");
    const reopenedAlerts = await loadSuppressedSupportAlerts(database.sql, { householdId, limit: 50 });
    assert.equal(reopenedAlerts.some((alert) => (
      alert.details.threadId === shadowNoReplyCandidate.id
      && alert.details.shadowMode === false
      && alert.details.requiresManagementAction === true
    )), true);

    const lifecycleThreadId = "9876543217";
    const lifecycleConversation = emailFixture({
      mailboxScope: "tristan",
      providerMessageId: `<lifecycle-conversation-${randomUUID()}@example.test>`,
      providerThreadId: lifecycleThreadId,
      occurredAt: "2026-08-21T21:00:00.000Z",
      entries: [{ name: "Lifecycle Guest", role: "Guest", text: "Please confirm my booking request." }],
    });
    await ingestConversation(database.sql, {
      householdId,
      email: lifecycleConversation,
      parsed: parseAirbnbConversationEmail(lifecycleConversation),
    });
    const lifecycleOutcome = await reconcileBookingLifecycle(database.sql, {
      householdId,
      email: {
        providerMessageId: `<lifecycle-expired-${randomUUID()}@example.test>`,
        from: "automated@airbnb.com",
        subject: "Aug 22 - 23 request dismissed - no payment",
        occurredAt: "2026-08-21T21:10:00.000Z",
      },
      lifecycle: {
        kind: "request_expired",
        reason: "nonpayment",
        guestName: "Lifecycle Guest",
        unitNumber: 3,
        listingName: "Jasmine Studio Stay",
        checkIn: "2026-08-22",
        checkOut: "2026-08-23",
      },
    });
    assert.equal(lifecycleOutcome.status, "resolved");
    assert.deepEqual({ ...(await admin`
      select evidence_kind, evidence_subtype
      from airbnb.evidence
      where household_id = ${householdId} and id = ${lifecycleOutcome.evidenceId}
    `)[0] }, {
      evidence_kind: "conversation",
      evidence_subtype: "booking_request_expired",
    });

    const initialInquiryEmail = {
      mailboxScope: "tristan",
      providerMessageId: `<initial-inquiry-${randomUUID()}@example.test>`,
      subject: "Inquiry for Jasmine Studio Stay for Sep 15 - 17, 2026",
      from: "automated@airbnb.com",
      replyTo: null,
      references: [],
      inReplyTo: null,
      occurredAt: "2026-08-21T22:00:00.000Z",
      body: [
        "RESPOND TO PRINSLOO'S INQUIRY",
        "Prinsloo",
        "https://www.airbnb.co.za/hosting/thread/9876543218?thread_type=home_booking",
        "Identity verified · 9 reviews",
        "What will be your monthly rate for three months?",
        "Pre-approve / Decline",
      ].join("\n"),
    };
    const initialInquiryParsed = parseAirbnbInitialInquiryEmail(initialInquiryEmail);
    const initialInquiryIngested = await ingestConversation(database.sql, {
      householdId,
      email: initialInquiryEmail,
      parsed: initialInquiryParsed,
    });
    const initialInquiryCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === "9876543218");
    assert.equal(initialInquiryCandidate.sourceKind, "initial_inquiry");
    assert.equal(initialInquiryCandidate.replyRequired, true);
    assert.equal(initialInquiryCandidate.replyCapable, false);
    assert.deepEqual({ ...(await admin`
      select evidence_subtype, normalized_payload->>'sourceKind' as source_kind
      from airbnb.evidence
      where household_id = ${householdId} and id = ${initialInquiryIngested.evidenceId}
    `)[0] }, {
      evidence_subtype: "airbnb_initial_inquiry",
      source_kind: "initial_inquiry",
    });

    const promotedDraft = await storeSupportDraft(database.sql, {
      householdId,
      candidate: initialInquiryCandidate,
      classification: {
        topic: "pricing",
        riskTier: "high",
        replyNeeded: true,
        summary: "A monthly-rate inquiry needs an Airbnb app reply.",
        draft: "Thanks, Prinsloo. We will check the monthly rate and get back to you.",
        autoReply: false,
        status: "needs_human",
        alertManagement: true,
        decisionVersion: 2,
        decisionSource: "adaptive_agent",
        deterministicGuard: "initial_inquiry_requires_airbnb_ui",
      },
      now: new Date("2026-08-21T22:01:00.000Z"),
      shadowMode: false,
    });
    const replyCapableInquiryEmail = {
      mailboxScope: "tristan",
      providerMessageId: `<reply-capable-inquiry-${randomUUID()}@example.test>`,
      subject: "RE: Inquiry for Jasmine Studio Stay, Sep 15 - 17, 2026",
      from: "express@airbnb.com",
      replyTo: "reply-token@reply.airbnb.com",
      references: ["<initial-inquiry@example.test>"],
      inReplyTo: "<initial-inquiry@example.test>",
      occurredAt: "2026-08-21T22:05:00.000Z",
      body: [
        "INQUIRY FOR JASMINE STUDIO STAY, SEP 15 - 17, 2026",
        "For your protection and safety, always communicate through Airbnb.",
        "PRINSLOO",
        "Booker",
        "What will be your monthly rate for three months?",
        "Reply",
        "https://www.airbnb.co.za/hosting/thread/9876543218?thread_type=home_booking",
      ].join("\n"),
    };
    const replyCapableParsed = parseAirbnbConversationEmail(replyCapableInquiryEmail);
    await ingestConversation(database.sql, {
      householdId,
      email: replyCapableInquiryEmail,
      parsed: replyCapableParsed,
    });
    const promotedInquiryCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === "9876543218");
    assert.equal(promotedInquiryCandidate.replyCapable, true);
    assert.equal(promotedInquiryCandidate.sourceFingerprint, initialInquiryCandidate.sourceFingerprint);
    await storeSupportDraft(database.sql, {
      householdId,
      candidate: promotedInquiryCandidate,
      classification: {
        topic: "pricing",
        riskTier: "low",
        replyNeeded: true,
        summary: "The guest asked for a three-month rate.",
        draft: "Thanks, Prinsloo. We will check the monthly rate and get back to you.",
        autoReply: true,
        status: "ready",
        alertManagement: false,
        decisionVersion: 2,
        decisionSource: "adaptive_agent",
      },
      now: new Date("2026-08-21T22:06:00.000Z"),
      shadowMode: false,
      automaticallyApprove: true,
    });
    assert.deepEqual({ ...(await admin`
      select
        (select count(*)::integer
         from airbnb.guest_messages message
         where message.household_id = ${householdId}
           and message.thread_id = ${initialInquiryCandidate.id}) as messages,
        (select count(*)::integer
         from airbnb.reply_deliveries delivery
         where delivery.household_id = ${householdId}
           and delivery.thread_id = ${initialInquiryCandidate.id}) as deliveries,
        (select status
         from airbnb.reply_deliveries delivery
         where delivery.household_id = ${householdId}
           and delivery.thread_id = ${initialInquiryCandidate.id}
         limit 1) as delivery_status
    `)[0] }, {
      messages: 1,
      deliveries: 1,
      delivery_status: "approved",
    });
    let sendCount = 0;
    const deliveryResult = await processDeliveryGuard({
      sql: database.sql,
      householdId,
      deliveryId: promotedDraft.id,
      now: () => new Date("2026-08-21T22:07:00.000Z"),
      env: {
        AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
        AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
      },
      collectMessages: async ({ mailboxScope }) => ({
        messages: mailboxScope === "tristan" ? [{
          ...replyCapableInquiryEmail,
          rfcMessageId: replyCapableInquiryEmail.providerMessageId,
        }] : [],
        envelopesFound: mailboxScope === "tristan" ? 1 : 0,
      }),
      reconcileSent: async () => [],
      sendReply: async ({ messageId }) => {
        sendCount += 1;
        return { messageId };
      },
    });
    assert.equal(deliveryResult.action, "sent");
    assert.equal(sendCount, 1);
    assert.equal((await admin`
      select status
      from airbnb.reply_deliveries
      where household_id = ${householdId} and id = ${promotedDraft.id}
    `)[0].status, "sent");
    assert.equal((await admin`
      select count(*)::integer as count
      from airbnb.alerts
      where household_id = ${householdId}
        and status in ('suppressed', 'notified')
        and details->>'replyDeliveryId' = ${promotedDraft.id}
    `)[0].count, 0);

    const hostActionInitialEmail = {
      ...initialInquiryEmail,
      providerMessageId: `<host-action-initial-${randomUUID()}@example.test>`,
      occurredAt: "2026-08-21T22:10:00.000Z",
      body: [
        "RESPOND TO AMANDA'S INQUIRY",
        "Amanda",
        "https://www.airbnb.co.za/hosting/thread/9876543219?thread_type=home_booking",
        "Identity verified · 4 reviews",
        "Could you confirm the monthly rate and whether there is secure parking?",
        "Pre-approve / Decline",
      ].join("\n"),
    };
    await ingestConversation(database.sql, {
      householdId,
      email: hostActionInitialEmail,
      parsed: parseAirbnbInitialInquiryEmail(hostActionInitialEmail),
    });
    const hostActionInitialCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === "9876543219");
    await storeSupportDraft(database.sql, {
      householdId,
      candidate: hostActionInitialCandidate,
      classification: {
        topic: "pricing",
        riskTier: "high",
        replyNeeded: true,
        summary: "A monthly rate needs a host decision.",
        draft: "Thanks, Amanda. We will confirm the monthly rate shortly.",
        autoReply: false,
        status: "needs_human",
        alertManagement: true,
        decisionVersion: 2,
        decisionSource: "adaptive_agent",
        deterministicGuard: "initial_inquiry_requires_airbnb_ui",
      },
      now: new Date("2026-08-21T22:11:00.000Z"),
      shadowMode: false,
    });
    const hostActionExpressEmail = {
      mailboxScope: "tristan",
      providerMessageId: `<host-action-express-${randomUUID()}@example.test>`,
      rfcMessageId: `<host-action-express-source-${randomUUID()}@example.test>`,
      subject: "RE: Inquiry for Jasmine Studio Stay, Sep 15 - 17, 2026",
      from: "express@airbnb.com",
      replyTo: "reply-token@reply.airbnb.com",
      references: ["<host-action-initial@example.test>"],
      inReplyTo: "<host-action-initial@example.test>",
      occurredAt: "2026-08-21T22:15:00.000Z",
      body: [
        "INQUIRY FOR JASMINE STUDIO STAY, SEP 15 - 17, 2026",
        "For your protection and safety, always communicate through Airbnb.",
        "AMANDA",
        "Booker",
        "Could you confirm the monthly rate and whether there is secure parking?",
        "Reply",
        "https://www.airbnb.co.za/hosting/thread/9876543219?thread_type=home_booking",
      ].join("\n"),
    };
    await ingestConversation(database.sql, {
      householdId,
      email: hostActionExpressEmail,
      parsed: parseAirbnbConversationEmail(hostActionExpressEmail),
    });
    const hostActionPromotedCandidate = (await loadShadowCandidates(database.sql, { householdId, limit: 50 }))
      .find((candidate) => candidate.providerThreadId === "9876543219");
    const hostActionDraft = await storeSupportDraft(database.sql, {
      householdId,
      candidate: hostActionPromotedCandidate,
      classification: {
        topic: "pricing",
        riskTier: "high",
        replyNeeded: true,
        summary: "Acknowledge now; Management must decide the monthly rate.",
        draft: "Thanks, Amanda. We will confirm the monthly rate shortly. There is secure off-street parking.",
        autoReply: true,
        status: "ready",
        alertManagement: true,
        decisionVersion: 2,
        decisionSource: "adaptive_agent",
      },
      now: new Date("2026-08-21T22:16:00.000Z"),
      shadowMode: false,
      automaticallyApprove: true,
    });
    const hostActionDeliveryResult = await processDeliveryGuard({
      sql: database.sql,
      householdId,
      deliveryId: hostActionDraft.id,
      now: () => new Date("2026-08-21T22:17:00.000Z"),
      env: {
        AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
        AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
      },
      collectMessages: async ({ mailboxScope }) => ({
        messages: mailboxScope === "tristan" ? [hostActionExpressEmail] : [],
        envelopesFound: mailboxScope === "tristan" ? 1 : 0,
      }),
      reconcileSent: async () => [],
      sendReply: async ({ messageId }) => ({ messageId }),
    });
    assert.equal(hostActionDeliveryResult.action, "sent");
    const survivingHostActionAlerts = (await loadSuppressedSupportAlerts(database.sql, { householdId }))
      .filter((alert) => alert.details.replyDeliveryId === hostActionDraft.id);
    assert.equal(survivingHostActionAlerts.length, 1);
    assert.equal(survivingHostActionAlerts[0].details.requiresManagementAction, true);
  } finally {
    await database?.close();
    await admin.end({ timeout: 5 });
  }
});
