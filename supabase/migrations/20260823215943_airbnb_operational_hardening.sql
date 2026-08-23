-- The regular stock poll and weekly review originally started together at
-- 09:00 SAST on Tuesdays. The stock service deliberately allows only one run
-- at a time, so move the full review five minutes later to make it reliable.
do $migration$
declare
  stock_review_job_id bigint;
begin
  select jobid
  into stock_review_job_id
  from cron.job
  where jobname = 'airbnb-stock-weekly-review-0700-utc'
  limit 1;

  if stock_review_job_id is null then
    raise exception 'Airbnb stock weekly review job is missing.';
  end if;

  perform cron.alter_job(stock_review_job_id, schedule := '5 7 * * 2');
end
$migration$;

-- Stock observations from the two private Airbnb groups are evidence only.
-- They can request a physical count, but cannot create inventory movements.
alter table airbnb.evidence
  drop constraint if exists evidence_evidence_kind_check;
alter table airbnb.evidence
  add constraint evidence_evidence_kind_check check (
    evidence_kind in (
      'confirmed', 'cancelled', 'supplemental', 'ignored', 'order', 'invoice',
      'conversation', 'stock_observation'
    )
  );

drop policy if exists "airbnb stock evidence access" on airbnb.evidence;
create policy "airbnb stock evidence access"
  on airbnb.evidence for all to airbnb_stock_worker
  using (
    household_id = airbnb.current_household_id()
    and evidence_kind in ('order', 'invoice', 'stock_observation')
  )
  with check (
    household_id = airbnb.current_household_id()
    and evidence_kind in ('order', 'invoice', 'stock_observation')
  );

alter table airbnb.shopping_lists
  add column if not exists price_estimate_complete boolean not null default false,
  add column if not exists meets_free_delivery_minimum boolean not null default false;
alter table airbnb.shopping_lists
  add constraint airbnb_shopping_lists_minimum_check check (
    not meets_free_delivery_minimum
    or (
      price_estimate_complete
      and estimated_total_cents >= 35000
    )
  );

insert into airbnb.inventory_items (
  household_id, sku, display_name, category, stock_unit,
  consumption_basis, quantity_per_basis, staple_priority
)
select
  household.id,
  item.sku,
  item.display_name,
  item.category,
  item.stock_unit,
  'manual',
  0::numeric,
  item.staple_priority
from public.households household
cross join (
  values
    ('hand_soap', 'Guest hand soap', 'guest_supply', 'bottle', 115),
    ('towel_set', 'Ready towel sets', 'linen', 'set', 145)
) as item(sku, display_name, category, stock_unit, staple_priority)
where household.name = 'Harewood Household'
on conflict (household_id, sku) do update
set display_name = excluded.display_name,
    category = excluded.category,
    stock_unit = excluded.stock_unit,
    staple_priority = excluded.staple_priority;

-- Replace the cleaner monitor with a delivery contract that treats the chat
-- readback as authoritative. A 2xx from the transport is not enough proof that
-- an alert appeared, and retries must reuse one provider idempotency key.
create or replace function internal.monitor_airbnb_cleaner(
  target_offset integer,
  window_name text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  target_date date;
  scheduler_secret text;
  monitor_config jsonb;
  status_response extensions.http_response;
  alert_response extensions.http_response;
  alert_read_response extensions.http_response;
  receipt jsonb;
  receipt_status text;
  receipt_started_at timestamptz;
  successful_receipt jsonb;
  successful_receipt_started_at timestamptz;
  window_started_at timestamptz;
  alert_text text;
  alert_url text;
  idempotency_key text;
  alert_found boolean;
  alert_accepted boolean;
  alert_attempt integer;
begin
  if target_offset not in (0, 1) or window_name not in ('today', 'tomorrow') then
    raise exception 'Invalid Airbnb cleaner monitor target.';
  end if;

  target_date := (pg_catalog.now() at time zone 'Africa/Johannesburg')::date + target_offset;
  window_started_at := case window_name
    when 'today' then
      (target_date::timestamp + time '12:00') at time zone 'Africa/Johannesburg'
    else
      ((target_date - 1)::timestamp + time '13:30') at time zone 'Africa/Johannesburg'
  end;

  select decrypted_secret
  into scheduler_secret
  from vault.decrypted_secrets
  where name = 'tristdrum_airbnb_cleaner_scheduler_secret'
  order by created_at desc
  limit 1;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');

  begin
    select response.*
    into status_response
    from extensions.http((
      'GET',
      'https://tristdrum-airbnb-cleaner.fly.dev/status?date=' || target_date::text,
      array[
        ('X-Airbnb-Cleaner-Scheduler-Secret', coalesce(scheduler_secret, ''))::extensions.http_header
      ],
      null,
      null
    )::extensions.http_request) as response;

    if status_response.status = 200 then
      receipt := status_response.content::jsonb;
      receipt_status := receipt ->> 'status';
      receipt_started_at := nullif(receipt ->> 'startedAt', '')::timestamptz;
      successful_receipt := case
        when receipt_status in ('sent', 'duplicate_skipped') then receipt
        else receipt -> 'previousSuccess'
      end;
      successful_receipt_started_at := nullif(successful_receipt ->> 'startedAt', '')::timestamptz;
    end if;
  exception when others then
    receipt := null;
    receipt_status := null;
    receipt_started_at := null;
    successful_receipt := null;
    successful_receipt_started_at := null;
  end;

  if (
    coalesce(receipt -> 'failureAlert' ->> 'verifiedFromChat', 'false') = 'true'
    and receipt_started_at >= window_started_at
  ) or (
    coalesce(receipt_status, '') <> 'blocked'
    and coalesce(successful_receipt ->> 'status', '') in ('sent', 'duplicate_skipped')
    and successful_receipt_started_at >= window_started_at
  )
  then
    return pg_catalog.jsonb_build_object(
      'targetDate', target_date,
      'receiptStatus', receipt_status,
      'alerted', false
    );
  end if;

  select decrypted_secret::jsonb
  into monitor_config
  from vault.decrypted_secrets
  where name = 'tristdrum_airbnb_cleaner_monitor_config'
  order by created_at desc
  limit 1;

  if monitor_config is null
    or coalesce(monitor_config ->> 'baseUrl', '') = ''
    or coalesce(monitor_config ->> 'apiKey', '') = ''
    or coalesce(monitor_config ->> 'accountId', '') = ''
    or coalesce(monitor_config ->> 'alertChatId', '') = ''
    or coalesce(monitor_config ->> 'cleanersChatId', '') = ''
  then
    raise exception 'Airbnb cleaner monitor configuration is incomplete.';
  end if;

  if monitor_config ->> 'alertChatId' = monitor_config ->> 'cleanersChatId' then
    raise exception 'Airbnb cleaner monitor must not alert the cleaners chat.';
  end if;

  alert_url :=
    pg_catalog.rtrim(monitor_config ->> 'baseUrl', '/')
    || '/api/v1/whatsapp/accounts/'
    || (monitor_config ->> 'accountId')
    || '/chats/'
    || (monitor_config ->> 'alertChatId')
    || '/messages';
  alert_text := case
    when receipt_status = 'blocked' then
      'Airbnb cleaner plan is blocked by an occupancy confidence check for '
      || target_date::text
      || '. Check the reservation evidence before cleaning.'
    else
      'Airbnb cleaner cloud '
      || window_name
      || ' schedule is missing after all retries for '
      || target_date::text
      || '. Check Fly and Supabase before the cleaning window.'
  end;
  idempotency_key := 'airbnb-cleaner-monitor:' || window_name || ':' || target_date::text;

  for alert_attempt in 1..3 loop
    alert_accepted := false;
    begin
      select response.*
      into alert_response
      from extensions.http((
        'POST',
        alert_url || '?dry_run=true',
        array[
          ('Content-Type', 'application/json')::extensions.http_header,
          ('X-Min-API-Key', monitor_config ->> 'apiKey')::extensions.http_header,
          ('Idempotency-Key', idempotency_key || ':dry-run')::extensions.http_header
        ],
        'application/json',
        pg_catalog.jsonb_build_object('text', alert_text)::text
      )::extensions.http_request) as response;

      if alert_response.status < 200 or alert_response.status >= 300 then
        raise exception 'Airbnb cleaner monitor alert dry-run failed with HTTP %.', alert_response.status;
      end if;

      select response.*
      into alert_response
      from extensions.http((
        'POST',
        alert_url,
        array[
          ('Content-Type', 'application/json')::extensions.http_header,
          ('X-Min-API-Key', monitor_config ->> 'apiKey')::extensions.http_header,
          ('Idempotency-Key', idempotency_key)::extensions.http_header
        ],
        'application/json',
        pg_catalog.jsonb_build_object('text', alert_text)::text
      )::extensions.http_request) as response;

      alert_accepted := alert_response.status >= 200 and alert_response.status < 300;
    exception when others then
      alert_accepted := false;
    end;

    perform pg_catalog.pg_sleep(alert_attempt);
    begin
      select response.*
      into alert_read_response
      from extensions.http((
        'GET',
        alert_url || '?limit=20',
        array[
          ('X-Min-API-Key', monitor_config ->> 'apiKey')::extensions.http_header
        ],
        null,
        null
      )::extensions.http_request) as response;

      if alert_read_response.status < 200 or alert_read_response.status >= 300 then
        raise exception 'Airbnb cleaner monitor readback failed with HTTP %.', alert_read_response.status;
      end if;

      select exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          coalesce(alert_read_response.content::jsonb -> 'messages', '[]'::jsonb)
        ) as outbound(message)
        where coalesce(outbound.message ->> 'from_me', 'false') = 'true'
          and outbound.message ->> 'text' = alert_text
      ) into alert_found;
    exception when others then
      alert_found := false;
    end;

    if alert_found then
      return pg_catalog.jsonb_build_object(
        'targetDate', target_date,
        'receiptStatus', receipt_status,
        'alerted', true,
        'transportAccepted', alert_accepted,
        'verifiedFromChat', true,
        'attempts', alert_attempt
      );
    end if;
  end loop;

  raise exception 'Airbnb cleaner monitor alert was not found in chat after all retries.';
end;
$function$;

revoke all on function internal.monitor_airbnb_cleaner(integer, text) from public, anon, authenticated;

create or replace function public.airbnb_record_stock_count(
  target_household_id uuid,
  target_inventory_item_id uuid,
  quantity_on_hand numeric,
  note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inventory_item airbnb.inventory_items%rowtype;
  current_quantity numeric;
  quantity_delta numeric;
  movement_id uuid;
  counted_at timestamptz := pg_catalog.now();
begin
  if not private.has_household_role(target_household_id, null) then
    raise exception 'Household access denied.' using errcode = '42501';
  end if;
  if quantity_on_hand is null or quantity_on_hand < 0 then
    raise exception 'Physical stock count must be zero or greater.';
  end if;

  select *
  into inventory_item
  from airbnb.inventory_items item
  where item.household_id = target_household_id
    and item.id = target_inventory_item_id
  for update;
  if not found then
    raise exception 'Inventory item not found.' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.sum(movement.quantity_delta), 0)
  into current_quantity
  from airbnb.inventory_movements movement
  where movement.household_id = target_household_id
    and movement.inventory_item_id = target_inventory_item_id;
  quantity_delta := quantity_on_hand - current_quantity;

  if quantity_delta <> 0 then
    insert into airbnb.inventory_movements (
      household_id, inventory_item_id, movement_type, quantity_delta,
      confidence, source_type, source_id, dedupe_key, note, occurred_at
    ) values (
      target_household_id, target_inventory_item_id, 'adjustment', quantity_delta,
      'manual', 'manual', auth.uid()::text,
      'physical-count:' || pg_catalog.gen_random_uuid()::text,
      nullif(pg_catalog.btrim(note), ''), counted_at
    ) returning id into movement_id;
  end if;

  update airbnb.inventory_items
  set count_status = 'confirmed',
      last_counted_at = counted_at,
      updated_at = counted_at
  where household_id = target_household_id
    and id = target_inventory_item_id;

  insert into airbnb.audit_events (
    household_id, actor_type, actor_id, action, entity_type, entity_id, details, occurred_at
  ) values (
    target_household_id, 'human', auth.uid()::text, 'stock_counted',
    'inventory_item', target_inventory_item_id::text,
    pg_catalog.jsonb_build_object(
      'quantityOnHand', quantity_on_hand,
      'quantityDelta', quantity_delta,
      'movementId', movement_id
    ),
    counted_at
  );

  return pg_catalog.jsonb_build_object(
    'inventoryItemId', target_inventory_item_id,
    'quantityOnHand', quantity_on_hand,
    'quantityDelta', quantity_delta,
    'movementId', movement_id,
    'countStatus', 'confirmed',
    'countedAt', counted_at
  );
end;
$function$;

create or replace function public.airbnb_mark_shopping_list_ordered(
  target_shopping_list_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  shopping_list airbnb.shopping_lists%rowtype;
  ordered_at timestamptz := pg_catalog.now();
begin
  select *
  into shopping_list
  from airbnb.shopping_lists list
  where list.id = target_shopping_list_id
  for update;

  if not found or not private.has_household_role(shopping_list.household_id, null) then
    raise exception 'Shopping list not found.' using errcode = '42501';
  end if;
  if shopping_list.status not in ('draft', 'posted', 'ordered') then
    raise exception 'Shopping list can no longer be marked ordered.';
  end if;

  update airbnb.shopping_lists
  set status = 'ordered', updated_at = ordered_at
  where household_id = shopping_list.household_id
    and id = shopping_list.id
  returning * into shopping_list;

  update airbnb.alerts
  set status = 'resolved', resolved_at = ordered_at, updated_at = ordered_at
  where household_id = shopping_list.household_id
    and alert_type = 'stock_low'
    and status in ('suppressed', 'notified')
    and nullif(details->>'shoppingListId', '')::uuid = shopping_list.id;

  insert into airbnb.audit_events (
    household_id, actor_type, actor_id, action, entity_type, entity_id, details, occurred_at
  ) values (
    shopping_list.household_id, 'human', auth.uid()::text,
    'shopping_list_ordered', 'shopping_list', shopping_list.id::text,
    pg_catalog.jsonb_build_object('estimatedTotalCents', shopping_list.estimated_total_cents),
    ordered_at
  );

  return pg_catalog.jsonb_build_object(
    'id', shopping_list.id,
    'status', shopping_list.status,
    'updatedAt', shopping_list.updated_at
  );
end;
$function$;

revoke all on function public.airbnb_record_stock_count(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.airbnb_mark_shopping_list_ordered(uuid) from public, anon;
grant execute on function public.airbnb_record_stock_count(uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.airbnb_mark_shopping_list_ordered(uuid) to authenticated, service_role;

-- Recursively remove credential-shaped fields from every nested receipt and
-- audit payload before the private dashboard receives it.
create or replace function private.airbnb_redact_jsonb(input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  output jsonb;
  entry record;
begin
  if input is null then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(input) = 'object' then
    output := '{}'::jsonb;
    for entry in select key, value from pg_catalog.jsonb_each(input)
    loop
      if entry.key ~* '^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|headers?|raw(?:body)?|email(?:body)?|cookie|credentials?)$' then
        continue;
      end if;
      output := output || pg_catalog.jsonb_build_object(
        entry.key,
        private.airbnb_redact_jsonb(entry.value)
      );
    end loop;
    return output;
  end if;
  if pg_catalog.jsonb_typeof(input) = 'array' then
    select coalesce(
      pg_catalog.jsonb_agg(private.airbnb_redact_jsonb(item.value) order by item.position),
      '[]'::jsonb
    )
    into output
    from pg_catalog.jsonb_array_elements(input) with ordinality item(value, position);
    return output;
  end if;
  return input;
end;
$function$;

revoke all on function private.airbnb_redact_jsonb(jsonb) from public, anon, authenticated, service_role;

create or replace function public.airbnb_dashboard_snapshot(target_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  snapshot jsonb;
begin
  snapshot := private.airbnb_dashboard_snapshot_base(target_household_id);

  snapshot := pg_catalog.jsonb_set(
    snapshot,
    '{shoppingLists}',
    coalesce((
      select pg_catalog.jsonb_agg(
        rows.item || pg_catalog.jsonb_build_object(
          'priceEstimateComplete', shopping_list.price_estimate_complete,
          'meetsFreeDeliveryMinimum', shopping_list.meets_free_delivery_minimum
        )
        order by rows.position
      )
      from pg_catalog.jsonb_array_elements(snapshot->'shoppingLists')
        with ordinality rows(item, position)
      join airbnb.shopping_lists shopping_list
        on shopping_list.household_id = target_household_id
       and shopping_list.id = (rows.item->>'id')::uuid
      where rows.item->>'status' <> 'superseded'
    ), '[]'::jsonb)
  );

  snapshot := pg_catalog.jsonb_set(
    snapshot,
    '{orders}',
    coalesce((
      select pg_catalog.jsonb_agg(item order by position)
      from pg_catalog.jsonb_array_elements(snapshot->'orders') with ordinality rows(item, position)
      where item->>'addressStatus' = 'bowie_1'
    ), '[]'::jsonb)
  );

  snapshot := pg_catalog.jsonb_set(
    snapshot,
    '{guestThreads}',
    coalesce((
      select pg_catalog.jsonb_agg(thread_row.payload order by thread_row.updated_at desc)
      from (
        select
          thread.updated_at,
          pg_catalog.jsonb_build_object(
            'id', thread.id,
            'guestName', thread.guest_display_name,
            'status', thread.status,
            'riskTier', thread.risk_tier,
            'lastGuestAt', thread.last_guest_at,
            'lastHostAt', thread.last_host_at,
            'latestMessage', (
              select pg_catalog.left(message.body_normalized, 500)
              from airbnb.guest_messages message
              where message.household_id = thread.household_id
                and message.thread_id = thread.id
              order by message.provider_sent_at desc
              limit 1
            ),
            'recentMessages', coalesce((
              select pg_catalog.jsonb_agg(message_row.payload order by message_row.provider_sent_at)
              from (
                select
                  message.provider_sent_at,
                  pg_catalog.jsonb_build_object(
                    'id', message.id,
                    'direction', message.direction,
                    'body', pg_catalog.left(message.body_normalized, 1000),
                    'sentAt', message.provider_sent_at
                  ) as payload
                from airbnb.guest_messages message
                where message.household_id = thread.household_id
                  and message.thread_id = thread.id
                order by message.provider_sent_at desc
                limit 6
              ) message_row
            ), '[]'::jsonb)
          ) as payload
        from airbnb.guest_threads thread
        where thread.household_id = target_household_id
        order by thread.updated_at desc
        limit 50
      ) thread_row
    ), '[]'::jsonb)
  );

  snapshot := pg_catalog.jsonb_set(
    snapshot,
    '{replyDeliveries}',
    coalesce((
      select pg_catalog.jsonb_agg(delivery_row.payload order by delivery_row.updated_at desc)
      from (
        select
          delivery.updated_at,
          pg_catalog.jsonb_build_object(
            'id', delivery.id,
            'threadId', delivery.thread_id,
            'guestName', thread.guest_display_name,
            'listingName', property.listing_name,
            'latestGuestMessage', (
              select pg_catalog.left(message.body_normalized, 1000)
              from airbnb.guest_messages message
              where message.household_id = delivery.household_id
                and message.thread_id = delivery.thread_id
                and message.direction = 'guest'
              order by message.provider_sent_at desc
              limit 1
            ),
            'recentMessages', coalesce((
              select pg_catalog.jsonb_agg(message_row.payload order by message_row.provider_sent_at)
              from (
                select
                  message.provider_sent_at,
                  pg_catalog.jsonb_build_object(
                    'id', message.id,
                    'direction', message.direction,
                    'body', pg_catalog.left(message.body_normalized, 1000),
                    'sentAt', message.provider_sent_at
                  ) as payload
                from airbnb.guest_messages message
                where message.household_id = delivery.household_id
                  and message.thread_id = delivery.thread_id
                order by message.provider_sent_at desc
                limit 6
              ) message_row
            ), '[]'::jsonb),
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
    ), '[]'::jsonb)
  );

  return private.airbnb_redact_jsonb(snapshot);
end;
$function$;

revoke all on function public.airbnb_dashboard_snapshot(uuid) from public, anon;
grant execute on function public.airbnb_dashboard_snapshot(uuid) to authenticated, service_role;
