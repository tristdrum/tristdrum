import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Activity,
  AlertTriangle,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  House,
  LayoutDashboard,
  MessageSquareText,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFinanceAccess } from '../auth/useFinanceAccess'
import {
  classifyAirbnbUnits,
  deriveAirbnbOverview,
  formatAirbnbDate,
  formatAirbnbDateTime,
  formatGuestCount,
  formatZar,
  humanizeAirbnbValue,
  isGuestReplyDue,
  listCleaningMovements,
  todayInJohannesburg,
  type AirbnbAlert,
  type AirbnbCleanerPlan,
  type AirbnbDashboardData,
  type AirbnbGuestThread,
  type AirbnbInventoryItem,
  type AirbnbJobRun,
  type AirbnbOrder,
  type AirbnbProperty,
  type AirbnbReservation,
  type AirbnbUnitDay,
} from '../lib/airbnb'
import { loadAirbnbDashboard } from '../lib/airbnbQueries'
import './AirbnbManagementPage.css'

type AirbnbSection = 'overview' | 'guests' | 'cleaning' | 'stock' | 'system'
type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

const sections: Array<{ id: AirbnbSection; label: string; icon: Icon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'guests', label: 'Guests', icon: MessageSquareText },
  { id: 'cleaning', label: 'Cleaning', icon: Sparkles },
  { id: 'stock', label: 'Stock & Orders', icon: PackageSearch },
  { id: 'system', label: 'System', icon: Activity },
]

export default function AirbnbManagementPage() {
  const membership = useFinanceAccess()
  const [activeSection, setActiveSection] = useState<AirbnbSection>('overview')
  const [data, setData] = useState<AirbnbDashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(true)
  const today = todayInJohannesburg()

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const snapshot = await loadAirbnbDashboard(membership.householdId)
      setData(snapshot)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The Airbnb management snapshot could not be loaded.')
    } finally {
      setRefreshing(false)
    }
  }, [membership.householdId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const overview = useMemo(
    () => data ? deriveAirbnbOverview(data, today) : null,
    [data, today],
  )

  const isEmpty = data ? snapshotIsEmpty(data) : false

  return (
    <main className="airbnb-page">
      <div className="airbnb-shell">
        <header className="airbnb-header">
          <div>
            <div className="airbnb-breadcrumbs">
              <Link to="/dashboard">Dashboard</Link>
              <span aria-hidden="true">/</span>
              <span>Airbnb management</span>
            </div>
            <p className="airbnb-eyebrow">Private household operations</p>
            <h1>Airbnb management</h1>
            <p className="airbnb-intro">Guests, cleaning, supplies, orders, and worker health for the three Nahoon studios.</p>
          </div>
          <div className="airbnb-header-meta">
            <span className="airbnb-role">{membership.role}</span>
            <span>{membership.householdName}</span>
            <span>{data ? `Updated ${formatAirbnbDateTime(data.loadedAt)}` : 'Waiting for snapshot'}</span>
            <button
              type="button"
              className="airbnb-icon-button"
              onClick={() => void refresh()}
              disabled={refreshing}
              title="Refresh Airbnb data"
              aria-label="Refresh Airbnb data"
            >
              <RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} aria-hidden />
            </button>
          </div>
        </header>

        <nav className="airbnb-tabs" aria-label="Airbnb management sections" role="tablist">
          {sections.map((section) => {
            const SectionIcon = section.icon
            const count = section.id === 'guests'
              ? overview?.guestRepliesDue
              : section.id === 'system'
                ? (overview?.openAlerts ?? 0) + (overview?.failedJobs ?? 0)
                : section.id === 'stock'
                  ? overview?.inventoryChecks
                  : null

            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeSection === section.id}
                className={activeSection === section.id ? 'is-active' : ''}
                onClick={() => setActiveSection(section.id)}
              >
                <SectionIcon size={16} strokeWidth={1.8} aria-hidden />
                <span>{section.label}</span>
                {count ? <strong>{count}</strong> : null}
              </button>
            )
          })}
        </nav>

        {error ? (
          <section className="airbnb-notice airbnb-notice--error" role="alert">
            <CircleAlert size={20} aria-hidden />
            <div>
              <strong>Airbnb data is unavailable.</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => void refresh()} disabled={refreshing}>Try again</button>
          </section>
        ) : null}

        {!data && refreshing ? <AirbnbLoadingState /> : null}

        {data && isEmpty ? (
          <EmptyState
            icon={House}
            title="No Airbnb operations have synced yet"
            copy="The workspace is ready. Reservations, cleaner runs, guest messages, stock, and orders will appear after the workers record their first snapshot."
          />
        ) : null}

        {data && !isEmpty && overview ? (
          <div role="tabpanel" aria-label={sections.find((section) => section.id === activeSection)?.label}>
            {activeSection === 'overview' ? <OverviewSection data={data} overview={overview} today={today} /> : null}
            {activeSection === 'guests' ? <GuestsSection data={data} today={today} /> : null}
            {activeSection === 'cleaning' ? <CleaningSection data={data} today={today} /> : null}
            {activeSection === 'stock' ? <StockSection inventory={data.inventory} orders={data.orders} /> : null}
            {activeSection === 'system' ? <SystemSection alerts={data.alerts} jobRuns={data.jobRuns} /> : null}
          </div>
        ) : null}
      </div>
    </main>
  )
}

function OverviewSection({
  data,
  overview,
  today,
}: {
  data: AirbnbDashboardData
  overview: ReturnType<typeof deriveAirbnbOverview>
  today: string
}) {
  const units = classifyAirbnbUnits(data, today)
  const activeAlerts = data.alerts.filter((alert) => alert.status === 'open' || alert.status === 'notified').slice(0, 5)
  const latestPlan = data.cleanerPlans[0] ?? null

  return (
    <div className="airbnb-stack">
      <section className="airbnb-metrics" aria-label="Airbnb operating summary">
        <Metric icon={CalendarDays} label="Arrivals next 7 days" value={overview.arrivalsNextSevenDays} />
        <Metric icon={BedDouble} label="Occupied today" value={overview.activeStays} />
        <Metric icon={MessageSquareText} label="Guest replies due" value={overview.guestRepliesDue} tone={overview.guestRepliesDue ? 'warning' : 'positive'} />
        <Metric icon={PackageSearch} label="Stock checks" value={overview.inventoryChecks} tone={overview.inventoryChecks ? 'warning' : 'positive'} />
        <Metric icon={AlertTriangle} label="Open alerts" value={overview.openAlerts} tone={overview.openAlerts ? 'danger' : 'positive'} />
      </section>

      <div className="airbnb-two-column airbnb-two-column--wide">
        <section className="airbnb-panel">
          <PanelHeading eyebrow={formatAirbnbDate(today, true)} title="Today's units" />
          {units.length ? (
            <div className="airbnb-unit-list">
              {units.map((unit) => <UnitRow key={unit.property.id} unit={unit} />)}
            </div>
          ) : (
            <InlineEmpty>No active studio records are available.</InlineEmpty>
          )}
        </section>

        <section className="airbnb-panel">
          <PanelHeading eyebrow="Cleaner automation" title="Latest plan" />
          {latestPlan ? <CleanerPlanSummary plan={latestPlan} /> : <InlineEmpty>No cleaner plan has been recorded yet.</InlineEmpty>}
        </section>
      </div>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Attention" title="Open operational alerts" />
        {activeAlerts.length ? (
          <div className="airbnb-table-list">
            {activeAlerts.map((alert) => (
              <div className="airbnb-row airbnb-row--alert" key={alert.id}>
                <StatusBadge value={alert.severity} />
                <div className="airbnb-row-primary">
                  <strong>{alert.summary}</strong>
                  <span>{humanizeAirbnbValue(alert.type)}</span>
                </div>
                <span>{formatAirbnbDateTime(alert.openedAt)}</span>
                <StatusBadge value={alert.status} />
              </div>
            ))}
          </div>
        ) : (
          <InlineEmpty icon={CheckCircle2}>No open alerts. The current snapshot has no recorded operational exceptions.</InlineEmpty>
        )}
      </section>
    </div>
  )
}

function GuestsSection({ data, today }: { data: AirbnbDashboardData; today: string }) {
  const threads = [...data.guestThreads].sort((left, right) => {
    const dueDifference = Number(isGuestReplyDue(right)) - Number(isGuestReplyDue(left))
    return dueDifference || Date.parse(right.lastGuestAt ?? right.lastHostAt ?? '') - Date.parse(left.lastGuestAt ?? left.lastHostAt ?? '')
  })
  const propertyById = new Map(data.properties.map((property) => [property.id, property]))
  const upcoming = data.reservations
    .filter((reservation) => reservation.status === 'confirmed' && reservation.checkOut >= today)
    .sort((left, right) => left.checkIn.localeCompare(right.checkIn) || left.propertyId.localeCompare(right.propertyId))
    .slice(0, 30)

  return (
    <div className="airbnb-stack">
      <section className="airbnb-panel">
        <PanelHeading eyebrow="Conversation monitor" title="Guest threads" />
        {threads.length ? (
          <div className="airbnb-table-list">
            {threads.map((thread) => <GuestThreadRow key={thread.id} thread={thread} />)}
          </div>
        ) : (
          <InlineEmpty>No Airbnb guest conversations have synced yet.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Confirmed only" title="Current and upcoming stays" />
        {upcoming.length ? (
          <div className="airbnb-table-list">
            {upcoming.map((reservation) => (
              <ReservationRow
                key={reservation.id}
                reservation={reservation}
                property={propertyById.get(reservation.propertyId) ?? null}
              />
            ))}
          </div>
        ) : (
          <InlineEmpty>No current or upcoming confirmed reservations are in this snapshot.</InlineEmpty>
        )}
      </section>
    </div>
  )
}

function CleaningSection({ data, today }: { data: AirbnbDashboardData; today: string }) {
  const movements = listCleaningMovements(data, today, 14)

  return (
    <div className="airbnb-two-column airbnb-two-column--equal">
      <section className="airbnb-panel">
        <PanelHeading eyebrow="Next 14 days" title="Arrivals and checkouts" />
        {movements.length ? (
          <div className="airbnb-table-list">
            {movements.map((movement) => (
              <div className="airbnb-row airbnb-row--movement" key={movement.id}>
                <div className="airbnb-date-block">
                  <strong>{formatAirbnbDate(movement.date, true)}</strong>
                  <span>{movement.kind === 'arrival' ? 'Check-in' : 'Checkout'}</span>
                </div>
                <div className="airbnb-row-primary">
                  <strong>{movement.property ? `Unit ${movement.property.unitNumber}: ${movement.property.commonName}` : 'Unknown unit'}</strong>
                  <span>{movement.reservation.guestName ?? 'Guest name to confirm'} · {formatGuestCount(movement.reservation)}</span>
                </div>
                <StatusBadge value={movement.kind} />
              </div>
            ))}
          </div>
        ) : (
          <InlineEmpty>No arrivals or checkouts are recorded for the next 14 days.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Delivery history" title="Cleaner plans" />
        {data.cleanerPlans.length ? (
          <div className="airbnb-table-list">
            {data.cleanerPlans.map((plan) => (
              <div className="airbnb-row airbnb-row--plan" key={plan.id}>
                <div className="airbnb-date-block">
                  <strong>{formatAirbnbDate(plan.targetDate, true)}</strong>
                  <span>{plan.isUpdate ? 'Updated plan' : 'Scheduled plan'}</span>
                </div>
                <div className="airbnb-row-primary">
                  <strong>{summarizePlanUnits(plan)}</strong>
                  <span>Completed {formatAirbnbDateTime(plan.completedAt)}</span>
                </div>
                <StatusBadge value={plan.status} />
                <ConfidenceBadge plan={plan} />
              </div>
            ))}
          </div>
        ) : (
          <InlineEmpty>No cleaner plan receipts have synced yet.</InlineEmpty>
        )}
      </section>
    </div>
  )
}

function StockSection({ inventory, orders }: { inventory: AirbnbInventoryItem[]; orders: AirbnbOrder[] }) {
  const sortedInventory = [...inventory].sort((left, right) => {
    const leftNeedsCount = Number(left.countStatus !== 'confirmed' || left.quantityOnHand <= 0)
    const rightNeedsCount = Number(right.countStatus !== 'confirmed' || right.quantityOnHand <= 0)
    return rightNeedsCount - leftNeedsCount || left.category.localeCompare(right.category) || left.displayName.localeCompare(right.displayName)
  })

  return (
    <div className="airbnb-stack">
      <section className="airbnb-panel">
        <PanelHeading eyebrow="Current evidence" title="Inventory" />
        {sortedInventory.length ? (
          <div className="airbnb-table-list">
            {sortedInventory.map((item) => (
              <div className="airbnb-row airbnb-row--inventory" key={item.id}>
                <div className="airbnb-row-primary">
                  <strong>{item.displayName}</strong>
                  <span>{humanizeAirbnbValue(item.category)} · {humanizeAirbnbValue(item.consumptionBasis)}</span>
                </div>
                <div className="airbnb-quantity">
                  <strong>{formatQuantity(item.quantityOnHand)}</strong>
                  <span>{item.stockUnit}</span>
                </div>
                <span>Counted {formatAirbnbDateTime(item.lastCountedAt)}</span>
                <StatusBadge value={item.countStatus} />
              </div>
            ))}
          </div>
        ) : (
          <InlineEmpty>No inventory items have been configured yet.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Checkers Sixty60" title="Recent orders" />
        {orders.length ? (
          <div className="airbnb-table-list">
            {orders.map((order) => (
              <div className="airbnb-row airbnb-row--order" key={order.id}>
                <ShoppingCart size={18} aria-hidden />
                <div className="airbnb-row-primary">
                  <strong>{order.providerOrderId ? `Order ${order.providerOrderId}` : 'Order reference pending'}</strong>
                  <span>{formatZar(order.totalCents)} · {order.addressStatus === 'bowie_1' ? '1 Bowie delivery' : humanizeAirbnbValue(order.addressStatus)}</span>
                </div>
                <span>{order.deliveryDueAt ? `Due ${formatAirbnbDateTime(order.deliveryDueAt)}` : `Ordered ${formatAirbnbDateTime(order.orderedAt)}`}</span>
                <StatusBadge value={order.status} />
              </div>
            ))}
          </div>
        ) : (
          <InlineEmpty>No relevant 1 Bowie orders have synced yet.</InlineEmpty>
        )}
      </section>
    </div>
  )
}

function SystemSection({ alerts, jobRuns }: { alerts: AirbnbAlert[]; jobRuns: AirbnbJobRun[] }) {
  return (
    <div className="airbnb-stack">
      <section className="airbnb-panel">
        <PanelHeading eyebrow="Automation receipts" title="Recent worker runs" />
        {jobRuns.length ? (
          <div className="airbnb-table-list">
            {jobRuns.map((run) => <JobRunRow key={run.id} run={run} />)}
          </div>
        ) : (
          <InlineEmpty>No worker run receipts have synced yet.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Operations" title="Alert history" />
        {alerts.length ? (
          <div className="airbnb-table-list">
            {alerts.map((alert) => (
              <div className="airbnb-row airbnb-row--alert" key={alert.id}>
                <StatusBadge value={alert.severity} />
                <div className="airbnb-row-primary">
                  <strong>{alert.summary}</strong>
                  <span>{humanizeAirbnbValue(alert.type)}</span>
                </div>
                <span>{formatAirbnbDateTime(alert.openedAt)}</span>
                <StatusBadge value={alert.status} />
              </div>
            ))}
          </div>
        ) : (
          <InlineEmpty icon={CheckCircle2}>No alert history is available in this snapshot.</InlineEmpty>
        )}
      </section>
    </div>
  )
}

function UnitRow({ unit }: { unit: AirbnbUnitDay }) {
  return (
    <div className="airbnb-unit-row">
      <div className="airbnb-unit-number">{unit.property.unitNumber}</div>
      <div className="airbnb-row-primary">
        <strong>{unit.property.commonName}</strong>
        <span>{unit.primaryReservation?.guestName ?? (unit.state === 'empty' ? 'No guest recorded' : 'Guest name to confirm')}</span>
      </div>
      <div className="airbnb-unit-guests">{formatGuestCount(unit.primaryReservation)}</div>
      <StatusBadge value={unit.state} />
    </div>
  )
}

function GuestThreadRow({ thread }: { thread: AirbnbGuestThread }) {
  const replyDue = isGuestReplyDue(thread)
  return (
    <div className={`airbnb-row airbnb-row--thread${replyDue ? ' is-attention' : ''}`}>
      <div className="airbnb-row-primary">
        <strong>{thread.guestName ?? 'Guest name unavailable'}</strong>
        <span className="airbnb-message-preview">{thread.latestMessage ?? 'No message preview available'}</span>
      </div>
      <div className="airbnb-thread-time">
        <strong>{replyDue ? 'Reply due' : 'No reply due'}</strong>
        <span>Guest {formatAirbnbDateTime(thread.lastGuestAt)}</span>
      </div>
      <StatusBadge value={thread.riskTier} />
      <StatusBadge value={thread.status} />
    </div>
  )
}

function ReservationRow({ reservation, property }: { reservation: AirbnbReservation; property: AirbnbProperty | null }) {
  return (
    <div className="airbnb-row airbnb-row--reservation">
      <div className="airbnb-row-primary">
        <strong>{reservation.guestName ?? 'Guest name to confirm'}</strong>
        <span>{formatGuestCount(reservation)} · {reservation.confirmationCode}</span>
      </div>
      <div>
        <strong>{property ? `Unit ${property.unitNumber}` : 'Unknown unit'}</strong>
        <span>{property?.commonName ?? 'Property mapping required'}</span>
      </div>
      <div>
        <strong>{formatAirbnbDate(reservation.checkIn, true)}</strong>
        <span>to {formatAirbnbDate(reservation.checkOut, true)}</span>
      </div>
      <StatusBadge value={reservation.status} />
    </div>
  )
}

function JobRunRow({ run }: { run: AirbnbJobRun }) {
  return (
    <div className="airbnb-row airbnb-row--job">
      <div className="airbnb-row-primary">
        <strong>{humanizeAirbnbValue(run.jobName)}</strong>
        <span>{humanizeAirbnbValue(run.service)}{run.targetDate ? ` · ${formatAirbnbDate(run.targetDate)}` : ''}</span>
      </div>
      <span>Started {formatAirbnbDateTime(run.startedAt)}</span>
      <span>{run.completedAt ? `Completed ${formatAirbnbDateTime(run.completedAt)}` : 'Still running'}</span>
      <StatusBadge value={run.status} />
      {run.errorCode ? <code>{run.errorCode}</code> : null}
    </div>
  )
}

function CleanerPlanSummary({ plan }: { plan: AirbnbCleanerPlan }) {
  return (
    <div className="airbnb-plan-summary">
      <div>
        <CalendarDays size={19} aria-hidden />
        <span>Target date</span>
        <strong>{formatAirbnbDate(plan.targetDate, true)}</strong>
      </div>
      <div>
        <Clock3 size={19} aria-hidden />
        <span>Completed</span>
        <strong>{formatAirbnbDateTime(plan.completedAt)}</strong>
      </div>
      <div>
        <Sparkles size={19} aria-hidden />
        <span>Plan scope</span>
        <strong>{summarizePlanUnits(plan)}</strong>
      </div>
      <div>
        <Activity size={19} aria-hidden />
        <span>Result</span>
        <span className="airbnb-inline-badges"><StatusBadge value={plan.status} /><ConfidenceBadge plan={plan} /></span>
      </div>
    </div>
  )
}

function Metric({ icon: MetricIcon, label, value, tone = 'neutral' }: { icon: Icon; label: string; value: number; tone?: 'neutral' | 'positive' | 'warning' | 'danger' }) {
  return (
    <article className={`airbnb-metric airbnb-metric--${tone}`}>
      <MetricIcon size={18} strokeWidth={1.8} aria-hidden />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="airbnb-panel-heading">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  )
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`airbnb-status airbnb-status--${statusTone(value)}`}>{humanizeAirbnbValue(value)}</span>
}

function ConfidenceBadge({ plan }: { plan: AirbnbCleanerPlan }) {
  const okay = plan.confidence.ok === true
  return <span className={`airbnb-status airbnb-status--${okay ? 'positive' : 'warning'}`}>{okay ? 'Confidence OK' : 'Check confidence'}</span>
}

function InlineEmpty({ children, icon: EmptyIcon = CircleAlert }: { children: string; icon?: Icon }) {
  return (
    <div className="airbnb-inline-empty">
      <EmptyIcon size={18} aria-hidden />
      <span>{children}</span>
    </div>
  )
}

function EmptyState({ icon: EmptyIcon, title, copy }: { icon: Icon; title: string; copy: string }) {
  return (
    <section className="airbnb-empty-state">
      <EmptyIcon size={24} aria-hidden />
      <h2>{title}</h2>
      <p>{copy}</p>
    </section>
  )
}

function AirbnbLoadingState() {
  return (
    <section className="airbnb-loading" aria-live="polite" aria-busy="true">
      <RefreshCw size={20} className="is-spinning" aria-hidden />
      <div>
        <strong>Loading Airbnb operations</strong>
        <span>Checking the latest private household snapshot.</span>
      </div>
    </section>
  )
}

function statusTone(value: string): 'neutral' | 'positive' | 'warning' | 'danger' | 'info' {
  if (['sent', 'success', 'confirmed', 'delivered', 'resolved', 'handled', 'low', 'arrival', 'stayover'].includes(value)) return 'positive'
  if (['error', 'failed', 'blocked', 'critical', 'conflict', 'cancelled'].includes(value)) return 'danger'
  if (['warning', 'needs_human', 'open', 'notified', 'confirm', 'unknown', 'checkout', 'turnover'].includes(value)) return 'warning'
  if (['info', 'ordered', 'delivery_due', 'invoiced', 'confirmation_received', 'duplicate_skipped'].includes(value)) return 'info'
  return 'neutral'
}

function summarizePlanUnits(plan: AirbnbCleanerPlan): string {
  const count = plan.unitStates.length
  if (count === 0) return 'No unit states recorded'
  return `${count} unit${count === 1 ? '' : 's'} in plan`
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 }).format(value)
}

function snapshotIsEmpty(data: AirbnbDashboardData): boolean {
  return data.properties.length === 0
    && data.reservations.length === 0
    && data.guestThreads.length === 0
    && data.cleanerPlans.length === 0
    && data.inventory.length === 0
    && data.orders.length === 0
    && data.alerts.length === 0
    && data.jobRuns.length === 0
}
