import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './useAuth'
import '../pages/PrivateShell.css'

type Props = {
  title: string
  children: ReactNode
}

export default function AdminAccessGate({ title, children }: Props) {
  const { isAdmin, bootstrapAvailable, setupRequired, claimInitialAdmin, refreshAdminState, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClaim = async () => {
    setBusy(true)
    setError(null)
    const result = await claimInitialAdmin()
    if (!result.success) {
      setError(result.error ?? 'Unable to claim site admin access yet.')
    }
    setBusy(false)
  }

  if (setupRequired) {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Setup required</p>
          <h1>{title}</h1>
          <p className="private-copy">
            The database auth helpers for site-admin access are not available yet. Apply the latest Supabase migrations, then refresh.
          </p>
          <div className="private-actions">
            <button type="button" onClick={() => void refreshAdminState()}>
              Retry
            </button>
            <Link to="/dashboard">Go to dashboard</Link>
          </div>
        </section>
      </main>
    )
  }

  if (!isAdmin && bootstrapAvailable) {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Owner bootstrap</p>
          <h1>{title}</h1>
          <p className="private-copy">
            Signed in as <strong>{user?.email ?? 'unknown user'}</strong>. No site admin has been claimed yet, so you can claim the first owner slot now.
          </p>
          {error ? <p className="private-error">{error}</p> : null}
          <div className="private-actions">
            <button type="button" onClick={() => void handleClaim()} disabled={busy}>
              {busy ? 'Claiming…' : 'Claim owner access'}
            </button>
            <Link to="/dashboard">Back to dashboard</Link>
          </div>
        </section>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Access denied</p>
          <h1>{title}</h1>
          <p className="private-copy">
            You are signed in, but this area is restricted to a site admin account.
          </p>
          <div className="private-actions">
            <Link to="/dashboard">Go to dashboard</Link>
          </div>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
