const LIMIT_USD = 10;
const WORST_CASE_COMPUTE_RESERVE_USD = 7.5;
const VOLUME_ROOTFS_SNAPSHOT_RESERVE_USD = 1;
const MACHINE_USD_PER_HOUR = 0.01;
const EGRESS_RESERVE_USD = 0.5;
const UNMETERED_HEADROOM_USD = 0.25;
const MODEL_CAP_USD = 0.7;
const MAX_TRANSFER_BYTES = 2 * 1024 ** 3;
const EGRESS_USD_PER_GB = 0.25;

export function monthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}`;
}

export function currentBudget(stored = {}, now = new Date()) {
  if (stored.month !== monthKey(now)) return { month: monthKey(now), transferredBytes: 0, modelUsd: 0, startedSeconds: 0 };
  return { month: stored.month, transferredBytes: stored.transferredBytes ?? 0,
    modelUsd: stored.modelUsd ?? 0, startedSeconds: stored.startedSeconds ?? 0 };
}

export function budgetStatus(stored, now = new Date()) {
  const budget = currentBudget(stored, now);
  const runtimeUsd = budget.startedSeconds / 3600 * MACHINE_USD_PER_HOUR;
  const transferUsd = budget.transferredBytes / 1024 ** 3 * EGRESS_USD_PER_GB;
  const estimatedUsd = VOLUME_ROOTFS_SNAPSHOT_RESERVE_USD + runtimeUsd + transferUsd + budget.modelUsd;
  const worstCaseCommittedUsd = WORST_CASE_COMPUTE_RESERVE_USD + VOLUME_ROOTFS_SNAPSHOT_RESERVE_USD +
    EGRESS_RESERVE_USD + UNMETERED_HEADROOM_USD + budget.modelUsd;
  return {
    month: budget.month,
    limitUsd: LIMIT_USD,
    worstCaseComputeReserveUsd: WORST_CASE_COMPUTE_RESERVE_USD,
    reservedVolumeRootfsSnapshotsUsd: VOLUME_ROOTFS_SNAPSHOT_RESERVE_USD,
    reservedEgressUsd: EGRESS_RESERVE_USD,
    runtimeRateUsdPerHour: MACHINE_USD_PER_HOUR,
    runtimeUsd: Number(runtimeUsd.toFixed(4)),
    transferUsd: Number(transferUsd.toFixed(4)),
    unmeteredHeadroomUsd: UNMETERED_HEADROOM_USD,
    estimatedUsd: Number(estimatedUsd.toFixed(4)),
    worstCaseCommittedUsd: Number(worstCaseCommittedUsd.toFixed(4)),
    modelCapacityUsd: MODEL_CAP_USD,
    modelRemainingUsd: Number(Math.max(0, MODEL_CAP_USD - budget.modelUsd).toFixed(4)),
    startedSeconds: budget.startedSeconds,
    transferredBytes: budget.transferredBytes,
    modelUsd: budget.modelUsd,
    exhausted: worstCaseCommittedUsd >= LIMIT_USD || estimatedUsd + UNMETERED_HEADROOM_USD >= LIMIT_USD ||
      budget.transferredBytes >= MAX_TRANSFER_BYTES,
  };
}

export function addRuntime(stored, seconds, now = new Date()) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid runtime duration");
  const budget = currentBudget(stored, now);
  budget.startedSeconds += seconds;
  return budget;
}

export function addTransfer(stored, bytes, now = new Date()) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid transfer count");
  const budget = currentBudget(stored, now);
  budget.transferredBytes += bytes;
  return budget;
}

// The read-only pilot never calls a model. Future event-driven calls must use this gate.
export function reserveEventModelCost(stored, usd, now = new Date()) {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("Invalid model cost");
  const budget = currentBudget(stored, now);
  budget.modelUsd += usd;
  if (budget.modelUsd > MODEL_CAP_USD || budgetStatus(budget, now).exhausted) {
    throw new Error("Monthly pilot budget exhausted");
  }
  return budget;
}
