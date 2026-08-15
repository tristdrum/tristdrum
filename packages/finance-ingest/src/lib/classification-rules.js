import { readFile } from "node:fs/promises";

export const FINANCE_HEURISTICS = Object.freeze([
  {
    id: "funding-account-purpose-crosscheck",
    version: 1,
    principle: "Use the account's household role as corroborating evidence for purpose, never as tax truth.",
    safeAutomaticOutcome: "suggestion_only",
    reviewWhen: ["property account plus private-looking purpose", "personal account plus property-looking purpose", "mixed or unknown purpose"],
  },
  {
    id: "mixed-merchant-line-item-review",
    version: 1,
    principle: "Sixty60, Checkers, Amazon and other mixed-use merchants are classified at line level.",
    safeAutomaticOutcome: "none",
    reviewWhen: ["order contains more than one purpose", "refund, wallet or split payment exists", "parser combines products"],
  },
  {
    id: "household-transfer-pairing",
    version: 1,
    principle: "Transfers between household accounts are paired before they can be income, expenses, contributions or reimbursements.",
    safeAutomaticOutcome: "transfer_candidate",
    reviewWhen: ["counter-account is missing", "amount or date does not pair uniquely"],
  },
  {
    id: "cash-wage-evidence",
    version: 1,
    principle: "An ATM withdrawal is cash movement until linked to a worker, work date or pay period and payment evidence.",
    safeAutomaticOutcome: "cash_movement",
    reviewWhen: ["worker or pay period is missing", "a payroll settlement may already count the wage"],
  },
  {
    id: "reimbursement-underlying-purchase",
    version: 1,
    principle: "A reimbursement proves settlement; the underlying invoice or receipt proves what was purchased.",
    safeAutomaticOutcome: "settlement_evidence",
    reviewWhen: ["underlying purchase evidence is missing", "buyer, property unit or private share is unclear"],
  },
  {
    id: "worker-transport-context",
    version: 1,
    principle: "Transport is a worker cost only when the worker, qualifying work date and property purpose are linked.",
    safeAutomaticOutcome: "suggestion_only",
    reviewWhen: ["rider or work date is missing", "merchant descriptor differs from the confirmed pattern"],
  },
  {
    id: "refund-cancellation-pairing",
    version: 1,
    principle: "Cancelled or refunded purchases contribute only their evidenced net cost after the payment and refund are paired.",
    safeAutomaticOutcome: "net_cost_candidate",
    reviewWhen: ["refund destination is missing", "payment and refund differ", "reimbursement cash remains"],
  },
  {
    id: "evidence-role-and-deduplication",
    version: 1,
    principle: "Invoices establish purchases; proofs establish settlement; duplicates and document bundles can create at most one cost event.",
    safeAutomaticOutcome: "counting_guardrail",
    reviewWhen: ["invoice, receipt, proof and bank row may describe one event", "normalized duplicates exist"],
  },
]);

const ACCOUNT_ROLES = new Set(["property_operating", "personal", "shared", "unknown"]);
const PURPOSE_SIGNALS = new Set(["property", "private", "mixed", "unknown"]);

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label} must be one of: ${[...allowed].join(", ")}`);
  }
}

export function evaluateFundingAccountPurpose({ accountRole = "unknown", purposeSignal = "unknown" }) {
  assertEnum(accountRole, ACCOUNT_ROLES, "accountRole");
  assertEnum(purposeSignal, PURPOSE_SIGNALS, "purposeSignal");

  const base = {
    heuristicId: "funding-account-purpose-crosscheck",
    accountRole,
    purposeSignal,
    taxTreatment: null,
    autoConfirm: false,
  };

  if (accountRole === "property_operating" && purposeSignal === "property") {
    return {
      ...base,
      disposition: "suggest_property",
      suggestedPurpose: "property",
      confidence: "high",
      requiresReview: false,
      reason: "The property-operating account and the independently observed property purpose agree.",
    };
  }
  if (accountRole === "personal" && purposeSignal === "private") {
    return {
      ...base,
      disposition: "suggest_private",
      suggestedPurpose: "private",
      confidence: "high",
      requiresReview: false,
      reason: "The personal account and the independently observed private purpose agree.",
    };
  }
  if (
    (accountRole === "property_operating" && purposeSignal === "private") ||
    (accountRole === "personal" && purposeSignal === "property")
  ) {
    return {
      ...base,
      disposition: "review_crossed_signal",
      suggestedPurpose: null,
      confidence: "none",
      requiresReview: true,
      reason: "Funding source and observed purpose disagree, so line-item evidence or a household answer is required.",
    };
  }
  return {
    ...base,
    disposition: "review_insufficient_signal",
    suggestedPurpose: null,
    confidence: "none",
    requiresReview: true,
    reason: "The account role or purpose is mixed/unknown; the funding source cannot resolve purpose safely.",
  };
}

export function validateHouseholdHeuristicConfig(config) {
  if (!config || config.schemaVersion !== "finance-household-heuristics/v1") {
    throw new Error("Household heuristic config must use finance-household-heuristics/v1");
  }
  if (!Array.isArray(config.accountRoles) || !Array.isArray(config.narrowRules)) {
    throw new Error("Household heuristic config requires accountRoles and narrowRules arrays");
  }
  for (const account of config.accountRoles) {
    if (!account.id || !account.role) throw new Error("Every account role requires id and role");
    assertEnum(account.role, ACCOUNT_ROLES, `accountRoles.${account.id}.role`);
  }
  return config;
}

export async function loadHouseholdHeuristicConfig(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  return validateHouseholdHeuristicConfig(parsed);
}
