import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.env.AIRBNB_CLEANER_HOME ?? "/data");
const RUNS_DIR = resolve(DATA_DIR, "runs");
const STATUS_DIR = resolve(DATA_DIR, "status");
const LOCK_DIR = resolve(DATA_DIR, "run.lock");
const LAST_FAILURE_PATH = resolve(DATA_DIR, "last-failure.json");

function writeJsonAtomic(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function providerSummary(value) {
  if (!value) return null;
  return {
    status: value.status ?? null,
    dryRun: value.dryRun ?? null,
    attempts: value.attempts ?? null,
    mutatesWhatsappState: value.mutatesWhatsappState ?? null,
  };
}

export function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|cookie|credentials?)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&,;}]+)/gi, "$1=[redacted]")
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s'\",]+/gi, "$1[redacted]")
    .slice(0, 500);
}

function isSuccessfulReceipt(receipt) {
  return receipt?.status === "sent" || receipt?.status === "duplicate_skipped";
}

function previousSuccessfulReceipt(path) {
  if (!existsSync(path)) return null;
  const existing = JSON.parse(readFileSync(path, "utf8"));
  const candidate = isSuccessfulReceipt(existing) ? existing : existing.previousSuccess;
  if (!isSuccessfulReceipt(candidate)) return null;
  const { previousSuccess: _nestedPreviousSuccess, ...receipt } = candidate;
  return receipt;
}

export function sanitizeRunResult(result, { runId, startedAt, completedAt, finalAttempt }) {
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt,
    finalAttempt,
    status: result.status,
    mode: result.mode,
    targetDate: result.targetDate,
    targetDay: result.targetDay,
    units: result.unitReports?.map((unit) => ({
      unit: unit.unit,
      action: unit.action,
      arrivalCount: unit.arrivals?.length ?? 0,
      checkoutCount: unit.checkouts?.length ?? 0,
      stayoverCount: unit.stayovers?.length ?? 0,
    })) ?? [],
    reservationsParsed: result.reservationsParsed,
    envelopesFound: result.envelopesFound,
    envelopesRead: result.envelopesRead,
    searchAfterDate: result.searchAfterDate,
    weather: result.weather,
    confidence: result.confidence,
    messageHash: result.messageHash,
    legacyMessageHash: result.legacyMessageHash,
    contentOccurrence: result.contentOccurrence,
    isUpdate: result.isUpdate,
    duplicateSource: result.duplicateSource ?? null,
    ledger: result.ledger ?? null,
    chatRead: result.chatRead,
    whatsappDryRun: providerSummary(result.whatsappDryRun),
    whatsappLiveSend: providerSummary(result.whatsappLiveSend),
    whatsappVerification: result.whatsappVerification ?? null,
  };
}

export function sanitizeFailure(error, { runId, targetDate, mode, finalAttempt, startedAt, completedAt }) {
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt,
    finalAttempt,
    status: "error",
    mode,
    targetDate,
    error: {
      name: redactSensitiveText(error?.name ?? "Error").slice(0, 100),
      code: error?.code == null ? null : redactSensitiveText(error.code).slice(0, 100),
      message: redactSensitiveText(error?.message ?? "Unknown failure"),
    },
  };
}

export function persistRun(receipt) {
  mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  writeJsonAtomic(resolve(RUNS_DIR, `${receipt.runId}.json`), receipt);
  writeJsonAtomic(resolve(DATA_DIR, "last-run.json"), receipt);
  if (receipt.targetDate) {
    const statusPath = resolve(STATUS_DIR, `${receipt.targetDate}.json`);
    const previousSuccess = isSuccessfulReceipt(receipt) ? null : previousSuccessfulReceipt(statusPath);
    writeJsonAtomic(statusPath, previousSuccess ? { ...receipt, previousSuccess } : receipt);
  }
  if (receipt.status === "error" || receipt.status === "blocked") {
    writeJsonAtomic(LAST_FAILURE_PATH, receipt);
  } else if (existsSync(LAST_FAILURE_PATH)) {
    unlinkSync(LAST_FAILURE_PATH);
  }
}

export function loadStatus(targetDate = null) {
  const path = targetDate ? resolve(STATUS_DIR, `${targetDate}.json`) : resolve(DATA_DIR, "last-run.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function acquireRunLock({ staleAfterMs = 20 * 60 * 1000 } = {}) {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    mkdirSync(LOCK_DIR, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const ageMs = Date.now() - statSync(LOCK_DIR).mtimeMs;
    if (ageMs <= staleAfterMs) {
      const busy = new Error("Another Airbnb cleaner report is already running.");
      busy.code = "RUN_IN_PROGRESS";
      throw busy;
    }
    rmSync(LOCK_DIR, { recursive: true, force: true });
    mkdirSync(LOCK_DIR, { mode: 0o700 });
  }
  writeFileSync(resolve(LOCK_DIR, "owner.json"), `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(LOCK_DIR, { recursive: true, force: true });
  };
}

export const storagePaths = {
  dataDir: DATA_DIR,
  runsDir: RUNS_DIR,
  statusDir: STATUS_DIR,
  lockDir: LOCK_DIR,
  lastFailurePath: LAST_FAILURE_PATH,
};
