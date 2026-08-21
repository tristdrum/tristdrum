set lock_timeout = '5s';
set statement_timeout = '60s';

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'airbnb_cleaner_worker') then
    create role airbnb_cleaner_worker nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'airbnb_stock_worker') then
    create role airbnb_stock_worker nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'airbnb_support_worker') then
    create role airbnb_support_worker nologin noinherit;
  end if;
end
$roles$;

grant usage on schema airbnb
  to airbnb_cleaner_worker, airbnb_stock_worker, airbnb_support_worker;
revoke usage on schema airbnb from airbnb_worker;

create table airbnb.worker_identities (
  role_name name primary key,
  household_id uuid not null references public.households (id) on delete restrict,
  service text not null check (service in ('cleaner', 'stock', 'support')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table airbnb.worker_identities enable row level security;
alter table airbnb.worker_identities force row level security;
create trigger airbnb_no_hard_delete
  before delete on airbnb.worker_identities
  for each row execute function airbnb.prevent_delete();
create trigger airbnb_set_updated_at
  before update on airbnb.worker_identities
  for each row execute function airbnb.set_updated_at();
revoke all on table airbnb.worker_identities
  from public, anon, authenticated, service_role,
       airbnb_worker, airbnb_cleaner_worker, airbnb_stock_worker, airbnb_support_worker;

create or replace function airbnb.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select identity.household_id
  from airbnb.worker_identities identity
  where identity.role_name = session_user::name
  limit 1
$function$;

revoke all on function airbnb.current_household_id() from public, anon, authenticated;
grant execute on function airbnb.current_household_id()
  to airbnb_cleaner_worker, airbnb_stock_worker, airbnb_support_worker;

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
    execute format('drop policy if exists "airbnb worker access" on airbnb.%I', table_name);
    execute format('revoke all on table airbnb.%I from airbnb_worker', table_name);
  end loop;

  foreach table_name in array array[
    'evidence', 'reservations', 'reservation_evidence', 'cleaner_plans',
    'alerts', 'job_runs', 'audit_events'
  ]
  loop
    execute format(
      'create policy "airbnb cleaner household access" on airbnb.%I for all to airbnb_cleaner_worker '
      'using (household_id = airbnb.current_household_id()) '
      'with check (household_id = airbnb.current_household_id())',
      table_name
    );
    execute format(
      'grant select, insert, update on table airbnb.%I to airbnb_cleaner_worker',
      table_name
    );
  end loop;
  create policy "airbnb cleaner property read"
    on airbnb.properties for select to airbnb_cleaner_worker
    using (household_id = airbnb.current_household_id());
  grant select on table airbnb.properties to airbnb_cleaner_worker;

  foreach table_name in array array[
    'evidence', 'inventory_items', 'orders', 'order_items', 'inventory_movements',
    'shopping_lists', 'shopping_list_items', 'alerts', 'job_runs', 'audit_events'
  ]
  loop
    execute format(
      'create policy "airbnb stock household access" on airbnb.%I for all to airbnb_stock_worker '
      'using (household_id = airbnb.current_household_id()) '
      'with check (household_id = airbnb.current_household_id())',
      table_name
    );
    execute format(
      'grant select, insert, update on table airbnb.%I to airbnb_stock_worker',
      table_name
    );
  end loop;
  foreach table_name in array array['properties', 'reservations', 'cleaner_plans']
  loop
    execute format(
      'create policy "airbnb stock household read" on airbnb.%I for select to airbnb_stock_worker '
      'using (household_id = airbnb.current_household_id())',
      table_name
    );
    execute format('grant select on table airbnb.%I to airbnb_stock_worker', table_name);
  end loop;

  foreach table_name in array array[
    'evidence', 'guest_threads', 'guest_messages', 'reply_deliveries',
    'alerts', 'job_runs', 'audit_events'
  ]
  loop
    execute format(
      'create policy "airbnb support household access" on airbnb.%I for all to airbnb_support_worker '
      'using (household_id = airbnb.current_household_id()) '
      'with check (household_id = airbnb.current_household_id())',
      table_name
    );
    execute format(
      'grant select, insert, update on table airbnb.%I to airbnb_support_worker',
      table_name
    );
  end loop;
  foreach table_name in array array['properties', 'reservations']
  loop
    execute format(
      'create policy "airbnb support household read" on airbnb.%I for select to airbnb_support_worker '
      'using (household_id = airbnb.current_household_id())',
      table_name
    );
    execute format('grant select on table airbnb.%I to airbnb_support_worker', table_name);
  end loop;
end
$security$;

revoke all on table airbnb.inventory_balances from airbnb_worker;
grant select on table airbnb.inventory_balances to airbnb_stock_worker;

create unique index airbnb_job_runs_one_started_service_idx
  on airbnb.job_runs (household_id, service)
  where status = 'started';
