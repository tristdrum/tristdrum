export const plannedAdapters = [
  {
    id: "absa-statements",
    status: "interface_only",
    sourceType: "Himalaya .eml plus original statement attachments",
    sourceKeyStrategy: "mailbox + RFC Message-ID + attachment part + exact hash",
    safeguards: ["dry_run_default", "never_mark_or_label_mail", "passwords_never_persisted"],
  },
  {
    id: "discovery-exports",
    status: "interface_only",
    sourceType: "Overlapping CSV or XLSX transaction exports",
    sourceKeyStrategy: "account fingerprint + provider transaction identity or stable row fingerprint",
    safeguards: ["overlap_deduplication", "transfers_not_income_by_default"],
  },
  {
    id: "airbnb-evidence",
    status: "interface_only",
    sourceType: "Confirmation/cancellation .eml and platform payout export",
    sourceKeyStrategy: "reservation or payout identity + source revision",
    safeguards: ["emails_are_booking_evidence_not_realized_cash", "cancellations_fail_closed"],
  },
  {
    id: "sixty60-himalaya",
    status: "interface_only",
    sourceType: "Household manager mailbox .eml with deterministic order and line items",
    sourceKeyStrategy: "mailbox + order number + invoice revision",
    safeguards: ["mixed_use_line_item_review", "wallet_and_card_settlement_split"],
  },
  {
    id: "himalaya-mail",
    status: "interface_only",
    sourceType: "Full RFC822 export plus original attachments",
    sourceKeyStrategy: "explicit account + folder + RFC Message-ID + MIME part",
    safeguards: ["explicit_account_required", "read_only_export", "no_cross_mailbox_default"],
  },
  {
    id: "domestic-worker-payroll",
    status: "interface_only",
    sourceType: "Approved summaries and evidence references from the canonical payroll repository",
    sourceKeyStrategy: "worker identity + pay period + approved revision",
    safeguards: ["payroll_repo_remains_canonical", "cash_withdrawal_not_payroll_without_link"],
  },
];
