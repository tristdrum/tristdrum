import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  buildShoppingList,
  forecastInventoryDemand,
  parseSixty60Message,
  projectInventory,
} from "@tristdrum/airbnb-core";
import {
  createAirbnbDatabase,
  recordJobFinish,
  recordJobStart,
  sanitizedError,
} from "@tristdrum/airbnb-db";
import { collectSixty60Messages } from "./gmail.mjs";
import {
  ingestOrderEvidence,
  latestStockRun,
  loadForecastInputs,
  storeShoppingList,
} from "./repository.mjs";

const ZONE = "Africa/Johannesburg";

function localDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addDays(isoDate, days) {
  const value = new Date(`${isoDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function deliveryDueAt(occurredAt, eta) {
  if (!occurredAt || !eta) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(eta.replace(/\s+/g, ""));
  if (!match) return null;
  let hour = Number.parseInt(match[1], 10) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${localDate(new Date(occurredAt))}T${String(hour).padStart(2, "0")}:${match[2]}:00+02:00`;
}

function lookbackDate(now, days) {
  return new Date(now.getTime() - days * 86_400_000);
}

export async function runStockObservation({
  now = () => new Date(),
  collectMessages = collectSixty60Messages,
  database = null,
  env = process.env,
  fullReview = false,
} = {}) {
  const runId = randomUUID();
  const startedAt = now();
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  const householdId = await ownDatabase.householdId();
  let started = false;
  try {
    await recordJobStart(ownDatabase.sql, {
      householdId,
      service: "stock",
      jobName: fullReview ? "weekly-review" : "observation",
      runId,
      startedAt,
      targetDate: localDate(startedAt),
    });
    started = true;
    const lookbackDays = Number.parseInt(env.AIRBNB_STOCK_LOOKBACK_DAYS ?? "120", 10);
    const collected = await collectMessages({
      since: lookbackDate(startedAt, lookbackDays),
      maxRead: Number.parseInt(env.AIRBNB_STOCK_MAX_EMAILS ?? "400", 10),
      env,
    });
    const evidenceResults = [];
    for (const message of collected.messages) {
      const parsed = parseSixty60Message(message);
      if (!parsed) continue;
      evidenceResults.push(await ingestOrderEvidence(ownDatabase.sql, {
        householdId,
        message,
        parsed,
        deliveryDueAt: deliveryDueAt(message.occurredAt, parsed.eta),
      }));
    }

    const startDate = localDate(startedAt);
    const endDate = addDays(startDate, 6);
    const inputs = await loadForecastInputs(ownDatabase.sql, { householdId, startDate, endDate });
    const forecast = forecastInventoryDemand({ reservations: inputs.reservations, startDate });
    const projections = projectInventory({ inventoryItems: inputs.inventory, forecast });
    const list = buildShoppingList({ projections });
    const storedList = await storeShoppingList(ownDatabase.sql, { householdId, forecast, list });
    const receipt = {
      schemaVersion: 1,
      runId,
      status: "success",
      mode: "observation",
      fullReview,
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      emailsFound: collected.envelopesFound,
      evidenceProcessed: evidenceResults.length,
      invoiceCount: evidenceResults.filter((result) => result.kind === "invoice").length,
      creditedInvoiceCount: evidenceResults.filter((result) => result.inventoryCredited).length,
      ignoredInvoiceCount: evidenceResults.filter((result) => result.ignored).length,
      reservationCount: inputs.reservations.length,
      inventoryItemCount: inputs.inventory.length,
      urgentItemCount: projections.filter((item) => item.urgent).length,
      countToConfirmCount: projections.filter((item) => item.countToConfirm).length,
      shoppingListItemCount: list.items.length,
      estimatedTotalCents: list.estimatedTotalCents,
      meetsFreeDeliveryMinimum: list.meetsFreeDeliveryMinimum,
      shoppingListId: storedList?.id ?? null,
      externalWritesEnabled: false,
      orderPlacementAllowed: false,
    };
    await recordJobFinish(ownDatabase.sql, {
      service: "stock",
      runId,
      status: "success",
      receipt,
      completedAt: receipt.completedAt,
    });
    return receipt;
  } catch (error) {
    const failure = sanitizedError(error);
    if (started) {
      await recordJobFinish(ownDatabase.sql, {
        service: "stock",
        runId,
        status: "error",
        receipt: { schemaVersion: 1, runId, status: "error", error: failure },
        errorCode: failure.code,
        errorMessage: failure.message,
        completedAt: now().toISOString(),
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (!database) await ownDatabase.close();
  }
}

export async function loadStockStatus({ database = null, env = process.env } = {}) {
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  try {
    return await latestStockRun(ownDatabase.sql, await ownDatabase.householdId());
  } finally {
    if (!database) await ownDatabase.close();
  }
}
