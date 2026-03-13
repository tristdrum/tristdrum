import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthContextValue } from './auth-context'

type AdminState = {
  isAdmin: boolean
  bootstrapAvailable: boolean
  setupRequired: boolean
}

type AuthRpcName = 'is_site_admin' | 'site_admin_bootstrap_available' | 'claim_initial_site_admin'

function authRpc(name: AuthRpcName) {
  return supabase.rpc(name as never)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [adminState, setAdminState] = useState<AdminState>({
    isAdmin: false,
    bootstrapAvailable: false,
    setupRequired: false,
  })

  const resolveAdminState = useCallback(async (activeSession: Session | null) => {
    if (!activeSession?.user) {
      setAdminState({ isAdmin: false, bootstrapAvailable: false, setupRequired: false })
      return
    }

    const [{ data: adminData, error: adminError }, { data: bootstrapData, error: bootstrapError }] = await Promise.all([
      authRpc('is_site_admin'),
      authRpc('site_admin_bootstrap_available'),
    ])

    const missingHelpers = [adminError, bootstrapError].some((error) => {
      const message = error?.message?.toLowerCase() ?? ''
      return message.includes('function') && message.includes('does not exist')
    })

    if (missingHelpers) {
      setAdminState({ isAdmin: false, bootstrapAvailable: false, setupRequired: true })
      return
    }

    setAdminState({
      isAdmin: Boolean(adminData),
      bootstrapAvailable: Boolean(bootstrapData),
      setupRequired: false,
    })
  }, [])

  useEffect(() => {
    let mounted = true

    void (async () => {
      const {
        data: { session: activeSession },
      } = await supabase.auth.getSession()

      if (!mounted) {
        return
      }

      setSession(activeSession)
      await resolveAdminState(activeSession)
      if (mounted) {
        setLoading(false)
      }
    })()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession)
      void resolveAdminState(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [resolveAdminState])

  const refreshAdminState = useCallback(async () => {
    await resolveAdminState(session)
  }, [resolveAdminState, session])

  const claimInitialAdmin = useCallback(async () => {
    const { data, error } = await authRpc('claim_initial_site_admin')

    if (error) {
      return { success: false, error: error.message }
    }

    await resolveAdminState(session)
    return { success: Boolean(data) }
  }, [resolveAdminState, session])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      isAdmin: adminState.isAdmin,
      bootstrapAvailable: adminState.bootstrapAvailable,
      setupRequired: adminState.setupRequired,
      refreshAdminState,
      claimInitialAdmin,
      signOut,
    }),
    [adminState.bootstrapAvailable, adminState.isAdmin, adminState.setupRequired, claimInitialAdmin, loading, refreshAdminState, session, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
