import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceAccess } from '../auth/useFinanceAccess'
import {
  compactHash,
  deriveFinanceSnapshot,
  formatFinanceDate,
  formatMoney,
  humanizeFinanceValue,
  rankReviewItems,
  type FinanceDashboardData,
  type FinanceEvidence,
  type FinanceReviewItem,
  type FinanceTransaction,
} from '../lib/finance'
import { loadFinanceDashboard } from '../lib/financeQueries'
import './FinanceHubPage.css'

type FinanceSection = 'overview' | 'reviews' | 'ledger' | 'evidence' | 'tax' | 'sources'

const sections: Array<{ id: FinanceSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'reviews', label: 'Anomaly inbox' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'tax', label: 'Tax scenarios' },
  { id: 'sources', label: 'Source health' },
]

export default function FinanceHubPage() {
  const membership = useFinanceAccess()
  const [activeSection, setActiveSection] = useState<FinanceSection>('overview')
  const [data, setData] = useState<FinanceDashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null)
  const [ledgerSearch, setLedgerSearch] = useState('')

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const nextData = await loadFinanceDashboard(membership)
      setData(nextData)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The finance workspace could not be loaded.')
    } finally {
      setRefreshing(false)
    }
  }, [membership])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rankedReviews = useMemo(() => rankReviewItems(data?.reviewItems ?? []), [data?.reviewItems])
  const filteredTransactions = useMemo(() => {
    const query = ledgerSearch.trim().toLowerCase()
    if (!query) {
      return data?.transactions ?? []
    }

    return (data?.transactions ?? []).filter((transaction) => (
      [transaction.accountName, transaction.description, transaction.counterparty, transaction.reconciliationStatus]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase()
        .includes(query)
    ))
  }, [data?.transactions, ledgerSearch])

  useEffect(() => {
    setSelectedReviewId((current) => selectExistingOrFirst(current, rankedReviews))
  }, [rankedReviews])

  useEffect(() => {
    setSelectedTransactionId((current) => selectExistingOrFirst(current, filteredTransactions))
  }, [filteredTransactions])

  useEffect(() => {
    setSelectedEvidenceId((current) => selectExistingOrFirst(current, data?.evidence ?? []))
  }, [data?.evidence])

  const selectedReview = rankedReviews.find((item) => item.id === selectedReviewId) ?? null
  const selectedTransaction = filteredTransactions.find((item) => item.id === selectedTransactionId) ?? null
  const selectedEvidence = data?.evidence.find((item) => item.id === selectedEvidenceId) ?? null
  const snapshot = data ? deriveFinanceSnapshot(data) : null

  return (
    <main className="finance-page">
      <div className="finance-shell">
        <header className="finance-header">
          <div>
            <div className="finance-breadcrumbs">
              <Link to="/dashboard">Dashboard</Link>
              <span aria-hidden="true">/</span>
              <span>Finance</span>
            </div>
            <p className="finance-eyebrow">Private household workspace</p>
            <h1>Finance hub</h1>
            <p className="finance-copy">
              One traceable view of source records, current interpretations, open questions, and accountant-facing scenarios.
            </p>
          </div>
          <div className="finance-header-meta">
            <RolePill role={membership.role} />
            <span>{membership.householdName}</span>
            <span>Loaded {formatFinanceDate(data?.loadedAt ?? null, true)}</span>
            <button type="button" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
        </header>

        <nav className="finance-nav" aria-label="Finance sections">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={activeSection === section.id ? 'page' : undefined}
              className={activeSection === section.id ? 'is-active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
              {section.id === 'reviews' && snapshot?.openReviewCount ? <span>{snapshot.openReviewCount}</span> : null}
            </button>
          ))}
        </nav>

        {error ? (
          <section className="finance-notice finance-notice--error" role="alert">
            <div>
              <strong>Some finance data could not be loaded.</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => void refresh()} disabled={refreshing}>Try again</button>
          </section>
        ) : null}

        {!data && refreshing ? <FinanceLoadingState /> : null}

        {data && snapshot ? (
          <>
            {activeSection === 'overview' ? (
              <OverviewSection
                data={data}
                onOpenReviews={() => setActiveSection('reviews')}
                onOpenSources={() => setActiveSection('sources')}
                onOpenLedger={() => setActiveSection('ledger')}
              />
            ) : null}
            {activeSection === 'reviews' ? (
              <ReviewSection
                items={rankedReviews}
                selected={selectedReview}
                selectedId={selectedReviewId}
                onSelect={setSelectedReviewId}
              />
            ) : null}
            {activeSection === 'ledger' ? (
              <LedgerSection
                transactions={filteredTransactions}
                totalCount={data.transactions.length}
                selected={selectedTransaction}
                selectedId={selectedTransactionId}
                search={ledgerSearch}
                onSearch={setLedgerSearch}
                onSelect={setSelectedTransactionId}
              />
            ) : null}
            {activeSection === 'evidence' ? (
              <EvidenceSection
                evidence={data.evidence}
                selected={selectedEvidence}
                selectedId={selectedEvidenceId}
                onSelect={setSelectedEvidenceId}
              />
            ) : null}
            {activeSection === 'tax' ? <TaxSection data={data} /> : null}
            {activeSection === 'sources' ? <SourcesSection data={data} /> : null}
          </>
        ) : null}

        {!data && !refreshing && !error ? (
          <EmptyPanel title="No finance data is available yet">
            The private workspace is ready. Source imports and reconciliations will appear here once they have been recorded.
          </EmptyPanel>
        ) : null}
      </div>
    </main>
  )
}

function OverviewSection({
  data,
  onOpenReviews,
  onOpenSources,
  onOpenLedger,
}: {
  data: FinanceDashboardData
  onOpenReviews: () => void
  onOpenSources: () => void
  onOpenLedger: () => void
}) {
  const snapshot = deriveFinanceSnapshot(data)
  const openReviews = rankReviewItems(data.reviewItems).filter((item) => item.status === 'open').slice(0, 4)
  const attentionSources = data.sources.filter((source) => source.state !== 'healthy').slice(0, 4)

  return (
    <div className="finance-section-stack">
      <section className="finance-summary-grid" aria-label="Loaded finance summary">
        <SummaryCard label="Loaded income allocations" value={formatMoney(snapshot.loadedIncomeCents)} tone="positive" />
        <SummaryCard label="Loaded expense allocations" value={formatMoney(snapshot.loadedExpenseCents)} />
        <SummaryCard label="Accountant-review allocations" value={formatMoney(snapshot.loadedReviewCents)} tone={snapshot.loadedReviewCents ? 'warning' : 'neutral'} />
        <SummaryCard label="Still unallocated" value={formatMoney(snapshot.loadedUnallocatedCents)} tone={snapshot.loadedUnallocatedCents ? 'warning' : 'neutral'} />
        <SummaryCard label="Open review questions" value={String(snapshot.openReviewCount)} tone={snapshot.openReviewCount ? 'warning' : 'positive'} />
        <SummaryCard
          label="Confirmed evidence coverage"
          value={snapshot.evidenceCoveragePercent === null
            ? '—'
            : `${snapshot.evidenceLinkedTransactionCount} tx (${snapshot.evidenceCoveragePercent === 0 && snapshot.evidenceLinkedTransactionCount > 0 ? '<1' : snapshot.evidenceCoveragePercent}%)`}
        />
        <SummaryCard label="Blocked sources" value={String(snapshot.sourceBlockerCount)} tone={snapshot.sourceBlockerCount ? 'danger' : 'positive'} />
      </section>

      <section className="finance-notice finance-notice--info">
        <div>
          <strong>Loaded totals are working-ledger numbers.</strong>
          <p>Superseded, void, duplicate, private, and not-relevant interpretations are excluded. Tax scenario totals remain separate until accountant review.</p>
        </div>
      </section>

      <div className="finance-two-column">
        <section className="finance-panel">
          <PanelHeading eyebrow="Reconciliation" title="Highest-value questions" actionLabel="Open inbox" onAction={onOpenReviews} />
          {openReviews.length === 0 ? (
            <InlineEmpty>There are no open review questions in the loaded workspace.</InlineEmpty>
          ) : (
            <ol className="finance-compact-list">
              {openReviews.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.reason}</span>
                  </div>
                  <div className="finance-list-meta">
                    <StatusPill value={item.priority} />
                    <span>{formatMoney(item.signedAmountCents, item.currency)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="finance-panel">
          <PanelHeading eyebrow="Coverage" title="Sources needing attention" actionLabel="Source health" onAction={onOpenSources} />
          {attentionSources.length === 0 ? (
            <InlineEmpty>All configured sources currently report healthy coverage.</InlineEmpty>
          ) : (
            <ul className="finance-compact-list">
              {attentionSources.map((source) => (
                <li key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <span>{source.blocker ?? `Coverage through ${formatFinanceDate(source.coverageThrough)}`}</span>
                  </div>
                  <StatusPill value={source.state} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="finance-panel">
        <PanelHeading eyebrow="Traceability" title="Current ledger coverage" actionLabel="Inspect ledger" onAction={onOpenLedger} />
        <div className="finance-trace-grid">
          <TraceStep number="1" title="Raw fact" copy={`${data.transactions.length} transactions loaded from preserved source imports.`} />
          <TraceStep number="2" title="Reconciliation" copy={`${snapshot.openReviewCount} question${snapshot.openReviewCount === 1 ? '' : 's'} remain open; previous answers remain available as history.`} />
          <TraceStep number="3" title="Accounting" copy={`${formatMoney(snapshot.loadedCapitalCents)} is currently allocated to capital and ${formatMoney(snapshot.loadedTransferCents)} to transfers.`} />
          <TraceStep number="4" title="Tax view" copy={`${data.taxScenarios.length} scenario${data.taxScenarios.length === 1 ? '' : 's'} loaded without changing the factual ledger.`} />
        </div>
      </section>
    </div>
  )
}

function ReviewSection({
  items,
  selected,
  selectedId,
  onSelect,
}: {
  items: FinanceReviewItem[]
  selected: FinanceReviewItem | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const detailPaneRef = useRef<HTMLElement | null>(null)
  const questionButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1

  const selectByOffset = (offset: -1 | 1, focusListButton = false) => {
    if (selectedIndex < 0) return

    const nextIndex = Math.min(items.length - 1, Math.max(0, selectedIndex + offset))
    const nextItem = items[nextIndex]
    if (!nextItem || nextIndex === selectedIndex) return

    onSelect(nextItem.id)
    if (focusListButton) {
      requestAnimationFrame(() => {
        const button = questionButtonRefs.current.get(nextItem.id)
        button?.focus({ preventScroll: true })
        button?.scrollIntoView({ block: 'nearest' })
      })
    }
  }

  const handleQuestionArrowKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return

    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return

    event.preventDefault()
    const focusListButton = target instanceof HTMLElement && Boolean(target.dataset.reviewQuestionId)
    selectByOffset(event.key === 'ArrowUp' ? -1 : 1, focusListButton)
  }

  const selectFromInbox = (id: string) => {
    onSelect(id)
    if (!window.matchMedia('(max-width: 880px)').matches) return

    requestAnimationFrame(() => {
      detailPaneRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  return (
    <section
      className="finance-master-detail finance-master-detail--reviews"
      aria-keyshortcuts="ArrowUp ArrowDown"
      onKeyDown={handleQuestionArrowKey}
    >
      <div className="finance-list-pane">
        <PanelHeading eyebrow="Reconciliation" title="Anomaly inbox" />
        <p className="finance-panel-copy">Permanent # references stay with each question even if this priority order changes. Use ↑ and ↓ to move between questions.</p>
        {items.length === 0 ? (
          <InlineEmpty>No review questions have been recorded yet.</InlineEmpty>
        ) : (
          <ul className="finance-select-list" aria-label="Review questions">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  ref={(element) => {
                    if (element) questionButtonRefs.current.set(item.id, element)
                    else questionButtonRefs.current.delete(item.id)
                  }}
                  type="button"
                  data-review-question-id={item.id}
                  aria-current={item.id === selectedId ? 'true' : undefined}
                  className={item.id === selectedId ? 'is-selected' : ''}
                  onClick={() => selectFromInbox(item.id)}
                >
                  <div className="finance-select-list-title">
                    <strong>
                      <span className="finance-question-number">#{item.questionNumber ?? '—'}</span>
                      {item.title}
                    </strong>
                    <StatusPill value={item.priority} />
                  </div>
                  <span>{formatFinanceDate(item.occurredOn)} · {formatMoney(item.signedAmountCents, item.currency)}</span>
                  <span>{item.accountName ?? 'No account linked'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside ref={detailPaneRef} className="finance-detail-pane" aria-live="polite">
        {!selected ? (
          <InlineEmpty>Select a question to inspect the available evidence and proposed interpretation.</InlineEmpty>
        ) : (
          <>
            <div className="finance-detail-heading">
              <div>
                <p className="finance-eyebrow">Question #{selected.questionNumber ?? '—'}</p>
                <h2>{selected.title}</h2>
              </div>
              <div className="finance-detail-actions">
                <StatusPill value={selected.status} />
                <div className="finance-question-nav" role="group" aria-label="Navigate review questions">
                  <button
                    type="button"
                    aria-label="Previous question"
                    title="Previous question (Arrow Up)"
                    disabled={selectedIndex <= 0}
                    onClick={() => selectByOffset(-1)}
                  >
                    ↑
                  </button>
                  <span aria-label={`Question ${selectedIndex + 1} of ${items.length}`}>{selectedIndex + 1} / {items.length}</span>
                  <button
                    type="button"
                    aria-label="Next question"
                    title="Next question (Arrow Down)"
                    disabled={selectedIndex < 0 || selectedIndex >= items.length - 1}
                    onClick={() => selectByOffset(1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            </div>
            <dl className="finance-detail-grid">
              <DetailField label="Date" value={formatFinanceDate(selected.occurredOn)} />
              <DetailField label="Amount" value={formatMoney(selected.signedAmountCents, selected.currency)} />
              <DetailField label="Account" value={selected.accountName ?? '—'} />
              <DetailField label="Counterparty" value={selected.counterparty ?? '—'} />
              <DetailField label="Description" value={selected.description ?? '—'} wide />
              <DetailField label="Estimated tax impact" value={formatMoney(selected.taxImpactCents, selected.currency)} />
            </dl>

            <DetailBlock title="Why this is ambiguous">{selected.reason}</DetailBlock>
            <DetailBlock title="Proposed interpretation">{selected.proposedInterpretation ?? 'No interpretation has been proposed yet.'}</DetailBlock>
            <DetailBlock title="Question">{selected.question ?? 'No question text has been recorded yet.'}</DetailBlock>

            <h3>Candidate evidence or answers</h3>
            {selected.candidates.length === 0 ? (
              <InlineEmpty>No candidate evidence or answer choices are linked yet.</InlineEmpty>
            ) : (
              <ul className="finance-candidate-list">
                {selected.candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <strong>{candidate.label}</strong>
                    <span>{candidate.detail ?? 'No additional detail.'}</span>
                    {candidate.evidenceObjectId ? <code>{candidate.evidenceObjectId}</code> : null}
                  </li>
                ))}
              </ul>
            )}

            <p className="finance-readonly-note">This view is read-only. Recorded answers and later corrections appear as preserved, superseding decisions—never as destructive edits.</p>
          </>
        )}
      </aside>
    </section>
  )
}

function LedgerSection({
  transactions,
  totalCount,
  selected,
  selectedId,
  search,
  onSearch,
  onSelect,
}: {
  transactions: FinanceTransaction[]
  totalCount: number
  selected: FinanceTransaction | null
  selectedId: string | null
  search: string
  onSearch: (value: string) => void
  onSelect: (id: string) => void
}) {
  return (
    <div className="finance-section-stack">
      <section className="finance-filter-bar">
        <label>
          <span>Search loaded ledger</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Account, description, counterparty, or status"
          />
        </label>
        <p>Showing {transactions.length} of {totalCount} loaded transactions</p>
      </section>

      <section className="finance-master-detail finance-master-detail--ledger">
        <div className="finance-list-pane">
          <PanelHeading eyebrow="Raw facts + allocations" title="Transaction ledger" />
          {transactions.length === 0 ? (
            <InlineEmpty>No loaded transactions match the current search.</InlineEmpty>
          ) : (
            <ul className="finance-select-list finance-select-list--transactions" aria-label="Finance transactions">
              {transactions.map((transaction) => (
                <li key={transaction.id}>
                  <button type="button" className={transaction.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(transaction.id)}>
                    <div className="finance-select-list-title">
                      <strong>{transaction.description}</strong>
                      <span className={transaction.signedAmountCents >= 0 ? 'finance-money--positive' : ''}>
                        {formatMoney(transaction.signedAmountCents, transaction.currency)}
                      </span>
                    </div>
                    <span>{formatFinanceDate(transaction.occurredOn)} · {transaction.accountName}</span>
                    <span>{transaction.counterparty ?? humanizeFinanceValue(transaction.reconciliationStatus)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="finance-detail-pane" aria-live="polite">
          {!selected ? (
            <InlineEmpty>Select a transaction to trace its current accounting interpretation.</InlineEmpty>
          ) : (
            <>
              <div className="finance-detail-heading">
                <div>
                  <p className="finance-eyebrow">Transaction trace</p>
                  <h2>{selected.description}</h2>
                </div>
                <StatusPill value={selected.effectiveStatus} />
              </div>
              <dl className="finance-detail-grid">
                <DetailField label="Date" value={formatFinanceDate(selected.occurredOn)} />
                <DetailField label="Amount" value={formatMoney(selected.signedAmountCents, selected.currency)} />
                <DetailField label="Account" value={selected.accountName} />
                <DetailField label="Counterparty" value={selected.counterparty ?? '—'} />
                <DetailField label="Reconciliation" value={humanizeFinanceValue(selected.reconciliationStatus)} />
                <DetailField label="Evidence links" value={String(selected.evidenceCount)} />
                <DetailField label="Human decisions" value={String(selected.decisionCount)} />
                <DetailField label="Transaction id" value={selected.id} mono wide />
              </dl>

              <h3>Current allocations</h3>
              {selected.allocations.length === 0 ? (
                <InlineEmpty>This transaction has no current allocations and remains unallocated.</InlineEmpty>
              ) : (
                <div className="finance-allocation-list">
                  {selected.allocations.map((allocation) => (
                    <article key={allocation.id}>
                      <div>
                        <StatusPill value={allocation.kind} />
                        <strong>{allocation.category ?? allocation.incomeStream ?? 'Uncategorised'}</strong>
                      </div>
                      <strong>{formatMoney(allocation.signedAmountCents, selected.currency)}</strong>
                      <dl>
                        <DetailField label="Unit" value={allocation.propertyUnit ?? '—'} />
                        <DetailField label="Tax treatment" value={allocation.taxTreatment ? humanizeFinanceValue(allocation.taxTreatment) : '—'} />
                      </dl>
                    </article>
                  ))}
                </div>
              )}

              <div className="finance-trace-line" aria-label="Trace layers">
                <span>Source import</span><span>Transaction</span><span>Reconciliation</span><span>Allocation</span><span>Tax view</span>
              </div>
            </>
          )}
        </aside>
      </section>
    </div>
  )
}

function EvidenceSection({
  evidence,
  selected,
  selectedId,
  onSelect,
}: {
  evidence: FinanceEvidence[]
  selected: FinanceEvidence | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="finance-master-detail">
      <div className="finance-list-pane">
        <PanelHeading eyebrow="Preserved source records" title="Evidence registry" />
        <p className="finance-panel-copy">Originals stay in the source vault. Registry rows add hashes, revisions, duplicate links, and traceable relationships.</p>
        {evidence.length === 0 ? (
          <InlineEmpty>No evidence objects have been indexed yet.</InlineEmpty>
        ) : (
          <ul className="finance-select-list" aria-label="Evidence registry">
            {evidence.map((item) => (
              <li key={item.id}>
                <button type="button" className={item.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(item.id)}>
                  <div className="finance-select-list-title">
                    <strong>{item.displayName}</strong>
                    <StatusPill value={item.localMirrorState} />
                  </div>
                  <span>{humanizeFinanceValue(item.documentKind)} · {formatFinanceDate(item.occurredOn)}</span>
                  <span>{item.linkedTransactionCount} transaction link{item.linkedTransactionCount === 1 ? '' : 's'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="finance-detail-pane" aria-live="polite">
        {!selected ? (
          <InlineEmpty>Select an evidence object to inspect its registry trace.</InlineEmpty>
        ) : (
          <>
            <div className="finance-detail-heading">
              <div>
                <p className="finance-eyebrow">Evidence trace</p>
                <h2>{selected.displayName}</h2>
              </div>
              <StatusPill value={selected.effectiveStatus} />
            </div>
            <dl className="finance-detail-grid">
              <DetailField label="Document kind" value={humanizeFinanceValue(selected.documentKind)} />
              <DetailField label="Source" value={humanizeFinanceValue(selected.sourceKind)} />
              <DetailField label="Document date" value={formatFinanceDate(selected.occurredOn)} />
              <DetailField label="Indexed" value={formatFinanceDate(selected.createdAt, true)} />
              <DetailField label="Pages" value={selected.pageCount === null ? '—' : String(selected.pageCount)} />
              <DetailField label="Current revision" value={String(selected.currentRevision)} />
              <DetailField label="Local mirror" value={humanizeFinanceValue(selected.localMirrorState)} />
              <DetailField label="Private Storage copy" value={humanizeFinanceValue(selected.storageMirrorState)} />
              <DetailField label="Exact SHA-256" value={compactHash(selected.exactSha256)} mono />
              <DetailField label="Normalised hash" value={compactHash(selected.normalizedSha256)} mono />
              <DetailField label="Duplicate of" value={selected.duplicateOfId ?? '—'} mono wide />
              <DetailField label="Registry id" value={selected.id} mono wide />
            </dl>
            <p className="finance-readonly-note">There is no delete action. Corrections create a new interpretation or revision while this source record and its hashes remain retrievable.</p>
          </>
        )}
      </aside>
    </section>
  )
}

function TaxSection({ data }: { data: FinanceDashboardData }) {
  return (
    <div className="finance-section-stack">
      <section className="finance-notice finance-notice--warning">
        <div>
          <strong>Scenario modelling is not filing approval.</strong>
          <p>The factual ledger stays common. A management-fee treatment remains proposed until the accountant confirms its basis and filing treatment.</p>
        </div>
      </section>

      <section className="finance-panel">
        <PanelHeading eyebrow="Versioned tax view" title="Scenario comparison" />
        {data.taxScenarios.length === 0 ? (
          <InlineEmpty>No tax scenarios have been calculated yet.</InlineEmpty>
        ) : (
          <div className="finance-scenario-grid">
            {data.taxScenarios.map((scenario) => (
              <article key={scenario.id}>
                <div className="finance-scenario-heading">
                  <div>
                    <span>{humanizeFinanceValue(scenario.kind)}</span>
                    <h3>{scenario.name}</h3>
                  </div>
                  <StatusPill value={scenario.status} />
                </div>
                <p>{formatFinanceDate(scenario.periodStart)} – {formatFinanceDate(scenario.periodEnd)}</p>
                <dl>
                  <ScenarioField label="Operating profit before fee" value={formatMoney(scenario.operatingProfitCents)} />
                  <ScenarioField label="Proposed management fee" value={formatMoney(scenario.managementFeeCents)} />
                  <ScenarioField label="Actual cash transferred" value={formatMoney(scenario.actualTransferredCents)} />
                  <ScenarioField label="Accrued versus paid difference" value={formatMoney(scenario.accruedDifferenceCents)} />
                  <ScenarioField label={`${scenario.ownerLabel} taxable income`} value={formatMoney(scenario.ownerTaxableIncomeCents)} />
                  <ScenarioField label={`${scenario.managerLabel} taxable income`} value={formatMoney(scenario.managerTaxableIncomeCents)} />
                  <ScenarioField label="Combined household tax" value={formatMoney(scenario.combinedTaxCents)} strong />
                </dl>
                {scenario.warning ? <p className="finance-scenario-warning">{scenario.warning}</p> : null}
                <small>Updated {formatFinanceDate(scenario.updatedAt, true)}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="finance-panel">
        <PanelHeading eyebrow="Accountant hand-off" title="Submission packs" />
        {data.submissionPacks.length === 0 ? (
          <InlineEmpty>No accountant packs have been registered yet.</InlineEmpty>
        ) : (
          <ul className="finance-pack-list">
            {data.submissionPacks.map((pack) => (
              <li key={pack.id}>
                <div>
                  <strong>{pack.name}</strong>
                  <span>{formatFinanceDate(pack.periodStart)} – {formatFinanceDate(pack.periodEnd)}</span>
                </div>
                <div>
                  <StatusPill value={pack.status} />
                  <span>{pack.unresolvedItemCount} unresolved</span>
                  <code>{compactHash(pack.manifestHash)}</code>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="finance-readonly-note">This hub does not send accountant email, file a return, or make a bank payment.</p>
      </section>
    </div>
  )
}

function SourcesSection({ data }: { data: FinanceDashboardData }) {
  return (
    <div className="finance-section-stack">
      <section className="finance-panel">
        <PanelHeading eyebrow="Import coverage" title="Source health" />
        <p className="finance-panel-copy">Coverage and import state are recorded separately from the financial events they produce. Re-running an idempotent importer should add no duplicate events.</p>
        {data.sources.length === 0 ? (
          <InlineEmpty>No sources have reported health yet.</InlineEmpty>
        ) : (
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>State</th>
                  <th>Coverage through</th>
                  <th>Last success</th>
                  <th>Imported</th>
                  <th>Blocker</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.id}>
                    <td><strong>{source.name}</strong><span>{humanizeFinanceValue(source.sourceKind)}</span></td>
                    <td><StatusPill value={source.state} /></td>
                    <td>{formatFinanceDate(source.coverageThrough)}</td>
                    <td>{formatFinanceDate(source.lastSuccessfulAt, true)}</td>
                    <td>{source.importedItemCount}</td>
                    <td>{source.blocker ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="finance-panel">
        <PanelHeading eyebrow="Safe operation" title="Preservation guarantees" />
        <div className="finance-guarantee-grid">
          <Guarantee title="No hard delete">The interface exposes no finance-record or evidence delete action.</Guarantee>
          <Guarantee title="Corrections are revisions">A new interpretation supersedes the old one; history remains available.</Guarantee>
          <Guarantee title="Original folders stay put">Indexing does not move or rename original evidence folders.</Guarantee>
          <Guarantee title="Mirrors are verified">Registry hashes make missing or mismatched local and Storage copies visible.</Guarantee>
        </div>
      </section>
    </div>
  )
}

function FinanceLoadingState() {
  return (
    <section className="finance-loading" aria-live="polite" aria-busy="true">
      <span />
      <div>
        <strong>Loading the household ledger…</strong>
        <p>Checking source health, current revisions, reconciliation questions, and tax scenarios.</p>
      </div>
    </section>
  )
}

function SummaryCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'positive' | 'warning' | 'danger' }) {
  return (
    <article className={`finance-summary-card finance-summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function PanelHeading({ eyebrow, title, actionLabel, onAction }: { eyebrow: string; title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="finance-panel-heading">
      <div>
        <p className="finance-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {actionLabel && onAction ? <button type="button" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  )
}

function RolePill({ role }: { role: string }) {
  return <span className="finance-role-pill">{humanizeFinanceValue(role)}</span>
}

function StatusPill({ value }: { value: string }) {
  const classValue = value.replaceAll('_', '-').replace(/[^a-z0-9-]/gi, '').toLowerCase()
  return <span className={`finance-status-pill finance-status-pill--${classValue}`}>{humanizeFinanceValue(value)}</span>
}

function TraceStep({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <article>
      <span>{number}</span>
      <div><strong>{title}</strong><p>{copy}</p></div>
    </article>
  )
}

function DetailField({ label, value, wide = false, mono = false }: { label: string; value: string; wide?: boolean; mono?: boolean }) {
  return (
    <div className={wide ? 'is-wide' : ''}>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : ''}>{value}</dd>
    </div>
  )
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return <section className="finance-detail-block"><h3>{title}</h3><p>{children}</p></section>
}

function ScenarioField({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><dt>{label}</dt><dd className={strong ? 'is-strong' : ''}>{value}</dd></div>
}

function Guarantee({ title, children }: { title: string; children: ReactNode }) {
  return <article><strong>{title}</strong><p>{children}</p></article>
}

function InlineEmpty({ children }: { children: ReactNode }) {
  return <p className="finance-inline-empty">{children}</p>
}

function EmptyPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="finance-panel finance-empty-panel"><p className="finance-eyebrow">Ready for data</p><h2>{title}</h2><p>{children}</p></section>
}

function selectExistingOrFirst<T extends { id: string }>(currentId: string | null, items: T[]): string | null {
  if (currentId && items.some((item) => item.id === currentId)) {
    return currentId
  }

  return items[0]?.id ?? null
}
