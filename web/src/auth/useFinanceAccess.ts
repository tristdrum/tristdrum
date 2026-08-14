import { useContext } from 'react'
import { FinanceAccessContext } from './finance-access-context'

export function useFinanceAccess() {
  const membership = useContext(FinanceAccessContext)

  if (!membership) {
    throw new Error('useFinanceAccess must be used inside FinanceAccessGate')
  }

  return membership
}
