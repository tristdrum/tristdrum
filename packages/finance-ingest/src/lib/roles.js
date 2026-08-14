const ROLE_POLICIES = {
  quote: {
    financialFactRole: "commercial_context",
    countingPolicy: "do_not_count_as_cost",
    purchaseEvidenceCandidate: false,
  },
  order_confirmation: {
    financialFactRole: "commercial_context",
    countingPolicy: "do_not_count_as_cost",
    purchaseEvidenceCandidate: false,
  },
  proof_of_payment: {
    financialFactRole: "settlement_evidence",
    countingPolicy: "do_not_count_as_cost",
    purchaseEvidenceCandidate: false,
  },
  reimbursement_evidence: {
    financialFactRole: "settlement_evidence",
    countingPolicy: "do_not_count_as_cost",
    purchaseEvidenceCandidate: false,
  },
  statement: {
    financialFactRole: "account_statement",
    countingPolicy: "statement_lines_require_reconciliation",
    purchaseEvidenceCandidate: false,
  },
  invoice: {
    financialFactRole: "purchase_evidence",
    countingPolicy: "candidate_cost_only_after_reconciliation",
    purchaseEvidenceCandidate: true,
  },
  receipt: {
    financialFactRole: "purchase_evidence",
    countingPolicy: "candidate_cost_only_after_reconciliation",
    purchaseEvidenceCandidate: true,
  },
  lease_or_contract: {
    financialFactRole: "contractual_context",
    countingPolicy: "do_not_count_directly",
    purchaseEvidenceCandidate: false,
  },
  payslip_or_payroll: {
    financialFactRole: "payroll_evidence",
    countingPolicy: "requires_payroll_reconciliation",
    purchaseEvidenceCandidate: false,
  },
  historical_register: {
    financialFactRole: "historical_classification",
    countingPolicy: "do_not_count_directly",
    purchaseEvidenceCandidate: false,
  },
  historical_workbook: {
    financialFactRole: "historical_classification",
    countingPolicy: "do_not_count_directly",
    purchaseEvidenceCandidate: false,
  },
  unknown: {
    financialFactRole: "unknown",
    countingPolicy: "requires_review",
    purchaseEvidenceCandidate: false,
  },
};

function normalizeSignals(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function classifySignals(haystack, extension) {
  if (!haystack) {
    return "unknown";
  }

  if (/invoice register/.test(haystack) && extension === "csv") {
    return "historical_register";
  }
  if (/prov tax pack|provisional tax pack|tax pack/.test(haystack) && extension === "xlsx") {
    return "historical_workbook";
  }
  if (/\b(quote|quotation)\b/.test(haystack)) {
    return "quote";
  }
  if (/\b(order confirmation|order details)\b/.test(haystack)) {
    return "order_confirmation";
  }
  if (/noticeofpaymentsingle|notice of payment single|proof of payment|transaction receipt|payment confirmation/.test(haystack)) {
    return "proof_of_payment";
  }
  if (/\b(payment to|reimburse|repaid|payback)\b/.test(haystack)) {
    return "reimbursement_evidence";
  }
  if (/\b(statement|account statement)\b/.test(haystack)) {
    return "statement";
  }
  if (/\b(payslip|payroll|uif)\b/.test(haystack)) {
    return "payslip_or_payroll";
  }
  if (/\b(lease|rental agreement|contract)\b/.test(haystack)) {
    return "lease_or_contract";
  }
  if (/\b(tax invoice|invoice)\b/.test(haystack)) {
    return "invoice";
  }
  if (/\b(receipt|slip)\b/.test(haystack)) {
    return "receipt";
  }
  return "unknown";
}

export function inferDocumentRole(fileName, extractedText = "") {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  const filenameRole = classifySignals(normalizeSignals(fileName), extension);
  const role =
    filenameRole === "unknown"
      ? classifySignals(normalizeSignals(extractedText.slice(0, 20_000)), extension)
      : filenameRole;

  return { role, ...ROLE_POLICIES[role] };
}

export function rolePolicy(role) {
  return ROLE_POLICIES[role] ?? ROLE_POLICIES.unknown;
}
