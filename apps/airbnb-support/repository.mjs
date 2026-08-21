import { contentFingerprint, conversationEntryKey, propertyForListing } from "@tristdrum/airbnb-core";

function eventTime(occurredAt, sequence) {
  const value = new Date(occurredAt);
  value.setMilliseconds(value.getMilliseconds() + sequence);
  return value.toISOString();
}

export async function ingestConversation(sql, { householdId, email, parsed }) {
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
        ${transaction.json({ listingName: parsed.listingName, stayLabel: parsed.stayLabel, entryCount: parsed.entries.length })}
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
      do update set property_id = coalesce(excluded.property_id, airbnb.guest_threads.property_id),
                    guest_display_name = coalesce(excluded.guest_display_name, airbnb.guest_threads.guest_display_name),
                    status = excluded.status,
                    last_guest_at = greatest(airbnb.guest_threads.last_guest_at, excluded.last_guest_at),
                    last_host_at = greatest(airbnb.guest_threads.last_host_at, excluded.last_host_at),
                    source_fingerprint = excluded.source_fingerprint
      returning id, status
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
    return {
      threadId: thread.id,
      providerThreadId: parsed.providerThreadId,
      status: thread.status,
      latestDirection: latest.direction,
      evidenceId: evidenceRows[0].id,
      propertyId: propertyRows[0]?.id ?? null,
    };
  });
}

export async function loadShadowCandidates(sql, { householdId, limit = 8 }) {
  const rows = await sql`
    select
      thread.id,
      thread.provider_thread_id,
      thread.guest_display_name,
      thread.source_fingerprint,
      thread.last_guest_at,
      property.listing_name,
      property.facts,
      existing.classification as existing_classification,
      existing.draft_text as existing_draft,
      latest.body_normalized as guest_message,
      latest.provider_sent_at as latest_event_at
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
      and coalesce(existing.status, 'draft') not in ('sent', 'handled_by_human', 'cancelled')
    order by (existing.classification is null) desc, thread.last_guest_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    ...row,
    facts: row.facts ?? {},
    existingClassification: row.existingClassification
      ? { ...row.existingClassification, draft: row.existingDraft }
      : null,
  }));
}

export async function storeShadowDraft(sql, { householdId, candidate, classification, now }) {
  const idempotencyKey = `airbnb-support:${candidate.providerThreadId}:${candidate.sourceFingerprint}`;
  const outboundMessageId = `<${contentFingerprint(idempotencyKey).slice(0, 32)}@airbnb.tristdrum.com>`;
  const rows = await sql`
    insert into airbnb.reply_deliveries (
      household_id, thread_id, source_fingerprint, source_last_event_at, topic,
      risk_tier, classification, draft_text, status, idempotency_key, outbound_message_id
    ) values (
      ${householdId}, ${candidate.id}, ${candidate.sourceFingerprint}, ${candidate.latestEventAt},
      ${classification.topic}, ${classification.riskTier},
      ${sql.json({ ...classification, shadowMode: true })}, ${classification.draft},
      'needs_approval', ${idempotencyKey}, ${outboundMessageId}
    )
    on conflict (idempotency_key)
    do update set classification = excluded.classification,
                  draft_text = excluded.draft_text,
                  updated_at = now()
    returning id, status
  `;
  await sql`
    update airbnb.guest_threads
    set status = 'needs_human', risk_tier = ${classification.riskTier}
    where household_id = ${householdId} and id = ${candidate.id}
  `;
  const minutesOpen = Math.floor((now.getTime() - Date.parse(candidate.latestEventAt)) / 60_000);
  const alertType = minutesOpen >= 60 ? "guest_overdue" : "guest_escalation";
  await sql`
    insert into airbnb.alerts (
      household_id, alert_type, severity, status, dedupe_key, summary, details
    ) values (
      ${householdId}, ${alertType}, ${minutesOpen >= 60 ? "critical" : "warning"}, 'suppressed',
      ${`guest:${candidate.providerThreadId}:${candidate.sourceFingerprint}`},
      ${minutesOpen >= 60 ? "Airbnb guest message is overdue" : "Airbnb guest message needs human review"},
      ${sql.json({ threadId: candidate.id, replyDeliveryId: rows[0].id, minutesOpen, topic: classification.topic })}
    )
    on conflict (household_id, dedupe_key)
    do update set alert_type = excluded.alert_type,
                  severity = excluded.severity,
                  summary = excluded.summary,
                  details = excluded.details,
                  updated_at = now()
  `;
  return { id: rows[0].id, status: rows[0].status, minutesOpen, alertType };
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

export async function latestConversationEvidenceAt(sql, householdId) {
  const rows = await sql`
    select max(occurred_at) as latest
    from airbnb.evidence
    where household_id = ${householdId}
      and mailbox_scope = 'tristan'
      and provider = 'gmail'
      and evidence_kind = 'conversation'
  `;
  return rows[0]?.latest ? new Date(rows[0].latest) : null;
}
