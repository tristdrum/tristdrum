import { parseAirbnbDashboardSnapshot, type AirbnbDashboardData } from './airbnb'
import { supabase } from './supabase'

type RpcError = {
  code?: string
  message?: string
}

export type AirbnbReplyReviewAction = 'save' | 'approve' | 'cancel'
export type AirbnbOrderStatusAction = 'ordered' | 'delivery_due' | 'delivered' | 'cancelled'

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

export async function recordAirbnbStockAdjustment(input: {
  householdId: string
  inventoryItemId: string
  quantityDelta: number
  note: string | null
}): Promise<void> {
  const { error } = await supabase.rpc(
    'airbnb_record_stock_adjustment' as never,
    {
      target_household_id: input.householdId,
      target_inventory_item_id: input.inventoryItemId,
      quantity_delta: input.quantityDelta,
      note: input.note,
    } as never,
  ) as { error: RpcError | null }

  if (error) throw new Error(airbnbMutationErrorMessage(error, 'The stock adjustment could not be saved.'))
}

export async function reviewAirbnbReply(input: {
  deliveryId: string
  action: AirbnbReplyReviewAction
  editedText: string | null
}): Promise<void> {
  const { error } = await supabase.rpc(
    'airbnb_review_reply' as never,
    {
      target_delivery_id: input.deliveryId,
      review_action: input.action,
      edited_text: input.editedText,
    } as never,
  ) as { error: RpcError | null }

  if (error) throw new Error(airbnbMutationErrorMessage(error, 'The reply review could not be saved.'))
}

export async function updateAirbnbOrderStatus(input: {
  orderId: string
  status: AirbnbOrderStatusAction
  deliveryDueAt: string | null
}): Promise<void> {
  const { error } = await supabase.rpc(
    'airbnb_update_order_status' as never,
    {
      target_order_id: input.orderId,
      next_status: input.status,
      next_delivery_due_at: input.deliveryDueAt,
    } as never,
  ) as { error: RpcError | null }

  if (error) throw new Error(airbnbMutationErrorMessage(error, 'The order status could not be saved.'))
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

function airbnbMutationErrorMessage(error: RpcError, fallback: string): string {
  const message = error.message?.toLowerCase() ?? ''

  if (error.code === '42501' || message.includes('access denied') || message.includes('not found')) {
    return 'This account cannot change that Airbnb record.'
  }

  if (message.includes('can no longer be reviewed')) {
    return 'That guest reply changed before the review was saved. Refresh and check the latest state.'
  }

  return fallback
}
