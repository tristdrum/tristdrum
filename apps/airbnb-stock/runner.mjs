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
import { notifyStockManagement } from "./management.mjs";
import {
  ingestOrderEvidence,
  latestStockRun,
  loadForecastInputs,
  loadKnownSixty60MessageIds,
  reconcileReservationConsumption,
  storeShoppingList,
  storeStockCountReview,
} from "./repository.mjs";
import { assertStockModeAllowed } from "./runtime.mjs";

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

export function stockPlanningWindow(runDate) {
  return {
    consumptionThroughDate: runDate,
    forecastStartDate: addDays(runDate, 1),
    forecastEndDate: addDays(runDate, 7),
  };
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
  notifyManagement = notifyStockManagement,
  database = null,
  env = process.env,
  fullReview = false,
  mode = "observation",
} = {}) {
  const capabilities = assertStockModeAllowed(mode, env);
  const runId = randomUUID();
  const startedAt = now();
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  const householdId = await ownDatabase.householdId();
  let started = false;
  try {
    await recordJobStart(ownDatabase.sql, {
      householdId,
      service: "stock",
      jobName: mode === "live"
        ? "management-alerts"
        : fullReview ? "weekly-review" : "observation",
      runId,
      startedAt,
      targetDate: localDate(startedAt),
    });
    started = true;
    const lookbackDays = Number.parseInt(env.AIRBNB_STOCK_LOOKBACK_DAYS ?? "120", 10);
    const since = lookbackDate(startedAt, lookbackDays);
    const knownProviderMessageIds = await loadKnownSixty60MessageIds(ownDatabase.sql, {
      householdId,
      since,
    });
    const collected = await collectMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_STOCK_MAX_EMAILS ?? "400", 10),
      knownProviderMessageIds,
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
    const planningWindow = stockPlanningWindow(startDate);
    const consumption = await reconcileReservationConsumption(ownDatabase.sql, {
      householdId,
      throughDate: planningWindow.consumptionThroughDate,
    });
    const inputs = await loadForecastInputs(ownDatabase.sql, {
      householdId,
      startDate: planningWindow.forecastStartDate,
      endDate: planningWindow.forecastEndDate,
    });
    const forecast = forecastInventoryDemand({
      reservations: inputs.reservations,
      startDate: planningWindow.forecastStartDate,
    });
    const projections = projectInventory({ inventoryItems: inputs.inventory, forecast });
    const list = buildShoppingList({ projections });
    const storedList = await storeShoppingList(ownDatabase.sql, { householdId, forecast, list });
    const countReview = fullReview
      ? await storeStockCountReview(ownDatabase.sql, {
        householdId,
        projections,
        runDate: startDate,
      })
      : null;
    const managementAlerts = mode === "live"
      ? await notifyManagement({ sql: ownDatabase.sql, householdId, now, env })
      : [];
    const receipt = {
      schemaVersion: 1,
      runId,
      status: "success",
      mode,
      fullReview,
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      planningWindow,
      emailsFound: collected.envelopesFound,
      emailsSkippedKnown: collected.envelopesSkippedKnown ?? 0,
      evidenceProcessed: evidenceResults.length,
      invoiceCount: evidenceResults.filter((result) => result.kind === "invoice").length,
      creditedInvoiceCount: evidenceResults.filter((result) => result.inventoryCredited).length,
      ignoredInvoiceCount: evidenceResults.filter((result) => result.ignored).length,
      unquantifiedItemCount: evidenceResults.reduce(
        (total, result) => total + result.unquantifiedItemCount,
        0,
      ),
      consumptionMovementCount: consumption.applied,
      reversedConsumptionCount: consumption.reversed,
      reservationCount: inputs.reservations.length,
      inventoryItemCount: inputs.inventory.length,
      urgentItemCount: projections.filter((item) => item.urgent).length,
      countToConfirmCount: projections.filter((item) => item.countToConfirm).length,
      shoppingListItemCount: list.items.length,
      estimatedTotalCents: list.estimatedTotalCents,
      meetsFreeDeliveryMinimum: list.meetsFreeDeliveryMinimum,
      shoppingListId: storedList?.id ?? null,
      stockCountReviewId: countReview?.id ?? null,
      externalWritesEnabled: mode === "live" && capabilities.managementAlertsEnabled,
      managementAlertsEnabled: mode === "live" && capabilities.managementAlertsEnabled,
      managementAlertCount: managementAlerts.length,
      verifiedManagementAlertCount: managementAlerts.filter((alert) => alert.verified).length,
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
        receipt: {
          schemaVersion: 1,
          runId,
          status: "error",
          mode,
          externalWritesEnabled: mode === "live" && capabilities.managementAlertsEnabled,
          managementAlertsEnabled: mode === "live" && capabilities.managementAlertsEnabled,
          orderPlacementAllowed: false,
          error: failure,
        },
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
