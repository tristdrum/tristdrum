import { describe, expect, it } from 'vitest'
import {
  compactHash,
  deriveFinanceSnapshot,
  formatMoney,
  rankReviewItems,
  type FinanceDashboardData,
  type FinanceReviewItem,
} from './finance.js'

const reviewItem = (overrides: Partial<FinanceReviewItem>): FinanceReviewItem => ({
  id: 'review-item',
  title: 'Review item',
  status: 'open',
  priority: 'medium',
  reason: 'The source evidence does not resolve the classification.',
  proposedInterpretation: null,
  question: null,
  occurredOn: null,
  accountName: null,
  description: null,
  counterparty: null,
  signedAmountCents: null,
  currency: 'ZAR',
  taxImpactCents: null,
  recurringValue: 0,
  incomeTransferRisk: false,
  candidates: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('rankReviewItems', () => {
  it('puts income and transfer risks ahead of similarly sized ordinary items', () => {
    const ranked = rankReviewItems([
      reviewItem({ id: 'ordinary', signedAmountCents: 500_000 }),
      reviewItem({ id: 'risky', signedAmountCents: 500_000, incomeTransferRisk: true }),
    ])

    expect(ranked.map((item) => item.id)).toEqual(['risky', 'ordinary'])
  })

  it('uses stated priority before amount', () => {
    const ranked = rankReviewItems([
      reviewItem({ id: 'medium-large', priority: 'medium', signedAmountCents: 10_000_000 }),
      reviewItem({ id: 'critical-small', priority: 'critical', signedAmountCents: 1 }),
    ])

    expect(ranked.map((item) => item.id)).toEqual(['critical-small', 'medium-large'])
  })
})

describe('deriveFinanceSnapshot', () => {
  it('uses current allocations and excludes void transactions', () => {
    const data: Pick<FinanceDashboardData, 'transactions' | 'reviewItems' | 'sources'> = {
      sources: [
        {
          id: 'source',
          name: 'Source',
          sourceKind: 'statement',
          state: 'blocked',
          coverageThrough: null,
          lastSuccessfulAt: null,
          importedItemCount: 0,
          blocker: 'A source export is required.',
        },
      ],
      reviewItems: [
        reviewItem({ id: 'open-critical', priority: 'critical' }),
        reviewItem({ id: 'answered', status: 'answered' }),
      ],
      transactions: [
        {
          id: 'income',
          occurredOn: '2026-01-02',
          accountName: 'Account',
          description: 'Income',
          counterparty: null,
          signedAmountCents: 500_000,
          currency: 'ZAR',
          effectiveStatus: 'current',
          reconciliationStatus: 'reconciled',
          evidenceCount: 1,
          decisionCount: 0,
          allocations: [
            {
              id: 'income-allocation',
              transactionId: 'income',
              signedAmountCents: 500_000,
              kind: 'income',
              category: null,
              incomeStream: null,
              propertyUnit: null,
              taxTreatment: null,
              effectiveStatus: 'current',
            },
          ],
        },
        {
          id: 'void-expense',
          occurredOn: '2026-01-03',
          accountName: 'Account',
          description: 'Voided expense',
          counterparty: null,
          signedAmountCents: -200_000,
          currency: 'ZAR',
          effectiveStatus: 'void',
          reconciliationStatus: 'reconciled',
          evidenceCount: 1,
          decisionCount: 0,
          allocations: [
            {
              id: 'void-allocation',
              transactionId: 'void-expense',
              signedAmountCents: -200_000,
              kind: 'expense',
              category: null,
              incomeStream: null,
              propertyUnit: null,
              taxTreatment: null,
              effectiveStatus: 'current',
            },
          ],
        },
        {
          id: 'unallocated',
          occurredOn: '2026-01-04',
          accountName: 'Account',
          description: 'Unallocated',
          counterparty: null,
          signedAmountCents: -75_000,
          currency: 'ZAR',
          effectiveStatus: 'current',
          reconciliationStatus: 'unresolved',
          evidenceCount: 0,
          decisionCount: 0,
          allocations: [],
        },
      ],
    }

    expect(deriveFinanceSnapshot(data)).toEqual({
      loadedIncomeCents: 500_000,
      loadedExpenseCents: 0,
      loadedCapitalCents: 0,
      loadedReviewCents: 0,
      loadedTransferCents: 0,
      loadedUnallocatedCents: 75_000,
      openReviewCount: 1,
      criticalReviewCount: 1,
      evidenceLinkedTransactionCount: 1,
      evidenceCoveragePercent: 33,
      sourceBlockerCount: 1,
    })
  })

  it('keeps accountant-review allocations out of the unallocated total', () => {
    const snapshot = deriveFinanceSnapshot({
      sources: [],
      reviewItems: [],
      transactions: [{
        id: 'tax-review',
        occurredOn: '2026-01-05',
        accountName: 'Account',
        description: 'Needs tax treatment review',
        counterparty: null,
        signedAmountCents: -25_000,
        currency: 'ZAR',
        effectiveStatus: 'current',
        reconciliationStatus: 'review_required',
        evidenceCount: 0,
        decisionCount: 0,
        allocations: [{
          id: 'tax-review-allocation',
          transactionId: 'tax-review',
          signedAmountCents: -25_000,
          kind: 'review',
          category: 'accountant_review',
          incomeStream: null,
          propertyUnit: null,
          taxTreatment: 'accountant_review',
          effectiveStatus: 'current',
        }],
      }],
    })

    expect(snapshot.loadedReviewCents).toBe(25_000)
    expect(snapshot.loadedUnallocatedCents).toBe(0)
  })
})

describe('finance formatters', () => {
  it('formats signed integer cents', () => {
    expect(formatMoney(12_345, 'ZAR')).toContain('123,45')
    expect(formatMoney(null)).toBe('—')
  })

  it('compacts a long evidence hash without losing both ends', () => {
    expect(compactHash('0123456789abcdef0123456789abcdef')).toBe('01234567…89abcdef')
  })
})
