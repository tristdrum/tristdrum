import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import '../pages/PrivateShell.css'

export default function RequireAuth() {
  const { loading, session } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="private-shell">
        <section className="private-panel private-panel--centered">
          <p className="private-eyebrow">Auth</p>
          <h1>Checking your session…</h1>
        </section>
      </main>
    )
  }

  if (!session) {
    const redirect = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  return <Outlet />
}
