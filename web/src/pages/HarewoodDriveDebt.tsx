import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
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

function buildFullSchedule(config: HarewoodDriveDebtConfig): MonthRow[] {
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
        // Future month: pay minimum or remaining balance, whichever is less
        payment = Math.min(minPayment, totalOwed)
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
        setError('Invalid password')
          setConfig(null)
        return
      }
      
      if (!response.ok) throw new Error('Could not load data')
      
      const raw = await response.json()
      const validated = validateHarewoodDriveDebtConfig(raw)
      setConfig(validated)
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

  const schedule = useMemo(() => {
    if (!config) return []
    return buildFullSchedule(config)
  }, [config])

  const totalInterest = useMemo(() => {
    return schedule.reduce((sum, row) => sum + row.interestCharged, 0)
  }, [schedule])

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
          <h1>Harewood Drive</h1>
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
                  <div>
                <dt>Total interest</dt>
                <dd>R{formatMoney(totalInterest)}</dd>
              </div>
            </dl>

            <table className="martin-table">
                    <thead>
                      <tr>
                  <th className="col-date">Date</th>
                  <th className="col-rate" title="Repo rate less 2.5% p.a.">Rate</th>
                  <th className="col-money">Charged</th>
                  <th className="col-money">Payment</th>
                  <th className="col-money">Interest</th>
                  <th className="col-money">Capital</th>
                  <th className="col-balance">Balance</th>
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
          </>
        ) : null}
      </div>
    </main>
  )
}

export default HarewoodDriveDebtPage
