import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  createAirbnbDatabase,
  recordJobFinish,
  recordJobStart,
} from "@tristdrum/airbnb-db";
import { syncCleanerDatabase } from "../airbnb-cleaner/database.mjs";
import { reconcileReservationConsumption } from "./repository.mjs";

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
  try {
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
    await admin.end({ timeout: 5 });
  }
});
