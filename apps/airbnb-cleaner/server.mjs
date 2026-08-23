#!/usr/bin/env node

import { timingSafeEqual, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadCleanerLedgerRecords, syncCleanerDatabase } from "./database.mjs";
import { formatISODate, parseISODate, resolveTargetDate, runReport, sendFinalFailureAlert } from "./report.mjs";
import {
  acquireRunLock,
  loadStatus,
  persistRun,
  sanitizeFailure,
  sanitizeRunResult,
} from "./storage.mjs";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const MAX_BODY_BYTES = 32 * 1024;

function schedulerSecret() {
  const value = String(process.env.AIRBNB_CLEANER_SCHEDULER_SECRET ?? "");
  if (!value) throw new Error("AIRBNB_CLEANER_SCHEDULER_SECRET is not configured.");
  return value;
}

export function authorized(request, expected = schedulerSecret()) {
  const supplied = String(request.headers["x-airbnb-cleaner-scheduler-secret"] ?? "");
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requestTargetDate(target, now) {
  if (target === "today" || target === "tomorrow") {
    return formatISODate(resolveTargetDate({ target, now }));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(target ?? ""))) return target;
  throw new Error("target must be today, tomorrow, or YYYY-MM-DD.");
}

function hasSuccessfulReceiptInWindow(targetDate, target) {
  if (target !== "today" && target !== "tomorrow") return false;
  const status = loadStatus(targetDate);
  const successfulReceipt = [status, status?.previousSuccess]
    .find((receipt) => receipt?.status === "sent" || receipt?.status === "duplicate_skipped");
  if (!successfulReceipt?.startedAt) return false;

  const windowStartedAt = parseISODate(targetDate);
  if (target === "tomorrow") windowStartedAt.setDate(windowStartedAt.getDate() - 1);
  windowStartedAt.setHours(target === "today" ? 12 : 13, target === "today" ? 0 : 30, 0, 0);
  return Date.parse(successfulReceipt.startedAt) >= windowStartedAt.getTime();
}

function publicReceipt(receipt, result = null) {
  if (result?.mode !== "preview") return receipt;
  return {
    ...receipt,
    preview: {
      message: result.message,
      unitReports: result.unitReports,
    },
  };
}

function statusCodeForReceipt(receipt) {
  if (receipt?.databaseSync?.status === "error" && receipt?.failureAlert?.sent !== true) return 503;
  return 200;
}

async function handleRun(request, response, dependencies) {
  const body = await readJson(request);
  const mode = body.mode ?? "live";
  if (!["preview", "dry-run", "live"].includes(mode)) throw new Error("mode must be preview, dry-run, or live.");
  const target = body.target ?? "tomorrow";
  const finalAttempt = body.finalAttempt === true;
  const runId = randomUUID();
  const startedAtDate = dependencies.now();
  const startedAt = startedAtDate.toISOString();
  const targetDate = requestTargetDate(target, startedAtDate);
  let release = () => {};
  try {
    release = acquireRunLock();
    const databaseLedger = await dependencies.loadDatabaseLedger({ targetDate });
    if (mode === "live" && dependencies.sharedLedgerRequired && databaseLedger.status !== "loaded") {
      throw new Error("The required Supabase cleaner ledger is not configured.");
    }
    const result = await dependencies.runReport({
      mode,
      targetDate,
      deliveryAttemptId: runId,
      authoritativeLedgerRecords: databaseLedger.status === "loaded" ? databaseLedger.records : null,
    });
    const completedAt = dependencies.now().toISOString();
    const receipt = sanitizeRunResult(result, { runId, startedAt, completedAt, finalAttempt });
    try {
      const databaseSync = await dependencies.syncDatabase({ result, receipt });
      if (databaseSync?.status !== "disabled") receipt.databaseSync = databaseSync;
    } catch (databaseError) {
      receipt.databaseSync = {
        status: "error",
        code: databaseError.code ?? null,
        message: String(databaseError.message ?? "Database synchronization failed.").slice(0, 200),
      };
    }
    if (
      finalAttempt
      && receipt.databaseSync?.status === "error"
      && ["sent", "duplicate_skipped"].includes(result.status)
    ) {
      try {
        receipt.failureAlert = await dependencies.sendFinalFailureAlert({
          targetDate: result.targetDate,
          runId,
          reason: "database_sync",
        });
      } catch (alertError) {
        receipt.failureAlert = { sent: false, error: String(alertError.message).slice(0, 200) };
      }
    }
    persistRun(receipt);
    if (result.status === "blocked") {
      if (finalAttempt) {
        try {
          receipt.failureAlert = await dependencies.sendFinalFailureAlert({ targetDate: result.targetDate, runId });
        } catch (alertError) {
          receipt.failureAlert = { sent: false, error: String(alertError.message).slice(0, 200) };
        }
        persistRun(receipt);
      }
      json(response, 422, publicReceipt(receipt));
      return;
    }
    json(response, 200, publicReceipt(receipt, result));
  } catch (error) {
    const completedAt = dependencies.now().toISOString();
    const receipt = sanitizeFailure(error, { runId, targetDate, mode, finalAttempt, startedAt, completedAt });
    if (finalAttempt && !hasSuccessfulReceiptInWindow(targetDate, target)) {
      try {
        receipt.failureAlert = await dependencies.sendFinalFailureAlert({ targetDate, runId });
      } catch (alertError) {
        receipt.failureAlert = { sent: false, error: String(alertError.message).slice(0, 200) };
      }
    }
    persistRun(receipt);
    const status = error.code === "RUN_IN_PROGRESS" ? 409 : 500;
    json(response, status, publicReceipt(receipt));
  } finally {
    release();
  }
}

export function createAirbnbCleanerServer(dependencies = {}) {
  const resolved = {
    runReport: dependencies.runReport ?? runReport,
    sendFinalFailureAlert: dependencies.sendFinalFailureAlert ?? sendFinalFailureAlert,
    syncDatabase: dependencies.syncDatabase ?? syncCleanerDatabase,
    loadDatabaseLedger: dependencies.loadDatabaseLedger ?? loadCleanerLedgerRecords,
    sharedLedgerRequired: dependencies.sharedLedgerRequired
      ?? process.env.AIRBNB_CLEANER_SHARED_LEDGER_REQUIRED === "true",
    now: dependencies.now ?? (() => new Date()),
  };
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, { ok: true, service: "airbnb-cleaner" });
        return;
      }
      if (!authorized(request)) {
        json(response, 401, { error: "unauthorized" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/run") {
        await handleRun(request, response, resolved);
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        const date = url.searchParams.get("date");
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          json(response, 400, { error: "invalid_date" });
          return;
        }
        const receipt = loadStatus(date);
        json(response, receipt ? statusCodeForReceipt(receipt) : 404, receipt ?? { error: "not_found" });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      json(response, error.code === "BODY_TOO_LARGE" ? 413 : 400, { error: "invalid_request" });
    }
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const server = createAirbnbCleanerServer();
  server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ event: "listening", service: "airbnb-cleaner", port: PORT }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
