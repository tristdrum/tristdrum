import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  createAirbnbDatabase,
  recordJobFinish,
  recordJobStart,
} from "@tristdrum/airbnb-db";
import {
  loadCleanerLedgerRecords,
  syncCleanerDatabase,
  syncCleanerFailureDatabase,
} from "../airbnb-cleaner/database.mjs";
import {
  ingestOrderEvidence,
  ingestStockWhatsAppObservation,
  loadSuppressedStockAlerts,
  reconcileReservationConsumption,
  storeShoppingList,
} from "./repository.mjs";

const adminUrl = process.env.AIRBNB_INTEGRATION_DATABASE_URL;
const householdId = randomUUID();
const otherHouseholdId = randomUUID();
const ownerId = randomUUID();
const localPassword = "airbnb-local-integration-only";

function isLoopbackDatabase(url) {
  const hostname = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

if (adminUrl && !isLoopbackDatabase(adminUrl)) {
  throw new Error("AIRBNB_INTEGRATION_DATABASE_URL must target a loopback database.");
}

function roleUrl(url, role) {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = localPassword;
  return parsed.toString();
}

function workerDatabase(url, role, service, scopedHouseholdId = householdId) {
  return createAirbnbDatabase({
    postgresFactory: postgres,
    url: roleUrl(url, role),
    env: {
      AIRBNB_HOUSEHOLD_ID: scopedHouseholdId,
      AIRBNB_SERVICE_NAME: service,
    },
  });
}

async function provisionLocalFixtures(admin) {
  await admin.unsafe(`
    do $roles$
    begin
      if not exists (select 1 from pg_roles where rolname = 'airbnb_cleaner_runtime_test') then
        create role airbnb_cleaner_runtime_test login password '${localPassword}';
      else
        alter role airbnb_cleaner_runtime_test password '${localPassword}';
      end if;
      if not exists (select 1 from pg_roles where rolname = 'airbnb_stock_runtime_test') then
        create role airbnb_stock_runtime_test login password '${localPassword}';
      else
        alter role airbnb_stock_runtime_test password '${localPassword}';
      end if;
      if not exists (select 1 from pg_roles where rolname = 'airbnb_support_runtime_test') then
        create role airbnb_support_runtime_test login password '${localPassword}';
      else
        alter role airbnb_support_runtime_test password '${localPassword}';
      end if;
    end
    $roles$;
    grant airbnb_cleaner_worker to airbnb_cleaner_runtime_test;
    grant airbnb_stock_worker to airbnb_stock_runtime_test;
    grant airbnb_support_worker to airbnb_support_runtime_test;
  `);
  await admin`
    insert into auth.users (id, email)
    values (${ownerId}, ${`airbnb-integration-${ownerId}@example.invalid`})
    on conflict (id) do nothing
  `;
  for (const [id, name] of [
    [householdId, "Airbnb Integration Household"],
    [otherHouseholdId, "Other Integration Household"],
  ]) {
    await admin`
      insert into public.households (id, name, created_by)
      values (${id}, ${name}, ${ownerId})
      on conflict (id) do update set name = excluded.name
    `;
  }
  await admin`
    insert into airbnb.worker_identities (role_name, household_id, service)
    values
      ('airbnb_cleaner_runtime_test', ${householdId}, 'cleaner'),
      ('airbnb_stock_runtime_test', ${householdId}, 'stock'),
      ('airbnb_support_runtime_test', ${householdId}, 'support')
    on conflict (role_name)
    do update set household_id = excluded.household_id,
                  service = excluded.service,
                  updated_at = now()
  `;
  await admin`
    insert into airbnb.properties (household_id, unit_number, listing_name, common_name)
    values (${householdId}, 1, 'Integration Jasmine Studio', 'Unit 1')
    on conflict (household_id, unit_number) do update set listing_name = excluded.listing_name
  `;
  const inventoryRows = await admin`
    insert into airbnb.inventory_items (
      household_id, sku, display_name, category, stock_unit,
      consumption_basis, quantity_per_basis, count_status
    ) values (
      ${householdId}, 'integration_chocolate', 'Integration chocolate',
      'guest_supply', 'each', 'per_guest', 1, 'inferred'
    )
    on conflict (household_id, sku) do update set quantity_per_basis = excluded.quantity_per_basis
    returning id
  `;
  await admin`
    insert into airbnb.inventory_items (
      household_id, sku, display_name, category, stock_unit,
      consumption_basis, quantity_per_basis, count_status
    ) values (
      ${householdId}, 'guest_chocolate', 'Guest chocolates',
      'guest_supply', 'each', 'manual', 0, 'confirm'
    )
    on conflict (household_id, sku)
    do update set display_name = excluded.display_name,
                  consumption_basis = excluded.consumption_basis,
                  quantity_per_basis = excluded.quantity_per_basis
  `;
  return inventoryRows[0].id;
}

function cleanerPayload({
  runId,
  envelopeId,
  confirmationCode,
  occurredAt,
  evidenceKind = "confirmed",
  includeReservation = true,
  checkIn = "2026-09-25",
  checkOut = "2026-09-26",
}) {
  const reservation = {
    unitId: 1,
    guestName: "Integration Mirror Guest",
    guests: "1 adult, 1 child, 1 infant",
    checkIn,
    checkOut,
    confirmationCode,
    sourceEnvelopeId: envelopeId,
    sources: [envelopeId],
  };
  const evidence = {
    ...reservation,
    evidenceKind,
    evidenceSubtype: evidenceKind === "cancelled" ? "cancellation" : "confirmation",
    subject: evidenceKind === "cancelled" ? "Cancelled reservation" : "Reservation confirmed",
    sourceTimestamp: Date.parse(occurredAt),
  };
  const receipt = {
    schemaVersion: 1,
    runId,
    status: "duplicate_skipped",
    targetDate: "2026-08-22",
    startedAt: occurredAt,
    completedAt: new Date(Date.parse(occurredAt) + 1_000).toISOString(),
  };
  return {
    receipt,
    result: {
      mode: "live",
      status: "duplicate_skipped",
      targetDate: "2026-08-22",
      messageHash: `integration-${runId}`,
      message: "Integration cleaner plan",
      isUpdate: false,
      unitReports: [],
      confidence: { ok: true },
      reservations: includeReservation ? [reservation] : [],
      reservationEvidence: [evidence],
    },
  };
}

test("scoped workers enforce household isolation, service boundaries, job locks, and reservation stock transitions", {
  skip: !adminUrl,
}, async () => {
  const admin = postgres(adminUrl, { max: 1, prepare: false });
  const databases = [];
  let fixtureLockHeld = false;
  try {
    await admin`select pg_advisory_lock(hashtext('airbnb-runtime-integration-fixtures'))`;
    fixtureLockHeld = true;
    const inventoryItemId = await provisionLocalFixtures(admin);
    const stock = workerDatabase(adminUrl, "airbnb_stock_runtime_test", "airbnb-stock");
    const wrongHousehold = workerDatabase(
      adminUrl,
      "airbnb_stock_runtime_test",
      "airbnb-stock-wrong-household",
      otherHouseholdId,
    );
    const support = workerDatabase(adminUrl, "airbnb_support_runtime_test", "airbnb-support");
    const cleaner = workerDatabase(adminUrl, "airbnb_cleaner_runtime_test", "airbnb-cleaner");
    databases.push(stock, wrongHousehold, support, cleaner);

    const visibleProperties = await stock.sql`select id from airbnb.properties`;
    assert.equal(visibleProperties.length, 1);
    await wrongHousehold.sql`select set_config('app.airbnb_household_id', ${otherHouseholdId}, false)`;
    assert.equal((await wrongHousehold.sql`select id from airbnb.properties`).length, 1);
    const boundHousehold = await wrongHousehold.sql`select airbnb.current_household_id() as household_id`;
    assert.equal(boundHousehold[0].householdId, householdId);
    await assert.rejects(stock.sql`select role_name from airbnb.worker_identities`, { code: "42501" });
    await assert.rejects(stock.sql`select id from airbnb.guest_messages`, { code: "42501" });
    await assert.rejects(support.sql`select id from airbnb.inventory_items`, { code: "42501" });
    await assert.rejects(cleaner.sql`select id from airbnb.guest_messages`, { code: "42501" });
    assert.equal(Array.isArray(await support.sql`select id from airbnb.guest_messages`), true);
    assert.equal(Array.isArray(await cleaner.sql`select id from airbnb.cleaner_plans`), true);

    const supportAuditEntityId = randomUUID();
    await support.sql`
      insert into airbnb.audit_events (
        household_id, actor_type, actor_id, action, entity_type, entity_id
      ) values (
        ${householdId}, 'worker', 'support', 'integration_guard_checked',
        'reply_delivery', ${supportAuditEntityId}
      )
    `;
    assert.equal((await admin`
      select count(*)::integer as count
      from airbnb.audit_events
      where household_id = ${householdId} and entity_id = ${supportAuditEntityId}
    `)[0].count, 1);
    await assert.rejects(support.sql`
      insert into airbnb.audit_events (
        household_id, actor_type, actor_id, action, entity_type, entity_id
      ) values (
        ${householdId}, 'worker', 'stock', 'integration_spoofed',
        'reply_delivery', ${randomUUID()}
      )
    `, { code: "42501" });

    const stockAuditEntityId = randomUUID();
    await stock.sql`
      insert into airbnb.audit_events (
        household_id, actor_type, actor_id, action, entity_type, entity_id
      ) values (
        ${householdId}, 'worker', 'stock', 'integration_alert_notified',
        'alert', ${stockAuditEntityId}
      )
    `;
    assert.equal((await admin`
      select count(*)::integer as count
      from airbnb.audit_events
      where household_id = ${householdId} and entity_id = ${stockAuditEntityId}
    `)[0].count, 1);
    const stockObservation = {
      providerMessageId: `integration-whatsapp-${randomUUID()}`,
      chatScope: "maids",
      senderName: "Integration cleaner",
      occurredAt: "2026-08-21T20:01:00.000Z",
      contentHash: "f".repeat(64),
      matchedSkus: ["integration_chocolate"],
    };
    assert.deepEqual(await ingestStockWhatsAppObservation(stock.sql, {
      householdId,
      observation: stockObservation,
    }), { status: "ingested", matchedItemCount: 1 });
    assert.deepEqual(await ingestStockWhatsAppObservation(stock.sql, {
      householdId,
      observation: stockObservation,
    }), { status: "duplicate", matchedItemCount: 0 });
    const observationState = (await admin`
      select
        (select count(*)::integer from airbnb.evidence
          where household_id = ${householdId}
            and provider_message_id = ${stockObservation.providerMessageId}) as evidence_count,
        (select count_status from airbnb.inventory_items
          where household_id = ${householdId} and id = ${inventoryItemId}) as count_status,
        (select count(*)::integer from airbnb.inventory_movements
          where household_id = ${householdId} and source_type = 'whatsapp') as movement_count
    `)[0];
    assert.deepEqual({ ...observationState }, {
      evidence_count: 1,
      count_status: "confirm",
      movement_count: 0,
    });
    await admin`
      update airbnb.inventory_items
      set count_status = 'confirmed', last_counted_at = '2026-08-22T09:00:00.000Z'
      where household_id = ${householdId} and id = ${inventoryItemId}
    `;
    const olderObservation = {
      ...stockObservation,
      providerMessageId: `integration-whatsapp-old-${randomUUID()}`,
      occurredAt: "2026-08-21T09:00:00.000Z",
      contentHash: "e".repeat(64),
    };
    assert.deepEqual(await ingestStockWhatsAppObservation(stock.sql, {
      householdId,
      observation: olderObservation,
    }), { status: "ingested", matchedItemCount: 0 });
    assert.equal((await admin`
      select count_status
      from airbnb.inventory_items
      where household_id = ${householdId} and id = ${inventoryItemId}
    `)[0].count_status, "confirmed");
    await assert.rejects(stock.sql`
      insert into airbnb.audit_events (
        household_id, actor_type, actor_id, action, entity_type, entity_id
      ) values (
        ${householdId}, 'worker', 'support', 'integration_spoofed',
        'alert', ${randomUUID()}
      )
    `, { code: "42501" });

    const confirmationCode = `INTEGRATION-MIRROR-${randomUUID()}`;
    const confirmed = cleanerPayload({
      runId: randomUUID(),
      envelopeId: `confirmation-${randomUUID()}`,
      confirmationCode,
      occurredAt: "2026-08-21T18:00:00.000Z",
    });
    const cleanerEnv = {
      AIRBNB_DATABASE_URL: roleUrl(adminUrl, "airbnb_cleaner_runtime_test"),
      AIRBNB_HOUSEHOLD_ID: householdId,
    };
    assert.equal((await syncCleanerDatabase({ ...confirmed, env: cleanerEnv })).status, "synced");
    assert.equal((await syncCleanerDatabase({ ...confirmed, env: cleanerEnv })).status, "synced");
    const cleanerLedger = await loadCleanerLedgerRecords({
      targetDate: confirmed.result.targetDate,
      env: cleanerEnv,
    });
    assert.equal(cleanerLedger.status, "loaded");
    assert.equal(cleanerLedger.records.some((record) => (
      record.messageHash === confirmed.result.messageHash
      && record.source === "supabase"
    )), true);
    const deliveredBeforeBlock = (await admin`
      select content_occurrence, sent_at
      from airbnb.cleaner_plans
      where household_id = ${householdId}
        and target_date = ${confirmed.result.targetDate}
        and message_hash = ${confirmed.result.messageHash}
    `)[0];
    const blockedAfterSend = {
      receipt: {
        ...confirmed.receipt,
        runId: randomUUID(),
        status: "blocked",
        startedAt: "2026-08-21T18:02:00.000Z",
        completedAt: "2026-08-21T18:02:01.000Z",
      },
      result: {
        ...confirmed.result,
        status: "blocked",
        contentOccurrence: 2,
        confidence: { ok: false, blockers: ["Integration overlap"] },
      },
    };
    assert.equal((await syncCleanerDatabase({ ...blockedAfterSend, env: cleanerEnv })).status, "synced");
    const preservedPlan = (await admin`
      select delivery_status, content_occurrence, sent_at
      from airbnb.cleaner_plans
      where household_id = ${householdId}
        and target_date = ${confirmed.result.targetDate}
        and message_hash = ${confirmed.result.messageHash}
    `)[0];
    assert.equal(preservedPlan.delivery_status, "duplicate_skipped");
    assert.equal(preservedPlan.content_occurrence, 1);
    assert.equal(preservedPlan.sent_at.toISOString(), deliveredBeforeBlock.sent_at.toISOString());
    const ledgerAfterBlock = await loadCleanerLedgerRecords({
      targetDate: confirmed.result.targetDate,
      env: cleanerEnv,
    });
    assert.equal(ledgerAfterBlock.records.some((record) => (
      record.messageHash === confirmed.result.messageHash
      && record.contentOccurrence === 1
    )), true);
    const deliveredReversion = {
      receipt: {
        ...confirmed.receipt,
        runId: randomUUID(),
        status: "sent",
        startedAt: "2026-08-21T18:03:00.000Z",
        completedAt: "2026-08-21T18:03:01.000Z",
      },
      result: {
        ...confirmed.result,
        status: "sent",
        contentOccurrence: 2,
      },
    };
    assert.equal((await syncCleanerDatabase({ ...deliveredReversion, env: cleanerEnv })).status, "synced");
    const advancedPlan = (await admin`
      select delivery_status, content_occurrence, sent_at
      from airbnb.cleaner_plans
      where household_id = ${householdId}
        and target_date = ${confirmed.result.targetDate}
        and message_hash = ${confirmed.result.messageHash}
    `)[0];
    assert.equal(advancedPlan.delivery_status, "sent");
    assert.equal(advancedPlan.content_occurrence, 2);
    assert.equal(advancedPlan.sent_at.toISOString(), deliveredReversion.receipt.completedAt);
    const mirroredRun = (await admin`
      select receipt
      from airbnb.job_runs
      where service = 'cleaner' and run_id = ${confirmed.receipt.runId}
    `)[0];
    assert.equal(mirroredRun.receipt.databaseSync.status, "synced");
    const failureRunId = randomUUID();
    assert.equal((await syncCleanerFailureDatabase({
      receipt: {
        schemaVersion: 1,
        runId: failureRunId,
        status: "error",
        mode: "live",
        targetDate: "2026-08-22",
        startedAt: "2026-08-21T18:03:00.000Z",
        completedAt: "2026-08-21T18:03:01.000Z",
        error: { code: "INTEGRATION_FAILURE", message: "Sanitized integration failure" },
      },
      env: cleanerEnv,
    })).status, "synced");
    const mirroredFailure = (await admin`
      select status, error_code, receipt
      from airbnb.job_runs
      where service = 'cleaner' and run_id = ${failureRunId}
    `)[0];
    assert.equal(mirroredFailure.status, "error");
    assert.equal(mirroredFailure.error_code, "INTEGRATION_FAILURE");
    assert.equal(mirroredFailure.receipt.databaseSync.status, "synced");
    let mirrored = await admin`
      select booking_status, revision, adults, children, infants
      from airbnb.reservations
      where household_id = ${householdId} and confirmation_code = ${confirmationCode}
    `;
    assert.deepEqual({ ...mirrored[0] }, {
      booking_status: "confirmed",
      revision: 1,
      adults: 1,
      children: 1,
      infants: 1,
    });
    const cancelled = cleanerPayload({
      runId: randomUUID(),
      envelopeId: `cancellation-${randomUUID()}`,
      confirmationCode,
      occurredAt: "2026-08-21T19:00:00.000Z",
      evidenceKind: "cancelled",
      includeReservation: false,
    });
    assert.equal((await syncCleanerDatabase({ ...cancelled, env: cleanerEnv })).status, "synced");
    mirrored = await admin`
      select booking_status, revision
      from airbnb.reservations
      where household_id = ${householdId} and confirmation_code = ${confirmationCode}
    `;
    assert.deepEqual({ ...mirrored[0] }, { booking_status: "cancelled", revision: 2 });
    const reconfirmed = cleanerPayload({
      runId: randomUUID(),
      envelopeId: `reconfirmation-${randomUUID()}`,
      confirmationCode,
      occurredAt: "2026-08-21T20:00:00.000Z",
    });
    assert.equal((await syncCleanerDatabase({ ...reconfirmed, env: cleanerEnv })).status, "synced");
    mirrored = await admin`
      select booking_status, revision
      from airbnb.reservations
      where household_id = ${householdId} and confirmation_code = ${confirmationCode}
    `;
    assert.deepEqual({ ...mirrored[0] }, { booking_status: "confirmed", revision: 3 });
    const cancellationLinks = await admin`
      select count(*) as count
      from airbnb.reservation_evidence link
      join airbnb.reservations reservation
        on reservation.household_id = link.household_id
       and reservation.id = link.reservation_id
      where reservation.confirmation_code = ${confirmationCode}
        and link.relationship = 'cancellation'
    `;
    assert.equal(Number(cancellationLinks[0].count), 1);

    const randomOffset = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 20_000;
    const uncodedCheckInDate = new Date("2030-01-01T12:00:00Z");
    uncodedCheckInDate.setUTCDate(uncodedCheckInDate.getUTCDate() + randomOffset);
    const uncodedCheckOutDate = new Date(uncodedCheckInDate);
    uncodedCheckOutDate.setUTCDate(uncodedCheckOutDate.getUTCDate() + 1);
    const uncodedCheckIn = uncodedCheckInDate.toISOString().slice(0, 10);
    const uncodedCheckOut = uncodedCheckOutDate.toISOString().slice(0, 10);
    const uncodedConfirmed = cleanerPayload({
      runId: randomUUID(),
      envelopeId: `uncoded-confirmation-${randomUUID()}`,
      confirmationCode: "",
      occurredAt: "2026-08-21T21:00:00.000Z",
      checkIn: uncodedCheckIn,
      checkOut: uncodedCheckOut,
    });
    await syncCleanerDatabase({ ...uncodedConfirmed, env: cleanerEnv });
    let uncodedRows = await admin`
      select id, booking_status, revision
      from airbnb.reservations
      where household_id = ${householdId}
        and check_in = ${uncodedCheckIn}
        and check_out = ${uncodedCheckOut}
        and confirmation_code like 'uncoded:%'
    `;
    assert.equal(uncodedRows.length, 1);
    assert.equal(uncodedRows[0].booking_status, "confirmed");
    const uncodedReservationId = uncodedRows[0].id;
    const uncodedCancelled = cleanerPayload({
      runId: randomUUID(),
      envelopeId: `uncoded-cancellation-${randomUUID()}`,
      confirmationCode: "",
      occurredAt: "2026-08-21T22:00:00.000Z",
      evidenceKind: "cancelled",
      includeReservation: false,
      checkIn: uncodedCheckIn,
      checkOut: uncodedCheckOut,
    });
    await syncCleanerDatabase({ ...uncodedCancelled, env: cleanerEnv });
    uncodedRows = await admin`
      select id, booking_status, revision
      from airbnb.reservations
      where id = ${uncodedReservationId}
    `;
    assert.deepEqual({ ...uncodedRows[0] }, {
      id: uncodedReservationId,
      booking_status: "cancelled",
      revision: 2,
    });
    const uncodedReconfirmed = cleanerPayload({
      runId: randomUUID(),
      envelopeId: `uncoded-reconfirmation-${randomUUID()}`,
      confirmationCode: "",
      occurredAt: "2026-08-21T23:00:00.000Z",
      checkIn: uncodedCheckIn,
      checkOut: uncodedCheckOut,
    });
    await syncCleanerDatabase({ ...uncodedReconfirmed, env: cleanerEnv });
    uncodedRows = await admin`
      select id, booking_status, revision
      from airbnb.reservations
      where household_id = ${householdId}
        and check_in = ${uncodedCheckIn}
        and check_out = ${uncodedCheckOut}
        and confirmation_code like 'uncoded:%'
    `;
    assert.equal(uncodedRows.length, 1);
    assert.deepEqual({ ...uncodedRows[0] }, {
      id: uncodedReservationId,
      booking_status: "confirmed",
      revision: 3,
    });

    const lockRunId = randomUUID();
    await recordJobStart(stock.sql, {
      householdId,
      service: "stock",
      jobName: "integration-lock",
      runId: lockRunId,
      targetDate: "2026-08-21",
      startedAt: "2026-08-21T20:00:00.000Z",
    });
    await assert.rejects(recordJobStart(stock.sql, {
      householdId,
      service: "stock",
      jobName: "integration-lock-overlap",
      runId: randomUUID(),
      targetDate: "2026-08-21",
      startedAt: "2026-08-21T20:01:00.000Z",
    }), { code: "RUN_IN_PROGRESS" });
    await recordJobFinish(stock.sql, {
      service: "stock",
      runId: lockRunId,
      status: "success",
      receipt: { integration: true },
      completedAt: "2026-08-21T20:02:00.000Z",
    });
    const crossServiceJobUpdate = await support.sql`
      update airbnb.job_runs
      set status = 'error'
      where run_id = ${lockRunId}
      returning id
    `;
    assert.equal(crossServiceJobUpdate.length, 0);
    const stockAlertKey = `integration-stock-alert-${randomUUID()}`;
    const stockAlerts = await stock.sql`
      insert into airbnb.alerts (
        household_id, alert_type, severity, status, dedupe_key, summary
      ) values (
        ${householdId}, 'stock_low', 'warning', 'suppressed',
        ${stockAlertKey}, 'Integration stock alert'
      )
      returning id
    `;
    assert.equal(stockAlerts.length, 1);
    const crossServiceAlertUpdate = await support.sql`
      update airbnb.alerts
      set summary = 'Cross-service rewrite'
      where id = ${stockAlerts[0].id}
      returning id
    `;
    assert.equal(crossServiceAlertUpdate.length, 0);
    await assert.rejects(support.sql`select id from airbnb.audit_events`, { code: "42501" });

    const shoppingForecast = {
      startDate: "2026-08-22",
      endDate: "2026-08-28",
      arrivals: [],
      demand: [],
    };
    const firstShoppingList = await storeShoppingList(stock.sql, {
      householdId,
      forecast: shoppingForecast,
      list: {
        estimatedTotalCents: 40_000,
        countsToConfirm: [],
        items: [{
          sku: "integration_chocolate",
          quantity: 4,
          estimatedUnitPriceCents: 10_000,
          reason: "Integration shortage",
          countToConfirm: false,
        }],
      },
    });
    const secondShoppingList = await storeShoppingList(stock.sql, {
      householdId,
      forecast: shoppingForecast,
      list: {
        estimatedTotalCents: 50_000,
        countsToConfirm: [],
        items: [{
          sku: "integration_chocolate",
          quantity: 5,
          estimatedUnitPriceCents: 10_000,
          reason: "Integration shortage changed",
          countToConfirm: false,
        }],
      },
    });
    let listStatuses = await admin`
      select id, status
      from airbnb.shopping_lists
      where household_id = ${householdId}
    `;
    assert.equal(listStatuses.filter((row) => row.status === "draft").length, 1);
    assert.equal(listStatuses.filter((row) => row.status === "superseded").length, 1);
    assert.equal(listStatuses.find((row) => row.status === "draft").id, secondShoppingList.id);
    let linkedAlertStates = await admin`
      select details->>'shoppingListId' as shopping_list_id, status
      from airbnb.alerts
      where household_id = ${householdId} and alert_type = 'stock_low'
    `;
    assert.equal(linkedAlertStates.find((row) => row.shopping_list_id === firstShoppingList.id).status, "resolved");
    assert.equal(linkedAlertStates.find((row) => row.shopping_list_id === secondShoppingList.id).status, "suppressed");

    const restoredShoppingList = await storeShoppingList(stock.sql, {
      householdId,
      forecast: shoppingForecast,
      list: {
        estimatedTotalCents: 40_000,
        countsToConfirm: [],
        items: [{
          sku: "integration_chocolate",
          quantity: 4,
          estimatedUnitPriceCents: 10_000,
          reason: "Integration shortage",
          countToConfirm: false,
        }],
      },
    });
    listStatuses = await admin`
      select id, status
      from airbnb.shopping_lists
      where household_id = ${householdId}
    `;
    assert.equal(restoredShoppingList.id, firstShoppingList.id);
    assert.equal(listStatuses.filter((row) => row.status === "draft").length, 1);
    assert.equal(listStatuses.find((row) => row.status === "draft").id, firstShoppingList.id);
    linkedAlertStates = await admin`
      select details->>'shoppingListId' as shopping_list_id, status
      from airbnb.alerts
      where household_id = ${householdId} and alert_type = 'stock_low'
    `;
    assert.equal(linkedAlertStates.find((row) => row.shopping_list_id === firstShoppingList.id).status, "suppressed");
    assert.equal(linkedAlertStates.find((row) => row.shopping_list_id === secondShoppingList.id).status, "resolved");
    const currentAlerts = await loadSuppressedStockAlerts(stock.sql, {
      householdId,
      now: new Date(),
      limit: 24,
    });
    assert.deepEqual(
      currentAlerts.filter((alert) => alert.alertType === "stock_low").map((alert) => alert.shoppingList.id),
      [firstShoppingList.id],
    );
    assert.equal(await storeShoppingList(stock.sql, {
      householdId,
      forecast: shoppingForecast,
      list: { estimatedTotalCents: 0, countsToConfirm: [], items: [] },
    }), null);
    assert.equal((await admin`
      select count(*)::integer as count
      from airbnb.shopping_lists
      where household_id = ${householdId} and status = 'draft'
    `)[0].count, 0);
    assert.equal((await loadSuppressedStockAlerts(stock.sql, {
      householdId,
      now: new Date(),
      limit: 24,
    })).some((alert) => alert.alertType === "stock_low"), false);

    const orderNumber = randomUUID();
    const invoiceMessage = {
      providerMessageId: `integration-invoice-${orderNumber}`,
      from: "no-reply@checkers.sixty60.co.za",
      subject: `Sixty60 invoice for order ${orderNumber}`,
      occurredAt: "2026-08-21T19:30:00.000Z",
    };
    const invoice = {
      kind: "invoice",
      providerOrderId: orderNumber,
      deliveryAddress: "1 Bowie Street, Nahoon",
      totalCents: 7_999,
      eta: null,
      delivered: "21 August 2026, 21:30",
      items: [{
        description: "Regal Assorted Chocolate Treats 400g",
        quantity: 1,
        unitPriceCents: 7_999,
        lineTotalCents: 7_999,
        inventorySku: "guest_chocolate",
        inventoryQuantityKnown: true,
        creditedQuantity: 1,
      }],
    };
    await ingestOrderEvidence(stock.sql, {
      householdId,
      message: invoiceMessage,
      parsed: invoice,
    });
    let invoiceCredits = await admin`
      select count(*) as count, coalesce(sum(movement.quantity_delta), 0) as quantity
      from airbnb.inventory_movements movement
      join airbnb.orders ordering
        on ordering.household_id = movement.household_id
       and ordering.id = movement.order_id
      where movement.household_id = ${householdId}
        and ordering.provider_order_id = ${orderNumber}
        and movement.source_type = 'invoice'
    `;
    assert.deepEqual({
      count: Number(invoiceCredits[0].count),
      quantity: Number(invoiceCredits[0].quantity),
    }, { count: 1, quantity: 1 });
    await ingestOrderEvidence(stock.sql, {
      householdId,
      message: invoiceMessage,
      parsed: {
        ...invoice,
        items: invoice.items.map((item) => ({
          ...item,
          inventoryQuantityKnown: false,
          creditedQuantity: 0,
        })),
      },
    });
    invoiceCredits = await admin`
      select count(*) as count, coalesce(sum(movement.quantity_delta), 0) as quantity
      from airbnb.inventory_movements movement
      join airbnb.orders ordering
        on ordering.household_id = movement.household_id
       and ordering.id = movement.order_id
      where movement.household_id = ${householdId}
        and ordering.provider_order_id = ${orderNumber}
        and movement.source_type = 'invoice'
    `;
    assert.deepEqual({
      count: Number(invoiceCredits[0].count),
      quantity: Number(invoiceCredits[0].quantity),
    }, { count: 2, quantity: 0 });
    for (const [creditedQuantity, expectedMovementCount] of [[1, 3], [2, 4], [1, 5], [1, 5]]) {
      await ingestOrderEvidence(stock.sql, {
        householdId,
        message: invoiceMessage,
        parsed: {
          ...invoice,
          items: invoice.items.map((item) => ({
            ...item,
            inventoryQuantityKnown: true,
            creditedQuantity,
          })),
        },
      });
      invoiceCredits = await admin`
        select count(*) as count, coalesce(sum(movement.quantity_delta), 0) as quantity
        from airbnb.inventory_movements movement
        join airbnb.orders ordering
          on ordering.household_id = movement.household_id
         and ordering.id = movement.order_id
        where movement.household_id = ${householdId}
          and ordering.provider_order_id = ${orderNumber}
          and movement.source_type = 'invoice'
      `;
      assert.deepEqual({
        count: Number(invoiceCredits[0].count),
        quantity: Number(invoiceCredits[0].quantity),
      }, { count: expectedMovementCount, quantity: creditedQuantity });
    }

    const evidenceId = randomUUID();
    const reservationId = randomUUID();
    const propertyId = visibleProperties[0].id;
    await admin`
      insert into airbnb.evidence (
        id, household_id, mailbox_scope, provider, provider_message_id,
        evidence_kind, occurred_at, content_hash
      ) values (
        ${evidenceId}, ${householdId}, 'tristan', 'gmail', ${`integration:${evidenceId}`},
        'confirmed', '2026-08-20T12:00:00Z', ${evidenceId}
      )
    `;
    await admin`
      insert into airbnb.reservations (
        id, household_id, property_id, confirmation_code, guest_name,
        check_in, check_out, adults, children, infants, guest_count_known,
        booking_status, authoritative_evidence_id, revision, source_cutoff_at
      ) values (
        ${reservationId}, ${householdId}, ${propertyId}, ${`INTEGRATION-${reservationId}`},
        'Integration Guest', '2026-08-21', '2026-08-22', 1, 1, 1, true,
        'confirmed', ${evidenceId}, 1, '2026-08-20T12:00:00Z'
      )
    `;

    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-21",
    }), { applied: 1, reversed: 0 });
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-21",
    }), { applied: 0, reversed: 0 });
    await admin`
      update airbnb.reservations
      set booking_status = 'cancelled', revision = 2
      where id = ${reservationId}
    `;
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-21",
    }), { applied: 0, reversed: 1 });
    await admin`
      update airbnb.reservations
      set booking_status = 'confirmed', revision = 3
      where id = ${reservationId}
    `;
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-21",
    }), { applied: 1, reversed: 0 });
    const totals = await admin`
      select sum(quantity_delta) as quantity
      from airbnb.inventory_movements
      where household_id = ${householdId}
        and inventory_item_id = ${inventoryItemId}
        and source_id = ${reservationId}
    `;
    assert.equal(Number(totals[0].quantity), -2);
    await admin`
      update airbnb.reservations
      set check_in = '2026-08-25', check_out = '2026-08-26', revision = 4
      where id = ${reservationId}
    `;
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-21",
    }), { applied: 0, reversed: 1 });
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-21",
    }), { applied: 0, reversed: 0 });
    const movedTotals = await admin`
      select sum(quantity_delta) as quantity
      from airbnb.inventory_movements
      where household_id = ${householdId}
        and inventory_item_id = ${inventoryItemId}
        and source_id = ${reservationId}
    `;
    assert.equal(Number(movedTotals[0].quantity), 0);
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-25",
    }), { applied: 1, reversed: 0 });
    assert.deepEqual(await reconcileReservationConsumption(stock.sql, {
      householdId,
      throughDate: "2026-08-25",
    }), { applied: 0, reversed: 0 });
    const arrivedTotals = await admin`
      select sum(quantity_delta) as quantity
      from airbnb.inventory_movements
      where household_id = ${householdId}
        and inventory_item_id = ${inventoryItemId}
        and source_id = ${reservationId}
    `;
    assert.equal(Number(arrivedTotals[0].quantity), -2);
  } finally {
    await Promise.all(databases.map((database) => database.close()));
    if (fixtureLockHeld) {
      await admin`select pg_advisory_unlock(hashtext('airbnb-runtime-integration-fixtures'))`.catch(() => {});
    }
    await admin.end({ timeout: 5 });
  }
});
