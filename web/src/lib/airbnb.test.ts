import { describe, expect, it } from 'vitest'
import {
  classifyAirbnbUnits,
  deriveAirbnbOverview,
  listCleaningMovements,
  parseAirbnbDashboardSnapshot,
  type AirbnbDashboardData,
  type AirbnbProperty,
  type AirbnbReservation,
} from './airbnb.js'

const properties: AirbnbProperty[] = [
  {
    id: 'unit-1',
    unitNumber: 1,
    listingName: 'Jasmine Studio Stay',
    commonName: 'Jasmine',
    facts: {},
    status: 'active',
  },
  {
    id: 'unit-2',
    unitNumber: 2,
    listingName: 'The Spekboom Studio',
    commonName: 'Spekboom',
    facts: {},
    status: 'active',
  },
  {
    id: 'unit-3',
    unitNumber: 3,
    listingName: 'Bougainvillea Courtyard Studio',
    commonName: 'Bougainvillea',
    facts: {},
    status: 'active',
  },
]

const reservation = (overrides: Partial<AirbnbReservation>): AirbnbReservation => ({
  id: 'reservation',
  propertyId: 'unit-1',
  confirmationCode: 'CONFIRMATION',
  guestName: 'Guest',
  checkIn: '2026-08-21',
  checkOut: '2026-08-23',
  adults: 1,
  children: 0,
  infants: 0,
  guestCountKnown: true,
  status: 'confirmed',
  sourceCutoffAt: '2026-08-20T12:00:00Z',
  ...overrides,
})

const dashboard = (overrides: Partial<AirbnbDashboardData>): AirbnbDashboardData => ({
  properties,
  reservations: [],
  guestThreads: [],
  cleanerPlans: [],
  inventory: [],
  orders: [],
  alerts: [],
  jobRuns: [],
  loadedAt: '2026-08-21T12:00:00Z',
  ...overrides,
})

describe('parseAirbnbDashboardSnapshot', () => {
  it('normalizes the mixed camel-case and inventory snake-case RPC payload', () => {
    const parsed = parseAirbnbDashboardSnapshot({
      properties: [{
        id: 'unit-1',
        unitNumber: 1,
        listingName: 'Jasmine Studio Stay',
        commonName: 'Jasmine',
        facts: { checkInTime: '15:00' },
        status: 'active',
      }],
      inventory: [{
        id: 'milk',
        sku: 'milk-1l',
        display_name: 'Milk',
        category: 'guest_supply',
        stock_unit: 'cartons',
        consumption_basis: 'per_stay',
        quantity_per_basis: '1',
        target_unit_price_cents: '2299',
        count_status: 'confirm',
        quantity_on_hand: '4',
      }],
      reservations: [{ invalid: true }],
      guestThreads: 'not-an-array',
    }, '2026-08-21T12:00:00Z')

    expect(parsed.properties.map((property) => property.commonName)).toEqual(['Jasmine'])
    expect(parsed.inventory).toEqual([{
      id: 'milk',
      sku: 'milk-1l',
      displayName: 'Milk',
      category: 'guest_supply',
      stockUnit: 'cartons',
      consumptionBasis: 'per_stay',
      quantityPerBasis: 1,
      targetUnitPriceCents: 2299,
      countStatus: 'confirm',
      lastCountedAt: null,
      quantityOnHand: 4,
      lastMovementAt: null,
    }])
    expect(parsed.reservations).toEqual([])
    expect(parsed.guestThreads).toEqual([])
  })
})

describe('classifyAirbnbUnits', () => {
  it('distinguishes turnover, stayover, and empty units for an operating day', () => {
    const states = classifyAirbnbUnits(dashboard({
      reservations: [
        reservation({ id: 'outgoing', checkIn: '2026-08-19', checkOut: '2026-08-21' }),
        reservation({ id: 'incoming', checkIn: '2026-08-21', checkOut: '2026-08-23' }),
        reservation({ id: 'stayover', propertyId: 'unit-2', checkIn: '2026-08-20', checkOut: '2026-08-22' }),
      ],
    }), '2026-08-21')

    expect(states.map((unit) => [unit.property.unitNumber, unit.state, unit.primaryReservation?.id])).toEqual([
      [1, 'turnover', 'incoming'],
      [2, 'stayover', 'stayover'],
      [3, 'empty', undefined],
    ])
  })

  it('surfaces impossible concurrent arrivals instead of presenting a normal clean', () => {
    const states = classifyAirbnbUnits(dashboard({
      reservations: [
        reservation({ id: 'arrival-a' }),
        reservation({ id: 'arrival-b', confirmationCode: 'SECOND' }),
      ],
    }), '2026-08-21')

    expect(states[0]?.state).toBe('conflict')
  })

  it('surfaces a checkout that overlaps another active stay', () => {
    const states = classifyAirbnbUnits(dashboard({
      reservations: [
        reservation({ id: 'checkout', checkIn: '2026-08-18', checkOut: '2026-08-21' }),
        reservation({ id: 'overlap', confirmationCode: 'OVERLAP', checkIn: '2026-08-20', checkOut: '2026-08-23' }),
      ],
    }), '2026-08-21')

    expect(states[0]?.state).toBe('conflict')
  })
})

describe('Airbnb operational summaries', () => {
  it('counts only actionable guest, stock, alert, and job states', () => {
    const data = dashboard({
      reservations: [
        reservation({ id: 'active' }),
        reservation({ id: 'future', checkIn: '2026-08-27', checkOut: '2026-08-29' }),
        reservation({ id: 'later', checkIn: '2026-09-10', checkOut: '2026-09-11' }),
      ],
      guestThreads: [
        { id: 'due', guestName: 'One', status: 'open', riskTier: 'low', lastGuestAt: '2026-08-21T10:00:00Z', lastHostAt: '2026-08-21T09:00:00Z', latestMessage: 'Question' },
        { id: 'handled', guestName: 'Two', status: 'open', riskTier: 'low', lastGuestAt: '2026-08-21T08:00:00Z', lastHostAt: '2026-08-21T09:00:00Z', latestMessage: 'Thanks' },
      ],
      inventory: [
        { id: 'milk', sku: 'milk', displayName: 'Milk', category: 'guest_supply', stockUnit: 'cartons', consumptionBasis: 'per_stay', quantityPerBasis: 1, targetUnitPriceCents: null, countStatus: 'confirm', lastCountedAt: null, quantityOnHand: 4, lastMovementAt: null },
        { id: 'coffee', sku: 'coffee', displayName: 'Coffee', category: 'guest_supply', stockUnit: 'jars', consumptionBasis: 'manual', quantityPerBasis: 0, targetUnitPriceCents: null, countStatus: 'confirmed', lastCountedAt: null, quantityOnHand: 2, lastMovementAt: null },
      ],
      alerts: [
        { id: 'open', type: 'guest_overdue', severity: 'warning', status: 'open', summary: 'Guest reply due', openedAt: null, notifiedAt: null },
        { id: 'resolved', type: 'order_update', severity: 'info', status: 'resolved', summary: 'Delivered', openedAt: null, notifiedAt: null },
      ],
      jobRuns: [
        { id: 'failed', service: 'cleaner', jobName: 'midday', status: 'error', targetDate: null, startedAt: null, completedAt: null, errorCode: 'MAILBOX' },
        { id: 'ok', service: 'stock', jobName: 'observe', status: 'success', targetDate: null, startedAt: null, completedAt: null, errorCode: null },
      ],
    })

    expect(deriveAirbnbOverview(data, '2026-08-21')).toEqual({
      arrivalsNextSevenDays: 2,
      activeStays: 1,
      guestRepliesDue: 1,
      openAlerts: 1,
      inventoryChecks: 1,
      failedJobs: 1,
    })
  })

  it('uses only the latest receipt for each worker job when counting failures', () => {
    const data = dashboard({
      jobRuns: [
        { id: 'old-failure', service: 'cleaner', jobName: 'midday', status: 'error', targetDate: null, startedAt: '2026-08-21T08:00:00Z', completedAt: '2026-08-21T08:01:00Z', errorCode: 'MAILBOX' },
        { id: 'recovered', service: 'cleaner', jobName: 'midday', status: 'success', targetDate: null, startedAt: '2026-08-21T10:00:00Z', completedAt: '2026-08-21T10:01:00Z', errorCode: null },
      ],
    })

    expect(deriveAirbnbOverview(data, '2026-08-21').failedJobs).toBe(0)
  })

  it('sorts upcoming arrivals and departures by day and unit', () => {
    const movements = listCleaningMovements(dashboard({
      reservations: [
        reservation({ id: 'unit-two', propertyId: 'unit-2', checkIn: '2026-08-22', checkOut: '2026-08-24' }),
        reservation({ id: 'unit-one', propertyId: 'unit-1', checkIn: '2026-08-22', checkOut: '2026-08-23' }),
      ],
    }), '2026-08-21', 7)

    expect(movements.map((movement) => `${movement.date}:${movement.property?.unitNumber}:${movement.kind}`)).toEqual([
      '2026-08-22:1:arrival',
      '2026-08-22:2:arrival',
      '2026-08-23:1:checkout',
      '2026-08-24:2:checkout',
    ])
  })
})
