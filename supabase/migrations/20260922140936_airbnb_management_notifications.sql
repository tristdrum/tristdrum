set lock_timeout = '5s';
set statement_timeout = '60s';

create table airbnb.management_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  source_service text not null default 'support' check (source_service in ('support', 'stock', 'operator')),
  notification_key text not null check (btrim(notification_key) <> ''),
  text text not null check (length(btrim(text)) between 1 and 1000),
  whatsapp_status text not null default 'pending' check (whatsapp_status in ('pending', 'sending', 'verified', 'ambiguous')),
  whatsapp_provider_message_id text,
  whatsapp_verified_at timestamptz,
  whatsapp_error text,
  ping_status text not null default 'pending' check (ping_status in ('pending', 'sending', 'accepted', 'failed')),
  ping_attempt_count integer not null default 0 check (ping_attempt_count between 0 and 2),
  ping_first_attempt_at timestamptz,
  ping_last_attempt_at timestamptz,
  ping_accepted_at timestamptz,
  ping_request_id text,
  ping_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, notification_key),
  check (ping_status <> 'accepted' or (whatsapp_status = 'verified' and ping_accepted_at is not null)),
  check (whatsapp_status <> 'verified' or whatsapp_verified_at is not null)
);

create index management_notifications_pending_ping_idx
  on airbnb.management_notifications (household_id, source_service, created_at)
  where whatsapp_status = 'verified' and ping_status in ('pending', 'sending', 'failed');

alter table airbnb.management_notifications enable row level security;
revoke all on table airbnb.management_notifications from public, anon, authenticated;
grant select, insert, update on airbnb.management_notifications to airbnb_support_worker, airbnb_stock_worker;

create policy "support management notification access"
  on airbnb.management_notifications for all to airbnb_support_worker
  using (household_id = airbnb.current_household_id() and source_service in ('support', 'operator'))
  with check (household_id = airbnb.current_household_id() and source_service in ('support', 'operator'));
create policy "stock management notification access"
  on airbnb.management_notifications for all to airbnb_stock_worker
  using (household_id = airbnb.current_household_id() and source_service = 'stock')
  with check (household_id = airbnb.current_household_id() and source_service = 'stock');
