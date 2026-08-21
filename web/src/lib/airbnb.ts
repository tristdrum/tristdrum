export type AirbnbProperty = {
  id: string
  unitNumber: number
  listingName: string
  commonName: string
  facts: Record<string, unknown>
  status: string
}

export type AirbnbReservation = {
  id: string
  propertyId: string
  confirmationCode: string
  guestName: string | null
  checkIn: string
  checkOut: string
  adults: number
  children: number
  infants: number
  guestCountKnown: boolean
  status: string
  sourceCutoffAt: string | null
}

export type AirbnbGuestThread = {
  id: string
  guestName: string | null
  status: string
  riskTier: string
  lastGuestAt: string | null
  lastHostAt: string | null
  latestMessage: string | null
}

export type AirbnbCleanerPlan = {
  id: string
  targetDate: string
  status: string
  isUpdate: boolean
  unitStates: unknown[]
  confidence: Record<string, unknown>
  startedAt: string | null
  completedAt: string | null
}

export type AirbnbInventoryItem = {
  id: string
  sku: string
  displayName: string
  category: string
  stockUnit: string
  consumptionBasis: string
  quantityPerBasis: number
  targetUnitPriceCents: number | null
  countStatus: string
  lastCountedAt: string | null
  quantityOnHand: number
  lastMovementAt: string | null
}

export type AirbnbOrder = {
  id: string
  providerOrderId: string | null
  status: string
  totalCents: number | null
  addressStatus: string
  deliveryDueAt: string | null
  orderedAt: string | null
}

export type AirbnbAlert = {
  id: string
  type: string
  severity: string
  status: string
  summary: string
  openedAt: string | null
  notifiedAt: string | null
}

export type AirbnbJobRun = {
  id: string
  service: string
  jobName: string
  status: string
  targetDate: string | null
  startedAt: string | null
  completedAt: string | null
  errorCode: string | null
}

export type AirbnbDashboardData = {
  properties: AirbnbProperty[]
  reservations: AirbnbReservation[]
  guestThreads: AirbnbGuestThread[]
  cleanerPlans: AirbnbCleanerPlan[]
  inventory: AirbnbInventoryItem[]
  orders: AirbnbOrder[]
  alerts: AirbnbAlert[]
  jobRuns: AirbnbJobRun[]
  loadedAt: string
}

export type AirbnbUnitState = 'empty' | 'stayover' | 'arrival' | 'checkout' | 'turnover' | 'conflict'

export type AirbnbUnitDay = {
  property: AirbnbProperty
  state: AirbnbUnitState
  primaryReservation: AirbnbReservation | null
  outgoingReservation: AirbnbReservation | null
}

export type AirbnbOverview = {
  arrivalsNextSevenDays: number
  activeStays: number
  guestRepliesDue: number
  openAlerts: number
  inventoryChecks: number
  failedJobs: number
}

export type AirbnbCleaningMovement = {
  id: string
  date: string
  property: AirbnbProperty | null
  kind: 'arrival' | 'checkout'
  reservation: AirbnbReservation
}

export function parseAirbnbDashboardSnapshot(
  value: unknown,
  loadedAt = new Date().toISOString(),
): AirbnbDashboardData {
  const snapshot = asRecord(value)

  return {
    properties: readRows(snapshot.properties, parseProperty),
    reservations: readRows(snapshot.reservations, parseReservation),
    guestThreads: readRows(snapshot.guestThreads, parseGuestThread),
    cleanerPlans: readRows(snapshot.cleanerPlans, parseCleanerPlan),
    inventory: readRows(snapshot.inventory, parseInventoryItem),
    orders: readRows(snapshot.orders, parseOrder),
    alerts: readRows(snapshot.alerts, parseAlert),
    jobRuns: readRows(snapshot.jobRuns, parseJobRun),
    loadedAt,
  }
}

export function deriveAirbnbOverview(data: AirbnbDashboardData, today: string): AirbnbOverview {
  const weekEnd = addDays(today, 6)
  const confirmed = data.reservations.filter((reservation) => reservation.status === 'confirmed')

  return {
    arrivalsNextSevenDays: confirmed.filter(
      (reservation) => reservation.checkIn >= today && reservation.checkIn <= weekEnd,
    ).length,
    activeStays: confirmed.filter(
      (reservation) => reservation.checkIn <= today && reservation.checkOut > today,
    ).length,
    guestRepliesDue: data.guestThreads.filter(isGuestReplyDue).length,
    openAlerts: data.alerts.filter((alert) => alert.status === 'open' || alert.status === 'notified').length,
    inventoryChecks: data.inventory.filter(
      (item) => item.countStatus !== 'confirmed' || item.quantityOnHand <= 0,
    ).length,
    failedJobs: latestJobRuns(data.jobRuns).filter((run) => run.status === 'error' || run.status === 'blocked').length,
  }
}

export function classifyAirbnbUnits(
  data: Pick<AirbnbDashboardData, 'properties' | 'reservations'>,
  date: string,
): AirbnbUnitDay[] {
  const confirmed = data.reservations.filter((reservation) => reservation.status === 'confirmed')

  return data.properties
    .filter((property) => property.status === 'active')
    .sort((left, right) => left.unitNumber - right.unitNumber)
    .map((property) => {
      const reservations = confirmed.filter((reservation) => reservation.propertyId === property.id)
      const arrivals = reservations.filter((reservation) => reservation.checkIn === date)
      const checkouts = reservations.filter((reservation) => reservation.checkOut === date)
      const stayovers = reservations.filter(
        (reservation) => reservation.checkIn < date && reservation.checkOut > date,
      )

      if (arrivals.length > 1 || checkouts.length > 1 || stayovers.length > 1 || (stayovers.length > 0 && (arrivals.length > 0 || checkouts.length > 0))) {
        return {
          property,
          state: 'conflict' as const,
          primaryReservation: arrivals[0] ?? stayovers[0] ?? checkouts[0] ?? null,
          outgoingReservation: checkouts[0] ?? null,
        }
      }

      if (arrivals.length === 1 && checkouts.length === 1) {
        return {
          property,
          state: 'turnover' as const,
          primaryReservation: arrivals[0],
          outgoingReservation: checkouts[0],
        }
      }

      if (arrivals.length === 1) {
        return { property, state: 'arrival' as const, primaryReservation: arrivals[0], outgoingReservation: null }
      }

      if (checkouts.length === 1) {
        return { property, state: 'checkout' as const, primaryReservation: checkouts[0], outgoingReservation: checkouts[0] }
      }

      if (stayovers.length === 1) {
        return { property, state: 'stayover' as const, primaryReservation: stayovers[0], outgoingReservation: null }
      }

      return { property, state: 'empty' as const, primaryReservation: null, outgoingReservation: null }
    })
}

export function listCleaningMovements(
  data: Pick<AirbnbDashboardData, 'properties' | 'reservations'>,
  fromDate: string,
  days = 14,
): AirbnbCleaningMovement[] {
  const untilDate = addDays(fromDate, Math.max(0, days - 1))
  const propertyById = new Map(data.properties.map((property) => [property.id, property]))

  return data.reservations
    .filter((reservation) => reservation.status === 'confirmed')
    .flatMap((reservation): AirbnbCleaningMovement[] => {
      const movements: AirbnbCleaningMovement[] = []
      if (reservation.checkIn >= fromDate && reservation.checkIn <= untilDate) {
        movements.push({
          id: `${reservation.id}:arrival`,
          date: reservation.checkIn,
          property: propertyById.get(reservation.propertyId) ?? null,
          kind: 'arrival',
          reservation,
        })
      }
      if (reservation.checkOut >= fromDate && reservation.checkOut <= untilDate) {
        movements.push({
          id: `${reservation.id}:checkout`,
          date: reservation.checkOut,
          property: propertyById.get(reservation.propertyId) ?? null,
          kind: 'checkout',
          reservation,
        })
      }
      return movements
    })
    .sort((left, right) => left.date.localeCompare(right.date)
      || (left.property?.unitNumber ?? 999) - (right.property?.unitNumber ?? 999)
      || left.kind.localeCompare(right.kind))
}

export function isGuestReplyDue(thread: AirbnbGuestThread): boolean {
  if (thread.status !== 'open' && thread.status !== 'needs_human') return false
  if (!thread.lastGuestAt) return false
  if (!thread.lastHostAt) return true
  return Date.parse(thread.lastGuestAt) > Date.parse(thread.lastHostAt)
}

export function todayInJohannesburg(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function formatAirbnbDate(value: string | null, includeWeekday = false): string {
  if (!value) return 'Not recorded'
  const timestamp = Date.parse(`${value.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(timestamp)) return value

  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: includeWeekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp))
}

export function formatAirbnbDateTime(value: string | null): string {
  if (!value) return 'Not recorded'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value

  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

export function formatZar(cents: number | null): string {
  if (cents === null) return 'Not recorded'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatGuestCount(reservation: AirbnbReservation | null): string {
  if (!reservation) return 'No guest'
  if (!reservation.guestCountKnown) return 'Guest count to confirm'
  const total = reservation.adults + reservation.children
  const guestLabel = total === 1 ? 'guest' : 'guests'
  return reservation.infants > 0
    ? `${total} ${guestLabel}, ${reservation.infants} ${reservation.infants === 1 ? 'infant' : 'infants'}`
    : `${total} ${guestLabel}`
}

export function humanizeAirbnbValue(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function parseProperty(value: unknown): AirbnbProperty | null {
  const row = asRecord(value)
  const id = readString(row.id)
  const unitNumber = readNumber(row.unitNumber)
  if (!id || unitNumber === null) return null

  return {
    id,
    unitNumber,
    listingName: readString(row.listingName) ?? `Unit ${unitNumber}`,
    commonName: readString(row.commonName) ?? `Unit ${unitNumber}`,
    facts: asRecord(row.facts),
    status: readString(row.status) ?? 'active',
  }
}

function parseReservation(value: unknown): AirbnbReservation | null {
  const row = asRecord(value)
  const id = readString(row.id)
  const propertyId = readString(row.propertyId)
  const confirmationCode = readString(row.confirmationCode)
  const checkIn = readDate(row.checkIn)
  const checkOut = readDate(row.checkOut)
  if (!id || !propertyId || !confirmationCode || !checkIn || !checkOut) return null

  return {
    id,
    propertyId,
    confirmationCode,
    guestName: readString(row.guestName),
    checkIn,
    checkOut,
    adults: readNumber(row.adults) ?? 0,
    children: readNumber(row.children) ?? 0,
    infants: readNumber(row.infants) ?? 0,
    guestCountKnown: readBoolean(row.guestCountKnown, true),
    status: readString(row.status) ?? 'confirmed',
    sourceCutoffAt: readString(row.sourceCutoffAt),
  }
}

function parseGuestThread(value: unknown): AirbnbGuestThread | null {
  const row = asRecord(value)
  const id = readString(row.id)
  if (!id) return null

  return {
    id,
    guestName: readString(row.guestName),
    status: readString(row.status) ?? 'open',
    riskTier: readString(row.riskTier) ?? 'unknown',
    lastGuestAt: readString(row.lastGuestAt),
    lastHostAt: readString(row.lastHostAt),
    latestMessage: readString(row.latestMessage),
  }
}

function parseCleanerPlan(value: unknown): AirbnbCleanerPlan | null {
  const row = asRecord(value)
  const id = readString(row.id)
  const targetDate = readDate(row.targetDate)
  if (!id || !targetDate) return null

  return {
    id,
    targetDate,
    status: readString(row.status) ?? 'error',
    isUpdate: readBoolean(row.isUpdate, false),
    unitStates: Array.isArray(row.unitStates) ? row.unitStates : [],
    confidence: asRecord(row.confidence),
    startedAt: readString(row.startedAt),
    completedAt: readString(row.completedAt),
  }
}

function parseInventoryItem(value: unknown): AirbnbInventoryItem | null {
  const row = asRecord(value)
  const id = readString(row.id)
  const sku = readString(row.sku)
  if (!id || !sku) return null

  return {
    id,
    sku,
    displayName: readString(row.display_name) ?? sku,
    category: readString(row.category) ?? 'guest_supply',
    stockUnit: readString(row.stock_unit) ?? 'units',
    consumptionBasis: readString(row.consumption_basis) ?? 'manual',
    quantityPerBasis: readNumber(row.quantity_per_basis) ?? 0,
    targetUnitPriceCents: readNumber(row.target_unit_price_cents),
    countStatus: readString(row.count_status) ?? 'confirm',
    lastCountedAt: readString(row.last_counted_at),
    quantityOnHand: readNumber(row.quantity_on_hand) ?? 0,
    lastMovementAt: readString(row.last_movement_at),
  }
}

function parseOrder(value: unknown): AirbnbOrder | null {
  const row = asRecord(value)
  const id = readString(row.id)
  if (!id) return null

  return {
    id,
    providerOrderId: readString(row.providerOrderId),
    status: readString(row.status) ?? 'suggested',
    totalCents: readNumber(row.totalCents),
    addressStatus: readString(row.addressStatus) ?? 'unknown',
    deliveryDueAt: readString(row.deliveryDueAt),
    orderedAt: readString(row.orderedAt),
  }
}

function parseAlert(value: unknown): AirbnbAlert | null {
  const row = asRecord(value)
  const id = readString(row.id)
  const summary = readString(row.summary)
  if (!id || !summary) return null

  return {
    id,
    type: readString(row.type) ?? 'unknown',
    severity: readString(row.severity) ?? 'warning',
    status: readString(row.status) ?? 'open',
    summary,
    openedAt: readString(row.openedAt),
    notifiedAt: readString(row.notifiedAt),
  }
}

function parseJobRun(value: unknown): AirbnbJobRun | null {
  const row = asRecord(value)
  const id = readString(row.id)
  if (!id) return null

  return {
    id,
    service: readString(row.service) ?? 'unknown',
    jobName: readString(row.jobName) ?? 'Unknown job',
    status: readString(row.status) ?? 'error',
    targetDate: readDate(row.targetDate),
    startedAt: readString(row.startedAt),
    completedAt: readString(row.completedAt),
    errorCode: readString(row.errorCode),
  }
}

function readRows<T>(value: unknown, parse: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.map(parse).filter((row): row is T => row !== null)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readDate(value: unknown): string | null {
  const date = readString(value)
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function readNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(numeric) ? numeric : null
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function latestJobRuns(jobRuns: AirbnbJobRun[]): AirbnbJobRun[] {
  const latestByJob = new Map<string, AirbnbJobRun>()

  for (const run of jobRuns) {
    const key = `${run.service}:${run.jobName}`
    const current = latestByJob.get(key)
    if (!current || sortableTimestamp(run.startedAt) > sortableTimestamp(current.startedAt)) {
      latestByJob.set(key, run)
    }
  }

  return [...latestByJob.values()]
}

function sortableTimestamp(value: string | null): number {
  const timestamp = Date.parse(value ?? '')
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}
