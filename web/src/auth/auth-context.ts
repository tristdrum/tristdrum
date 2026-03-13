import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthContextValue = {
  loading: boolean
  session: Session | null
  user: User | null
  isAdmin: boolean
  bootstrapAvailable: boolean
  setupRequired: boolean
  refreshAdminState: () => Promise<void>
  claimInitialAdmin: () => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
