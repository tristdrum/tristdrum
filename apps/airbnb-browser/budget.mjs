const LIMIT_USD = 10;
const RESERVED_INFRA_USD = 8.5;
const MAX_TRANSFER_BYTES = 2 * 1024 ** 3;
const EGRESS_USD_PER_GB = 0.25;

export function monthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}`;
}

export function currentBudget(stored = {}, now = new Date()) {
  if (stored.month !== monthKey(now)) return { month: monthKey(now), transferredBytes: 0, modelUsd: 0 };
  return { month: stored.month, transferredBytes: stored.transferredBytes ?? 0, modelUsd: stored.modelUsd ?? 0 };
}

export function budgetStatus(stored, now = new Date()) {
  const budget = currentBudget(stored, now);
  const estimatedUsd = RESERVED_INFRA_USD + budget.modelUsd + budget.transferredBytes / 1024 ** 3 * EGRESS_USD_PER_GB;
  return {
    month: budget.month,
    limitUsd: LIMIT_USD,
    reservedInfraUsd: RESERVED_INFRA_USD,
    estimatedUsd: Number(estimatedUsd.toFixed(4)),
    transferredBytes: budget.transferredBytes,
    modelUsd: budget.modelUsd,
    exhausted: estimatedUsd >= LIMIT_USD || budget.transferredBytes >= MAX_TRANSFER_BYTES,
  };
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
  if (budgetStatus(budget, now).exhausted) throw new Error("Monthly pilot budget exhausted");
  return budget;
}
