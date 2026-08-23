set lock_timeout = '5s';
set statement_timeout = '60s';

-- Keep the deployed migration immutable. This follow-up is safe whether the
-- previous release is still pending or was applied outside this rollout.
do $scheduler$
declare
  stock_review_job_id bigint;
  stock_management_job_id bigint;
begin
  select jobid
  into stock_review_job_id
  from cron.job
  where jobname = 'airbnb-stock-weekly-review-0700-utc'
  limit 1;

  select jobid
  into stock_management_job_id
  from cron.job
  where jobname = 'airbnb-stock-management-alerts-10-40'
  limit 1;

  if stock_review_job_id is null or stock_management_job_id is null then
    raise exception 'Airbnb stock scheduler inventory is incomplete.';
  end if;

  perform cron.alter_job(stock_review_job_id, schedule := '0,20 4 * * 2');
  perform cron.alter_job(stock_management_job_id, schedule := '15,45 5-19 * * *');
end
$scheduler$;

-- Store the highest delivered occurrence on the existing content row. Keeping
-- the original three-column unique constraint preserves rollback compatibility
-- with the previous cleaner image.
alter table airbnb.cleaner_plans
  add column if not exists content_occurrence integer not null default 1;
alter table airbnb.cleaner_plans
  drop constraint if exists airbnb_cleaner_plans_content_occurrence_check;
alter table airbnb.cleaner_plans
  add constraint airbnb_cleaner_plans_content_occurrence_check check (content_occurrence > 0);

alter table airbnb.shopping_lists
  drop constraint if exists airbnb_shopping_lists_minimum_check;
alter table airbnb.shopping_lists
  add constraint airbnb_shopping_lists_minimum_check check (
    not meets_free_delivery_minimum
    or (
      price_estimate_complete
      and estimated_total_cents is not null
      and estimated_total_cents >= 35000
    )
  );

do $inventory_seed$
declare
  target_household_id uuid;
  matching_households integer;
begin
  select pg_catalog.count(*)::integer
  into matching_households
  from public.households household
  where household.name = 'Harewood Household';

  if matching_households = 0 then
    return;
  end if;
  if matching_households > 1 then
    raise exception 'Expected at most one Harewood Household, found %.', matching_households;
  end if;

  select household.id
  into target_household_id
  from public.households household
  where household.name = 'Harewood Household'
  order by household.created_at, household.id
  limit 1;

  insert into airbnb.inventory_items (
    household_id, sku, display_name, category, stock_unit,
    consumption_basis, quantity_per_basis, staple_priority
  )
  select
    target_household_id,
    item.sku,
    item.display_name,
    item.category,
    item.stock_unit,
    'manual',
    0::numeric,
    item.staple_priority
  from (
    values
      ('hand_soap', 'Guest hand soap', 'guest_supply', 'bottle', 115),
      ('towel_set', 'Ready towel sets', 'linen', 'set', 145)
  ) as item(sku, display_name, category, stock_unit, staple_priority)
  on conflict (household_id, sku) do update
  set display_name = excluded.display_name,
      category = excluded.category,
      stock_unit = excluded.stock_unit,
      staple_priority = excluded.staple_priority;
end
$inventory_seed$;

alter table airbnb.inventory_items
  add column if not exists last_count_quantity numeric(12, 3);
alter table airbnb.inventory_items
  drop constraint if exists airbnb_inventory_items_last_count_quantity_check;
alter table airbnb.inventory_items
  add constraint airbnb_inventory_items_last_count_quantity_check check (
    last_count_quantity is null or last_count_quantity >= 0
  );

create or replace view airbnb.inventory_balances
with (security_invoker = true)
as
select
  item.id,
  item.household_id,
  item.sku,
  item.display_name,
  item.category,
  item.stock_unit,
  item.consumption_basis,
  item.quantity_per_basis,
  item.target_unit_price_cents,
  item.staple_priority,
  item.count_status,
  item.last_counted_at,
  item.active,
  case
    when item.last_counted_at is not null and item.last_count_quantity is not null then
      item.last_count_quantity + coalesce(
        pg_catalog.sum(movement.quantity_delta) filter (
          where movement.occurred_at > item.last_counted_at
        ),
        0::numeric
      )
    else coalesce(pg_catalog.sum(movement.quantity_delta), 0::numeric)
  end as quantity_on_hand,
  pg_catalog.max(movement.occurred_at) as last_movement_at
from airbnb.inventory_items item
left join airbnb.inventory_movements movement
  on movement.household_id = item.household_id
 and movement.inventory_item_id = item.id
group by item.id;

revoke all on table airbnb.inventory_balances from public, anon, authenticated, airbnb_worker;
grant select on table airbnb.inventory_balances to service_role, airbnb_stock_worker;

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

  select balance.quantity_on_hand
  into current_quantity
  from airbnb.inventory_balances balance
  where balance.household_id = target_household_id
    and balance.id = target_inventory_item_id;
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
      last_count_quantity = quantity_on_hand,
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

revoke all on function public.airbnb_record_stock_count(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.airbnb_record_stock_count(uuid, uuid, numeric, text) to authenticated, service_role;

create or replace function private.airbnb_redact_jsonb(input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  output jsonb;
  entry record;
  text_value text;
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
  if pg_catalog.jsonb_typeof(input) = 'string' then
    text_value := input #>> '{}';
    text_value := pg_catalog.regexp_replace(
      text_value,
      '(bearer|basic)[[:space:]]+[[:alnum:]._~+/=-]+',
      '\1 [REDACTED]',
      'gi'
    );
    text_value := pg_catalog.regexp_replace(
      text_value,
      '(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|cookie|credentials?)["'']?[[:space:]]*[:=][[:space:]]*("[^"]*"|''[^'']*''|[^[:space:]&,;}]+)',
      '\1=[REDACTED]',
      'gi'
    );
    text_value := pg_catalog.regexp_replace(
      text_value,
      '(postgres(ql)?://)[^[:space:]''",]+',
      '\1[REDACTED]',
      'gi'
    );
    return pg_catalog.to_jsonb(text_value);
  end if;
  return input;
end;
$function$;

revoke all on function private.airbnb_redact_jsonb(jsonb) from public, anon, authenticated, service_role;
