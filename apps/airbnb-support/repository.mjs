import {
  contentFingerprint,
  conversationEntryKey,
  propertyForListing,
  supportEscalationStages,
} from "@tristdrum/airbnb-core";
import { redactCredentialText } from "@tristdrum/airbnb-db";

function eventTime(occurredAt, sequence) {
  const value = new Date(occurredAt);
  value.setMilliseconds(value.getMilliseconds() + sequence);
  return value.toISOString();
}

export async function ingestConversation(sql, { householdId, email, parsed }) {
  if ((email.mailboxScope ?? "tristan") !== "tristan") {
    throw new Error("Canonical Airbnb conversations must come from Tristan's mailbox.");
  }
  return sql.begin(async (transaction) => {
    const evidenceRows = await transaction`
      insert into airbnb.evidence (
        household_id, mailbox_scope, provider, provider_message_id, provider_thread_id,
        sender_address, subject, evidence_kind, evidence_subtype, occurred_at,
        content_hash, normalized_payload
      ) values (
        ${householdId}, 'tristan', 'gmail', ${email.providerMessageId}, ${parsed.providerThreadId},
        ${email.from}, ${email.subject}, 'conversation', 'airbnb_thread', ${email.occurredAt},
        ${contentFingerprint(parsed.sourceFingerprint)},
        ${transaction.json({
          listingName: parsed.listingName,
          stayLabel: parsed.stayLabel,
          entryCount: parsed.entries.length,
          replyTo: parsed.replyTo,
          inReplyTo: email.inReplyTo,
          references: parsed.references,
        })}
      )
      on conflict (household_id, mailbox_scope, provider, provider_message_id)
      do update set content_hash = excluded.content_hash,
                    normalized_payload = excluded.normalized_payload,
                    occurred_at = excluded.occurred_at
      returning id
    `;
    const property = propertyForListing(parsed.listingName);
    const propertyRows = property ? await transaction`
      select id, facts
      from airbnb.properties
      where household_id = ${householdId} and unit_number = ${property.unitNumber}
      limit 1
    ` : [];
    const latest = parsed.entries.at(-1);
    const latestGuest = [...parsed.entries].reverse().find((entry) => entry.direction === "guest") ?? null;
    const latestGuestAt = latestGuest ? eventTime(email.occurredAt, latestGuest.sequence) : null;
    const latestHost = [...parsed.entries].reverse().find((entry) => entry.direction === "host") ?? null;
    const latestHostAt = latestHost ? eventTime(email.occurredAt, latestHost.sequence) : null;
    const threadRows = await transaction`
      insert into airbnb.guest_threads (
        household_id, provider_thread_id, canonical_mailbox, property_id, guest_display_name,
        status, risk_tier, last_guest_at, last_host_at, source_fingerprint
      ) values (
        ${householdId}, ${parsed.providerThreadId}, 'tristan', ${propertyRows[0]?.id ?? null}, ${latestGuest?.name ?? null},
        ${latest.direction === "host" ? "handled" : "open"}, 'unknown',
        ${latestGuestAt}, ${latestHostAt}, ${parsed.sourceFingerprint}
      )
      on conflict (household_id, canonical_mailbox, provider_thread_id)
      do update set property_id = case
                      when greatest(
                        coalesce(excluded.last_guest_at, '-infinity'::timestamptz),
                        coalesce(excluded.last_host_at, '-infinity'::timestamptz)
                      ) >= greatest(
                        coalesce(airbnb.guest_threads.last_guest_at, '-infinity'::timestamptz),
                        coalesce(airbnb.guest_threads.last_host_at, '-infinity'::timestamptz)
                      ) then coalesce(excluded.property_id, airbnb.guest_threads.property_id)
                      else airbnb.guest_threads.property_id
                    end,
                    guest_display_name = case
                      when greatest(
                        coalesce(excluded.last_guest_at, '-infinity'::timestamptz),
                        coalesce(excluded.last_host_at, '-infinity'::timestamptz)
                      ) >= greatest(
                        coalesce(airbnb.guest_threads.last_guest_at, '-infinity'::timestamptz),
                        coalesce(airbnb.guest_threads.last_host_at, '-infinity'::timestamptz)
                      ) then coalesce(excluded.guest_display_name, airbnb.guest_threads.guest_display_name)
                      else airbnb.guest_threads.guest_display_name
                    end,
                    status = case
                      when greatest(
                        coalesce(excluded.last_guest_at, '-infinity'::timestamptz),
                        coalesce(excluded.last_host_at, '-infinity'::timestamptz)
                      ) >= greatest(
                        coalesce(airbnb.guest_threads.last_guest_at, '-infinity'::timestamptz),
                        coalesce(airbnb.guest_threads.last_host_at, '-infinity'::timestamptz)
                      ) then excluded.status
                      else airbnb.guest_threads.status
                    end,
                    last_guest_at = greatest(airbnb.guest_threads.last_guest_at, excluded.last_guest_at),
                    last_host_at = greatest(airbnb.guest_threads.last_host_at, excluded.last_host_at),
                    source_fingerprint = case
                      when greatest(
                        coalesce(excluded.last_guest_at, '-infinity'::timestamptz),
                        coalesce(excluded.last_host_at, '-infinity'::timestamptz)
                      ) >= greatest(
                        coalesce(airbnb.guest_threads.last_guest_at, '-infinity'::timestamptz),
                        coalesce(airbnb.guest_threads.last_host_at, '-infinity'::timestamptz)
                      ) then excluded.source_fingerprint
                      else airbnb.guest_threads.source_fingerprint
                    end
      returning id, status, property_id, guest_display_name,
                last_guest_at, last_host_at, source_fingerprint
    `;
    const thread = threadRows[0];
    for (const entry of parsed.entries) {
      const providerEntryId = conversationEntryKey(parsed.providerThreadId, entry);
      await transaction`
        insert into airbnb.guest_messages (
          household_id, thread_id, provider_message_id, provider_thread_id, direction,
          sender_label, sender_mailbox, body_normalized, content_hash, provider_sent_at
        ) values (
          ${householdId}, ${thread.id}, ${providerEntryId}, ${parsed.providerThreadId}, ${entry.direction},
          ${`${entry.name} / ${entry.role}`}, 'tristan', ${entry.text}, ${entry.contentHash},
          ${eventTime(email.occurredAt, entry.sequence)}
        )
        on conflict (household_id, provider_message_id) do nothing
      `;
    }
    const databaseLatestDirection = (
      thread.lastHostAt
      && (!thread.lastGuestAt || new Date(thread.lastHostAt) >= new Date(thread.lastGuestAt))
    ) ? "host" : "guest";
    if (databaseLatestDirection === "host") {
      await transaction`
        update airbnb.reply_deliveries
        set status = 'handled_by_human',
            cancellation_reason = 'A newer host reply was observed in the canonical Airbnb thread.',
            updated_at = ${email.occurredAt}
        where household_id = ${householdId}
          and thread_id = ${thread.id}
          and status not in ('sent', 'handled_by_human', 'cancelled')
      `;
      await transaction`
        update airbnb.alerts
        set status = 'resolved', resolved_at = ${email.occurredAt}, updated_at = ${email.occurredAt}
        where household_id = ${householdId}
          and status = 'suppressed'
          and alert_type in ('guest_escalation', 'guest_overdue')
          and details->>'threadId' = ${thread.id}
      `;
    }
    return {
      threadId: thread.id,
      providerThreadId: parsed.providerThreadId,
      status: thread.status,
      latestDirection: databaseLatestDirection,
      evidenceId: evidenceRows[0].id,
      propertyId: propertyRows[0]?.id ?? null,
    };
  });
}

export async function ingestSupplementalConversation(sql, { householdId, email, parsed }) {
  if ((email.mailboxScope ?? "jane") !== "jane") {
    throw new Error("Supplemental Airbnb conversation evidence must come from Jane's mailbox.");
  }
  const rows = await sql`
    insert into airbnb.evidence (
      household_id, mailbox_scope, provider, provider_message_id, provider_thread_id,
      sender_address, subject, evidence_kind, evidence_subtype, occurred_at,
      content_hash, normalized_payload
    ) values (
      ${householdId}, 'jane', 'gmail', ${email.providerMessageId}, ${parsed.providerThreadId},
      ${email.from}, ${email.subject}, 'conversation', 'airbnb_thread_supplemental', ${email.occurredAt},
      ${contentFingerprint(parsed.sourceFingerprint)},
      ${sql.json({ listingName: parsed.listingName, stayLabel: parsed.stayLabel, entryCount: parsed.entries.length })}
    )
    on conflict (household_id, mailbox_scope, provider, provider_message_id)
    do update set content_hash = excluded.content_hash,
                  normalized_payload = excluded.normalized_payload,
                  occurred_at = excluded.occurred_at
    returning id
  `;
  const canonical = await sql`
    select id
    from airbnb.guest_threads
    where household_id = ${householdId}
      and canonical_mailbox = 'tristan'
      and provider_thread_id = ${parsed.providerThreadId}
    limit 1
  `;
  return {
    evidenceId: rows[0].id,
    providerThreadId: parsed.providerThreadId,
    canonicalThreadId: canonical[0]?.id ?? null,
  };
}

export async function loadShadowCandidates(sql, { householdId, limit = 8 }) {
  const rows = await sql`
    select
      thread.id,
      thread.provider_thread_id,
      thread.property_id,
      thread.reservation_id,
      thread.guest_display_name,
      thread.source_fingerprint,
      thread.last_guest_at,
      property.listing_name,
      property.facts,
      existing.classification as existing_classification,
      existing.draft_text as existing_draft,
      latest.body_normalized as guest_message,
      latest.provider_sent_at as latest_event_at,
      conversation.stay_label,
      active_time_request.request_type as active_time_request_type,
      active_time_request.stay_date as active_time_request_stay_date,
      active_time_request.effective_time as active_time_request_effective_time,
      active_time_request.status as active_time_request_status,
      active_time_request.ready_at as active_time_request_ready_at,
      recent_context.messages as conversation_context
    from airbnb.guest_threads thread
    join lateral (
      select message.body_normalized, message.provider_sent_at
      from airbnb.guest_messages message
      where message.household_id = thread.household_id
        and message.thread_id = thread.id
        and message.direction = 'guest'
      order by message.provider_sent_at desc
      limit 1
    ) latest on true
    left join lateral (
      select evidence.normalized_payload->>'stayLabel' as stay_label
      from airbnb.evidence evidence
      where evidence.household_id = thread.household_id
        and evidence.mailbox_scope = 'tristan'
        and evidence.evidence_kind = 'conversation'
        and evidence.provider_thread_id = thread.provider_thread_id
      order by evidence.occurred_at desc
      limit 1
    ) conversation on true
    left join lateral (
      select request.request_type, request.stay_date, request.effective_time,
             request.status, request.ready_at
      from airbnb.guest_time_requests request
      where request.household_id = thread.household_id
        and request.thread_id = thread.id
        and request.status not in ('completed', 'cancelled')
      order by request.created_at desc
      limit 1
    ) active_time_request on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'direction', context_message.direction,
        'text', context_message.body_normalized,
        'occurredAt', context_message.provider_sent_at
      ) order by context_message.provider_sent_at) as messages
      from (
        select message.direction, message.body_normalized, message.provider_sent_at
        from airbnb.guest_messages message
        where message.household_id = thread.household_id
          and message.thread_id = thread.id
        order by message.provider_sent_at desc
        limit 8
      ) context_message
    ) recent_context on true
    left join airbnb.properties property
      on property.household_id = thread.household_id
     and property.id = thread.property_id
    left join lateral (
      select delivery.classification, delivery.draft_text, delivery.status
      from airbnb.reply_deliveries delivery
      where delivery.household_id = thread.household_id
        and delivery.thread_id = thread.id
        and delivery.source_fingerprint = thread.source_fingerprint
      order by delivery.created_at desc
      limit 1
    ) existing on true
    where thread.household_id = ${householdId}
      and thread.status in ('open', 'needs_human')
      and (thread.last_host_at is null or thread.last_host_at < thread.last_guest_at)
      and coalesce(existing.status, 'draft') not in ('sent', 'handled_by_human', 'cancelled', 'ambiguous')
    order by (existing.classification is null) desc, thread.last_guest_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    ...row,
    facts: row.facts ?? {},
    existingClassification: row.existingClassification
      ? { ...row.existingClassification, draft: row.existingDraft }
      : null,
    activeTimeRequest: row.activeTimeRequestType ? {
      requestType: row.activeTimeRequestType,
      stayDate: String(row.activeTimeRequestStayDate),
      effectiveTime: String(row.activeTimeRequestEffectiveTime).slice(0, 5),
      status: row.activeTimeRequestStatus,
      readyAt: row.activeTimeRequestReadyAt ?? null,
    } : null,
    conversationContext: row.conversationContext ?? [],
  }));
}

export async function storeSupportDraft(sql, {
  householdId,
  candidate,
  classification,
  now,
  shadowMode = true,
  automaticallyApprove = false,
}) {
  const idempotencyKey = `airbnb-support:${candidate.providerThreadId}:${candidate.sourceFingerprint}`;
  const outboundMessageId = `<${contentFingerprint(`${householdId}:${idempotencyKey}`).slice(0, 32)}@airbnb.tristdrum.com>`;
  const initialStatus = automaticallyApprove ? "approved" : "needs_approval";
  const rows = await sql`
    insert into airbnb.reply_deliveries (
      household_id, thread_id, source_fingerprint, source_last_event_at, topic,
      risk_tier, classification, draft_text, status, idempotency_key, outbound_message_id
    ) values (
      ${householdId}, ${candidate.id}, ${candidate.sourceFingerprint}, ${candidate.latestEventAt},
      ${classification.topic}, ${classification.riskTier},
      ${sql.json({ ...classification, shadowMode })}, ${classification.draft},
      ${initialStatus}, ${idempotencyKey}, ${outboundMessageId}
    )
    on conflict (household_id, idempotency_key)
    do update set source_last_event_at = excluded.source_last_event_at,
                  topic = excluded.topic,
                  risk_tier = excluded.risk_tier,
                  classification = excluded.classification,
                  draft_text = excluded.draft_text,
                  status = case
                    when airbnb.reply_deliveries.status = 'approved'
                      and airbnb.reply_deliveries.approved_by is null
                      and not (excluded.classification @> '{"messageWhitelisted": true}'::jsonb)
                    then 'needs_approval'
                    else airbnb.reply_deliveries.status
                  end,
                  updated_at = now()
    returning id, status
  `;
  await sql`
    update airbnb.guest_threads
    set status = 'needs_human', risk_tier = ${classification.riskTier}
    where household_id = ${householdId} and id = ${candidate.id}
  `;
  const escalationStages = classification.alertManagement === true
    ? supportEscalationStages({ latestEventAt: candidate.latestEventAt, now })
    : [];
  for (const escalation of escalationStages) {
    const summary = escalation.stage === "overdue"
      ? "Airbnb guest message is overdue"
      : escalation.stage === "reminder"
        ? "Airbnb guest message still needs human review"
        : "Airbnb guest message needs human review";
    await sql`
      insert into airbnb.alerts (
        household_id, alert_type, severity, status, dedupe_key, summary, details
      ) values (
        ${householdId}, ${escalation.alertType}, ${escalation.severity}, 'suppressed',
        ${`guest:${candidate.providerThreadId}:${candidate.sourceFingerprint}:${escalation.stage}`},
        ${summary},
        ${sql.json({
          threadId: candidate.id,
          replyDeliveryId: rows[0].id,
          stage: escalation.stage,
          minutesOpen: escalation.minutesOpen,
          topic: classification.topic,
          listingName: candidate.listingName,
          guestName: candidate.guestDisplayName,
          classificationSummary: classification.summary,
        })}
      )
      on conflict (household_id, dedupe_key)
      do update set alert_type = excluded.alert_type,
                    severity = excluded.severity,
                    summary = excluded.summary,
                    details = excluded.details,
                    updated_at = now()
    `;
  }
  return {
    id: rows[0].id,
    status: rows[0].status,
    minutesOpen: escalationStages[0]?.minutesOpen ?? null,
    alertStages: escalationStages.map((item) => item.stage),
  };
}

export function storeShadowDraft(sql, options) {
  return storeSupportDraft(sql, { ...options, shadowMode: true, automaticallyApprove: false });
}

export async function upsertGuestTimeRequest(sql, {
  householdId,
  candidate,
  request,
  now,
}) {
  const rows = await sql`
    with superseded as (
      update airbnb.guest_time_requests
      set status = 'cancelled',
          details = details || ${sql.json({ supersededByFingerprint: candidate.sourceFingerprint })}
      where household_id = ${householdId}
        and thread_id = ${candidate.id}
        and request_type = ${request.requestType}
        and source_fingerprint <> ${candidate.sourceFingerprint}
        and status not in ('completed', 'cancelled')
      returning id
    ), upserted as (
      insert into airbnb.guest_time_requests (
      household_id, thread_id, property_id, reservation_id, source_fingerprint,
      request_type, stay_date, requested_time, effective_time, cleaner_note_en,
      cleaner_note_xh, readiness_check_at, details
      ) values (
        ${householdId}, ${candidate.id}, ${candidate.propertyId}, ${candidate.reservationId ?? null},
        ${candidate.sourceFingerprint}, ${request.requestType}, ${request.stayDate},
        ${request.requestedTime}, ${request.effectiveTime}, ${request.cleanerNoteEn},
        ${request.cleanerNoteXh}, ${request.readinessCheckAt ?? null},
        ${sql.json({
          listingName: candidate.listingName,
          guestName: candidate.guestDisplayName,
          unitNumber: request.unitNumber,
          action: request.action,
        })}::jsonb || jsonb_build_object(
          'replacesPrevious', exists(select 1 from superseded)
        )
      )
      on conflict (household_id, thread_id, source_fingerprint, request_type)
      do update set requested_time = excluded.requested_time,
                    effective_time = excluded.effective_time,
                    cleaner_note_en = excluded.cleaner_note_en,
                    cleaner_note_xh = excluded.cleaner_note_xh,
                    readiness_check_at = excluded.readiness_check_at,
                    details = excluded.details || jsonb_build_object(
                      'replacesPrevious',
                      coalesce((airbnb.guest_time_requests.details->>'replacesPrevious')::boolean, false)
                        or coalesce((excluded.details->>'replacesPrevious')::boolean, false)
                    ),
                    updated_at = ${now}
      returning id, status, cleaners_notified_at, readiness_check_at,
                coalesce((details->>'replacesPrevious')::boolean, false) as replaces_previous
    )
    select upserted.*, (select count(*)::integer from superseded) as superseded_count
    from upserted
  `;
  return rows[0];
}

export async function loadActiveGuestTimeRequestsForReplacement(sql, {
  householdId,
  candidate,
  requestType,
}) {
  return sql`
    select request.id, request.stay_date, request.request_type, request.effective_time,
           property.unit_number
    from airbnb.guest_time_requests request
    join airbnb.properties property
      on property.household_id = request.household_id
     and property.id = request.property_id
    where request.household_id = ${householdId}
      and request.thread_id = ${candidate.id}
      and request.request_type = ${requestType}
      and request.source_fingerprint <> ${candidate.sourceFingerprint}
      and request.status not in ('completed', 'cancelled')
    order by request.created_at
  `;
}

export async function cancelActiveGuestTimeRequests(sql, {
  householdId,
  candidate,
  requestType,
  now,
}) {
  return sql`
    update airbnb.guest_time_requests
    set status = 'cancelled',
        details = details || ${sql.json({ withdrawnByFingerprint: candidate.sourceFingerprint })},
        updated_at = ${now}
    where household_id = ${householdId}
      and thread_id = ${candidate.id}
      and request_type = ${requestType}
      and source_fingerprint <> ${candidate.sourceFingerprint}
      and status not in ('completed', 'cancelled')
    returning id
  `;
}

export async function markGuestTimeRequestCleanersNotified(sql, {
  householdId,
  requestId,
  providerMessageId = null,
  now,
}) {
  const rows = await sql`
    update airbnb.guest_time_requests
    set status = 'cleaners_notified',
        cleaners_notified_at = coalesce(cleaners_notified_at, ${now}),
        cleaner_provider_message_id = coalesce(cleaner_provider_message_id, ${providerMessageId})
    where household_id = ${householdId}
      and id = ${requestId}
      and status in ('accepted', 'cleaners_notified')
    returning id, status, cleaners_notified_at
  `;
  return rows[0] ?? null;
}

export async function loadDueReadinessRequests(sql, { householdId, now, limit = 8 }) {
  return sql`
    select request.id, request.thread_id, request.property_id, request.source_fingerprint,
           request.stay_date, request.effective_time, request.readiness_check_at,
           request.details, property.unit_number, property.common_name,
           thread.provider_thread_id
    from airbnb.guest_time_requests request
    join airbnb.properties property
      on property.household_id = request.household_id
     and property.id = request.property_id
    join airbnb.guest_threads thread
      on thread.household_id = request.household_id
     and thread.id = request.thread_id
    where request.household_id = ${householdId}
      and request.request_type = 'early_checkin'
      and request.status = 'cleaners_notified'
      and request.stay_date = (${now} at time zone 'Africa/Johannesburg')::date
      and request.readiness_check_at <= ${now}
      and request.readiness_prompted_at is null
    order by request.readiness_check_at
    limit ${limit}
  `;
}

export async function markGuestTimeRequestReadinessPrompted(sql, {
  householdId,
  requestId,
  now,
}) {
  const rows = await sql`
    update airbnb.guest_time_requests
    set status = 'awaiting_ready', readiness_prompted_at = ${now}
    where household_id = ${householdId}
      and id = ${requestId}
      and status = 'cleaners_notified'
      and readiness_prompted_at is null
    returning id, status, readiness_prompted_at
  `;
  return rows[0] ?? null;
}

export async function loadAwaitingReadyRequests(sql, { householdId, now, limit = 8 }) {
  return sql`
    select request.id, request.thread_id, request.source_fingerprint, request.stay_date,
           request.effective_time, request.readiness_prompted_at, request.details,
           property.unit_number, property.common_name
    from airbnb.guest_time_requests request
    join airbnb.properties property
      on property.household_id = request.household_id
     and property.id = request.property_id
    where request.household_id = ${householdId}
      and request.request_type = 'early_checkin'
      and request.status = 'awaiting_ready'
      and request.stay_date = (${now} at time zone 'Africa/Johannesburg')::date
    order by request.readiness_prompted_at
    limit ${limit}
  `;
}

export async function markGuestTimeRequestReady(sql, { householdId, requestId, now }) {
  const rows = await sql`
    update airbnb.guest_time_requests
    set status = 'ready', ready_at = ${now}
    where household_id = ${householdId}
      and id = ${requestId}
      and status = 'awaiting_ready'
    returning id, thread_id, source_fingerprint, stay_date, effective_time
  `;
  return rows[0] ?? null;
}

export async function loadReadyTimeRequests(sql, { householdId, now, limit = 8 }) {
  return sql`
    select request.id, request.thread_id, request.stay_date, request.effective_time
    from airbnb.guest_time_requests request
    where request.household_id = ${householdId}
      and request.status = 'ready'
      and request.stay_date = (${now} at time zone 'Africa/Johannesburg')::date
      and (
        request.stay_date::text || ' ' || request.effective_time::text
      )::timestamp at time zone 'Africa/Johannesburg' <= ${now}
    order by request.stay_date, request.effective_time
    limit ${limit}
  `;
}

export async function storeOperationalGuestReply(sql, {
  householdId,
  requestId,
  threadId,
  draft,
  now,
}) {
  const threadRows = await sql`
    select source_fingerprint, last_guest_at
    from airbnb.guest_threads
    where household_id = ${householdId} and id = ${threadId}
    limit 1
  `;
  const thread = threadRows[0];
  if (!thread?.sourceFingerprint || !thread?.lastGuestAt) return null;
  const idempotencyKey = `airbnb-support:time-ready:${requestId}`;
  const outboundMessageId = `<${contentFingerprint(`${householdId}:${idempotencyKey}`).slice(0, 32)}@airbnb.tristdrum.com>`;
  const rows = await sql`
    insert into airbnb.reply_deliveries (
      household_id, thread_id, source_fingerprint, source_last_event_at, topic,
      risk_tier, classification, draft_text, status, idempotency_key, outbound_message_id
    ) values (
      ${householdId}, ${threadId}, ${thread.sourceFingerprint}, ${thread.lastGuestAt},
      'early_check_in_ready', 'low',
      ${sql.json({
        topic: 'early_check_in_ready',
        riskTier: 'low',
        confidence: 1,
        factsVerified: true,
        messageWhitelisted: true,
        replyNeeded: true,
        summary: 'The cleaners explicitly confirmed that the studio is ready.',
        operationalRequestId: requestId,
      })},
      ${draft}, 'approved', ${idempotencyKey}, ${outboundMessageId}
    )
    on conflict (household_id, idempotency_key) do nothing
    returning id, status
  `;
  return rows[0] ?? null;
}

export async function markGuestTimeRequestGuestNotified(sql, { householdId, requestId, now }) {
  const rows = await sql`
    update airbnb.guest_time_requests
    set status = 'guest_notified', guest_notified_at = ${now}
    where household_id = ${householdId}
      and id = ${requestId}
      and status = 'ready'
    returning id, status
  `;
  return rows[0] ?? null;
}

export async function reconcileGuestTimeRequestNotifications(sql, { householdId, now }) {
  const rows = await sql`
    update airbnb.guest_time_requests request
    set status = 'guest_notified', guest_notified_at = ${now}
    from airbnb.reply_deliveries delivery
    where request.household_id = ${householdId}
      and request.status = 'ready'
      and delivery.household_id = request.household_id
      and delivery.thread_id = request.thread_id
      and delivery.status = 'sent'
      and delivery.classification->>'operationalRequestId' = request.id::text
    returning request.id, request.status
  `;
  return rows;
}

const STALE_SENDING_AFTER_MS = 15 * 60 * 1000;

export async function recoverStaleSendingDeliveries(sql, {
  householdId,
  now,
  staleAfterMs = STALE_SENDING_AFTER_MS,
}) {
  const checkedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(checkedAt.getTime())) throw new Error("Stale delivery recovery time is invalid.");
  const staleBefore = new Date(checkedAt.getTime() - staleAfterMs);
  return sql.begin(async (transaction) => {
    const retryable = await transaction`
      update airbnb.reply_deliveries
      set status = 'approved',
          last_delivery_error = 'Recovered a stale claim before the possible-send boundary.',
          last_reconciled_at = ${checkedAt},
          updated_at = ${checkedAt}
      where household_id = ${householdId}
        and status = 'sending'
        and send_attempted_at is null
        and coalesce(last_reconciled_at, updated_at) < ${staleBefore}
      returning id
    `;
    const ambiguous = await transaction`
      update airbnb.reply_deliveries
      set status = 'ambiguous',
          cancellation_reason = 'A stale possible-send sequence requires manual Sent-mail reconciliation.',
          last_delivery_error = 'Recovered a stale delivery after the possible-send boundary.',
          last_reconciled_at = ${checkedAt},
          updated_at = ${checkedAt}
      where household_id = ${householdId}
        and status = 'sending'
        and send_attempted_at is not null
        and coalesce(last_reconciled_at, updated_at) < ${staleBefore}
      returning id, thread_id
    `;
    for (const delivery of ambiguous) {
      await transaction`
        insert into airbnb.alerts (
          household_id, alert_type, severity, status, dedupe_key, summary, details
        ) values (
          ${householdId}, 'guest_overdue', 'critical', 'suppressed',
          ${`guest:${delivery.threadId}:delivery-ambiguous:${delivery.id}`},
          'Airbnb reply delivery outcome needs confirmation',
          ${transaction.json({
            threadId: delivery.threadId,
            replyDeliveryId: delivery.id,
            stage: "delivery_ambiguous",
            classificationSummary: "Check Sent mail, then mark the reply sent, retry it, or cancel it.",
          })}
        )
        on conflict (household_id, dedupe_key)
        do update set severity = excluded.severity,
                      status = 'suppressed',
                      summary = excluded.summary,
                      details = excluded.details,
                      notified_at = null,
                      resolved_at = null,
                      updated_at = now()
      `;
      await recordSupportAudit(transaction, {
        householdId,
        action: "guest_reply_stale_send_ambiguous",
        entityId: delivery.id,
        details: { reason: "stale_after_possible_send_boundary" },
        occurredAt: checkedAt,
      });
    }
    return { retryableCount: retryable.length, ambiguousCount: ambiguous.length };
  });
}

export async function loadDeliveryGuardCandidates(sql, { householdId, now, limit = 8 }) {
  await recoverStaleSendingDeliveries(sql, { householdId, now });
  return sql`
    select id
    from airbnb.reply_deliveries
    where household_id = ${householdId}
      and status = 'approved'
      and (
        approved_by is not null
        or classification @> '{"messageWhitelisted": true}'::jsonb
      )
    order by created_at
    limit ${limit}
  `;
}

async function recordSupportAudit(transaction, {
  householdId,
  action,
  entityId,
  entityType = "reply_delivery",
  details = {},
  occurredAt,
}) {
  await transaction`
    insert into airbnb.audit_events (
      household_id, actor_type, actor_id, action, entity_type, entity_id, details, occurred_at
    ) values (
      ${householdId}, 'worker', 'support', ${action}, ${entityType}, ${entityId},
      ${transaction.json(details)}, ${occurredAt}
    )
  `;
}

export async function loadSuppressedSupportAlerts(sql, { householdId, limit = 24 }) {
  return sql`
    with ranked as (
      select alert.id, alert.alert_type, alert.severity, alert.dedupe_key,
             alert.summary, alert.details, alert.opened_at,
             row_number() over (
               partition by coalesce(alert.details->>'threadId', alert.dedupe_key)
               order by case alert.details->>'stage'
                 when 'delivery_ambiguous' then 3
                 when 'overdue' then 2
                 when 'reminder' then 1
                 else 0
               end desc, alert.opened_at desc, alert.id desc
             ) as stage_rank
      from airbnb.alerts alert
      join airbnb.guest_threads thread
        on thread.household_id = alert.household_id
       and thread.id = nullif(alert.details->>'threadId', '')::uuid
      join airbnb.reply_deliveries delivery
        on delivery.household_id = alert.household_id
       and delivery.id = nullif(alert.details->>'replyDeliveryId', '')::uuid
      where alert.household_id = ${householdId}
        and alert.status = 'suppressed'
        and alert.alert_type in ('guest_escalation', 'guest_overdue')
        and thread.status = 'needs_human'
        and (thread.last_host_at is null or thread.last_host_at < thread.last_guest_at)
        and (
          delivery.status not in ('sent', 'handled_by_human', 'cancelled', 'ambiguous')
          or (
            delivery.status = 'ambiguous'
            and alert.details->>'stage' = 'delivery_ambiguous'
          )
        )
    )
    select id, alert_type, severity, dedupe_key, summary, details, opened_at
    from ranked
    where stage_rank = 1
    order by case details->>'stage'
      when 'delivery_ambiguous' then 3
      when 'overdue' then 2
      when 'reminder' then 1
      else 0
    end desc, opened_at, id
    limit ${limit}
  `;
}

export async function markSupportAlertNotified(sql, { householdId, alertId, now }) {
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.alerts
      set status = 'notified', notified_at = ${now}
      where household_id = ${householdId}
        and id = ${alertId}
        and status = 'suppressed'
      returning id, details
    `;
    if (!rows[0]) return null;
    const threadId = rows[0].details?.threadId ?? null;
    if (threadId) {
      await transaction`
        update airbnb.alerts
        set status = 'resolved', resolved_at = ${now}
        where household_id = ${householdId}
          and id <> ${alertId}
          and status = 'suppressed'
          and alert_type in ('guest_escalation', 'guest_overdue')
          and details->>'threadId' = ${threadId}
      `;
    }
    await recordSupportAudit(transaction, {
      householdId,
      action: "guest_alert_notified",
      entityType: "alert",
      entityId: alertId,
      occurredAt: now,
    });
    return { id: rows[0].id, status: "notified" };
  });
}

export async function claimDeliveryForGuard(sql, { householdId, deliveryId, now }) {
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      select
        delivery.id,
        delivery.status,
        delivery.source_fingerprint,
        delivery.source_last_event_at,
        delivery.draft_text,
        delivery.final_text,
        delivery.outbound_message_id,
        delivery.send_attempt_count,
        delivery.send_attempted_at,
        thread.provider_thread_id,
        thread.source_fingerprint as latest_thread_fingerprint,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'direction', message.direction,
            'contentHash', message.content_hash
          ))
          from airbnb.guest_messages message
          where message.household_id = delivery.household_id
            and message.thread_id = delivery.thread_id
            and message.provider_sent_at <= delivery.source_last_event_at
        ), '[]'::jsonb) as source_events
      from airbnb.reply_deliveries delivery
      join airbnb.guest_threads thread
        on thread.household_id = delivery.household_id
       and thread.id = delivery.thread_id
      where delivery.household_id = ${householdId}
        and delivery.id = ${deliveryId}
        and delivery.status = 'approved'
      for update of delivery, thread
    `;
    const delivery = rows[0];
    if (!delivery) return null;
    await transaction`
      update airbnb.reply_deliveries
      set status = 'sending',
          last_reconciled_at = ${now},
          last_delivery_error = null
      where household_id = ${householdId} and id = ${deliveryId}
    `;
    return { ...delivery, status: "sending", action: "claimed" };
  });
}

export async function applyDeliveryGuardDecision(sql, {
  householdId,
  deliveryId,
  decision,
  now,
}) {
  if (decision.action === "send") return { status: "sending", reason: decision.reason };
  const status = decision.action === "mark_sent"
    ? "sent"
    : decision.action === "handled_by_human"
      ? "handled_by_human"
      : "cancelled";
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.reply_deliveries
      set status = ${status},
          send_attempt_count = greatest(
            0,
            send_attempt_count - case when send_attempted_at is not null then 1 else 0 end
          ),
          send_attempted_at = null,
          cancellation_reason = ${status === "cancelled" ? decision.reason : null},
          provider_sent_message_id = case
            when ${status} = 'sent' then outbound_message_id
            else provider_sent_message_id
          end,
          sent_at = case when ${status} = 'sent' then coalesce(sent_at, ${now}) else sent_at end,
          last_reconciled_at = ${now}
      where household_id = ${householdId}
        and id = ${deliveryId}
        and status = 'sending'
      returning id, thread_id, status
    `;
    if (!rows[0]) return null;
    if (["sent", "handled_by_human"].includes(status)) {
      await transaction`
        update airbnb.guest_threads thread
        set status = 'handled'
        where thread.household_id = ${householdId}
          and thread.id = ${rows[0].threadId}
          and thread.source_fingerprint = (
            select delivery.source_fingerprint
            from airbnb.reply_deliveries delivery
            where delivery.household_id = ${householdId} and delivery.id = ${deliveryId}
          )
      `;
      await transaction`
        update airbnb.alerts
        set status = 'resolved', resolved_at = ${now}, updated_at = ${now}
        where household_id = ${householdId}
          and status = 'suppressed'
          and alert_type in ('guest_escalation', 'guest_overdue')
          and details->>'threadId' = ${rows[0].threadId}
      `;
    } else {
      await transaction`
        update airbnb.guest_threads
        set status = 'open'
        where household_id = ${householdId} and id = ${rows[0].threadId}
      `;
    }
    await recordSupportAudit(transaction, {
      householdId,
      action: `guest_reply_guard_${status}`,
      entityId: deliveryId,
      details: { reason: decision.reason },
      occurredAt: now,
    });
    return { ...rows[0], reason: decision.reason };
  });
}

export async function recordDeliveryAttempt(sql, { householdId, deliveryId, now }) {
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.reply_deliveries
      set send_attempt_count = send_attempt_count + 1,
          send_attempted_at = ${now},
          last_delivery_error = null
      where household_id = ${householdId}
        and id = ${deliveryId}
        and status = 'sending'
      returning id, send_attempt_count
    `;
    if (!rows[0]) return null;
    await recordSupportAudit(transaction, {
      householdId,
      action: "guest_reply_send_attempted",
      entityId: deliveryId,
      details: { attempt: rows[0].sendAttemptCount },
      occurredAt: now,
    });
    return rows[0];
  });
}

export async function markDeliverySent(sql, {
  householdId,
  deliveryId,
  providerMessageId,
  now,
}) {
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.reply_deliveries
      set status = 'sent',
          provider_sent_message_id = ${providerMessageId},
          sent_at = ${now},
          last_reconciled_at = ${now},
          last_delivery_error = null
      where household_id = ${householdId}
        and id = ${deliveryId}
        and status = 'sending'
      returning id, thread_id, status
    `;
    if (!rows[0]) return null;
    await transaction`
      update airbnb.guest_threads thread
      set status = 'handled'
      where thread.household_id = ${householdId}
        and thread.id = ${rows[0].threadId}
        and thread.source_fingerprint = (
          select delivery.source_fingerprint
          from airbnb.reply_deliveries delivery
          where delivery.household_id = ${householdId} and delivery.id = ${deliveryId}
        )
    `;
    await transaction`
      update airbnb.alerts
      set status = 'resolved', resolved_at = ${now}, updated_at = ${now}
      where household_id = ${householdId}
        and status = 'suppressed'
        and alert_type in ('guest_escalation', 'guest_overdue')
        and details->>'threadId' = ${rows[0].threadId}
    `;
    await recordSupportAudit(transaction, {
      householdId,
      action: "guest_reply_sent",
      entityId: deliveryId,
      details: { providerMessageFingerprint: contentFingerprint(providerMessageId).slice(0, 16) },
      occurredAt: now,
    });
    return rows[0];
  });
}

export async function recordAmbiguousDeliveryFailure(sql, {
  householdId,
  deliveryId,
  error,
  now,
}) {
  const message = redactCredentialText(error?.message ?? "Ambiguous SMTP failure.").slice(0, 300);
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.reply_deliveries
      set status = 'ambiguous',
          cancellation_reason = 'Ambiguous SMTP result requires manual Sent-mail reconciliation.',
          last_delivery_error = ${message},
          last_reconciled_at = ${now}
      where household_id = ${householdId}
        and id = ${deliveryId}
        and status = 'sending'
      returning id, thread_id, status
    `;
    if (!rows[0]) return null;
    await transaction`
      insert into airbnb.alerts (
        household_id, alert_type, severity, status, dedupe_key, summary, details
      ) values (
        ${householdId}, 'guest_overdue', 'critical', 'suppressed',
        ${`guest:${rows[0].threadId}:delivery-ambiguous:${deliveryId}`},
        'Airbnb reply delivery outcome needs confirmation',
        ${transaction.json({
          threadId: rows[0].threadId,
          replyDeliveryId: deliveryId,
          stage: "delivery_ambiguous",
          classificationSummary: "Check Sent mail, then mark the reply sent, retry it, or cancel it.",
        })}
      )
      on conflict (household_id, dedupe_key)
      do update set severity = excluded.severity,
                    status = 'suppressed',
                    summary = excluded.summary,
                    details = excluded.details,
                    notified_at = null,
                    resolved_at = null,
                    updated_at = now()
    `;
    await recordSupportAudit(transaction, {
      householdId,
      action: "guest_reply_send_ambiguous",
      entityId: deliveryId,
      details: { error: message },
      occurredAt: now,
    });
    return rows[0];
  });
}

export async function recordDeliveryGuardFailure(sql, {
  householdId,
  deliveryId,
  error,
  now,
  attemptRecorded = false,
}) {
  const message = redactCredentialText(error?.message ?? "Delivery guard failed.").slice(0, 300);
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.reply_deliveries
      set status = 'approved',
          send_attempt_count = greatest(
            0,
            send_attempt_count - case when send_attempted_at is not null then 1 else 0 end
          ),
          send_attempted_at = null,
          last_delivery_error = ${message},
          last_reconciled_at = ${now}
      where household_id = ${householdId}
        and id = ${deliveryId}
        and status = 'sending'
      returning id, status
    `;
    if (!rows[0]) return null;
    await recordSupportAudit(transaction, {
      householdId,
      action: "guest_reply_guard_failed",
      entityId: deliveryId,
      details: { error: message, attemptRecorded },
      occurredAt: now,
    });
    return rows[0];
  });
}

export async function latestSupportRun(sql, householdId) {
  const rows = await sql`
    select run_id, status, receipt, started_at, completed_at
    from airbnb.job_runs
    where household_id = ${householdId} and service = 'support'
    order by started_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function latestConversationEvidenceAt(sql, householdId, mailboxScope = "tristan") {
  if (!["tristan", "jane"].includes(mailboxScope)) throw new Error("Unsupported mailbox scope.");
  const rows = await sql`
    select max(occurred_at) as latest
    from airbnb.evidence
    where household_id = ${householdId}
      and mailbox_scope = ${mailboxScope}
      and provider = 'gmail'
      and evidence_kind = 'conversation'
  `;
  return rows[0]?.latest ? new Date(rows[0].latest) : null;
}
