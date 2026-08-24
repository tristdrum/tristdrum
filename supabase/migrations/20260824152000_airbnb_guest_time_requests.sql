set lock_timeout = '5s';
set statement_timeout = '60s';

create table airbnb.guest_time_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  thread_id uuid not null,
  property_id uuid not null,
  reservation_id uuid,
  source_fingerprint text not null check (btrim(source_fingerprint) <> ''),
  request_type text not null check (request_type in ('early_checkin', 'late_checkout')),
  stay_date date not null,
  requested_time time not null,
  effective_time time not null,
  status text not null default 'accepted' check (
    status in ('accepted', 'cleaners_notified', 'awaiting_ready', 'ready', 'guest_notified', 'completed', 'cancelled')
  ),
  cleaner_note_en text not null check (btrim(cleaner_note_en) <> ''),
  cleaner_note_xh text not null check (btrim(cleaner_note_xh) <> ''),
  cleaners_notified_at timestamptz,
  readiness_check_at timestamptz,
  readiness_prompted_at timestamptz,
  ready_at timestamptz,
  guest_notified_at timestamptz,
  cleaner_provider_message_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airbnb_guest_time_requests_source_key
    unique (household_id, thread_id, source_fingerprint, request_type),
  constraint airbnb_guest_time_requests_household_id_id_key unique (household_id, id),
  constraint airbnb_guest_time_requests_thread_fkey
    foreign key (household_id, thread_id)
    references airbnb.guest_threads (household_id, id) on delete restrict,
  constraint airbnb_guest_time_requests_property_fkey
    foreign key (household_id, property_id)
    references airbnb.properties (household_id, id) on delete restrict,
  constraint airbnb_guest_time_requests_reservation_fkey
    foreign key (household_id, reservation_id)
    references airbnb.reservations (household_id, id) on delete restrict
);

create index airbnb_guest_time_requests_cleaner_idx
  on airbnb.guest_time_requests (household_id, stay_date, property_id)
  where status <> 'cancelled';

create index airbnb_guest_time_requests_readiness_idx
  on airbnb.guest_time_requests (household_id, readiness_check_at)
  where request_type = 'early_checkin'
    and status in ('cleaners_notified', 'awaiting_ready');

alter table airbnb.guest_time_requests enable row level security;
alter table airbnb.guest_time_requests force row level security;

create policy "airbnb support time request access"
  on airbnb.guest_time_requests for all to airbnb_support_worker
  using (household_id = airbnb.current_household_id())
  with check (household_id = airbnb.current_household_id());

create policy "airbnb cleaner time request read"
  on airbnb.guest_time_requests for select to airbnb_cleaner_worker
  using (household_id = airbnb.current_household_id());

grant select, insert, update on table airbnb.guest_time_requests to airbnb_support_worker;
grant select on table airbnb.guest_time_requests to airbnb_cleaner_worker;
grant select, insert, update on table airbnb.guest_time_requests to service_role;

create trigger airbnb_no_hard_delete
  before delete on airbnb.guest_time_requests
  for each row execute function airbnb.prevent_delete();

create trigger airbnb_set_updated_at
  before update on airbnb.guest_time_requests
  for each row execute function airbnb.set_updated_at();
