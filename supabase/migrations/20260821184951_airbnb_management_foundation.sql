set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists airbnb;
revoke all on schema airbnb from public, anon, authenticated;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'airbnb_worker') then
    create role airbnb_worker nologin noinherit;
  end if;
end
$role$;

grant usage on schema airbnb to service_role, airbnb_worker;

create table airbnb.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  unit_number smallint not null check (unit_number > 0),
  listing_name text not null check (btrim(listing_name) <> ''),
  common_name text not null check (btrim(common_name) <> ''),
  external_listing_id text,
  timezone text not null default 'Africa/Johannesburg',
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_properties_household_unit_key unique (household_id, unit_number),
  constraint airbnb_properties_household_id_id_key unique (household_id, id)
);

create table airbnb.evidence (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  mailbox_scope text not null check (mailbox_scope in ('tristan', 'jane', 'whatsapp', 'manual')),
  provider text not null check (provider in ('gmail', 'whatsapp', 'sixty60', 'manual')),
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  provider_thread_id text,
  sender_address text,
  subject text,
  evidence_kind text not null check (
    evidence_kind in ('confirmed', 'cancelled', 'supplemental', 'ignored', 'order', 'invoice', 'conversation')
  ),
  evidence_subtype text,
  occurred_at timestamptz not null,
  content_hash text not null check (btrim(content_hash) <> ''),
  normalized_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_payload) = 'object'),
  ingested_at timestamptz not null default now(),
  constraint airbnb_evidence_provider_message_key
    unique (household_id, mailbox_scope, provider, provider_message_id),
  constraint airbnb_evidence_household_id_id_key unique (household_id, id)
);

create table airbnb.reservations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  property_id uuid not null,
  confirmation_code text not null check (btrim(confirmation_code) <> ''),
  guest_name text,
  check_in date not null,
  check_out date not null check (check_out > check_in),
  adults integer not null default 0 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  infants integer not null default 0 check (infants >= 0),
  guest_count_known boolean not null default true,
  booking_status text not null check (booking_status in ('confirmed', 'cancelled')),
  authoritative_evidence_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  source_cutoff_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_reservations_household_confirmation_key unique (household_id, confirmation_code),
  constraint airbnb_reservations_household_id_id_key unique (household_id, id),
  constraint airbnb_reservations_property_fkey
    foreign key (household_id, property_id)
    references airbnb.properties (household_id, id) on delete restrict,
  constraint airbnb_reservations_authoritative_evidence_fkey
    foreign key (household_id, authoritative_evidence_id)
    references airbnb.evidence (household_id, id) on delete restrict,
  constraint airbnb_reservations_guest_total_check check (
    not guest_count_known or adults + children > 0
  )
);

create table airbnb.reservation_evidence (
  household_id uuid not null references public.households (id) on delete restrict,
  reservation_id uuid not null,
  evidence_id uuid not null,
  relationship text not null check (relationship in ('confirmation', 'update', 'cancellation', 'supplemental')),
  linked_at timestamptz not null default now(),
  primary key (household_id, reservation_id, evidence_id),
  constraint airbnb_reservation_evidence_reservation_fkey
    foreign key (household_id, reservation_id)
    references airbnb.reservations (household_id, id) on delete restrict,
  constraint airbnb_reservation_evidence_evidence_fkey
    foreign key (household_id, evidence_id)
    references airbnb.evidence (household_id, id) on delete restrict
);

create table airbnb.guest_threads (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  provider_thread_id text not null check (btrim(provider_thread_id) <> ''),
  canonical_mailbox text not null default 'tristan' check (canonical_mailbox in ('tristan', 'jane')),
  reservation_id uuid,
  guest_display_name text,
  status text not null default 'open' check (status in ('open', 'handled', 'needs_human', 'closed')),
  risk_tier text not null default 'unknown' check (risk_tier in ('low', 'high', 'unknown')),
  last_guest_at timestamptz,
  last_host_at timestamptz,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_guest_threads_provider_key unique (household_id, canonical_mailbox, provider_thread_id),
  constraint airbnb_guest_threads_household_id_id_key unique (household_id, id),
  constraint airbnb_guest_threads_reservation_fkey
    foreign key (household_id, reservation_id)
    references airbnb.reservations (household_id, id) on delete restrict
);

create table airbnb.guest_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  thread_id uuid not null,
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  provider_thread_id text not null check (btrim(provider_thread_id) <> ''),
  direction text not null check (direction in ('guest', 'host', 'system')),
  sender_label text,
  sender_mailbox text,
  body_normalized text not null,
  content_hash text not null check (btrim(content_hash) <> ''),
  provider_sent_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  constraint airbnb_guest_messages_provider_key unique (household_id, provider_message_id),
  constraint airbnb_guest_messages_household_id_id_key unique (household_id, id),
  constraint airbnb_guest_messages_thread_fkey
    foreign key (household_id, thread_id)
    references airbnb.guest_threads (household_id, id) on delete restrict
);

create table airbnb.reply_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  thread_id uuid not null,
  source_fingerprint text not null check (btrim(source_fingerprint) <> ''),
  source_last_event_at timestamptz not null,
  topic text,
  risk_tier text not null check (risk_tier in ('low', 'high', 'unknown')),
  classification jsonb not null default '{}'::jsonb check (jsonb_typeof(classification) = 'object'),
  draft_text text,
  final_text text,
  footer text not null default 'Automated reply on behalf of your hosts.',
  status text not null default 'draft' check (
    status in ('draft', 'needs_approval', 'approved', 'sending', 'sent', 'handled_by_human', 'cancelled', 'failed')
  ),
  cancellation_reason text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  outbound_message_id text not null check (btrim(outbound_message_id) <> ''),
  provider_sent_message_id text,
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_reply_deliveries_idempotency_key unique (idempotency_key),
  constraint airbnb_reply_deliveries_outbound_message_key unique (outbound_message_id),
  constraint airbnb_reply_deliveries_household_id_id_key unique (household_id, id),
  constraint airbnb_reply_deliveries_thread_fkey
    foreign key (household_id, thread_id)
    references airbnb.guest_threads (household_id, id) on delete restrict
);

create table airbnb.cleaner_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  run_id text not null check (btrim(run_id) <> ''),
  target_date date not null,
  mode text not null check (mode in ('preview', 'dry-run', 'live')),
  delivery_status text not null check (
    delivery_status in ('preview', 'dry_run_ok', 'sent', 'duplicate_skipped', 'blocked', 'error')
  ),
  message_hash text not null check (btrim(message_hash) <> ''),
  message_text text,
  is_update boolean not null default false,
  unit_states jsonb not null default '[]'::jsonb check (jsonb_typeof(unit_states) = 'array'),
  confidence jsonb not null default '{}'::jsonb check (jsonb_typeof(confidence) = 'object'),
  source_cutoff_at timestamptz,
  whatsapp_chat_id text,
  provider_message_id text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint airbnb_cleaner_plans_run_key unique (household_id, run_id),
  constraint airbnb_cleaner_plans_content_key unique (household_id, target_date, message_hash),
  constraint airbnb_cleaner_plans_household_id_id_key unique (household_id, id)
);

create table airbnb.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  sku text not null check (btrim(sku) <> ''),
  display_name text not null check (btrim(display_name) <> ''),
  category text not null check (category in ('guest_supply', 'cleaning', 'laundry', 'linen', 'tableware')),
  stock_unit text not null check (btrim(stock_unit) <> ''),
  consumption_basis text not null default 'manual' check (consumption_basis in ('per_guest', 'per_stay', 'manual')),
  quantity_per_basis numeric(12, 3) not null default 0 check (quantity_per_basis >= 0),
  target_unit_price_cents bigint check (target_unit_price_cents is null or target_unit_price_cents >= 0),
  staple_priority integer not null default 100 check (staple_priority >= 0),
  count_status text not null default 'confirm' check (count_status in ('confirmed', 'inferred', 'confirm')),
  last_counted_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_inventory_items_sku_key unique (household_id, sku),
  constraint airbnb_inventory_items_household_id_id_key unique (household_id, id)
);

create table airbnb.orders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  provider text not null default 'checkers_sixty60',
  provider_order_id text,
  status text not null check (
    status in ('suggested', 'ordered', 'confirmation_received', 'invoiced', 'delivery_due', 'delivered', 'cancelled', 'ignored')
  ),
  total_cents bigint check (total_cents is null or total_cents >= 0),
  confirmation_evidence_id uuid,
  invoice_evidence_id uuid,
  delivery_address_normalized text,
  address_status text not null default 'unknown' check (address_status in ('unknown', 'bowie_1', 'other')),
  delivery_due_at timestamptz,
  inventory_credited_at timestamptz,
  ordered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_orders_provider_order_key unique (household_id, provider, provider_order_id),
  constraint airbnb_orders_household_id_id_key unique (household_id, id),
  constraint airbnb_orders_confirmation_evidence_fkey
    foreign key (household_id, confirmation_evidence_id)
    references airbnb.evidence (household_id, id) on delete restrict,
  constraint airbnb_orders_invoice_evidence_fkey
    foreign key (household_id, invoice_evidence_id)
    references airbnb.evidence (household_id, id) on delete restrict,
  constraint airbnb_orders_credit_address_check check (
    inventory_credited_at is null or address_status = 'bowie_1'
  )
);

create table airbnb.order_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  order_id uuid not null,
  inventory_item_id uuid,
  provider_line_id text,
  description text not null check (btrim(description) <> ''),
  quantity numeric(12, 3) not null check (quantity > 0),
  stock_unit text,
  line_total_cents bigint check (line_total_cents is null or line_total_cents >= 0),
  credited_quantity numeric(12, 3) not null default 0 check (credited_quantity >= 0),
  created_at timestamptz not null default now(),
  constraint airbnb_order_items_provider_line_key
    unique (household_id, order_id, provider_line_id),
  constraint airbnb_order_items_household_id_id_key unique (household_id, id),
  constraint airbnb_order_items_order_fkey
    foreign key (household_id, order_id)
    references airbnb.orders (household_id, id) on delete restrict,
  constraint airbnb_order_items_inventory_item_fkey
    foreign key (household_id, inventory_item_id)
    references airbnb.inventory_items (household_id, id) on delete restrict
);

create table airbnb.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  inventory_item_id uuid not null,
  movement_type text not null check (
    movement_type in ('opening_balance', 'purchase', 'consumption', 'adjustment', 'waste')
  ),
  quantity_delta numeric(12, 3) not null check (quantity_delta <> 0),
  confidence text not null check (confidence in ('confirmed', 'inferred', 'manual')),
  source_type text not null check (source_type in ('reservation', 'invoice', 'manual', 'whatsapp', 'system')),
  source_id text,
  dedupe_key text not null check (btrim(dedupe_key) <> ''),
  order_id uuid,
  order_item_id uuid,
  note text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint airbnb_inventory_movements_dedupe_key unique (household_id, dedupe_key),
  constraint airbnb_inventory_movements_household_id_id_key unique (household_id, id),
  constraint airbnb_inventory_movements_item_fkey
    foreign key (household_id, inventory_item_id)
    references airbnb.inventory_items (household_id, id) on delete restrict,
  constraint airbnb_inventory_movements_order_fkey
    foreign key (household_id, order_id)
    references airbnb.orders (household_id, id) on delete restrict,
  constraint airbnb_inventory_movements_order_item_fkey
    foreign key (household_id, order_item_id)
    references airbnb.order_items (household_id, id) on delete restrict
);

create table airbnb.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  forecast_start date not null,
  forecast_end date not null check (forecast_end >= forecast_start),
  status text not null default 'draft' check (status in ('draft', 'posted', 'ordered', 'superseded')),
  buffer_percent integer not null default 25 check (buffer_percent between 0 and 200),
  trigger_horizon_days integer not null default 3 check (trigger_horizon_days > 0),
  estimated_total_cents bigint check (estimated_total_cents is null or estimated_total_cents >= 0),
  demand_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(demand_snapshot) = 'object'),
  content_hash text not null check (btrim(content_hash) <> ''),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_shopping_lists_content_key unique (household_id, content_hash),
  constraint airbnb_shopping_lists_household_id_id_key unique (household_id, id)
);

create table airbnb.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  shopping_list_id uuid not null,
  inventory_item_id uuid not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  estimated_unit_price_cents bigint check (estimated_unit_price_cents is null or estimated_unit_price_cents >= 0),
  reason text not null,
  count_to_confirm boolean not null default false,
  created_at timestamptz not null default now(),
  constraint airbnb_shopping_list_items_item_key unique (household_id, shopping_list_id, inventory_item_id),
  constraint airbnb_shopping_list_items_household_id_id_key unique (household_id, id),
  constraint airbnb_shopping_list_items_list_fkey
    foreign key (household_id, shopping_list_id)
    references airbnb.shopping_lists (household_id, id) on delete restrict,
  constraint airbnb_shopping_list_items_inventory_item_fkey
    foreign key (household_id, inventory_item_id)
    references airbnb.inventory_items (household_id, id) on delete restrict
);

create table airbnb.alerts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  alert_type text not null check (
    alert_type in ('cleaner_failure', 'confidence_blocked', 'guest_escalation', 'guest_overdue', 'stock_low', 'order_update')
  ),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'notified', 'resolved', 'suppressed')),
  dedupe_key text not null check (btrim(dedupe_key) <> ''),
  summary text not null check (btrim(summary) <> ''),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  opened_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint airbnb_alerts_dedupe_key unique (household_id, dedupe_key),
  constraint airbnb_alerts_household_id_id_key unique (household_id, id)
);

create table airbnb.job_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  service text not null check (service in ('cleaner', 'stock', 'support')),
  job_name text not null check (btrim(job_name) <> ''),
  run_id text not null check (btrim(run_id) <> ''),
  target_date date,
  status text not null check (
    status in ('started', 'success', 'sent', 'duplicate_skipped', 'blocked', 'error', 'cancelled')
  ),
  receipt jsonb not null default '{}'::jsonb check (jsonb_typeof(receipt) = 'object'),
  error_code text,
  error_message text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint airbnb_job_runs_run_key unique (service, run_id),
  constraint airbnb_job_runs_household_id_id_key unique (household_id, id)
);

create table airbnb.audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  actor_type text not null check (actor_type in ('worker', 'human', 'scheduler', 'system')),
  actor_id text,
  action text not null check (btrim(action) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint airbnb_audit_events_household_id_id_key unique (household_id, id)
);

create index airbnb_evidence_household_occurred_idx
  on airbnb.evidence (household_id, occurred_at desc);
create index airbnb_reservations_property_dates_idx
  on airbnb.reservations (household_id, property_id, check_in, check_out);
create index airbnb_reservations_authoritative_evidence_idx
  on airbnb.reservations (household_id, authoritative_evidence_id);
create index airbnb_reservation_evidence_evidence_idx
  on airbnb.reservation_evidence (household_id, evidence_id);
create index airbnb_guest_threads_reservation_idx
  on airbnb.guest_threads (household_id, reservation_id);
create index airbnb_guest_threads_status_updated_idx
  on airbnb.guest_threads (household_id, status, updated_at desc);
create index airbnb_guest_messages_thread_sent_idx
  on airbnb.guest_messages (household_id, thread_id, provider_sent_at desc);
create index airbnb_reply_deliveries_thread_status_idx
  on airbnb.reply_deliveries (household_id, thread_id, status, created_at desc);
create index airbnb_cleaner_plans_target_idx
  on airbnb.cleaner_plans (household_id, target_date desc, completed_at desc);
create index airbnb_orders_confirmation_evidence_idx
  on airbnb.orders (household_id, confirmation_evidence_id);
create index airbnb_orders_invoice_evidence_idx
  on airbnb.orders (household_id, invoice_evidence_id);
create index airbnb_order_items_inventory_item_idx
  on airbnb.order_items (household_id, inventory_item_id);
create index airbnb_inventory_movements_item_time_idx
  on airbnb.inventory_movements (household_id, inventory_item_id, occurred_at);
create index airbnb_inventory_movements_order_idx
  on airbnb.inventory_movements (household_id, order_id);
create index airbnb_inventory_movements_order_item_idx
  on airbnb.inventory_movements (household_id, order_item_id);
create index airbnb_shopping_list_items_inventory_idx
  on airbnb.shopping_list_items (household_id, inventory_item_id);
create index airbnb_alerts_status_opened_idx
  on airbnb.alerts (household_id, status, opened_at desc);
create index airbnb_job_runs_service_started_idx
  on airbnb.job_runs (household_id, service, started_at desc);
create index airbnb_audit_events_entity_idx
  on airbnb.audit_events (household_id, entity_type, entity_id, occurred_at desc);

create view airbnb.inventory_balances
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
  coalesce(sum(movement.quantity_delta), 0::numeric) as quantity_on_hand,
  max(movement.occurred_at) as last_movement_at
from airbnb.inventory_items item
left join airbnb.inventory_movements movement
  on movement.household_id = item.household_id
 and movement.inventory_item_id = item.id
group by item.id;

revoke all on table airbnb.inventory_balances from public, anon, authenticated;
grant select on table airbnb.inventory_balances to service_role, airbnb_worker;

create or replace function airbnb.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function airbnb.prevent_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Airbnb operational records cannot be hard-deleted.';
end;
$$;

revoke all on function airbnb.set_updated_at() from public, anon, authenticated;
revoke all on function airbnb.prevent_delete() from public, anon, authenticated;

do $security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'properties', 'evidence', 'reservations', 'reservation_evidence',
    'guest_threads', 'guest_messages', 'reply_deliveries', 'cleaner_plans',
    'inventory_items', 'orders', 'order_items', 'inventory_movements',
    'shopping_lists', 'shopping_list_items', 'alerts', 'job_runs', 'audit_events'
  ]
  loop
    execute format('alter table airbnb.%I enable row level security', table_name);
    execute format('alter table airbnb.%I force row level security', table_name);
    execute format(
      'create policy "airbnb worker access" on airbnb.%I for all to airbnb_worker using (true) with check (true)',
      table_name
    );
    execute format(
      'revoke all on table airbnb.%I from public, anon, authenticated, service_role, airbnb_worker',
      table_name
    );
    execute format(
      'grant select, insert, update on table airbnb.%I to service_role, airbnb_worker',
      table_name
    );
    execute format(
      'create trigger airbnb_no_hard_delete before delete on airbnb.%I '
      'for each row execute function airbnb.prevent_delete()',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'properties', 'reservations', 'guest_threads', 'reply_deliveries',
    'inventory_items', 'orders', 'shopping_lists', 'alerts'
  ]
  loop
    execute format(
      'create trigger airbnb_set_updated_at before update on airbnb.%I '
      'for each row execute function airbnb.set_updated_at()',
      table_name
    );
  end loop;
end
$security$;

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
            'orderedAt', order_record.ordered_at
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
            'errorCode', run.error_code
          ) as payload
        from airbnb.job_runs run
        where run.household_id = target_household_id
        order by run.started_at desc
        limit 50
      ) run_row
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.airbnb_record_stock_adjustment(
  target_household_id uuid,
  target_inventory_item_id uuid,
  quantity_delta numeric,
  note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_id uuid;
begin
  if not private.has_household_role(target_household_id, null) then
    raise exception 'Household access denied.' using errcode = '42501';
  end if;
  if quantity_delta = 0 then
    raise exception 'Stock adjustment must be non-zero.';
  end if;
  if not exists (
    select 1 from airbnb.inventory_items item
    where item.household_id = target_household_id
      and item.id = target_inventory_item_id
  ) then
    raise exception 'Inventory item not found.';
  end if;

  insert into airbnb.inventory_movements (
    household_id, inventory_item_id, movement_type, quantity_delta,
    confidence, source_type, source_id, dedupe_key, note, occurred_at
  ) values (
    target_household_id, target_inventory_item_id, 'adjustment', quantity_delta,
    'manual', 'manual', auth.uid()::text, 'manual:' || gen_random_uuid()::text, note, now()
  ) returning id into movement_id;

  insert into airbnb.audit_events (
    household_id, actor_type, actor_id, action, entity_type, entity_id, details
  ) values (
    target_household_id, 'human', auth.uid()::text, 'stock_adjusted',
    'inventory_movement', movement_id::text,
    jsonb_build_object('inventoryItemId', target_inventory_item_id, 'quantityDelta', quantity_delta)
  );
  return movement_id;
end;
$$;

create or replace function public.airbnb_review_reply(
  target_delivery_id uuid,
  review_action text,
  edited_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery airbnb.reply_deliveries%rowtype;
begin
  select * into delivery
  from airbnb.reply_deliveries
  where id = target_delivery_id
  for update;
  if not found or not private.has_household_role(delivery.household_id, null) then
    raise exception 'Reply delivery not found.' using errcode = '42501';
  end if;
  if review_action not in ('save', 'approve', 'cancel') then
    raise exception 'Invalid reply review action.';
  end if;
  if delivery.status in ('sending', 'sent', 'handled_by_human') then
    raise exception 'Reply delivery can no longer be reviewed.';
  end if;

  update airbnb.reply_deliveries
  set final_text = coalesce(edited_text, final_text, draft_text),
      status = case review_action
        when 'approve' then 'approved'
        when 'cancel' then 'cancelled'
        else 'draft'
      end,
      cancellation_reason = case when review_action = 'cancel' then 'Cancelled by household reviewer.' else null end,
      approved_by = case when review_action = 'approve' then auth.uid() else null end,
      approved_at = case when review_action = 'approve' then now() else null end
  where id = target_delivery_id
  returning * into delivery;

  insert into airbnb.audit_events (
    household_id, actor_type, actor_id, action, entity_type, entity_id
  ) values (
    delivery.household_id, 'human', auth.uid()::text,
    'reply_' || review_action, 'reply_delivery', delivery.id::text
  );

  return jsonb_build_object('id', delivery.id, 'status', delivery.status, 'updatedAt', delivery.updated_at);
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
    household_id, actor_type, actor_id, action, entity_type, entity_id,
    details
  ) values (
    order_record.household_id, 'human', auth.uid()::text,
    'order_status_updated', 'order', order_record.id::text,
    jsonb_build_object('status', next_status, 'deliveryDueAt', next_delivery_due_at)
  );

  return jsonb_build_object('id', order_record.id, 'status', order_record.status, 'updatedAt', order_record.updated_at);
end;
$$;

revoke all on function public.airbnb_dashboard_snapshot(uuid) from public, anon;
revoke all on function public.airbnb_record_stock_adjustment(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.airbnb_review_reply(uuid, text, text) from public, anon;
revoke all on function public.airbnb_update_order_status(uuid, text, timestamptz) from public, anon;

grant execute on function public.airbnb_dashboard_snapshot(uuid) to authenticated, service_role;
grant execute on function public.airbnb_record_stock_adjustment(uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.airbnb_review_reply(uuid, text, text) to authenticated, service_role;
grant execute on function public.airbnb_update_order_status(uuid, text, timestamptz) to authenticated, service_role;

insert into airbnb.properties (household_id, unit_number, listing_name, common_name)
select household.id, property.unit_number, property.listing_name, property.common_name
from public.households household
cross join (
  values
    (1::smallint, 'Bougainvillea Courtyard Studio', 'Bougainvillea'),
    (2::smallint, 'The Spekboom Studio', 'Spekboom'),
    (3::smallint, 'Jasmine Studio Stay', 'Jasmine')
) as property(unit_number, listing_name, common_name)
where household.name = 'Harewood Household'
on conflict (household_id, unit_number) do update
set listing_name = excluded.listing_name,
    common_name = excluded.common_name;

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
  item.consumption_basis,
  item.quantity_per_basis,
  item.staple_priority
from public.households household
cross join (
  values
    ('guest_chocolate', 'Guest chocolates', 'guest_supply', 'each', 'per_guest', 1::numeric, 10),
    ('water_500ml', '500 ml water', 'guest_supply', 'bottle', 'per_guest', 1::numeric, 20),
    ('milk_250ml', '250 ml milk', 'guest_supply', 'carton', 'per_stay', 1::numeric, 30),
    ('wrapped_rusk', 'Individually wrapped rusks', 'guest_supply', 'each', 'per_guest', 1::numeric, 40),
    ('coffee_portion', 'Coffee portions', 'guest_supply', 'portion', 'per_guest', 1::numeric, 50),
    ('sugar_portion', 'Sugar portions', 'guest_supply', 'portion', 'per_guest', 2::numeric, 60),
    ('toilet_roll', 'Toilet rolls', 'cleaning', 'roll', 'manual', 0::numeric, 70),
    ('refuse_bag', 'Refuse bags', 'cleaning', 'bag', 'manual', 0::numeric, 80),
    ('bleach', 'Bleach', 'cleaning', 'bottle', 'manual', 0::numeric, 90),
    ('multipurpose_cleaner', 'Multipurpose cleaner', 'cleaning', 'bottle', 'manual', 0::numeric, 100),
    ('dishwashing_liquid', 'Dishwashing liquid', 'cleaning', 'bottle', 'manual', 0::numeric, 110),
    ('laundry_detergent', 'Laundry detergent', 'laundry', 'pack', 'manual', 0::numeric, 120),
    ('bath_mat', 'Bath mats', 'linen', 'each', 'manual', 0::numeric, 130),
    ('linen_set', 'Ready linen sets', 'linen', 'set', 'manual', 0::numeric, 140),
    ('mug', 'Mugs', 'tableware', 'each', 'manual', 0::numeric, 150),
    ('drinking_glass', 'Drinking glasses', 'tableware', 'each', 'manual', 0::numeric, 160)
) as item(sku, display_name, category, stock_unit, consumption_basis, quantity_per_basis, staple_priority)
where household.name = 'Harewood Household'
on conflict (household_id, sku) do update
set display_name = excluded.display_name,
    category = excluded.category,
    stock_unit = excluded.stock_unit,
    consumption_basis = excluded.consumption_basis,
    quantity_per_basis = excluded.quantity_per_basis,
    staple_priority = excluded.staple_priority;
