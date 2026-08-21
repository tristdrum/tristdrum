import { createHash } from "node:crypto";
import postgres from "postgres";
import { guestComposition } from "./report.mjs";

function databaseConfiguration(env) {
  const url = String(env.AIRBNB_DATABASE_URL ?? "").trim();
  const householdId = String(env.AIRBNB_HOUSEHOLD_ID ?? "").trim();
  if (!url && !householdId) return null;
  if (!url || !householdId) {
    throw new Error("AIRBNB_DATABASE_URL and AIRBNB_HOUSEHOLD_ID must be configured together.");
  }
  return { url, householdId };
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sourceTime(evidence, fallback) {
  if (Number.isFinite(evidence?.sourceTimestamp) && evidence.sourceTimestamp > 0) {
    return new Date(evidence.sourceTimestamp).toISOString();
  }
  const parsed = Date.parse(evidence?.sourceDate ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function confirmationCode(reservation) {
  if (reservation.confirmationCode) return reservation.confirmationCode;
  return `uncoded:${hash([
    reservation.unitId,
    reservation.checkIn,
    reservation.checkOut,
  ].join(":"))}`;
}

function counts(reservation) {
  const composition = guestComposition(reservation);
  const componentTotal = composition.adultCount + composition.childCount;
  const known = componentTotal > 0 || composition.explicitGuestCount > 0;
  return {
    adults: componentTotal > 0 ? composition.adultCount : composition.explicitGuestCount,
    children: composition.childCount,
    infants: composition.infantCount,
    guestCountKnown: known,
  };
}

function deliveryStatus(result) {
  if (["preview", "dry_run_ok", "sent", "duplicate_skipped", "blocked", "error"].includes(result.status)) {
    return result.status;
  }
  return "error";
}

export async function syncCleanerDatabase({ result, receipt, env = process.env, postgresFactory = postgres }) {
  if (result.mode !== "live") return { status: "disabled" };
  const configuration = databaseConfiguration(env);
  if (!configuration) return { status: "disabled" };
  const { householdId, url } = configuration;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(householdId)) {
    throw new Error("AIRBNB_HOUSEHOLD_ID must be a UUID.");
  }
  const sql = postgresFactory(url, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    transform: postgresFactory.camel,
    connection: {
      application_name: "airbnb-cleaner",
      statement_timeout: 60_000,
      lock_timeout: 5_000,
    },
  });
  try {
    return await sql.begin(async (transaction) => {
      const properties = await transaction`
        select id, unit_number
        from airbnb.properties
        where household_id = ${householdId}
      `;
      const propertyByUnit = new Map(properties.map((property) => [Number(property.unitNumber), property.id]));
      const evidenceByEnvelope = new Map();
      for (const evidence of result.reservationEvidence ?? []) {
        const occurredAt = sourceTime(evidence, receipt.startedAt);
        const normalized = {
          unitId: evidence.unitId,
          checkIn: evidence.checkIn,
          checkOut: evidence.checkOut,
          confirmationCode: evidence.confirmationCode || null,
          guestName: evidence.guestName || null,
          guests: evidence.guests || null,
          evidenceKind: evidence.evidenceKind,
          evidenceSubtype: evidence.evidenceSubtype,
        };
        const rows = await transaction`
          insert into airbnb.evidence (
            household_id, mailbox_scope, provider, provider_message_id, sender_address,
            subject, evidence_kind, evidence_subtype, occurred_at, content_hash, normalized_payload
          ) values (
            ${householdId}, 'tristan', 'gmail', ${`imap:${evidence.sourceEnvelopeId}`},
            'automated@airbnb.com', ${evidence.subject}, ${evidence.evidenceKind},
            ${evidence.evidenceSubtype}, ${occurredAt}, ${hash(JSON.stringify(normalized))},
            ${transaction.json(normalized)}
          )
          on conflict (household_id, mailbox_scope, provider, provider_message_id)
          do update set content_hash = excluded.content_hash,
                        normalized_payload = excluded.normalized_payload,
                        occurred_at = excluded.occurred_at
          returning id
        `;
        evidenceByEnvelope.set(String(evidence.sourceEnvelopeId), { id: rows[0].id, occurredAt, evidence });
      }

      for (const entry of evidenceByEnvelope.values()) {
        if (entry.evidence.evidenceKind !== "cancelled") continue;
        const cancellationCode = entry.evidence.confirmationCode || (
          entry.evidence.unitId && entry.evidence.checkIn && entry.evidence.checkOut
            ? confirmationCode(entry.evidence)
            : null
        );
        if (!cancellationCode) continue;
        const cancelledRows = await transaction`
          update airbnb.reservations
          set booking_status = 'cancelled',
              authoritative_evidence_id = ${entry.id},
              source_cutoff_at = ${entry.occurredAt},
              revision = revision + 1
          where household_id = ${householdId}
            and confirmation_code = ${cancellationCode}
            and source_cutoff_at <= ${entry.occurredAt}
            and (
              booking_status <> 'cancelled'
              or authoritative_evidence_id <> ${entry.id}
              or source_cutoff_at <> ${entry.occurredAt}
            )
          returning id
        `;
        if (cancelledRows[0]) {
          await transaction`
            insert into airbnb.reservation_evidence (
              household_id, reservation_id, evidence_id, relationship
            ) values (
              ${householdId}, ${cancelledRows[0].id}, ${entry.id}, 'cancellation'
            )
            on conflict (household_id, reservation_id, evidence_id) do nothing
          `;
        }
      }

      let reservationCount = 0;
      for (const reservation of result.reservations ?? []) {
        const propertyId = propertyByUnit.get(Number(reservation.unitId));
        const authoritative = evidenceByEnvelope.get(String(reservation.sourceEnvelopeId));
        if (!propertyId || !authoritative || !reservation.checkIn || !reservation.checkOut) continue;
        const guestCounts = counts(reservation);
        const code = confirmationCode(reservation);
        const reservationRows = await transaction`
          insert into airbnb.reservations (
            household_id, property_id, confirmation_code, guest_name, check_in, check_out,
            adults, children, infants, guest_count_known, booking_status,
            authoritative_evidence_id, source_cutoff_at
          ) values (
            ${householdId}, ${propertyId}, ${code}, ${reservation.guestName || null},
            ${reservation.checkIn}, ${reservation.checkOut}, ${guestCounts.adults},
            ${guestCounts.children}, ${guestCounts.infants}, ${guestCounts.guestCountKnown},
            'confirmed', ${authoritative.id}, ${authoritative.occurredAt}
          )
          on conflict (household_id, confirmation_code)
          do update set property_id = excluded.property_id,
                        guest_name = coalesce(excluded.guest_name, airbnb.reservations.guest_name),
                        check_in = excluded.check_in,
                        check_out = excluded.check_out,
                        adults = excluded.adults,
                        children = excluded.children,
                        infants = excluded.infants,
                        guest_count_known = excluded.guest_count_known,
                        booking_status = 'confirmed',
                        authoritative_evidence_id = excluded.authoritative_evidence_id,
                        source_cutoff_at = excluded.source_cutoff_at,
                        revision = airbnb.reservations.revision + case
                          when row(
                            airbnb.reservations.property_id,
                            airbnb.reservations.guest_name,
                            airbnb.reservations.check_in,
                            airbnb.reservations.check_out,
                            airbnb.reservations.adults,
                            airbnb.reservations.children,
                            airbnb.reservations.infants,
                            airbnb.reservations.guest_count_known,
                            airbnb.reservations.booking_status,
                            airbnb.reservations.authoritative_evidence_id,
                            airbnb.reservations.source_cutoff_at
                          ) is distinct from row(
                            excluded.property_id,
                            coalesce(excluded.guest_name, airbnb.reservations.guest_name),
                            excluded.check_in,
                            excluded.check_out,
                            excluded.adults,
                            excluded.children,
                            excluded.infants,
                            excluded.guest_count_known,
                            'confirmed',
                            excluded.authoritative_evidence_id,
                            excluded.source_cutoff_at
                          ) then 1 else 0
                        end
          where excluded.source_cutoff_at > airbnb.reservations.source_cutoff_at
             or (
               excluded.source_cutoff_at = airbnb.reservations.source_cutoff_at
               and excluded.authoritative_evidence_id = airbnb.reservations.authoritative_evidence_id
             )
          returning id
        `;
        const reservationId = reservationRows[0]?.id;
        if (!reservationId) continue;
        reservationCount += 1;
        for (const sourceEnvelopeId of reservation.sources ?? [reservation.sourceEnvelopeId]) {
          const linked = evidenceByEnvelope.get(String(sourceEnvelopeId));
          if (!linked) continue;
          const relationship = linked.evidence.evidenceKind === "confirmed" ? "confirmation"
            : linked.evidence.evidenceSubtype === "update" ? "update"
              : "supplemental";
          await transaction`
            insert into airbnb.reservation_evidence (
              household_id, reservation_id, evidence_id, relationship
            ) values (
              ${householdId}, ${reservationId}, ${linked.id}, ${relationship}
            )
            on conflict (household_id, reservation_id, evidence_id) do nothing
          `;
        }
      }

      const planRows = await transaction`
        insert into airbnb.cleaner_plans (
          household_id, run_id, target_date, mode, delivery_status, message_hash,
          message_text, is_update, unit_states, confidence, source_cutoff_at,
          started_at, completed_at, sent_at
        ) values (
          ${householdId}, ${receipt.runId}, ${result.targetDate}, ${result.mode},
          ${deliveryStatus(result)}, ${result.messageHash}, ${result.message},
          ${result.isUpdate}, ${transaction.json(result.unitReports ?? [])},
          ${transaction.json(result.confidence ?? {})}, ${receipt.startedAt},
          ${receipt.startedAt}, ${receipt.completedAt},
          ${result.status === "sent" ? receipt.completedAt : null}
        )
        on conflict (household_id, target_date, message_hash)
        do update set delivery_status = excluded.delivery_status,
                      confidence = excluded.confidence,
                      completed_at = excluded.completed_at,
                      sent_at = coalesce(airbnb.cleaner_plans.sent_at, excluded.sent_at)
        returning id
      `;
      const { databaseSync: _databaseSync, ...receiptForDatabase } = receipt;
      await transaction`
        insert into airbnb.job_runs (
          household_id, service, job_name, run_id, target_date, status,
          receipt, started_at, completed_at
        ) values (
          ${householdId}, 'cleaner', 'scheduled-report', ${receipt.runId}, ${result.targetDate},
          ${result.status}, ${transaction.json(receiptForDatabase)},
          ${receipt.startedAt}, ${receipt.completedAt}
        )
        on conflict (service, run_id)
        do update set status = excluded.status,
                      receipt = excluded.receipt,
                      completed_at = excluded.completed_at
      `;
      return { status: "synced", reservationCount, evidenceCount: evidenceByEnvelope.size, cleanerPlanId: planRows[0].id };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
