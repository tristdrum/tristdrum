export type HouseholdRole = 'owner' | 'manager'

export type FinanceMembership = {
  householdId: string
  householdName: string
  role: HouseholdRole
}

export type SourceHealthState = 'healthy' | 'stale' | 'blocked' | 'not_configured' | 'error'

export type FinanceSourceHealth = {
  id: string
  name: string
  sourceKind: string
  state: SourceHealthState
  coverageThrough: string | null
  lastSuccessfulAt: string | null
  importedItemCount: number
  blocker: string | null
}

export type ReviewPriority = 'critical' | 'high' | 'medium' | 'low'
export type ReviewStatus = 'open' | 'answered' | 'resolved' | 'deferred' | 'superseded' | 'void'

export type ReviewCandidate = {
  id: string
  label: string
  detail: string | null
  evidenceObjectId: string | null
}

export type FinanceReviewItem = {
  id: string
  questionNumber: number | null
  title: string
  status: ReviewStatus
  priority: ReviewPriority
  reason: string
  proposedInterpretation: string | null
  question: string | null
  occurredOn: string | null
  accountName: string | null
  description: string | null
  counterparty: string | null
  signedAmountCents: number | null
  currency: string
  taxImpactCents: number | null
  recurringValue: number
  incomeTransferRisk: boolean
  candidates: ReviewCandidate[]
  createdAt: string
}

export type EffectiveRecordStatus = 'current' | 'void' | 'duplicate' | 'private' | 'not_relevant'

export type AllocationKind = 'income' | 'expense' | 'capital' | 'private' | 'review' | 'transfer' | 'unallocated'

export type FinanceAllocation = {
  id: string
  transactionId: string
  signedAmountCents: number
  kind: AllocationKind
  category: string | null
  incomeStream: string | null
  propertyUnit: string | null
  taxTreatment: string | null
  effectiveStatus: EffectiveRecordStatus
}

export type FinanceTransaction = {
  id: string
  occurredOn: string
  accountName: string
  description: string
  counterparty: string | null
  signedAmountCents: number
  currency: string
  effectiveStatus: EffectiveRecordStatus
  reconciliationStatus: string
  evidenceCount: number
  decisionCount: number
  allocations: FinanceAllocation[]
}

export type EvidenceMirrorState = 'verified' | 'pending' | 'missing' | 'mismatch'

export type FinanceEvidence = {
  id: string
  displayName: string
  documentKind: string
  sourceKind: string
  effectiveStatus: EffectiveRecordStatus
  occurredOn: string | null
  exactSha256: string
  normalizedSha256: string | null
  localMirrorState: EvidenceMirrorState
  storageMirrorState: EvidenceMirrorState
  currentRevision: number
  duplicateOfId: string | null
  linkedTransactionCount: number
  pageCount: number | null
  createdAt: string
}

export type TaxScenarioKind = 'conservative' | 'intended_management_fee' | 'other'
export type TaxScenarioStatus = 'draft' | 'needs_accountant_review' | 'approved' | 'superseded'

export type FinanceTaxScenario = {
  id: string
  name: string
  kind: TaxScenarioKind
  status: TaxScenarioStatus
  periodStart: string
  periodEnd: string
  ownerLabel: string
  managerLabel: string
  operatingProfitCents: number | null
  managementFeeCents: number | null
  actualTransferredCents: number | null
  accruedDifferenceCents: number | null
  ownerTaxableIncomeCents: number | null
  managerTaxableIncomeCents: number | null
  combinedTaxCents: number | null
  warning: string | null
  updatedAt: string
}

export type SubmissionPackStatus = 'draft' | 'ready_for_review' | 'reviewed' | 'sent' | 'superseded'

export type FinanceSubmissionPack = {
  id: string
  name: string
  status: SubmissionPackStatus
  periodStart: string
  periodEnd: string
  manifestHash: string | null
  unresolvedItemCount: number
  createdAt: string
}

export type FinanceDashboardData = {
  membership: FinanceMembership
  sources: FinanceSourceHealth[]
  reviewItems: FinanceReviewItem[]
  transactions: FinanceTransaction[]
  evidence: FinanceEvidence[]
  taxScenarios: FinanceTaxScenario[]
  submissionPacks: FinanceSubmissionPack[]
  loadedAt: string
}

export type FinanceSnapshot = {
  loadedIncomeCents: number
  loadedExpenseCents: number
  loadedCapitalCents: number
  loadedReviewCents: number
  loadedTransferCents: number
  loadedUnallocatedCents: number
  openReviewCount: number
  criticalReviewCount: number
  evidenceLinkedTransactionCount: number
  evidenceCoveragePercent: number | null
  sourceBlockerCount: number
}

const priorityWeight: Record<ReviewPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function rankReviewItems(items: FinanceReviewItem[]): FinanceReviewItem[] {
  return [...items].sort((left, right) => {
    const leftScore = getReviewPriorityScore(left)
    const rightScore = getReviewPriorityScore(right)

    if (leftScore !== rightScore) {
      return rightScore - leftScore
    }

    return Date.parse(left.createdAt) - Date.parse(right.createdAt)
  })
}

export function getReviewPriorityScore(item: FinanceReviewItem): number {
  const taxImpact = Math.min(Math.abs(item.taxImpactCents ?? 0), 100_000_000)
  const amountImpact = Math.min(Math.abs(item.signedAmountCents ?? 0), 100_000_000)

  return (
    priorityWeight[item.priority] * 1_000_000_000
    + taxImpact * 10
    + amountImpact
    + (item.incomeTransferRisk ? 500_000_000 : 0)
    + Math.max(0, item.recurringValue) * 10_000
  )
}

export function deriveFinanceSnapshot(data: Pick<FinanceDashboardData, 'transactions' | 'reviewItems' | 'sources'>): FinanceSnapshot {
  let loadedIncomeCents = 0
  let loadedExpenseCents = 0
  let loadedCapitalCents = 0
  let loadedReviewCents = 0
  let loadedTransferCents = 0
  let loadedUnallocatedCents = 0
  let linkedTransactionCount = 0

  for (const transaction of data.transactions) {
    if (transaction.effectiveStatus !== 'current') {
      continue
    }

    if (transaction.evidenceCount > 0) {
      linkedTransactionCount += 1
    }

    const currentAllocations = transaction.allocations.filter((allocation) => allocation.effectiveStatus === 'current')
    if (currentAllocations.length === 0) {
      loadedUnallocatedCents += Math.abs(transaction.signedAmountCents)
      continue
    }

    for (const allocation of currentAllocations) {
      switch (allocation.kind) {
        case 'income':
          loadedIncomeCents += Math.abs(allocation.signedAmountCents)
          break
        case 'expense':
          loadedExpenseCents += Math.abs(allocation.signedAmountCents)
          break
        case 'capital':
          loadedCapitalCents += Math.abs(allocation.signedAmountCents)
          break
        case 'review':
          loadedReviewCents += Math.abs(allocation.signedAmountCents)
          break
        case 'transfer':
          loadedTransferCents += Math.abs(allocation.signedAmountCents)
          break
        case 'unallocated':
          loadedUnallocatedCents += Math.abs(allocation.signedAmountCents)
          break
        case 'private':
          break
      }
    }
  }

  const openReviewItems = data.reviewItems.filter((item) => item.status === 'open')
  const evidenceCoveragePercent = data.transactions.length === 0
    ? null
    : Math.round((linkedTransactionCount / data.transactions.length) * 100)

  return {
    loadedIncomeCents,
    loadedExpenseCents,
    loadedCapitalCents,
    loadedReviewCents,
    loadedTransferCents,
    loadedUnallocatedCents,
    openReviewCount: openReviewItems.length,
    criticalReviewCount: openReviewItems.filter((item) => item.priority === 'critical').length,
    evidenceLinkedTransactionCount: linkedTransactionCount,
    evidenceCoveragePercent,
    sourceBlockerCount: data.sources.filter((source) => source.state === 'blocked' || source.state === 'error').length,
  }
}

export function formatMoney(cents: number | null, currency = 'ZAR'): string {
  if (cents === null || !Number.isSafeInteger(cents)) {
    return '—'
  }

  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatFinanceDate(value: string | null, includeTime = false): string {
  if (!value) {
    return '—'
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return value
  }

  const options: Intl.DateTimeFormatOptions = includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }

  return new Intl.DateTimeFormat('en-ZA', options).format(new Date(timestamp))
}

export function compactHash(value: string | null): string {
  if (!value) {
    return '—'
  }

  if (value.length <= 16) {
    return value
  }

  return `${value.slice(0, 8)}…${value.slice(-8)}`
}

export function humanizeFinanceValue(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
