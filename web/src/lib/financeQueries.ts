import { supabase } from './supabase'
import {
  type AllocationKind,
  type EffectiveRecordStatus,
  type FinanceAllocation,
  type FinanceDashboardData,
  type FinanceEvidence,
  type FinanceMembership,
  type FinanceReviewItem,
  type FinanceSourceHealth,
  type FinanceSubmissionPack,
  type FinanceTaxScenario,
  type FinanceTransaction,
  type ReviewCandidate,
  type ReviewPriority,
  type ReviewStatus,
  type SourceHealthState,
  type SubmissionPackStatus,
  type TaxScenarioKind,
  type TaxScenarioStatus,
} from './finance'

export type FinanceAccessResult =
  | { status: 'loading' }
  | { status: 'allowed'; membership: FinanceMembership }
  | { status: 'denied' }
  | { status: 'setup_required' }
  | { status: 'error'; message: string }

type QueryError = {
  code?: string
  message?: string
}

export async function loadFinanceMembership(userId: string): Promise<FinanceAccessResult> {
  const { data: membershipRows, error: membershipError } = await supabase
    .from('household_members')
    .select('household_id, role, membership_status')
    .eq('user_id', userId)
    .eq('membership_status', 'active')
    .limit(1)

  if (membershipError) {
    if (isMissingFinanceSchema(membershipError)) {
      return { status: 'setup_required' }
    }

    return { status: 'error', message: accessErrorMessage(membershipError) }
  }

  const member = membershipRows?.[0]
  if (!member || (member.role !== 'owner' && member.role !== 'manager')) {
    return { status: 'denied' }
  }

  const { data: householdRows, error: householdError } = await supabase
    .from('households')
    .select('id, name')
    .eq('id', member.household_id)
    .limit(1)

  if (householdError) {
    if (isMissingFinanceSchema(householdError)) {
      return { status: 'setup_required' }
    }

    return { status: 'error', message: accessErrorMessage(householdError) }
  }

  const household = householdRows?.[0]
  if (!household) {
    return { status: 'denied' }
  }

  return {
    status: 'allowed',
    membership: {
      householdId: household.id,
      householdName: household.name,
      role: member.role,
    },
  }
}

export async function loadFinanceDashboard(membership: FinanceMembership): Promise<FinanceDashboardData> {
  const householdId = membership.householdId
  const [
    sourceResult,
    importRunResult,
    accountResult,
    reviewResult,
    decisionResult,
    transactionResult,
    allocationResult,
    evidenceResult,
    documentResult,
    pageResult,
    matchResult,
    taxScenarioResult,
    submissionPackResult,
  ] = await Promise.all([
    supabase
      .from('finance_sources')
      .select('id, logical_source_id, source_type, display_name, connection_status, last_success_at, coverage_end_on, health_summary, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_import_runs')
      .select('id, logical_import_id, source_id, run_status, inserted_record_count, duplicate_record_count, coverage_end_on, completed_at, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('financial_accounts')
      .select('id, logical_account_id, display_name, currency, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_review_items')
      .select('id, logical_review_item_id, transaction_id, document_id, evidence_object_id, review_type, title, question, proposed_interpretation, ambiguity_reason, answer_options, context_snapshot, workflow_status, priority, priority_score, amount_cents, tax_impact_cents, record_status, revision_number, created_at')
      .eq('household_id', householdId),
    supabase
      .from('finance_human_decisions')
      .select('id, logical_decision_id, review_item_id, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_transactions')
      .select('id, logical_transaction_id, financial_account_id, transaction_at, booked_on, amount_cents, currency, raw_description, counterparty_name, reference, record_status, revision_number')
      .eq('household_id', householdId)
      .order('transaction_at', { ascending: false }),
    supabase
      .from('finance_allocations')
      .select('id, logical_allocation_id, transaction_id, amount_cents, allocation_type, category_code, income_stream, property_unit, tax_treatment, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_current_evidence_objects')
      .select('id, logical_evidence_id, source_id, evidence_kind, original_filename, exact_sha256, normalized_sha256, duplicate_of_evidence_id, record_status, source_created_at, acquired_at, last_verified_at, revision_number, created_at, has_local_copy, has_storage_copy')
      .eq('household_id', householdId)
      .order('acquired_at', { ascending: false }),
    supabase
      .from('finance_documents')
      .select('id, logical_document_id, evidence_object_id, document_type, issued_on, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_document_pages')
      .select('id, logical_page_id, document_id, page_number, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_transaction_document_matches')
      .select('id, logical_match_id, transaction_id, document_id, match_status, record_status, revision_number')
      .eq('household_id', householdId),
    supabase
      .from('finance_tax_scenarios')
      .select('id, logical_tax_scenario_id, scenario_name, scenario_type, scenario_status, period_start_on, period_end_on, calculated_management_fee_cents, paid_management_fee_cents, accrued_management_fee_cents, tristan_taxable_income_cents, jane_taxable_income_cents, combined_household_tax_cents, calculation_basis, warnings, calculated_at, record_status, revision_number, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false }),
    supabase
      .from('finance_submission_packs')
      .select('id, logical_submission_pack_id, tax_scenario_id, pack_name, pack_status, manifest_sha256, generated_at, record_status, revision_number, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false }),
  ])

  const sourceRows = requireRows(sourceResult, 'Source health')
  const importRunRows = requireRows(importRunResult, 'Import history')
  const accountRows = requireRows(accountResult, 'Financial accounts')
  const reviewRows = requireRows(reviewResult, 'Review inbox')
  const decisionRows = requireRows(decisionResult, 'Human decisions')
  const transactionRows = requireRows(transactionResult, 'Transaction ledger')
  const allocationRows = requireRows(allocationResult, 'Accounting allocations')
  const evidenceRows = requireRows(evidenceResult, 'Evidence registry')
  const documentRows = requireRows(documentResult, 'Document registry')
  const pageRows = requireRows(pageResult, 'Document pages')
  const matchRows = requireRows(matchResult, 'Evidence matches')
  const taxScenarioRows = requireRows(taxScenarioResult, 'Tax scenarios')
  const submissionPackRows = requireRows(submissionPackResult, 'Submission packs')

  const currentSourceRows = latestRevisions(sourceRows, 'logical_source_id')
    .filter((row) => row.record_status === 'active')
  const currentImportRows = latestRevisions(importRunRows, 'logical_import_id')
    .filter((row) => row.record_status === 'active')
  const currentAccountRows = latestRevisions(accountRows, 'logical_account_id')
    .filter((row) => row.record_status === 'active')
  const currentReviewRows = latestRevisions(reviewRows, 'logical_review_item_id')
    .filter((row) => row.record_status === 'active')
  const currentDecisionRows = latestRevisions(decisionRows, 'logical_decision_id')
    .filter((row) => row.record_status === 'active')
  const currentTransactionRows = latestRevisions(transactionRows, 'logical_transaction_id')
    .filter((row) => row.record_status === 'active')
  const currentAllocationRows = latestRevisions(allocationRows, 'logical_allocation_id')
    .filter((row) => row.record_status === 'active')
  const currentEvidenceRows = evidenceRows.filter(hasStringId)
  const currentDocumentRows = latestRevisions(documentRows, 'logical_document_id')
    .filter((row) => row.record_status === 'active')
  const currentPageRows = latestRevisions(pageRows, 'logical_page_id')
    .filter((row) => row.record_status === 'active')
  const currentMatchRows = latestRevisions(matchRows, 'logical_match_id')
    .filter((row) => row.record_status === 'active' && row.match_status === 'confirmed')
  const currentTaxScenarioRows = latestRevisions(taxScenarioRows, 'logical_tax_scenario_id')
    .filter((row) => row.record_status === 'active')
  const currentSubmissionPackRows = latestRevisions(submissionPackRows, 'logical_submission_pack_id')
    .filter((row) => row.record_status === 'active')

  const currentAccountByLogicalId = new Map(currentAccountRows.map((row) => [row.logical_account_id, row]))
  const accountNameById = new Map(accountRows.map((row) => [
    row.id,
    currentAccountByLogicalId.get(row.logical_account_id)?.display_name ?? row.display_name,
  ]))
  const sourceLogicalIdByRowId = new Map(sourceRows.map((row) => [row.id, row.logical_source_id]))
  const currentSourceByLogicalId = new Map(currentSourceRows.map((row) => [row.logical_source_id, row]))
  const sourceById = new Map(sourceRows.map((row) => [
    row.id,
    currentSourceByLogicalId.get(row.logical_source_id) ?? row,
  ]))
  const transactionLogicalIdByRowId = new Map(transactionRows.map((row) => [row.id, row.logical_transaction_id]))
  const currentTransactionByLogicalId = new Map(currentTransactionRows.map((row) => [row.logical_transaction_id, row]))
  const reviewRowById = new Map(reviewRows.map((row) => [row.id, row]))
  const reviewsByLogicalTransactionId = groupBy(
    currentReviewRows,
    (row) => row.transaction_id ? transactionLogicalIdByRowId.get(row.transaction_id) ?? null : null,
  )
  const allocationsByLogicalTransactionId = groupBy(
    currentAllocationRows,
    (row) => transactionLogicalIdByRowId.get(row.transaction_id) ?? null,
  )
  const matchesByLogicalTransactionId = groupBy(
    currentMatchRows,
    (row) => transactionLogicalIdByRowId.get(row.transaction_id) ?? null,
  )
  const documentLogicalIdByRowId = new Map(documentRows.map((row) => [row.id, row.logical_document_id]))
  const currentDocumentByLogicalId = new Map(currentDocumentRows.map((row) => [row.logical_document_id, row]))
  const documentByEvidenceId = firstBy(currentDocumentRows, (row) => row.evidence_object_id)
  const pagesByLogicalDocumentId = groupBy(
    currentPageRows,
    (row) => documentLogicalIdByRowId.get(row.document_id) ?? null,
  )
  const scenarioLogicalIdByRowId = new Map(taxScenarioRows.map((row) => [row.id, row.logical_tax_scenario_id]))
  const currentScenarioByLogicalId = new Map(currentTaxScenarioRows.map((row) => [row.logical_tax_scenario_id, row]))
  const decisionCountByLogicalTransactionId = new Map<string, number>()
  for (const decision of currentDecisionRows) {
    const review = reviewRowById.get(decision.review_item_id)
    const logicalTransactionId = review?.transaction_id
      ? transactionLogicalIdByRowId.get(review.transaction_id)
      : null
    if (!logicalTransactionId) continue
    decisionCountByLogicalTransactionId.set(
      logicalTransactionId,
      (decisionCountByLogicalTransactionId.get(logicalTransactionId) ?? 0) + 1,
    )
  }

  const sources: FinanceSourceHealth[] = currentSourceRows.map((source) => {
    const sourceImports = currentImportRows.filter(
      (run) => sourceLogicalIdByRowId.get(run.source_id) === source.logical_source_id
        && (run.run_status === 'succeeded' || run.run_status === 'partial'),
    )
    const latestImport = sourceImports.reduce<(typeof sourceImports)[number] | null>((latest, run) => {
      if (!latest) return run
      const latestTimestamp = Date.parse(latest.completed_at ?? '')
      const runTimestamp = Date.parse(run.completed_at ?? '')
      return runTimestamp > latestTimestamp ? run : latest
    }, null)

    return {
      id: source.id,
      name: source.display_name,
      sourceKind: source.source_type,
      state: mapSourceState(source.connection_status),
      coverageThrough: source.coverage_end_on ?? latestImport?.coverage_end_on ?? null,
      lastSuccessfulAt: source.last_success_at ?? latestImport?.completed_at ?? null,
      importedItemCount: sourceImports.reduce((total, run) => total + safeInteger(run.inserted_record_count), 0),
      blocker: readFirstString(source.health_summary, ['blocker', 'error', 'message']),
    }
  })

  const reviewItems: FinanceReviewItem[] = currentReviewRows.map((review) => {
    const transactionLogicalId = review.transaction_id ? transactionLogicalIdByRowId.get(review.transaction_id) : undefined
    const transaction = transactionLogicalId ? currentTransactionByLogicalId.get(transactionLogicalId) : undefined
    const context = asRecord(review.context_snapshot)
    const transactionCurrency = transaction?.currency ?? readString(context, 'currency') ?? 'ZAR'

    return {
      id: review.id,
      title: review.title,
      status: mapReviewStatus(review.workflow_status),
      priority: mapReviewPriority(review.priority),
      reason: review.ambiguity_reason,
      proposedInterpretation: review.proposed_interpretation,
      question: review.question,
      occurredOn: transaction?.booked_on ?? transaction?.transaction_at ?? readString(context, 'occurred_on'),
      accountName: transaction ? accountNameById.get(transaction.financial_account_id) ?? null : readString(context, 'account_name'),
      description: transaction?.raw_description ?? readString(context, 'description'),
      counterparty: transaction?.counterparty_name ?? readString(context, 'counterparty'),
      signedAmountCents: nullableSafeInteger(review.amount_cents ?? transaction?.amount_cents),
      currency: transactionCurrency,
      taxImpactCents: nullableSafeInteger(review.tax_impact_cents),
      recurringValue: Math.max(0, safeInteger(review.priority_score)),
      incomeTransferRisk: review.review_type === 'income' || review.review_type === 'transfer' || readBoolean(context, 'income_transfer_risk'),
      candidates: mapReviewCandidates(review.answer_options, review.evidence_object_id),
      createdAt: review.created_at,
    }
  })

  const transactions: FinanceTransaction[] = currentTransactionRows.map((transaction) => {
    const logicalTransactionId = transaction.logical_transaction_id
    const allocationRowsForTransaction = allocationsByLogicalTransactionId.get(logicalTransactionId) ?? []
    const allocations = allocationRowsForTransaction.map(mapAllocation)
    const linkedReviews = reviewsByLogicalTransactionId.get(logicalTransactionId) ?? []
    const openReviews = linkedReviews.filter((review) => review.workflow_status === 'open')
    const decisionCount = decisionCountByLogicalTransactionId.get(logicalTransactionId) ?? 0

    return {
      id: transaction.id,
      occurredOn: transaction.booked_on ?? transaction.transaction_at,
      accountName: accountNameById.get(transaction.financial_account_id) ?? 'Unknown account',
      description: transaction.raw_description || transaction.reference || 'Unlabelled transaction',
      counterparty: transaction.counterparty_name,
      signedAmountCents: safeInteger(transaction.amount_cents),
      currency: transaction.currency,
      effectiveStatus: mapRecordStatus(transaction.record_status),
      reconciliationStatus: deriveReconciliationStatus(transaction.amount_cents, allocationRowsForTransaction, openReviews.length, matchesByLogicalTransactionId.get(logicalTransactionId)?.length ?? 0),
      evidenceCount: matchesByLogicalTransactionId.get(logicalTransactionId)?.length ?? 0,
      decisionCount,
      allocations,
    }
  })

  const linkedTransactionsByEvidenceId = new Map<string, Set<string>>()
  for (const match of currentMatchRows) {
    const documentLogicalId = documentLogicalIdByRowId.get(match.document_id)
    const document = documentLogicalId ? currentDocumentByLogicalId.get(documentLogicalId) : undefined
    if (!document) continue
    const logicalTransactionId = transactionLogicalIdByRowId.get(match.transaction_id)
    if (!logicalTransactionId) continue
    const existing = linkedTransactionsByEvidenceId.get(document.evidence_object_id) ?? new Set<string>()
    existing.add(logicalTransactionId)
    linkedTransactionsByEvidenceId.set(document.evidence_object_id, existing)
  }

  const evidence: FinanceEvidence[] = currentEvidenceRows.map((item) => {
    const document = documentByEvidenceId.get(item.id)
    const source = item.source_id ? sourceById.get(item.source_id) : undefined

    return {
      id: item.id,
      displayName: item.original_filename ?? `${humanEvidenceKind(item.evidence_kind ?? 'other')} evidence`,
      documentKind: document?.document_type ?? item.evidence_kind ?? 'other',
      sourceKind: source?.source_type ?? item.evidence_kind ?? 'other',
      effectiveStatus: mapRecordStatus(item.record_status ?? 'active'),
      occurredOn: document?.issued_on ?? item.source_created_at,
      exactSha256: item.exact_sha256 ?? '',
      normalizedSha256: item.normalized_sha256,
      localMirrorState: mirrorState(item.has_local_copy, item.last_verified_at),
      storageMirrorState: mirrorState(item.has_storage_copy, item.last_verified_at),
      currentRevision: item.revision_number ?? 1,
      duplicateOfId: item.duplicate_of_evidence_id,
      linkedTransactionCount: linkedTransactionsByEvidenceId.get(item.id)?.size ?? 0,
      pageCount: document ? (pagesByLogicalDocumentId.get(document.logical_document_id)?.length ?? 0) : null,
      createdAt: item.created_at ?? item.acquired_at ?? '',
    }
  })

  const taxScenarios: FinanceTaxScenario[] = currentTaxScenarioRows.map((scenario) => ({
    id: scenario.id,
    name: scenario.scenario_name,
    kind: mapTaxScenarioKind(scenario.scenario_type),
    status: mapTaxScenarioStatus(scenario.scenario_status),
    periodStart: scenario.period_start_on,
    periodEnd: scenario.period_end_on,
    ownerLabel: readString(scenario.calculation_basis, 'owner_label') ?? 'Owner',
    managerLabel: readString(scenario.calculation_basis, 'manager_label') ?? 'Manager',
    operatingProfitCents: readFirstInteger(scenario.calculation_basis, ['operating_profit_cents', 'operating_profit_before_fee_cents']),
    managementFeeCents: nullableSafeInteger(scenario.calculated_management_fee_cents),
    actualTransferredCents: nullableSafeInteger(scenario.paid_management_fee_cents),
    accruedDifferenceCents: nullableSafeInteger(scenario.accrued_management_fee_cents),
    ownerTaxableIncomeCents: nullableSafeInteger(scenario.tristan_taxable_income_cents),
    managerTaxableIncomeCents: nullableSafeInteger(scenario.jane_taxable_income_cents),
    combinedTaxCents: nullableSafeInteger(scenario.combined_household_tax_cents),
    warning: readWarning(scenario.warnings),
    updatedAt: scenario.calculated_at ?? scenario.created_at,
  }))

  const unresolvedItemCount = reviewItems.filter((item) => item.status === 'open').length
  const submissionPacks: FinanceSubmissionPack[] = currentSubmissionPackRows.map((pack) => {
    const scenarioLogicalId = scenarioLogicalIdByRowId.get(pack.tax_scenario_id)
    const scenario = scenarioLogicalId ? currentScenarioByLogicalId.get(scenarioLogicalId) : undefined
    return {
      id: pack.id,
      name: pack.pack_name,
      status: mapSubmissionPackStatus(pack.pack_status),
      periodStart: scenario?.period_start_on ?? pack.created_at.slice(0, 10),
      periodEnd: scenario?.period_end_on ?? pack.created_at.slice(0, 10),
      manifestHash: pack.manifest_sha256,
      unresolvedItemCount,
      createdAt: pack.generated_at ?? pack.created_at,
    }
  })

  return {
    membership,
    sources,
    reviewItems,
    transactions,
    evidence,
    taxScenarios,
    submissionPacks,
    loadedAt: new Date().toISOString(),
  }
}

function requireRows<T>(result: { data: T[] | null; error: QueryError | null }, section: string): T[] {
  if (result.error) {
    if (isMissingFinanceSchema(result.error)) {
      throw new Error('The finance database foundation is not available yet. Apply the finance migration, then refresh.')
    }

    if (result.error.code === '42501') {
      throw new Error(`${section} is not available to this household role.`)
    }

    throw new Error(`${section} could not be loaded. Refresh or confirm the finance connection.`)
  }

  return result.data ?? []
}

function latestRevisions<T extends { revision_number: number }>(rows: T[], logicalKey: keyof T): T[] {
  const current = new Map<unknown, T>()
  for (const row of rows) {
    const key = row[logicalKey]
    const existing = current.get(key)
    if (!existing || row.revision_number > existing.revision_number) {
      current.set(key, row)
    }
  }

  return Array.from(current.values())
}

function hasStringId<T extends { id: string | null }>(row: T): row is T & { id: string } {
  return typeof row.id === 'string'
}

function groupBy<T, K>(rows: T[], keyFor: (row: T) => K | null): Map<K, T[]> {
  const grouped = new Map<K, T[]>()
  for (const row of rows) {
    const key = keyFor(row)
    if (key === null) continue
    const existing = grouped.get(key) ?? []
    existing.push(row)
    grouped.set(key, existing)
  }
  return grouped
}

function firstBy<T, K>(rows: T[], keyFor: (row: T) => K): Map<K, T> {
  const mapped = new Map<K, T>()
  for (const row of rows) {
    const key = keyFor(row)
    if (!mapped.has(key)) mapped.set(key, row)
  }
  return mapped
}

function mapAllocation(row: {
  id: string
  transaction_id: string
  amount_cents: number
  allocation_type: string
  category_code: string
  income_stream: string | null
  property_unit: string | null
  tax_treatment: string
  record_status: string
}): FinanceAllocation {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    signedAmountCents: safeInteger(row.amount_cents),
    kind: mapAllocationKind(row.allocation_type),
    category: row.category_code,
    incomeStream: row.income_stream,
    propertyUnit: row.property_unit,
    taxTreatment: row.tax_treatment,
    effectiveStatus: mapRecordStatus(row.record_status),
  }
}

function deriveReconciliationStatus(
  transactionAmount: number,
  allocations: Array<{ amount_cents: number }>,
  openReviewCount: number,
  evidenceCount: number,
): string {
  if (openReviewCount > 0) return 'review_required'
  const allocatedCents = allocations.reduce((total, allocation) => total + safeInteger(allocation.amount_cents), 0)
  if (allocations.length > 0 && allocatedCents === safeInteger(transactionAmount)) return 'reconciled'
  if (allocations.length > 0) return 'partially_allocated'
  if (evidenceCount > 0) return 'evidence_linked'
  return 'unallocated'
}

function mapReviewCandidates(value: unknown, linkedEvidenceId: string | null): ReviewCandidate[] {
  const values = Array.isArray(value) ? value : []
  const candidates = values.flatMap<ReviewCandidate>((entry, index) => {
    if (typeof entry === 'string') {
      return [{ id: `option-${index}`, label: entry, detail: null, evidenceObjectId: null }]
    }

    const record = asRecord(entry)
    const label = readString(record, 'label') ?? readString(record, 'value')
    if (!label) return []
    return [{
      id: readString(record, 'id') ?? `option-${index}`,
      label,
      detail: readString(record, 'detail') ?? readString(record, 'description'),
      evidenceObjectId: readString(record, 'evidence_object_id'),
    }]
  })

  if (linkedEvidenceId && !candidates.some((candidate) => candidate.evidenceObjectId === linkedEvidenceId)) {
    candidates.push({ id: `evidence-${linkedEvidenceId}`, label: 'Linked evidence', detail: null, evidenceObjectId: linkedEvidenceId })
  }

  return candidates
}

function mapRecordStatus(value: string): EffectiveRecordStatus {
  if (value === 'void' || value === 'duplicate' || value === 'private' || value === 'not_relevant') return value
  return 'current'
}

function mapAllocationKind(value: string): AllocationKind {
  if (value === 'income' || value === 'expense' || value === 'capital' || value === 'private' || value === 'transfer') return value
  if (value === 'liability' || value === 'equity') return 'transfer'
  return 'unallocated'
}

function mapReviewStatus(value: string): ReviewStatus {
  if (value === 'answered' || value === 'resolved' || value === 'deferred') return value
  return 'open'
}

function mapReviewPriority(value: string): ReviewPriority {
  if (value === 'critical' || value === 'high' || value === 'low') return value
  return 'medium'
}

function mapSourceState(value: string): SourceHealthState {
  if (value === 'healthy') return 'healthy'
  if (value === 'degraded') return 'stale'
  if (value === 'blocked') return 'blocked'
  if (value === 'disabled' || value === 'not_configured') return 'not_configured'
  return 'error'
}

function mapTaxScenarioKind(value: string): TaxScenarioKind {
  if (value === 'conservative' || value === 'intended_management_fee') return value
  return 'other'
}

function mapTaxScenarioStatus(value: string): TaxScenarioStatus {
  if (value === 'accountant_review') return 'needs_accountant_review'
  if (value === 'confirmed') return 'approved'
  if (value === 'superseded') return 'superseded'
  return 'draft'
}

function mapSubmissionPackStatus(value: string): SubmissionPackStatus {
  if (value === 'review_ready') return 'ready_for_review'
  if (value === 'approved') return 'reviewed'
  if (value === 'sent') return 'sent'
  return 'draft'
}

function mirrorState(hasCopy: boolean | null, lastVerifiedAt: string | null): FinanceEvidence['localMirrorState'] {
  if (!hasCopy) return 'missing'
  return lastVerifiedAt ? 'verified' : 'pending'
}

function humanEvidenceKind(value: string): string {
  return value.replaceAll('_', ' ')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown, key: string): string | null {
  const entry = asRecord(value)[key]
  return typeof entry === 'string' && entry.trim() ? entry : null
}

function readBoolean(value: unknown, key: string): boolean {
  return asRecord(value)[key] === true
}

function readFirstString(value: unknown, keys: string[]): string | null {
  for (const key of keys) {
    const result = readString(value, key)
    if (result) return result
  }
  return null
}

function readFirstInteger(value: unknown, keys: string[]): number | null {
  const record = asRecord(value)
  for (const key of keys) {
    const result = nullableSafeInteger(record[key])
    if (result !== null) return result
  }
  return null
}

function readWarning(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const warnings = value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry]
    const message = readString(entry, 'message') ?? readString(entry, 'warning')
    return message ? [message] : []
  })
  return warnings.length ? warnings.slice(0, 2).join(' ') : null
}

function safeInteger(value: unknown): number {
  return nullableSafeInteger(value) ?? 0
}

function nullableSafeInteger(value: unknown): number | null {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof numeric === 'number' && Number.isSafeInteger(numeric) ? numeric : null
}

function isMissingFinanceSchema(error: QueryError): boolean {
  const message = error.message?.toLowerCase() ?? ''
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || (message.includes('schema cache') && message.includes('could not find'))
    || (message.includes('relation') && message.includes('does not exist'))
}

function accessErrorMessage(error: QueryError): string {
  if (error.code === '42501') {
    return 'The signed-in account is not permitted to read household membership.'
  }

  return 'Household access could not be verified. Refresh or confirm the finance connection.'
}
