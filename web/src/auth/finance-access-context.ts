import { createContext } from 'react'
import type { FinanceMembership } from '../lib/finance'

export const FinanceAccessContext = createContext<FinanceMembership | null>(null)
