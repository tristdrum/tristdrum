const MS_PER_DAY = 24 * 60 * 60 * 1000
const SAST_OFFSET = '+02:00'

export type RepoRateChange = {
  effectiveFrom: string
  repoRate: number
}

export type DebtPayment = {
  paidAt: string
  amount: number
  note?: string
}

export type HarewoodDriveDebtConfig = {
  schemaVersion: 1
  property: {
    label: string
    erf?: string
    registrationDate: string
  }
  parties?: {
    debtorDisplayName?: string
    creditorDisplayName?: string
  }
  agreement: {
    principal: number
    interestMarginBelowRepo: number
    graceMonths: number
    minimumMonthlyPayment: number
  }
  repoRateTimeline: RepoRateChange[]
  payments?: DebtPayment[]
}

export type DebtScheduleEntry = {
  dueDate: string
  paymentAmount: number
  interestCharged: number
  interestPortion: number
  principalPortion: number
  startingBalance: number
  endingBalance: number
}

export type HarewoodDriveDebtSnapshot = {
  asOf: string
  property: HarewoodDriveDebtConfig['property']
  parties?: HarewoodDriveDebtConfig['parties']
  agreement: {
    principal: number
    interestMarginBelowRepo: number
    graceMonths: number
    minimumMonthlyPayment: number
    firstPaymentDueDate: string
  }
  currentRepoRate: number
  currentInterestRate: number
  totals: {
    principalOriginal: number
    principalRemaining: number
    accruedInterestUnpaid: number
    totalInterestAccrued: number
    totalInterestPaid: number
    totalPrincipalPaid: number
    totalPaid: number
    outstandingBalance: number
  }
  status: {
    expectedPaidToDate: number
    actualPaidToDate: number
    arrears: number
    aheadBy: number
    firstOverdueDueDate: string | null
  }
  nextPayment: {
    dueDate: string | null
    amountDue: number | null
    minimumAmount: number | null
    interestChargedToDueDate: number | null
  }
  projection: {
    payoffDate: string | null
    paymentsRemaining: number
    totalInterestRemaining: number
    totalPaymentsRemaining: number
  }
  upcomingSchedule: DebtScheduleEntry[]
  repoRateTimeline: RepoRateChange[]
  assumptions: string[]
}

const roundToCents = (value: number) => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

const parseTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`)
  }
  return date
}

const parseSastDateStart = (dateOnly: string) => parseTimestamp(`${dateOnly}T00:00:00${SAST_OFFSET}`)

const parseSastDateEndExclusive = (dateOnly: string) =>
  new Date(parseSastDateStart(dateOnly).getTime() + MS_PER_DAY)

const asDateTime = (value: string, fallback: 'startOfDay' | 'endOfDay') => {
  if (isDateOnly(value)) {
    return fallback === 'endOfDay' ? parseSastDateEndExclusive(value) : parseSastDateStart(value)
  }
  return parseTimestamp(value)
}

const pad2 = (value: number) => String(value).padStart(2, '0')

const lastDayOfMonth = (year: number, month1Based: number) =>
  new Date(Date.UTC(year, month1Based, 0)).getUTCDate()

export const getFirstPaymentDueDate = (registrationDate: string, graceMonths: number) => {
  if (!isDateOnly(registrationDate)) {
    throw new Error(`registrationDate must be YYYY-MM-DD, got: ${registrationDate}`)
  }

  const [year, month] = registrationDate.split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error(`Invalid registrationDate: ${registrationDate}`)
  }

  const monthIndex = month - 1 + graceMonths + 1
  const dueYear = year + Math.floor(monthIndex / 12)
  const dueMonth = (monthIndex % 12) + 1
  const dueDay = lastDayOfMonth(dueYear, dueMonth)
  return `${dueYear}-${pad2(dueMonth)}-${pad2(dueDay)}`
}

export const validateHarewoodDriveDebtConfig = (raw: unknown): HarewoodDriveDebtConfig => {
  if (!isRecord(raw)) {
    throw new Error('Debt config must be an object')
  }

  if (raw.schemaVersion !== 1) {
    throw new Error('Debt config schemaVersion must be 1')
  }

  const property = raw.property
  const agreement = raw.agreement
  const repoRateTimeline = raw.repoRateTimeline
  const payments = raw.payments

  if (!isRecord(property) || typeof property.label !== 'string' || typeof property.registrationDate !== 'string') {
    throw new Error('Debt config property is invalid')
  }

  if (
    !isRecord(agreement) ||
    typeof agreement.principal !== 'number' ||
    typeof agreement.interestMarginBelowRepo !== 'number' ||
    typeof agreement.graceMonths !== 'number' ||
    typeof agreement.minimumMonthlyPayment !== 'number'
  ) {
    throw new Error('Debt config agreement is invalid')
  }

  if (!Array.isArray(repoRateTimeline) || repoRateTimeline.length === 0) {
    throw new Error('Debt config repoRateTimeline is required')
  }

  const parsedTimeline: RepoRateChange[] = repoRateTimeline.map((entry) => {
    if (!isRecord(entry) || typeof entry.effectiveFrom !== 'string' || typeof entry.repoRate !== 'number') {
      throw new Error('Debt config repoRateTimeline entry is invalid')
    }
    parseTimestamp(entry.effectiveFrom)
    return { effectiveFrom: entry.effectiveFrom, repoRate: entry.repoRate }
  })

  const parsedPayments: DebtPayment[] | undefined = payments
    ? (() => {
        if (!Array.isArray(payments)) {
          throw new Error('Debt config payments must be an array')
        }
        return payments.map((payment) => {
          if (!isRecord(payment) || typeof payment.paidAt !== 'string' || typeof payment.amount !== 'number') {
            throw new Error('Debt config payment is invalid')
          }
          return {
            paidAt: payment.paidAt,
            amount: payment.amount,
            note: typeof payment.note === 'string' ? payment.note : undefined,
          }
        })
      })()
    : undefined

  const parties = raw.parties
  const parsedParties = parties
    ? (() => {
        if (!isRecord(parties)) return undefined
        return {
          debtorDisplayName: typeof parties.debtorDisplayName === 'string' ? parties.debtorDisplayName : undefined,
          creditorDisplayName:
            typeof parties.creditorDisplayName === 'string' ? parties.creditorDisplayName : undefined,
        }
      })()
    : undefined

  return {
    schemaVersion: 1,
    property: {
      label: property.label,
      erf: typeof property.erf === 'string' ? property.erf : undefined,
      registrationDate: property.registrationDate,
    },
    parties: parsedParties,
    agreement: {
      principal: agreement.principal,
      interestMarginBelowRepo: agreement.interestMarginBelowRepo,
      graceMonths: agreement.graceMonths,
      minimumMonthlyPayment: agreement.minimumMonthlyPayment,
    },
    repoRateTimeline: parsedTimeline,
    payments: parsedPayments,
  }
}

const sortTimeline = (timeline: RepoRateChange[]) =>
  [...timeline]
    .map((entry) => ({ ...entry, effectiveFromDate: parseTimestamp(entry.effectiveFrom) }))
    .sort((a, b) => a.effectiveFromDate.getTime() - b.effectiveFromDate.getTime())

export const getRepoRateAt = (timeline: RepoRateChange[], at: Date) => {
  const sorted = sortTimeline(timeline)
  const atTime = at.getTime()

  let current: { repoRate: number; effectiveFromDate: Date } | null = null
  for (const entry of sorted) {
    if (entry.effectiveFromDate.getTime() <= atTime) {
      current = entry
      continue
    }
    break
  }

  if (!current) {
    throw new Error(`No repo rate defined for ${at.toISOString()}`)
  }

  return current.repoRate
}

export const calculateInterestAccrued = (
  timeline: RepoRateChange[],
  principalOutstanding: number,
  annualMarginBelowRepo: number,
  start: Date,
  end: Date,
) => {
  if (end.getTime() <= start.getTime()) return 0

  const sorted = sortTimeline(timeline)
  const startTime = start.getTime()
  const endTime = end.getTime()

  let interest = 0
  let cursor = start

  let rate = getRepoRateAt(timeline, start) - annualMarginBelowRepo
  if (!Number.isFinite(rate)) rate = 0

  const nextChanges = sorted.filter((entry) => entry.effectiveFromDate.getTime() > startTime)
  for (const entry of nextChanges) {
    const changeTime = entry.effectiveFromDate.getTime()
    if (changeTime >= endTime) break

    const segmentEnd = entry.effectiveFromDate
    const durationDays = (segmentEnd.getTime() - cursor.getTime()) / MS_PER_DAY
    interest += principalOutstanding * rate * (durationDays / 365)
    cursor = segmentEnd
    rate = entry.repoRate - annualMarginBelowRepo
  }

  const remainingDays = (end.getTime() - cursor.getTime()) / MS_PER_DAY
  interest += principalOutstanding * rate * (remainingDays / 365)
  return interest
}

const getDueDateByInstallmentIndex = (registrationDate: string, graceMonths: number, installmentIndex: number) => {
  const [year, month] = registrationDate.split('-').map((part) => Number(part))
  const monthIndex = month - 1 + graceMonths + installmentIndex
  const dueYear = year + Math.floor(monthIndex / 12)
  const dueMonth = (monthIndex % 12) + 1
  const dueDay = lastDayOfMonth(dueYear, dueMonth)
  return `${dueYear}-${pad2(dueMonth)}-${pad2(dueDay)}`
}

const applyPayment = (principalOutstanding: number, accruedInterestUnpaid: number, paymentAmount: number) => {
  let remainingPayment = paymentAmount

  const interestPortion = Math.min(accruedInterestUnpaid, remainingPayment)
  accruedInterestUnpaid -= interestPortion
  remainingPayment -= interestPortion

  const principalPortion = Math.min(principalOutstanding, remainingPayment)
  principalOutstanding -= principalPortion
  remainingPayment -= principalPortion

  return {
    principalOutstanding,
    accruedInterestUnpaid,
    interestPortion,
    principalPortion,
    unappliedRemainder: remainingPayment,
  }
}

const calculateExpectedPaidToDate = (config: HarewoodDriveDebtConfig, asOf: Date) => {
  const minPayment = config.agreement.minimumMonthlyPayment
  let expectedPaid = 0

  let installmentIndex = 1
  while (true) {
    const dueDate = getDueDateByInstallmentIndex(config.property.registrationDate, config.agreement.graceMonths, installmentIndex)
    const dueTime = parseSastDateEndExclusive(dueDate)
    if (dueTime.getTime() > asOf.getTime()) break
    expectedPaid += minPayment
    installmentIndex += 1
    if (installmentIndex > 600) break
  }

  return roundToCents(expectedPaid)
}

const findFirstOverdueDueDate = (config: HarewoodDriveDebtConfig, asOf: Date, actualPaid: number) => {
  const minPayment = config.agreement.minimumMonthlyPayment
  if (actualPaid >= calculateExpectedPaidToDate(config, asOf)) return null

  let remainingPaid = actualPaid
  let installmentIndex = 1
  while (true) {
    const dueDate = getDueDateByInstallmentIndex(config.property.registrationDate, config.agreement.graceMonths, installmentIndex)
    const dueTime = parseSastDateEndExclusive(dueDate)
    if (dueTime.getTime() > asOf.getTime()) break
    if (remainingPaid >= minPayment) {
      remainingPaid -= minPayment
    } else {
      return dueDate
    }
    installmentIndex += 1
    if (installmentIndex > 600) break
  }

  return null
}

const getNextDueDateInfo = (config: HarewoodDriveDebtConfig, asOf: Date) => {
  let installmentIndex = 1
  while (true) {
    const dueDate = getDueDateByInstallmentIndex(config.property.registrationDate, config.agreement.graceMonths, installmentIndex)
    const dueTime = parseSastDateEndExclusive(dueDate)
    if (dueTime.getTime() > asOf.getTime()) return { dueDate, installmentIndex }
    installmentIndex += 1
    if (installmentIndex > 600) break
  }

  return null
}

const buildUpcomingScheduleFromState = (params: {
  config: HarewoodDriveDebtConfig
  asOf: Date
  principalOutstanding: number
  accruedInterestUnpaid: number
  months: number
}) => {
  const { config, asOf, months } = params
  const minPayment = config.agreement.minimumMonthlyPayment
  const margin = config.agreement.interestMarginBelowRepo

  let principalOutstanding = params.principalOutstanding
  let accruedInterest = params.accruedInterestUnpaid
  let cursor = asOf

  const schedule: DebtScheduleEntry[] = []
  const next = getNextDueDateInfo(config, asOf)
  if (!next) return schedule

  for (let offset = 0; offset < months; offset += 1) {
    const dueDate = getDueDateByInstallmentIndex(
      config.property.registrationDate,
      config.agreement.graceMonths,
      next.installmentIndex + offset,
    )

    const dueTime = parseSastDateEndExclusive(dueDate)
    const interestForPeriod = calculateInterestAccrued(config.repoRateTimeline, principalOutstanding, margin, cursor, dueTime)
    const roundedInterestForPeriod = roundToCents(interestForPeriod)
    accruedInterest = roundToCents(accruedInterest + roundedInterestForPeriod)

    const startingBalance = roundToCents(principalOutstanding + accruedInterest)
    const paymentAmount = startingBalance <= minPayment ? startingBalance : minPayment

    const paymentResult = applyPayment(principalOutstanding, accruedInterest, paymentAmount)
    principalOutstanding = roundToCents(paymentResult.principalOutstanding)
    accruedInterest = roundToCents(paymentResult.accruedInterestUnpaid)

    const endingBalance = roundToCents(principalOutstanding + accruedInterest)
    schedule.push({
      dueDate,
      paymentAmount: roundToCents(paymentAmount),
      interestCharged: roundedInterestForPeriod,
      interestPortion: roundToCents(paymentResult.interestPortion),
      principalPortion: roundToCents(paymentResult.principalPortion),
      startingBalance,
      endingBalance,
    })

    cursor = dueTime
    if (endingBalance <= 0) break
  }

  return schedule
}

const projectToPayoffFromState = (params: {
  config: HarewoodDriveDebtConfig
  asOf: Date
  principalOutstanding: number
  accruedInterestUnpaid: number
  maxPayments?: number
}) => {
  const { config, asOf } = params
  const maxPayments = params.maxPayments ?? 600
  const minPayment = config.agreement.minimumMonthlyPayment
  const margin = config.agreement.interestMarginBelowRepo

  let principalOutstanding = params.principalOutstanding
  let accruedInterest = params.accruedInterestUnpaid
  let cursor = asOf

  let payoffDate: string | null = null
  let paymentsRemaining = 0
  let totalInterestRemaining = 0
  let totalPaymentsRemaining = 0

  if (roundToCents(principalOutstanding + accruedInterest) <= 0) {
    return {
      payoffDate,
      paymentsRemaining,
      totalInterestRemaining,
      totalPaymentsRemaining,
    }
  }

  const next = getNextDueDateInfo(config, asOf)
  if (!next) {
    return {
      payoffDate,
      paymentsRemaining,
      totalInterestRemaining,
      totalPaymentsRemaining,
    }
  }

  for (let i = 0; i < maxPayments; i += 1) {
    const dueDate = getDueDateByInstallmentIndex(config.property.registrationDate, config.agreement.graceMonths, next.installmentIndex + i)
    const dueTime = parseSastDateEndExclusive(dueDate)

    const interestForPeriod = calculateInterestAccrued(config.repoRateTimeline, principalOutstanding, margin, cursor, dueTime)
    const roundedInterestForPeriod = roundToCents(interestForPeriod)
    totalInterestRemaining = roundToCents(totalInterestRemaining + roundedInterestForPeriod)
    accruedInterest = roundToCents(accruedInterest + roundedInterestForPeriod)

    const balanceBeforePayment = roundToCents(principalOutstanding + accruedInterest)
    const paymentAmount = balanceBeforePayment <= minPayment ? balanceBeforePayment : minPayment

    const paymentResult = applyPayment(principalOutstanding, accruedInterest, paymentAmount)
    principalOutstanding = roundToCents(paymentResult.principalOutstanding)
    accruedInterest = roundToCents(paymentResult.accruedInterestUnpaid)

    totalPaymentsRemaining = roundToCents(totalPaymentsRemaining + paymentAmount)
    paymentsRemaining += 1
    payoffDate = dueDate
    cursor = dueTime

    if (roundToCents(principalOutstanding + accruedInterest) <= 0) break
  }

  return {
    payoffDate,
    paymentsRemaining,
    totalInterestRemaining,
    totalPaymentsRemaining,
  }
}

export const getHarewoodDriveDebtSnapshot = (
  config: HarewoodDriveDebtConfig,
  options?: { asOf?: string; upcomingMonths?: number },
): HarewoodDriveDebtSnapshot => {
  const validated = validateHarewoodDriveDebtConfig(config)
  const upcomingMonths = options?.upcomingMonths ?? 12
  const asOf = options?.asOf ? asDateTime(options.asOf, 'endOfDay') : new Date()

  const registrationStart = parseSastDateStart(validated.property.registrationDate)
  if (asOf.getTime() < registrationStart.getTime()) {
    throw new Error('asOf cannot be before registrationDate')
  }

  const sortedPayments = (validated.payments ?? [])
    .map((payment) => ({ ...payment, paidAtDate: asDateTime(payment.paidAt, 'endOfDay') }))
    .sort((a, b) => a.paidAtDate.getTime() - b.paidAtDate.getTime())

  let principalOutstanding = validated.agreement.principal
  let accruedInterestUnpaid = 0
  let totalInterestAccrued = 0
  let totalInterestPaid = 0
  let totalPrincipalPaid = 0
  let cursor = registrationStart

  let actualPaidToDate = 0

  for (const payment of sortedPayments) {
    if (payment.paidAtDate.getTime() > asOf.getTime()) break
    if (payment.amount <= 0) continue

    const interestForPeriod = calculateInterestAccrued(
      validated.repoRateTimeline,
      principalOutstanding,
      validated.agreement.interestMarginBelowRepo,
      cursor,
      payment.paidAtDate,
    )
    const roundedInterestForPeriod = roundToCents(interestForPeriod)
    totalInterestAccrued = roundToCents(totalInterestAccrued + roundedInterestForPeriod)
    accruedInterestUnpaid = roundToCents(accruedInterestUnpaid + roundedInterestForPeriod)

    const paymentAmount = roundToCents(payment.amount)
    const result = applyPayment(principalOutstanding, accruedInterestUnpaid, paymentAmount)
    principalOutstanding = roundToCents(result.principalOutstanding)
    accruedInterestUnpaid = roundToCents(result.accruedInterestUnpaid)

    totalInterestPaid = roundToCents(totalInterestPaid + result.interestPortion)
    totalPrincipalPaid = roundToCents(totalPrincipalPaid + result.principalPortion)
    actualPaidToDate = roundToCents(actualPaidToDate + paymentAmount)

    cursor = payment.paidAtDate

    if (principalOutstanding <= 0 && accruedInterestUnpaid <= 0) break
  }

  const interestToAsOf = calculateInterestAccrued(
    validated.repoRateTimeline,
    principalOutstanding,
    validated.agreement.interestMarginBelowRepo,
    cursor,
    asOf,
  )
  const roundedInterestToAsOf = roundToCents(interestToAsOf)
  totalInterestAccrued = roundToCents(totalInterestAccrued + roundedInterestToAsOf)
  accruedInterestUnpaid = roundToCents(accruedInterestUnpaid + roundedInterestToAsOf)

  const currentRepoRate = getRepoRateAt(validated.repoRateTimeline, asOf)
  const currentInterestRate = currentRepoRate - validated.agreement.interestMarginBelowRepo

  const expectedPaidToDate = calculateExpectedPaidToDate(validated, asOf)
  const arrears = roundToCents(Math.max(0, expectedPaidToDate - actualPaidToDate))
  const aheadBy = roundToCents(Math.max(0, actualPaidToDate - expectedPaidToDate))

  const outstandingBalance = roundToCents(principalOutstanding + accruedInterestUnpaid)
  const firstPaymentDueDate = getFirstPaymentDueDate(validated.property.registrationDate, validated.agreement.graceMonths)

  const schedule =
    outstandingBalance > 0
      ? buildUpcomingScheduleFromState({
          config: validated,
          asOf,
          principalOutstanding,
          accruedInterestUnpaid,
          months: upcomingMonths,
        })
      : []

  const firstOverdueDueDate = findFirstOverdueDueDate(validated, asOf, actualPaidToDate)
  const projection = projectToPayoffFromState({
    config: validated,
    asOf,
    principalOutstanding,
    accruedInterestUnpaid,
  })

  const nextPaymentEntry = schedule[0]

  const assumptions = [
    'Interest accrues daily using ACT/365, based on the repo rate timeline provided.',
    'Payments are applied to accrued interest first, then capital.',
    'Due dates are treated as the last calendar day of each month, with the first instalment due after the grace period.',
    'Future projections assume the last known repo rate continues until you add a new change in the JSON.',
  ]

  return {
    asOf: asOf.toISOString(),
    property: validated.property,
    parties: validated.parties,
    agreement: {
      ...validated.agreement,
      firstPaymentDueDate,
    },
    currentRepoRate,
    currentInterestRate,
    totals: {
      principalOriginal: roundToCents(validated.agreement.principal),
      principalRemaining: roundToCents(principalOutstanding),
      accruedInterestUnpaid: roundToCents(accruedInterestUnpaid),
      totalInterestAccrued: roundToCents(totalInterestAccrued),
      totalInterestPaid: roundToCents(totalInterestPaid),
      totalPrincipalPaid: roundToCents(totalPrincipalPaid),
      totalPaid: roundToCents(actualPaidToDate),
      outstandingBalance,
    },
    status: {
      expectedPaidToDate,
      actualPaidToDate,
      arrears,
      aheadBy,
      firstOverdueDueDate,
    },
    nextPayment: {
      dueDate: nextPaymentEntry?.dueDate ?? null,
      amountDue: nextPaymentEntry ? roundToCents(nextPaymentEntry.paymentAmount) : null,
      minimumAmount: nextPaymentEntry ? roundToCents(validated.agreement.minimumMonthlyPayment) : null,
      interestChargedToDueDate: nextPaymentEntry ? roundToCents(nextPaymentEntry.interestCharged) : null,
    },
    projection,
    upcomingSchedule: schedule,
    repoRateTimeline: validated.repoRateTimeline,
    assumptions,
  }
}

