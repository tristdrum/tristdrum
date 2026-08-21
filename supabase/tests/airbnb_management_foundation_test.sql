begin;

select plan(20);

create temp table airbnb_test_tables (table_name text primary key) on commit drop;
insert into airbnb_test_tables (table_name)
values
  ('properties'),
  ('evidence'),
  ('reservations'),
  ('reservation_evidence'),
  ('guest_threads'),
  ('guest_messages'),
  ('reply_deliveries'),
  ('cleaner_plans'),
  ('inventory_items'),
  ('orders'),
  ('order_items'),
  ('inventory_movements'),
  ('shopping_lists'),
  ('shopping_list_items'),
  ('alerts'),
  ('job_runs'),
  ('audit_events'),
  ('worker_identities');

select ok(
  (select count(*)
   from information_schema.tables table_info
   join airbnb_test_tables expected on expected.table_name = table_info.table_name
   where table_info.table_schema = 'airbnb') = 18,
  'all private Airbnb tables exist'
);

select ok(
  not has_schema_privilege('anon', 'airbnb', 'USAGE')
  and not has_schema_privilege('authenticated', 'airbnb', 'USAGE'),
  'browser roles cannot use the private Airbnb schema'
);

select ok(
  has_schema_privilege('service_role', 'airbnb', 'USAGE')
  and has_schema_privilege('airbnb_cleaner_worker', 'airbnb', 'USAGE')
  and has_schema_privilege('airbnb_stock_worker', 'airbnb', 'USAGE')
  and has_schema_privilege('airbnb_support_worker', 'airbnb', 'USAGE'),
  'service and scoped worker roles can use the private schema'
);

select ok(
  not exists (
    select 1
    from pg_roles
    where rolname in ('airbnb_cleaner_worker', 'airbnb_stock_worker', 'airbnb_support_worker')
      and (rolcanlogin or rolsuper or rolbypassrls)
  ),
  'worker capability roles are non-login and cannot bypass RLS'
);

select ok(
  not has_schema_privilege('airbnb_worker', 'airbnb', 'USAGE')
  and not exists (
    select 1 from airbnb_test_tables expected
    where has_table_privilege('airbnb_worker', format('airbnb.%I', expected.table_name), 'SELECT')
       or has_table_privilege('airbnb_worker', format('airbnb.%I', expected.table_name), 'INSERT')
       or has_table_privilege('airbnb_worker', format('airbnb.%I', expected.table_name), 'UPDATE')
  ),
  'legacy broad worker capability has no Airbnb access'
);

select ok(
  has_table_privilege('airbnb_cleaner_worker', 'airbnb.cleaner_plans', 'SELECT')
  and not has_table_privilege('airbnb_cleaner_worker', 'airbnb.guest_messages', 'SELECT')
  and not has_table_privilege('airbnb_cleaner_worker', 'airbnb.inventory_items', 'SELECT'),
  'cleaner capability cannot read support or stock tables'
);

select ok(
  has_table_privilege('airbnb_stock_worker', 'airbnb.inventory_items', 'SELECT')
  and has_table_privilege('airbnb_stock_worker', 'airbnb.reservations', 'SELECT')
  and not has_table_privilege('airbnb_stock_worker', 'airbnb.guest_messages', 'SELECT'),
  'stock capability can forecast without reading support tables'
);

select ok(
  has_table_privilege('airbnb_support_worker', 'airbnb.guest_messages', 'SELECT')
  and has_table_privilege('airbnb_support_worker', 'airbnb.reservations', 'SELECT')
  and not has_table_privilege('airbnb_support_worker', 'airbnb.cleaner_plans', 'SELECT')
  and not has_table_privilege('airbnb_support_worker', 'airbnb.inventory_items', 'SELECT'),
  'support capability cannot read cleaner or stock tables'
);

select ok(
  not exists (
    select 1
    from airbnb_test_tables expected
    left join pg_class relation on relation.relname = expected.table_name
    left join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname is distinct from 'airbnb'
      or not coalesce(relation.relrowsecurity, false)
      or not coalesce(relation.relforcerowsecurity, false)
  ),
  'every Airbnb table has RLS enabled and forced'
);

select ok(
  not exists (
    select 1 from airbnb_test_tables expected
    where has_table_privilege('anon', format('airbnb.%I', expected.table_name), 'SELECT')
       or has_table_privilege('authenticated', format('airbnb.%I', expected.table_name), 'SELECT')
  ),
  'browser roles have no direct Airbnb table access'
);

select ok(
  not exists (
    select 1 from airbnb_test_tables expected
    where has_table_privilege('airbnb_worker', format('airbnb.%I', expected.table_name), 'DELETE')
       or has_table_privilege('airbnb_cleaner_worker', format('airbnb.%I', expected.table_name), 'DELETE')
       or has_table_privilege('airbnb_stock_worker', format('airbnb.%I', expected.table_name), 'DELETE')
       or has_table_privilege('airbnb_support_worker', format('airbnb.%I', expected.table_name), 'DELETE')
       or has_table_privilege('service_role', format('airbnb.%I', expected.table_name), 'DELETE')
  ),
  'worker roles cannot hard-delete Airbnb data'
);

select ok(
  (
    select count(*)
    from pg_trigger trigger_info
    join pg_class relation on relation.oid = trigger_info.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join airbnb_test_tables expected on expected.table_name = relation.relname
    where namespace.nspname = 'airbnb'
      and trigger_info.tgname = 'airbnb_no_hard_delete'
      and not trigger_info.tgisinternal
  ) = 18,
  'every Airbnb table rejects hard deletes'
);

select ok(
  not has_table_privilege('service_role', 'airbnb.worker_identities', 'SELECT')
  and not has_table_privilege('airbnb_cleaner_worker', 'airbnb.worker_identities', 'SELECT')
  and not has_table_privilege('airbnb_stock_worker', 'airbnb.worker_identities', 'SELECT')
  and not has_table_privilege('airbnb_support_worker', 'airbnb.worker_identities', 'SELECT'),
  'worker identity bindings are not readable by runtime roles'
);

select ok(
  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'airbnb'
      and procedure.proname = 'current_household_id'
      and procedure.prosecdef
  ),
  'household identity is resolved by a security-definer function'
);

select ok(
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'airbnb'
      and relation.relname = 'inventory_balances'
      and coalesce(relation.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ),
  'inventory balance view uses invoker security'
);

select ok(
  not has_function_privilege('anon', 'public.airbnb_dashboard_snapshot(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.airbnb_dashboard_snapshot(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.airbnb_record_stock_adjustment(uuid,uuid,numeric,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.airbnb_record_stock_adjustment(uuid,uuid,numeric,text)', 'EXECUTE'),
  'dashboard and stock RPCs are authenticated-only'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'airbnb'
      and table_name = 'reservations'
      and column_name = 'guest_count_known'
  ),
  'unknown guest counts remain representable'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid = 'airbnb.orders'::regclass
      and constraint_info.conname = 'airbnb_orders_credit_address_check'
      and constraint_info.contype = 'c'
  ),
  'inventory credit requires a verified 1 Bowie invoice address'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'airbnb'
      and table_name = 'guest_threads'
      and column_name = 'property_id'
  )
  and exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid = 'airbnb.guest_threads'::regclass
      and constraint_info.conname = 'airbnb_guest_threads_property_fkey'
      and constraint_info.contype = 'f'
  ),
  'guest threads retain their household-scoped property relationship'
);

select ok(
  (
    select count(*)
    from cron.job
    where jobname in (
      'airbnb-stock-email-poll-30m',
      'airbnb-stock-email-poll-1900-utc',
      'airbnb-stock-weekly-review-0700-utc',
      'airbnb-support-shadow-poll-5m'
    )
      and not active
      and command not like '%mincool-airbnb-cleaner%'
  ) = 4,
  'stock and support observers are installed dormant on personal Fly apps'
);

select * from finish();
rollback;
