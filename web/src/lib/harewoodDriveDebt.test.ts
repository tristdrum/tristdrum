import { describe, expect, it } from 'vitest'
import {
  calculateInterestAccrued,
  getFirstPaymentDueDate,
  getHarewoodDriveDebtSnapshot,
  type HarewoodDriveDebtConfig,
} from './harewoodDriveDebt.js'

const expectCloseTo = (actual: number, expected: number, tolerance = 0.00001) => {
  expect(Math.abs(actual - expected) <= tolerance).toBe(true)
}

const config: HarewoodDriveDebtConfig = {
  schemaVersion: 1,
  property: {
    label: '28 Harewood Drive',
    erf: 'Erf 10520, East London',
    registrationDate: '2025-09-17',
  },
  parties: {
    debtorDisplayName: 'Tristan',
    creditorDisplayName: 'Martin',
  },
  agreement: {
    principal: 333000,
    interestMarginBelowRepo: 0.025,
    graceMonths: 5,
    minimumMonthlyPayment: 3500,
  },
  repoRateTimeline: [
    {
      effectiveFrom: '2025-09-01T00:00:00+02:00',
      repoRate: 0.07,
    },
    {
      effectiveFrom: '2025-11-20T15:00:00+02:00',
      repoRate: 0.0675,
    },
    {
      effectiveFrom: '2026-05-29T00:00:00+02:00',
      repoRate: 0.07,
    },
  ],
  payments: [
    {
      paidAt: '2026-02-28',
      amount: 3500,
      note: 'Monthly plan payment',
    },
    {
      paidAt: '2026-03-31',
      amount: 3500,
      note: 'Monthly plan payment',
    },
    {
      paidAt: '2026-04-30',
      amount: 3500,
      note: 'Monthly plan payment',
    },
    {
      paidAt: '2026-05-31',
      amount: 3500,
      note: 'Monthly plan payment',
    },
  ],
}

describe('Harewood Drive debt calculations', () => {
  it('splits interest across the May 2026 repo-rate change', () => {
    const interest = calculateInterestAccrued(
      config.repoRateTimeline,
      365000,
      0,
      new Date('2026-05-28T00:00:00+02:00'),
      new Date('2026-05-30T00:00:00+02:00'),
    )

    expectCloseTo(interest, 137.5)
  })

  it('treats February 2026 as the first payment month after five grace month-ends', () => {
    expect(getFirstPaymentDueDate(config.property.registrationDate, config.agreement.graceMonths)).toBe('2026-02-28')
  })

  it('includes paid monthly instalments and the May 2026 rate change in the current balance', () => {
    const snapshot = getHarewoodDriveDebtSnapshot(config, {
      asOf: '2026-06-22',
      upcomingMonths: 1,
    })

    expect(snapshot.currentRepoRate).toBe(0.07)
    expectCloseTo(snapshot.currentInterestRate, 0.045)
    expect(snapshot.totals.totalPaid).toBe(14000)
    expect(snapshot.totals.principalRemaining).toBe(329113.37)
    expect(snapshot.totals.accruedInterestUnpaid).toBe(892.66)
    expect(snapshot.totals.outstandingBalance).toBe(330006.03)
  })

  it('calculates the 30 June 2026 payment row after the paid-through-May balance', () => {
    const interest = calculateInterestAccrued(
      config.repoRateTimeline,
      329113.37,
      config.agreement.interestMarginBelowRepo,
      new Date('2026-06-01T00:00:00+02:00'),
      new Date('2026-07-01T00:00:00+02:00'),
    )

    expect(Math.round((interest + Number.EPSILON) * 100) / 100).toBe(1217.27)
    expectCloseTo(3500 - 1217.27, 2282.73)
    expectCloseTo(329113.37 - 2282.73, 326830.64)
  })
})
