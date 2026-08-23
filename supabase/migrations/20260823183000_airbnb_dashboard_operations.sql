set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function public.airbnb_dashboard_snapshot(target_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_household_role(target_household_id, null) then
    raise exception 'Household access denied.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', property.id,
        'unitNumber', property.unit_number,
        'listingName', property.listing_name,
        'commonName', property.common_name,
        'facts', property.facts,
        'status', property.status
      ) order by property.unit_number)
      from airbnb.properties property
      where property.household_id = target_household_id
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reservation.id,
        'propertyId', reservation.property_id,
        'confirmationCode', reservation.confirmation_code,
        'guestName', reservation.guest_name,
        'checkIn', reservation.check_in,
        'checkOut', reservation.check_out,
        'adults', reservation.adults,
        'children', reservation.children,
        'infants', reservation.infants,
        'guestCountKnown', reservation.guest_count_known,
        'status', reservation.booking_status,
        'sourceCutoffAt', reservation.source_cutoff_at
      ) order by reservation.check_in, reservation.property_id)
      from airbnb.reservations reservation
      where reservation.household_id = target_household_id
        and reservation.check_out >= current_date - 2
        and reservation.check_in <= current_date + 90
    ), '[]'::jsonb),
    'guestThreads', coalesce((
      select jsonb_agg(thread_row.payload order by thread_row.updated_at desc)
      from (
        select
          thread.updated_at,
          jsonb_build_object(
            'id', thread.id,
            'guestName', thread.guest_display_name,
            'status', thread.status,
            'riskTier', thread.risk_tier,
            'lastGuestAt', thread.last_guest_at,
            'lastHostAt', thread.last_host_at,
            'latestMessage', (
              select left(message.body_normalized, 500)
              from airbnb.guest_messages message
              where message.household_id = thread.household_id
                and message.thread_id = thread.id
              order by message.provider_sent_at desc
              limit 1
            )
          ) as payload
        from airbnb.guest_threads thread
        where thread.household_id = target_household_id
        order by thread.updated_at desc
        limit 50
      ) thread_row
    ), '[]'::jsonb),
    'replyDeliveries', coalesce((
      select jsonb_agg(delivery_row.payload order by delivery_row.updated_at desc)
      from (
        select
          delivery.updated_at,
          jsonb_build_object(
            'id', delivery.id,
            'threadId', delivery.thread_id,
            'guestName', thread.guest_display_name,
            'listingName', property.listing_name,
            'latestGuestMessage', (
              select left(message.body_normalized, 1000)
              from airbnb.guest_messages message
              where message.household_id = delivery.household_id
                and message.thread_id = delivery.thread_id
                and message.direction = 'guest'
              order by message.provider_sent_at desc
              limit 1
            ),
            'sourceLastEventAt', delivery.source_last_event_at,
            'topic', delivery.topic,
            'riskTier', delivery.risk_tier,
            'classification', delivery.classification,
            'draftText', delivery.draft_text,
            'finalText', delivery.final_text,
            'footer', delivery.footer,
            'status', delivery.status,
            'cancellationReason', delivery.cancellation_reason,
            'sentAt', delivery.sent_at,
            'createdAt', delivery.created_at,
            'updatedAt', delivery.updated_at
          ) as payload
        from airbnb.reply_deliveries delivery
        join airbnb.guest_threads thread
          on thread.household_id = delivery.household_id
         and thread.id = delivery.thread_id
        left join airbnb.properties property
          on property.household_id = thread.household_id
         and property.id = thread.property_id
        where delivery.household_id = target_household_id
        order by delivery.updated_at desc
        limit 50
      ) delivery_row
    ), '[]'::jsonb),
    'cleanerPlans', coalesce((
      select jsonb_agg(plan_row.payload order by plan_row.completed_at desc)
      from (
        select
          plan.completed_at,
          jsonb_build_object(
            'id', plan.id,
            'targetDate', plan.target_date,
            'status', plan.delivery_status,
            'isUpdate', plan.is_update,
            'unitStates', plan.unit_states,
            'confidence', plan.confidence,
            'startedAt', plan.started_at,
            'completedAt', plan.completed_at
          ) as payload
        from airbnb.cleaner_plans plan
        where plan.household_id = target_household_id
        order by plan.completed_at desc
        limit 30
      ) plan_row
    ), '[]'::jsonb),
    'inventory', coalesce((
      select jsonb_agg(to_jsonb(balance) - 'household_id' order by balance.category, balance.display_name)
      from airbnb.inventory_balances balance
      where balance.household_id = target_household_id
        and balance.active
    ), '[]'::jsonb),
    'shoppingLists', coalesce((
      select jsonb_agg(list_row.payload order by list_row.created_at desc)
      from (
        select
          shopping_list.created_at,
          jsonb_build_object(
            'id', shopping_list.id,
            'forecastStart', shopping_list.forecast_start,
            'forecastEnd', shopping_list.forecast_end,
            'status', shopping_list.status,
            'bufferPercent', shopping_list.buffer_percent,
            'triggerHorizonDays', shopping_list.trigger_horizon_days,
            'estimatedTotalCents', shopping_list.estimated_total_cents,
            'postedAt', shopping_list.posted_at,
            'createdAt', shopping_list.created_at,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', list_item.id,
                'inventoryItemId', list_item.inventory_item_id,
                'displayName', inventory_item.display_name,
                'stockUnit', inventory_item.stock_unit,
                'quantity', list_item.quantity,
                'estimatedUnitPriceCents', list_item.estimated_unit_price_cents,
                'reason', list_item.reason,
                'countToConfirm', list_item.count_to_confirm
              ) order by inventory_item.staple_priority, inventory_item.display_name)
              from airbnb.shopping_list_items list_item
              join airbnb.inventory_items inventory_item
                on inventory_item.household_id = list_item.household_id
               and inventory_item.id = list_item.inventory_item_id
              where list_item.household_id = shopping_list.household_id
                and list_item.shopping_list_id = shopping_list.id
            ), '[]'::jsonb)
          ) as payload
        from airbnb.shopping_lists shopping_list
        where shopping_list.household_id = target_household_id
        order by shopping_list.created_at desc
        limit 20
      ) list_row
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(order_row.payload order by order_row.created_at desc)
      from (
        select
          order_record.created_at,
          jsonb_build_object(
            'id', order_record.id,
            'providerOrderId', order_record.provider_order_id,
            'status', order_record.status,
            'totalCents', order_record.total_cents,
            'addressStatus', order_record.address_status,
            'deliveryDueAt', order_record.delivery_due_at,
            'orderedAt', order_record.ordered_at,
            'createdAt', order_record.created_at
          ) as payload
        from airbnb.orders order_record
        where order_record.household_id = target_household_id
        order by order_record.created_at desc
        limit 50
      ) order_row
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(alert_row.payload order by alert_row.opened_at desc)
      from (
        select
          alert.opened_at,
          jsonb_build_object(
            'id', alert.id,
            'type', alert.alert_type,
            'severity', alert.severity,
            'status', alert.status,
            'summary', alert.summary,
            'openedAt', alert.opened_at,
            'notifiedAt', alert.notified_at
          ) as payload
        from airbnb.alerts alert
        where alert.household_id = target_household_id
        order by (alert.status in ('open', 'notified')) desc, alert.opened_at desc
        limit 50
      ) alert_row
    ), '[]'::jsonb),
    'jobRuns', coalesce((
      select jsonb_agg(run_row.payload order by run_row.started_at desc)
      from (
        select
          run.started_at,
          jsonb_build_object(
            'id', run.id,
            'service', run.service,
            'jobName', run.job_name,
            'status', run.status,
            'targetDate', run.target_date,
            'startedAt', run.started_at,
            'completedAt', run.completed_at,
            'errorCode', run.error_code,
            'receipt', run.receipt - array[
              'authorization', 'apiKey', 'api_key', 'token', 'accessToken',
              'refreshToken', 'password', 'secret', 'headers', 'raw', 'rawBody',
              'emailBody'
            ]
          ) as payload
        from airbnb.job_runs run
        where run.household_id = target_household_id
        order by run.started_at desc
        limit 50
      ) run_row
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(evidence_row.payload order by evidence_row.occurred_at desc)
      from (
        select
          evidence.occurred_at,
          jsonb_build_object(
            'id', evidence.id,
            'mailboxScope', evidence.mailbox_scope,
            'provider', evidence.provider,
            'kind', evidence.evidence_kind,
            'subtype', evidence.evidence_subtype,
            'subject', evidence.subject,
            'occurredAt', evidence.occurred_at,
            'ingestedAt', evidence.ingested_at,
            'contentHash', evidence.content_hash
          ) as payload
        from airbnb.evidence evidence
        where evidence.household_id = target_household_id
        order by evidence.occurred_at desc
        limit 100
      ) evidence_row
    ), '[]'::jsonb),
    'auditEvents', coalesce((
      select jsonb_agg(audit_row.payload order by audit_row.occurred_at desc)
      from (
        select
          audit.occurred_at,
          jsonb_build_object(
            'id', audit.id,
            'actorType', audit.actor_type,
            'action', audit.action,
            'entityType', audit.entity_type,
            'entityId', audit.entity_id,
            'details', audit.details,
            'occurredAt', audit.occurred_at
          ) as payload
        from airbnb.audit_events audit
        where audit.household_id = target_household_id
        order by audit.occurred_at desc
        limit 100
      ) audit_row
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.airbnb_update_order_status(
  target_order_id uuid,
  next_status text,
  next_delivery_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_record airbnb.orders%rowtype;
begin
  select * into order_record
  from airbnb.orders
  where id = target_order_id
  for update;
  if not found or not private.has_household_role(order_record.household_id, null) then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  if order_record.address_status <> 'bowie_1' then
    raise exception 'Only verified 1 Bowie orders can be managed here.';
  end if;
  if next_status not in ('ordered', 'delivery_due', 'delivered', 'cancelled') then
    raise exception 'Invalid order status.';
  end if;

  update airbnb.orders
  set status = next_status,
      delivery_due_at = coalesce(next_delivery_due_at, delivery_due_at),
      ordered_at = case when next_status = 'ordered' then coalesce(ordered_at, now()) else ordered_at end
  where id = target_order_id
  returning * into order_record;

  insert into airbnb.audit_events (
    household_id, actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    order_record.household_id, 'human', auth.uid()::text,
    'order_status_updated', 'order', order_record.id::text,
    jsonb_build_object('status', next_status, 'deliveryDueAt', next_delivery_due_at)
  );

  return jsonb_build_object('id', order_record.id, 'status', order_record.status, 'updatedAt', order_record.updated_at);
end;
$$;

revoke all on function public.airbnb_dashboard_snapshot(uuid) from public, anon;
revoke all on function public.airbnb_update_order_status(uuid, text, timestamptz) from public, anon;
grant execute on function public.airbnb_dashboard_snapshot(uuid) to authenticated, service_role;
grant execute on function public.airbnb_update_order_status(uuid, text, timestamptz) to authenticated, service_role;
