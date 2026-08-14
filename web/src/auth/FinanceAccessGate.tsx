import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FinanceAccessContext } from './finance-access-context'
import { useAuth } from './useAuth'
import { loadFinanceMembership, type FinanceAccessResult } from '../lib/financeQueries'
import '../pages/PrivateShell.css'

export default function FinanceAccessGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [result, setResult] = useState<FinanceAccessResult>({ status: 'loading' })

  const refresh = useCallback(async () => {
    if (!user) {
      setResult({ status: 'denied' })
      return
    }

    setResult({ status: 'loading' })
    try {
      setResult(await loadFinanceMembership(user.id))
    } catch {
      setResult({
        status: 'error',
        message: 'Household access could not be verified. Refresh or confirm the finance connection.',
      })
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (result.status === 'loading') {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Finance access</p>
          <h1>Checking household membership…</h1>
          <p className="private-copy">Finance data stays restricted to active household members.</p>
        </section>
      </main>
    )
  }

  if (result.status === 'setup_required') {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Setup required</p>
          <h1>Finance hub</h1>
          <p className="private-copy">The finance schema or household access helpers are not available yet. Apply the finance migration, provision household membership, then retry.</p>
          <div className="private-actions">
            <button type="button" onClick={() => void refresh()}>Retry</button>
            <Link to="/dashboard">Back to dashboard</Link>
          </div>
        </section>
      </main>
    )
  }

  if (result.status === 'error') {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Finance access</p>
          <h1>We could not verify household access</h1>
          <p className="private-error">{result.message}</p>
          <div className="private-actions">
            <button type="button" onClick={() => void refresh()}>Retry</button>
            <Link to="/dashboard">Back to dashboard</Link>
          </div>
        </section>
      </main>
    )
  }

  if (result.status === 'denied') {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Access denied</p>
          <h1>Finance hub</h1>
          <p className="private-copy">This account is signed in, but it is not an active member of this private household workspace.</p>
          <div className="private-actions">
            <Link to="/dashboard">Back to dashboard</Link>
          </div>
        </section>
      </main>
    )
  }

  return <FinanceAccessContext.Provider value={result.membership}>{children}</FinanceAccessContext.Provider>
}
