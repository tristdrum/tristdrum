import { parseAirbnbDashboardSnapshot, type AirbnbDashboardData } from './airbnb'
import { supabase } from './supabase'

type RpcError = {
  code?: string
  message?: string
}

export async function loadAirbnbDashboard(householdId: string): Promise<AirbnbDashboardData> {
  const { data, error } = await supabase.rpc(
    'airbnb_dashboard_snapshot' as never,
    { target_household_id: householdId } as never,
  ) as { data: unknown; error: RpcError | null }

  if (error) {
    throw new Error(airbnbDashboardErrorMessage(error))
  }

  return parseAirbnbDashboardSnapshot(data)
}

function airbnbDashboardErrorMessage(error: RpcError): string {
  const message = error.message?.toLowerCase() ?? ''

  if (error.code === '42501' || message.includes('access denied')) {
    return 'This account no longer has access to the Airbnb household workspace.'
  }

  if (message.includes('function') && message.includes('does not exist')) {
    return 'The Airbnb dashboard database helper is not available yet.'
  }

  return 'The Airbnb management snapshot could not be loaded.'
}
