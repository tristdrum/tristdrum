import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DEFAULT_POST_LOGIN_PATH, safeRedirectPath } from '../lib/authRedirect'
import { useAuth } from '../auth/useAuth'
import './PrivateShell.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loadingMode, setLoadingMode] = useState<'password' | 'magic' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const redirectPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return safeRedirectPath(params.get('redirect'))
  }, [location.search])

  useEffect(() => {
    if (session) {
      navigate(redirectPath || DEFAULT_POST_LOGIN_PATH, { replace: true })
    }
  }, [navigate, redirectPath, session])

  const handlePasswordSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoadingMode('password')
    setError(null)
    setSuccess(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoadingMode(null)
      return
    }

    navigate(redirectPath, { replace: true })
  }

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoadingMode('magic')
    setError(null)
    setSuccess(null)

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/login?redirect=${encodeURIComponent(redirectPath)}`,
      },
    })

    if (otpError) {
      setError(otpError.message)
      setLoadingMode(null)
      return
    }

    setSuccess('Magic link sent. Open it on this device and you’ll land back in the dashboard flow.')
    setLoadingMode(null)
  }

  return (
    <main className="private-shell">
      <section className="private-panel private-panel--centered">
        <p className="private-eyebrow">Owner access</p>
        <h1>Sign in to the private side of tristdrum.com</h1>
        <p className="private-copy">
          Public pages stay public. The dashboard, admin tools, and future assistant workspace live behind Supabase Auth.
        </p>

        {error ? <p className="private-error">{error}</p> : null}
        {success ? <p className="private-success">{success}</p> : null}

        <form className="private-form" onSubmit={handlePasswordSignIn}>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              required
            />
          </label>
          <button type="submit" disabled={loadingMode !== null}>
            {loadingMode === 'password' ? 'Signing in…' : 'Sign in with password'}
          </button>
        </form>

        <form className="private-form" onSubmit={handleMagicLink}>
          <label>
            Email for magic link
            <input
              autoComplete="email"
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <button type="submit" disabled={loadingMode !== null}>
            {loadingMode === 'magic' ? 'Sending…' : 'Email me a magic link'}
          </button>
        </form>

        <div className="private-actions">
          <Link to="/">Back to the public site</Link>
          <span className="private-muted">Default post-login path: {redirectPath}</span>
        </div>
      </section>
    </main>
  )
}
