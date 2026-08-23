import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Check,
  ClipboardCheck,
  CircleAlert,
  Clock3,
  Copy,
  Database,
  FileJson2,
  House,
  LayoutDashboard,
  MessageSquareText,
  PencilLine,
  PackageSearch,
  RefreshCw,
  Save,
  ShoppingCart,
  Sparkles,
  X,
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
  type AirbnbCleanerPlan,
  type AirbnbDashboardData,
  type AirbnbGuestThread,
  type AirbnbInventoryItem,
  type AirbnbJobRun,
  type AirbnbOrder,
  type AirbnbProperty,
  type AirbnbReplyDelivery,
  type AirbnbReservation,
  type AirbnbShoppingList,
  type AirbnbUnitDay,
} from '../lib/airbnb'
import {
  loadAirbnbDashboard,
  markAirbnbShoppingListOrdered,
  recordAirbnbStockCount,
  reviewAirbnbReply,
  updateAirbnbOrderStatus,
  type AirbnbOrderStatusAction,
  type AirbnbReplyReviewAction,
} from '../lib/airbnbQueries'
import './AirbnbManagementPage.css'

type AirbnbSection = 'overview' | 'guests' | 'cleaning' | 'stock' | 'system'
type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>
type AirbnbActionNotice = { tone: 'success' | 'error'; message: string }

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
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<AirbnbActionNotice | null>(null)
  const actionLock = useRef(false)
  const today = todayInJohannesburg()

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const snapshot = await loadAirbnbDashboard(membership.householdId)
      setData(snapshot)
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : 'The Airbnb management snapshot could not be loaded.')
    } finally {
      setRefreshing(false)
    }
  }, [membership.householdId])

  const performAction = useCallback(async (
    actionKey: string,
    successMessage: string,
    action: () => Promise<void>,
  ) => {
    if (actionLock.current) return
    actionLock.current = true
    setActionBusy(actionKey)
    setActionNotice(null)
    try {
      await action()
      await refresh()
      setActionNotice({ tone: 'success', message: successMessage })
    } catch (actionError) {
      setActionNotice({
        tone: 'error',
        message: actionError instanceof Error ? actionError.message : 'The Airbnb change could not be saved.',
      })
    } finally {
      actionLock.current = false
      setActionBusy(null)
    }
  }, [refresh])

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

        {actionNotice ? (
          <section className={`airbnb-notice airbnb-notice--${actionNotice.tone}`} role="status">
            {actionNotice.tone === 'success' ? <CheckCircle2 size={20} aria-hidden /> : <CircleAlert size={20} aria-hidden />}
            <div><strong>{actionNotice.message}</strong></div>
            <button type="button" onClick={() => setActionNotice(null)} aria-label="Dismiss notification" title="Dismiss notification">
              <X size={16} aria-hidden />
            </button>
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
            {activeSection === 'guests' ? (
              <GuestsSection
                data={data}
                today={today}
                actionBusy={actionBusy}
                onReviewReply={(deliveryId, action, editedText) => performAction(
                  `reply:${deliveryId}`,
                  action === 'approve' ? 'Reply approved.' : action === 'cancel' ? 'Reply cancelled.' : 'Reply draft saved.',
                  () => reviewAirbnbReply({ deliveryId, action, editedText }),
                )}
              />
            ) : null}
            {activeSection === 'cleaning' ? <CleaningSection data={data} today={today} /> : null}
            {activeSection === 'stock' ? (
              <StockSection
                inventory={data.inventory}
                shoppingLists={data.shoppingLists}
                orders={data.orders}
                actionBusy={actionBusy}
                onRecordStockCount={(inventoryItemId, quantityOnHand, note) => performAction(
                  `stock:${inventoryItemId}`,
                  'Physical stock count recorded.',
                  () => recordAirbnbStockCount({
                    householdId: membership.householdId,
                    inventoryItemId,
                    quantityOnHand,
                    note,
                  }),
                )}
                onMarkShoppingListOrdered={(shoppingListId) => performAction(
                  `shopping-list:${shoppingListId}`,
                  'Shopping list marked ordered.',
                  () => markAirbnbShoppingListOrdered(shoppingListId),
                )}
                onUpdateOrder={(orderId, status, deliveryDueAt) => performAction(
                  `order:${orderId}`,
                  'Order status updated.',
                  () => updateAirbnbOrderStatus({ orderId, status, deliveryDueAt }),
                )}
              />
            ) : null}
            {activeSection === 'system' ? <SystemSection data={data} /> : null}
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

function GuestsSection({
  data,
  today,
  actionBusy,
  onReviewReply,
}: {
  data: AirbnbDashboardData
  today: string
  actionBusy: string | null
  onReviewReply: (deliveryId: string, action: AirbnbReplyReviewAction, editedText: string | null) => Promise<void>
}) {
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
        <PanelHeading eyebrow="Human review" title="Reply drafts" />
        {data.replyDeliveries.length ? (
          <div className="airbnb-table-list">
            {data.replyDeliveries.map((delivery) => (
              <ReplyReviewRow
                key={delivery.id}
                delivery={delivery}
                busy={actionBusy !== null}
                onReview={onReviewReply}
              />
            ))}
          </div>
        ) : (
          <InlineEmpty>No guest reply drafts are waiting for review.</InlineEmpty>
        )}
      </section>

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

function StockSection({
  inventory,
  shoppingLists,
  orders,
  actionBusy,
  onRecordStockCount,
  onMarkShoppingListOrdered,
  onUpdateOrder,
}: {
  inventory: AirbnbInventoryItem[]
  shoppingLists: AirbnbShoppingList[]
  orders: AirbnbOrder[]
  actionBusy: string | null
  onRecordStockCount: (inventoryItemId: string, quantityOnHand: number, note: string | null) => Promise<void>
  onMarkShoppingListOrdered: (shoppingListId: string) => Promise<void>
  onUpdateOrder: (orderId: string, status: AirbnbOrderStatusAction, deliveryDueAt: string | null) => Promise<void>
}) {
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
              <InventoryAdjustmentRow
                key={item.id}
                item={item}
                busy={actionBusy !== null}
                onRecordCount={onRecordStockCount}
              />
            ))}
          </div>
        ) : (
          <InlineEmpty>No inventory items have been configured yet.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Paste into Checkers Sixty60" title="Restocking lists" />
        {shoppingLists.length ? (
          <div className="airbnb-table-list">
            {shoppingLists.map((shoppingList) => (
              <ShoppingListRow
                key={shoppingList.id}
                shoppingList={shoppingList}
                busy={actionBusy !== null}
                onMarkOrdered={onMarkShoppingListOrdered}
              />
            ))}
          </div>
        ) : (
          <InlineEmpty>No restocking list has been generated yet.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Checkers Sixty60" title="Recent orders" />
        {orders.length ? (
          <div className="airbnb-table-list">
            {orders.map((order) => (
              <OrderStatusRow
                key={order.id}
                order={order}
                busy={actionBusy !== null}
                onUpdate={onUpdateOrder}
              />
            ))}
          </div>
        ) : (
          <InlineEmpty>No relevant 1 Bowie orders have synced yet.</InlineEmpty>
        )}
      </section>
    </div>
  )
}

function SystemSection({ data }: { data: AirbnbDashboardData }) {
  return (
    <div className="airbnb-stack">
      <section className="airbnb-panel">
        <PanelHeading eyebrow="Automation receipts" title="Recent worker runs" />
        {data.jobRuns.length ? (
          <div className="airbnb-table-list">
            {data.jobRuns.map((run) => <JobRunRow key={run.id} run={run} />)}
          </div>
        ) : (
          <InlineEmpty>No worker run receipts have synced yet.</InlineEmpty>
        )}
      </section>

      <section className="airbnb-panel">
        <PanelHeading eyebrow="Operations" title="Alert history" />
        {data.alerts.length ? (
          <div className="airbnb-table-list">
            {data.alerts.map((alert) => (
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

      <div className="airbnb-two-column airbnb-two-column--equal">
        <section className="airbnb-panel">
          <PanelHeading eyebrow="Source trail" title="Recent evidence" />
          {data.evidence.length ? (
            <div className="airbnb-table-list">
              {data.evidence.slice(0, 40).map((evidence) => (
                <div className="airbnb-row airbnb-row--evidence" key={evidence.id}>
                  <Database size={18} aria-hidden />
                  <div className="airbnb-row-primary">
                    <strong>{evidence.subject ?? humanizeAirbnbValue(evidence.subtype ?? evidence.kind)}</strong>
                    <span>{humanizeAirbnbValue(evidence.provider)} · {humanizeAirbnbValue(evidence.mailboxScope)}</span>
                  </div>
                  <span>{formatAirbnbDateTime(evidence.occurredAt)}</span>
                  <StatusBadge value={evidence.kind} />
                </div>
              ))}
            </div>
          ) : (
            <InlineEmpty>No source evidence has synced yet.</InlineEmpty>
          )}
        </section>

        <section className="airbnb-panel">
          <PanelHeading eyebrow="Append-only history" title="Audit events" />
          {data.auditEvents.length ? (
            <div className="airbnb-table-list">
              {data.auditEvents.slice(0, 40).map((event) => (
                <div className="airbnb-row airbnb-row--audit" key={event.id}>
                  <FileJson2 size={18} aria-hidden />
                  <div className="airbnb-row-primary">
                    <strong>{humanizeAirbnbValue(event.action)}</strong>
                    <span>{humanizeAirbnbValue(event.entityType)} · {humanizeAirbnbValue(event.actorType)}</span>
                  </div>
                  <span>{formatAirbnbDateTime(event.occurredAt)}</span>
                  {Object.keys(event.details).length ? (
                    <details className="airbnb-json-details">
                      <summary>Details</summary>
                      <pre>{formatJson(event.details)}</pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <InlineEmpty>No audited operator actions have been recorded yet.</InlineEmpty>
          )}
        </section>
      </div>
    </div>
  )
}

function ReplyReviewRow({
  delivery,
  busy,
  onReview,
}: {
  delivery: AirbnbReplyDelivery
  busy: boolean
  onReview: (deliveryId: string, action: AirbnbReplyReviewAction, editedText: string | null) => Promise<void>
}) {
  const [text, setText] = useState(delivery.finalText ?? delivery.draftText ?? '')
  const reviewable = ['draft', 'needs_approval', 'approved', 'failed'].includes(delivery.status)
  const ambiguous = delivery.status === 'ambiguous'

  useEffect(() => {
    setText(delivery.finalText ?? delivery.draftText ?? '')
  }, [delivery.draftText, delivery.finalText])

  const submit = async (action: AirbnbReplyReviewAction) => {
    const editedText = ['save', 'approve'].includes(action) ? text.trim() || null : null
    await onReview(delivery.id, action, editedText)
  }

  return (
    <article className="airbnb-review-row">
      <div className="airbnb-review-meta">
        <div className="airbnb-row-primary">
          <strong>{delivery.guestName ?? 'Guest name unavailable'}</strong>
          <span>{delivery.listingName ?? 'Studio to confirm'} · {delivery.topic ? humanizeAirbnbValue(delivery.topic) : 'Topic unclassified'}</span>
        </div>
        <span>{formatAirbnbDateTime(delivery.sourceLastEventAt)}</span>
        <StatusBadge value={delivery.riskTier} />
        <StatusBadge value={delivery.status} />
      </div>
      {delivery.recentMessages.length ? (
        <div className="airbnb-conversation-context" aria-label="Recent conversation context">
          {delivery.recentMessages.map((message) => (
            <div key={message.id} className={`airbnb-conversation-message airbnb-conversation-message--${message.direction}`}>
              <span>{humanizeAirbnbValue(message.direction)} · {formatAirbnbDateTime(message.sentAt)}</span>
              <p>{message.body}</p>
            </div>
          ))}
        </div>
      ) : delivery.latestGuestMessage ? <blockquote>{delivery.latestGuestMessage}</blockquote> : null}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!reviewable || busy}
        rows={4}
        aria-label={`Reply draft for ${delivery.guestName ?? 'guest'}`}
      />
      <p className="airbnb-reply-footer">{delivery.footer}</p>
      {reviewable ? (
        <div className="airbnb-actions">
          <button type="button" onClick={() => void submit('save')} disabled={busy || !text.trim()}>
            <Save size={15} aria-hidden />
            <span>Save</span>
          </button>
          <button type="button" className="is-primary" onClick={() => void submit('approve')} disabled={busy || !text.trim()}>
            <Check size={15} aria-hidden />
            <span>Approve</span>
          </button>
          <button type="button" className="is-danger" onClick={() => void submit('cancel')} disabled={busy}>
            <X size={15} aria-hidden />
            <span>Cancel</span>
          </button>
        </div>
      ) : null}
      {ambiguous ? (
        <div className="airbnb-actions">
          <button type="button" onClick={() => void submit('mark_sent')} disabled={busy}>
            <CheckCircle2 size={15} aria-hidden />
            <span>Mark sent</span>
          </button>
          <button type="button" className="is-primary" onClick={() => void submit('retry')} disabled={busy}>
            <RefreshCw size={15} aria-hidden />
            <span>Retry</span>
          </button>
          <button type="button" className="is-danger" onClick={() => void submit('cancel')} disabled={busy}>
            <X size={15} aria-hidden />
            <span>Cancel</span>
          </button>
        </div>
      ) : null}
    </article>
  )
}

function InventoryAdjustmentRow({
  item,
  busy,
  onRecordCount,
}: {
  item: AirbnbInventoryItem
  busy: boolean
  onRecordCount: (inventoryItemId: string, quantityOnHand: number, note: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const numericQuantity = Number(quantity)
  const validQuantity = quantity.trim() !== '' && Number.isFinite(numericQuantity) && numericQuantity >= 0

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validQuantity) return
    await onRecordCount(item.id, numericQuantity, note.trim() || null)
    setQuantity('')
    setNote('')
    setEditing(false)
  }

  return (
    <div className="airbnb-operational-row">
      <div className="airbnb-row airbnb-row--inventory">
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
        <button
          type="button"
          className="airbnb-icon-button airbnb-icon-button--inline"
          onClick={() => setEditing((current) => !current)}
          disabled={busy}
          aria-label={`Adjust ${item.displayName}`}
          title={`Adjust ${item.displayName}`}
        >
          {editing ? <X size={15} aria-hidden /> : <PencilLine size={15} aria-hidden />}
        </button>
      </div>
      {editing ? (
        <form className="airbnb-inline-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Counted quantity ({item.stockUnit})</span>
            <input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </label>
          <label className="airbnb-form-grow">
            <span>Evidence note</span>
            <input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Physical count or correction" />
          </label>
          <button type="submit" className="is-primary" disabled={busy || !validQuantity}>
            <Save size={15} aria-hidden />
            <span>Save count</span>
          </button>
        </form>
      ) : null}
    </div>
  )
}

function ShoppingListRow({
  shoppingList,
  busy,
  onMarkOrdered,
}: {
  shoppingList: AirbnbShoppingList
  busy: boolean
  onMarkOrdered: (shoppingListId: string) => Promise<void>
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const itemText = shoppingList.items
    .map((item) => `${formatQuantity(item.quantity)} ${item.stockUnit} ${item.displayName}${item.countToConfirm ? ' (confirm count)' : ''}`)
    .join('\n')
  const minimumInstruction = '\n\nCheck the current Sixty60 basket is at least R350 for free delivery; aim for about R400 with useful guest or cleaning staples.'
  const listText = `${itemText}${minimumInstruction}`.trim()
  const estimateLabel = shoppingList.priceEstimateComplete
    ? formatZar(shoppingList.estimatedTotalCents)
    : `${formatZar(shoppingList.estimatedTotalCents)} plus unpriced items`

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(listText)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <article className="airbnb-shopping-list-row">
      <div className="airbnb-shopping-list-heading">
        <div className="airbnb-row-primary">
          <strong>{formatAirbnbDate(shoppingList.forecastStart, true)} to {formatAirbnbDate(shoppingList.forecastEnd, true)}</strong>
          <span>{shoppingList.bufferPercent}% buffer · {shoppingList.triggerHorizonDays}-day trigger · {estimateLabel}</span>
        </div>
        <StatusBadge value={shoppingList.status} />
        <button type="button" onClick={() => void copyList()} disabled={!shoppingList.items.length}>
          {copyState === 'copied' ? <ClipboardCheck size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy list'}</span>
        </button>
        {shoppingList.status !== 'ordered' ? (
          <button
            type="button"
            className="is-primary"
            onClick={() => void onMarkOrdered(shoppingList.id)}
            disabled={busy || !shoppingList.items.length}
          >
            <Check size={15} aria-hidden />
            <span>{busy ? 'Saving' : 'Mark ordered'}</span>
          </button>
        ) : null}
      </div>
      <p className="airbnb-shopping-minimum">Check the current Sixty60 basket is at least R350 for free delivery; aim for about R400. Historical prices are estimates only.</p>
      {shoppingList.items.length ? (
        <ul className="airbnb-shopping-items">
          {shoppingList.items.map((item) => (
            <li key={item.id}>
              <strong>{formatQuantity(item.quantity)} {item.stockUnit} {item.displayName}</strong>
              <span>{item.reason}</span>
              {item.countToConfirm ? <StatusBadge value="confirm" /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <InlineEmpty>This forecast did not require any purchases.</InlineEmpty>
      )}
    </article>
  )
}

function OrderStatusRow({
  order,
  busy,
  onUpdate,
}: {
  order: AirbnbOrder
  busy: boolean
  onUpdate: (orderId: string, status: AirbnbOrderStatusAction, deliveryDueAt: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<AirbnbOrderStatusAction>(suggestOrderStatus(order.status))
  const [deliveryDueAt, setDeliveryDueAt] = useState(toDatetimeLocal(order.deliveryDueAt))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const dueAt = deliveryDueAt ? new Date(deliveryDueAt).toISOString() : null
    await onUpdate(order.id, status, dueAt)
    setEditing(false)
  }

  return (
    <div className="airbnb-operational-row">
      <div className="airbnb-row airbnb-row--order">
        <ShoppingCart size={18} aria-hidden />
        <div className="airbnb-row-primary">
          <strong>{order.providerOrderId ? `Order ${order.providerOrderId}` : 'Order reference pending'}</strong>
          <span>{formatZar(order.totalCents)} · {order.addressStatus === 'bowie_1' ? '1 Bowie delivery' : humanizeAirbnbValue(order.addressStatus)}</span>
        </div>
        <span>{order.deliveryDueAt ? `Due ${formatAirbnbDateTime(order.deliveryDueAt)}` : `Ordered ${formatAirbnbDateTime(order.orderedAt)}`}</span>
        <StatusBadge value={order.status} />
        {order.addressStatus === 'bowie_1' ? (
          <button
            type="button"
            className="airbnb-icon-button airbnb-icon-button--inline"
            onClick={() => setEditing((current) => !current)}
            disabled={busy}
            aria-label="Update order status"
            title="Update order status"
          >
            {editing ? <X size={15} aria-hidden /> : <PencilLine size={15} aria-hidden />}
          </button>
        ) : null}
      </div>
      {editing && order.addressStatus === 'bowie_1' ? (
        <form className="airbnb-inline-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as AirbnbOrderStatusAction)}>
              <option value="ordered">Ordered</option>
              <option value="delivery_due">Delivery due</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="airbnb-form-grow">
            <span>Delivery due</span>
            <input type="datetime-local" value={deliveryDueAt} onChange={(event) => setDeliveryDueAt(event.target.value)} />
          </label>
          <button type="submit" className="is-primary" disabled={busy}>
            <Save size={15} aria-hidden />
            <span>Save status</span>
          </button>
        </form>
      ) : null}
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
      {Object.keys(run.receipt).length ? (
        <details className="airbnb-json-details">
          <summary>Receipt</summary>
          <pre>{formatJson(run.receipt)}</pre>
        </details>
      ) : null}
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

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2)
}

function suggestOrderStatus(status: string): AirbnbOrderStatusAction {
  if (status === 'suggested') return 'ordered'
  if (status === 'delivery_due') return 'delivered'
  if (status === 'delivered') return 'delivered'
  if (status === 'cancelled') return 'cancelled'
  return 'delivery_due'
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

function snapshotIsEmpty(data: AirbnbDashboardData): boolean {
  return data.properties.length === 0
    && data.reservations.length === 0
    && data.guestThreads.length === 0
    && data.replyDeliveries.length === 0
    && data.cleanerPlans.length === 0
    && data.inventory.length === 0
    && data.shoppingLists.length === 0
    && data.orders.length === 0
    && data.alerts.length === 0
    && data.jobRuns.length === 0
    && data.evidence.length === 0
    && data.auditEvents.length === 0
}
