import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import './PrivateShell.css'

export default function DashboardPage() {
  const { user, isAdmin, bootstrapAvailable, setupRequired, claimInitialAdmin, signOut } = useAuth()

  const handleClaim = async () => {
    await claimInitialAdmin()
  }

  return (
    <main className="private-shell">
      <div className="private-layout">
        <section className="private-panel">
          <p className="private-eyebrow">Private dashboard</p>
          <h1>Hi {user?.email ?? 'there'}</h1>
          <p className="private-copy">
            This is the private side of the site. Household and site-admin roles keep each tool visible only to the people who should use it.
          </p>
          <div className="private-actions">
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
            <Link to="/">Public site</Link>
            <Link to="/task-pulse">Task Pulse</Link>
            <Link to="/dashboard/finance">Finance hub</Link>
            <Link to="/manage-7f8a9c2e-4b3d-11ef-a8c9-0242ac130003">Artwork admin</Link>
          </div>
        </section>

        {setupRequired ? (
          <section className="private-panel">
            <p className="private-eyebrow">Database setup</p>
            <h2>Supabase auth helpers still need to be migrated</h2>
            <p className="private-copy">
              The UI is ready, but the database-side admin helpers are missing. Apply the latest Supabase migrations to finish the owner-access foundation.
            </p>
          </section>
        ) : null}

        {!setupRequired && !isAdmin && bootstrapAvailable ? (
          <section className="private-panel">
            <p className="private-eyebrow">Owner bootstrap</p>
            <h2>Claim the first site-admin slot</h2>
            <p className="private-copy">
              No owner account has been claimed yet. Because you’re signed in already, you can claim the first admin slot now.
            </p>
            <div className="private-actions">
              <button type="button" onClick={() => void handleClaim()}>
                Claim owner access
              </button>
            </div>
          </section>
        ) : null}

        <section className="private-grid">
          <article className="private-card">
            <span className="private-kicker">Household</span>
            <h3>Finance hub</h3>
            <p>Trace source records, reconciliations, current accounting allocations, open questions, and tax scenarios without erasing history.</p>
            <div className="private-actions">
              <Link to="/dashboard/finance">Open finance</Link>
            </div>
          </article>
          <article className="private-card">
            <span className="private-kicker">Now</span>
            <h3>Auth foundation</h3>
            <p>Email/password + magic link provides the session; each private tool then checks its own role or household membership.</p>
          </article>
          <article className="private-card">
            <span className="private-kicker">Next</span>
            <h3>Active work dashboard</h3>
            <p>We can hang project cards, open loops, reminders, and assistant-tracked items here without cluttering the public site.</p>
          </article>
          <article className="private-card">
            <span className="private-kicker">Integrations</span>
            <h3>OpenClaw + Slack + Linear</h3>
            <p>This shell is designed to grow into a real control plane rather than another hidden route.</p>
          </article>
        </section>

        <section className="private-panel">
          <p className="private-eyebrow">Useful entry points</p>
          <div className="private-links">
            <Link to="/dashboard/finance">Household finance ledger</Link>
            <Link to="/task-pulse">Task Pulse monitor</Link>
            <Link to="/manage-7f8a9c2e-4b3d-11ef-a8c9-0242ac130003">Artwork management</Link>
            <Link to="/harewood-drive">Harewood Drive calculator</Link>
          </div>
        </section>
      </div>
    </main>
  )
}
