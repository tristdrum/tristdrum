import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  validateHarewoodDriveDebtConfig,
  getRepoRateAt,
  calculateInterestAccrued,
  type HarewoodDriveDebtConfig,
} from '../lib/harewoodDriveDebt'

const EDGE_FUNCTION_URL = 'https://akvlarrmhlbnuvnfpvic.supabase.co/functions/v1/harewood-drive-debt'
const SESSION_KEY = 'harewood-drive-password'

const formatMoney = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const formatDate = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const formatPercent = (rate: number) => `${(rate * 100).toFixed(2)}%`

const formatDuration = (months: number) => {
  const absMonths = Math.abs(months)
  if (absMonths < 12) return `${absMonths} mo`
  const years = Math.floor(absMonths / 12)
  const remainingMonths = absMonths % 12
  if (remainingMonths === 0) return `${years} yr`
  return `${years} yr ${remainingMonths} mo`
}

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

const pad2 = (n: number) => String(n).padStart(2, '0')

const roundCents = (n: number) => Math.round(n * 100) / 100

type MonthRow = {
  date: string
  repoRate: number
  effectiveRate: number
  interestCharged: number
  payment: number | null
  interestPaid: number
  capitalPaid: number
  balance: number
  isPast: boolean
  isGrace: boolean
}

function buildFullSchedule(config: HarewoodDriveDebtConfig, customFuturePayment?: number | null): MonthRow[] {
  const rows: MonthRow[] = []
  const margin = config.agreement.interestMarginBelowRepo
  const minPayment = config.agreement.minimumMonthlyPayment
  const graceMonths = config.agreement.graceMonths
  const today = new Date()

  const [startYear, startMonth] = config.property.registrationDate.split('-').map(Number)
  
  const paymentsByMonth = new Map<string, number>()
  for (const p of config.payments ?? []) {
    const d = new Date(p.paidAt)
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
    paymentsByMonth.set(key, (paymentsByMonth.get(key) ?? 0) + p.amount)
  }
  
  let cursor = new Date(`${config.property.registrationDate}T00:00:00+02:00`)
  let principalBalance = config.agreement.principal
  let accruedInterest = 0
  
  const startRepoRate = getRepoRateAt(config.repoRateTimeline, cursor)
  rows.push({
    date: config.property.registrationDate,
    repoRate: startRepoRate,
    effectiveRate: startRepoRate - margin,
    interestCharged: 0,
    payment: null,
    interestPaid: 0,
    capitalPaid: 0,
    balance: principalBalance,
    isPast: cursor < today,
    isGrace: true,
  })

  let monthIndex = 0
  while (principalBalance > 0.01 && monthIndex < 200) {
    monthIndex++
    
    // monthIndex=1 should give us the same month as registration (end of Sept)
    const monthOffset = startMonth - 2 + monthIndex
    const year = startYear + Math.floor(monthOffset / 12)
    const month = (monthOffset % 12) + 1
    const day = lastDayOfMonth(year, month)
    const endDate = `${year}-${pad2(month)}-${pad2(day)}`
    const endCursor = new Date(`${endDate}T23:59:59+02:00`)
    const monthKey = `${year}-${pad2(month)}`
    
    const repoRate = getRepoRateAt(config.repoRateTimeline, endCursor)
    const interest = calculateInterestAccrued(
      config.repoRateTimeline,
      principalBalance,
      margin,
      cursor,
      endCursor
    )
    const roundedInterest = roundCents(interest)
    accruedInterest = roundCents(accruedInterest + roundedInterest)
    
    const isGrace = monthIndex <= graceMonths
    const isPast = endCursor < today
    
    let capitalPaid = 0
    let interestPaid = 0
    let payment: number | null = null
    
    if (!isGrace) {
      const actualPayment = paymentsByMonth.get(monthKey)
      const totalOwed = roundCents(principalBalance + accruedInterest)
      
      if (actualPayment !== undefined) {
        payment = actualPayment
      } else if (!isPast) {
        // Future month: use custom payment if set, otherwise minimum
        const futurePayment = customFuturePayment ?? minPayment
        payment = Math.min(futurePayment, totalOwed)
      } else {
        payment = 0
      }
      
      if (payment > 0) {
        const effectivePayment = Math.min(payment, totalOwed)
        
        interestPaid = Math.min(accruedInterest, effectivePayment)
        accruedInterest = roundCents(accruedInterest - interestPaid)
        
        capitalPaid = Math.min(principalBalance, effectivePayment - interestPaid)
        principalBalance = roundCents(principalBalance - capitalPaid)
      }
    }
    
    rows.push({
      date: endDate,
      repoRate,
      effectiveRate: repoRate - margin,
      interestCharged: roundedInterest,
      payment,
      interestPaid,
      capitalPaid,
      balance: roundCents(principalBalance + accruedInterest),
      isPast,
      isGrace,
    })
    
    cursor = endCursor
  }
  
  return rows
}

function HarewoodDriveDebtPage() {
  const [config, setConfig] = useState<HarewoodDriveDebtConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [role, setRole] = useState<'creditor' | 'debtor' | null>(null)
  const [customPayment, setCustomPayment] = useState<number | null>(null)
  const [viewAs, setViewAs] = useState<'creditor' | 'debtor'>('debtor')

  const loadData = useCallback(async (pwd: string) => {
      setLoading(true)
      setError(null)
      try {
      const response = await fetch(EDGE_FUNCTION_URL, {
        headers: { 'x-password': pwd }
      })
      
      if (response.status === 401) {
        sessionStorage.removeItem(SESSION_KEY)
        setIsAuthenticated(false)
        setRole(null)
        setError('Invalid password')
          setConfig(null)
        return
      }
      
      if (!response.ok) throw new Error('Could not load data')
      
      const raw = await response.json()
      const validated = validateHarewoodDriveDebtConfig(raw)
      setConfig(validated)
      setRole(raw.role ?? 'creditor')
      setCustomPayment(null) // Reset to default
      setIsAuthenticated(true)
      sessionStorage.setItem(SESSION_KEY, pwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Check for saved password on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) {
      setPassword(saved)
      void loadData(saved)
    }
  }, [loadData])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password.trim()) {
      void loadData(password.trim())
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setIsAuthenticated(false)
    setConfig(null)
    setRole(null)
    setPassword('')
    setCustomPayment(null)
    setViewAs('debtor')
  }

  // Effective view: debtor can toggle, creditor always sees creditor view
  const activeView = role === 'debtor' ? viewAs : 'creditor'

  const schedule = useMemo(() => {
    if (!config) return []
    return buildFullSchedule(config, customPayment)
  }, [config, customPayment])

  // Default schedule (minimum payment) for comparison
  const defaultSchedule = useMemo(() => {
    if (!config) return []
    return buildFullSchedule(config, null)
  }, [config])

  const totalInterest = useMemo(() => {
    return schedule.reduce((sum, row) => sum + row.interestCharged, 0)
  }, [schedule])

  const defaultTotalInterest = useMemo(() => {
    return defaultSchedule.reduce((sum, row) => sum + row.interestCharged, 0)
  }, [defaultSchedule])

  const lastPaymentDate = useMemo(() => {
    if (schedule.length === 0) return null
    for (let i = schedule.length - 1; i >= 0; i--) {
      if (schedule[i].payment && schedule[i].payment > 0) {
        return schedule[i].date
      }
    }
    return null
  }, [schedule])

  const defaultLastPaymentDate = useMemo(() => {
    if (defaultSchedule.length === 0) return null
    for (let i = defaultSchedule.length - 1; i >= 0; i--) {
      if (defaultSchedule[i].payment && defaultSchedule[i].payment > 0) {
        return defaultSchedule[i].date
      }
    }
    return null
  }, [defaultSchedule])

  // Count payment months
  const paymentMonths = useMemo(() => {
    return schedule.filter(row => row.payment && row.payment > 0).length
  }, [schedule])

  const defaultPaymentMonths = useMemo(() => {
    return defaultSchedule.filter(row => row.payment && row.payment > 0).length
  }, [defaultSchedule])

  const interestSaved = defaultTotalInterest - totalInterest
  const monthsSaved = defaultPaymentMonths - paymentMonths

  const effectivePayment = customPayment ?? config?.agreement.minimumMonthlyPayment ?? 0
  const isCustomPayment = customPayment !== null && customPayment !== config?.agreement.minimumMonthlyPayment

  const downloadExcel = useCallback(() => {
    if (!config || schedule.length === 0) return

    const data = schedule.map((row) => ({
      'Date': row.date,
      'Rate': `${(row.effectiveRate * 100).toFixed(2)}%`,
      'Charged': row.interestCharged,
      'Payment': row.payment ?? '',
      'Interest': row.interestPaid || '',
      'Capital': row.capitalPaid || '',
      'Balance': row.balance,
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
    XLSX.writeFile(wb, 'harewood-drive-debt.xlsx')
  }, [config, schedule])

  // Password prompt
  if (!isAuthenticated) {
  return (
      <main className="martin-page">
        <div className="martin-container">
          <header className="martin-header">
            <Link to="/" className="martin-back">← tristdrum.com</Link>
            <h1>Harewood Drive</h1>
          </header>

          <form onSubmit={handleSubmit} className="martin-auth">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              disabled={loading}
            />
            <button type="submit" disabled={loading || !password.trim()}>
              {loading ? 'Loading…' : 'View'}
            </button>
            {error && <p className="martin-error">{error}</p>}
          </form>
          </div>
      </main>
    )
  }

  return (
    <main className="martin-page">
      <div className="martin-container">
        <header className="martin-header">
          <Link to="/" className="martin-back">← tristdrum.com</Link>
          <div className="martin-header-row">
            <h1>Harewood Drive</h1>
            <div className="martin-header-actions">
              {role === 'debtor' && (
                <div className="martin-view-toggle">
                  <button
                    type="button"
                    className={viewAs === 'debtor' ? 'active' : ''}
                    onClick={() => setViewAs('debtor')}
                  >
                    Tristan
                  </button>
                  <button
                    type="button"
                    className={viewAs === 'creditor' ? 'active' : ''}
                    onClick={() => setViewAs('creditor')}
                  >
                    Martin
                  </button>
                </div>
              )}
              <button type="button" className="martin-download" onClick={downloadExcel}>
                Download
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <p className="martin-status">Loading…</p>
        ) : error ? (
          <p className="martin-status martin-error">{error}</p>
        ) : config ? (
          <>
            <dl className="martin-info">
              <div>
                <dt>Loan started</dt>
                <dd>{formatDate(config.property.registrationDate)}</dd>
              </div>
              <div>
                <dt>Principal</dt>
                <dd>R{formatMoney(config.agreement.principal)}</dd>
              </div>
              <div>
                <dt>Interest rate</dt>
                <dd>Repo − {(config.agreement.interestMarginBelowRepo * 100).toFixed(1)}%</dd>
              </div>
              {activeView === 'debtor' ? (
                <div>
                  <dt>Monthly payment</dt>
                  <dd className="martin-payment-row">
                    <input
                      type="number"
                      className="martin-payment-input"
                      value={effectivePayment}
                      onChange={(e) => setCustomPayment(Number(e.target.value) || null)}
                      min={0}
                      step={100}
                    />
                    {isCustomPayment && (
                      <button
                        type="button"
                        className="martin-reset"
                        onClick={() => setCustomPayment(null)}
                        title="Reset to minimum"
                      >
                        ↺
                      </button>
                    )}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>Monthly payment</dt>
                  <dd>R{formatMoney(config.agreement.minimumMonthlyPayment)}</dd>
                </div>
              )}
              <div>
                <dt>Total interest</dt>
                <dd>
                  R{formatMoney(totalInterest)}
                  {activeView === 'debtor' && isCustomPayment && interestSaved !== 0 && (
                    <span className={`martin-diff ${interestSaved > 0 ? 'martin-diff--good' : 'martin-diff--bad'}`}>
                      {interestSaved > 0 ? '↓' : '↑'} R{formatMoney(Math.abs(interestSaved))}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Last payment</dt>
                <dd>
                  {lastPaymentDate ? formatDate(lastPaymentDate) : '—'}
                  {activeView === 'debtor' && isCustomPayment && monthsSaved !== 0 && (
                    <span className={`martin-diff ${monthsSaved > 0 ? 'martin-diff--good' : 'martin-diff--bad'}`}>
                      {monthsSaved > 0 ? '↓' : '↑'} {formatDuration(monthsSaved)}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <table className="martin-table">
                    <thead>
                      <tr>
                  <th className="col-date" title="End of month">Date</th>
                  <th className="col-rate" title="Interest rate: Repo − 2.5% p.a.">Rate</th>
                  <th className="col-money" title="Interest charged this month">Charged</th>
                  <th className="col-money" title="Payment made">Payment</th>
                  <th className="col-money" title="Portion of payment applied to interest">Interest</th>
                  <th className="col-money" title="Portion of payment applied to capital">Capital</th>
                  <th className="col-balance" title="Outstanding balance">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                {schedule.map((row, i) => (
                  <tr key={row.date} className={row.isGrace && i > 0 ? 'grace-row' : ''}>
                    <td className="col-date">{formatDate(row.date)}</td>
                    <td className="col-rate" title={`Repo ${formatPercent(row.repoRate)} − 2.5% = ${formatPercent(row.effectiveRate)}`}>
                      {formatPercent(row.effectiveRate)}
                    </td>
                    <td className="col-money">{row.interestCharged > 0 ? formatMoney(row.interestCharged) : '—'}</td>
                    <td className="col-money">{row.payment === null ? '—' : formatMoney(row.payment)}</td>
                    <td className="col-money">{row.interestPaid > 0 ? formatMoney(row.interestPaid) : '—'}</td>
                    <td className="col-money">{row.capitalPaid > 0 ? formatMoney(row.capitalPaid) : '—'}</td>
                    <td className="col-balance">{formatMoney(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

            <button type="button" className="martin-logout" onClick={handleLogout}>
              Logout
            </button>
          </>
        ) : null}
      </div>
    </main>
  )
}

export default HarewoodDriveDebtPage
