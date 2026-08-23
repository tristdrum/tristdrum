begin;

select plan(32);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000a001', 'airbnb-dashboard-test@example.invalid');

insert into public.households (id, name, created_by)
values (
  '00000000-0000-0000-0000-00000000b001',
  'Airbnb dashboard test household',
  '00000000-0000-0000-0000-00000000a001'
);

insert into public.household_members (
  household_id, user_id, role, membership_status, invited_by, joined_at
) values (
  '00000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-00000000a001',
  'owner',
  'active',
  '00000000-0000-0000-0000-00000000a001',
  now()
);

insert into airbnb.properties (id, household_id, unit_number, listing_name, common_name)
values (
  '00000000-0000-0000-0000-00000000c001',
  '00000000-0000-0000-0000-00000000b001',
  1,
  'Fixture Studio',
  'Fixture'
);

insert into airbnb.inventory_items (
  id, household_id, sku, display_name, category, stock_unit
) values (
  '00000000-0000-0000-0000-00000000d001',
  '00000000-0000-0000-0000-00000000b001',
  'fixture-milk',
  'Fixture milk',
  'guest_supply',
  'carton'
);

insert into airbnb.shopping_lists (
  id, household_id, forecast_start, forecast_end, estimated_total_cents, content_hash
) values (
  '00000000-0000-0000-0000-00000000e001',
  '00000000-0000-0000-0000-00000000b001',
  current_date,
  current_date + 7,
  35000,
  'fixture-shopping-list'
);

insert into airbnb.shopping_list_items (
  household_id, shopping_list_id, inventory_item_id, quantity, reason, count_to_confirm
) values (
  '00000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-00000000e001',
  '00000000-0000-0000-0000-00000000d001',
  2,
  'Fixture demand',
  true
);

insert into airbnb.guest_threads (
  id, household_id, provider_thread_id, property_id, guest_display_name, last_guest_at
) values (
  '00000000-0000-0000-0000-00000000f001',
  '00000000-0000-0000-0000-00000000b001',
  'fixture-thread',
  '00000000-0000-0000-0000-00000000c001',
  'Fixture Guest',
  now()
);

insert into airbnb.reply_deliveries (
  id, household_id, thread_id, source_fingerprint, source_last_event_at,
  risk_tier, draft_text, status, idempotency_key, outbound_message_id
) values (
  '00000000-0000-0000-0000-000000001001',
  '00000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-00000000f001',
  'fixture-fingerprint',
  now(),
  'low',
  'Fixture reply',
  'needs_approval',
  'fixture-reply-idempotency',
  'fixture-outbound-message'
);

insert into airbnb.orders (
  id, household_id, provider_order_id, status, address_status
) values
  (
    '00000000-0000-0000-0000-000000002001',
    '00000000-0000-0000-0000-00000000b001',
    'fixture-bowie',
    'suggested',
    'bowie_1'
  ),
  (
    '00000000-0000-0000-0000-000000002002',
    '00000000-0000-0000-0000-00000000b001',
    'fixture-other',
    'ignored',
    'other'
  );

insert into airbnb.evidence (
  household_id, mailbox_scope, provider, provider_message_id, subject,
  evidence_kind, occurred_at, content_hash
) values (
  '00000000-0000-0000-0000-00000000b001',
  'tristan',
  'gmail',
  'fixture-evidence',
  'Fixture evidence',
  'supplemental',
  now(),
  'fixture-evidence-hash'
);

insert into airbnb.job_runs (
  household_id, service, job_name, run_id, status, receipt, started_at, completed_at
) values (
  '00000000-0000-0000-0000-00000000b001',
  'stock',
  'fixture-observe',
  'fixture-run',
  'success',
  '{"externalWrites": false}'::jsonb,
  now(),
  now()
);

insert into airbnb.audit_events (
  household_id, actor_type, action, entity_type, entity_id
) values (
  '00000000-0000-0000-0000-00000000b001',
  'system',
  'fixture_created',
  'fixture',
  'fixture-1'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);

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
  not has_function_privilege('anon', 'public.airbnb_review_reply(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.airbnb_review_reply(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.airbnb_update_order_status(uuid,text,timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.airbnb_update_order_status(uuid,text,timestamp with time zone)', 'EXECUTE'),
  'reply review and order update RPCs are authenticated-only'
);

select ok(
  pg_get_functiondef('public.airbnb_dashboard_snapshot(uuid)'::regprocedure) like '%''replyDeliveries''%'
  and pg_get_functiondef('public.airbnb_dashboard_snapshot(uuid)'::regprocedure) like '%''shoppingLists''%'
  and pg_get_functiondef('public.airbnb_dashboard_snapshot(uuid)'::regprocedure) like '%''evidence''%'
  and pg_get_functiondef('public.airbnb_dashboard_snapshot(uuid)'::regprocedure) like '%''auditEvents''%'
  and pg_get_functiondef('public.airbnb_dashboard_snapshot(uuid)'::regprocedure) like '%''receipt''%',
  'dashboard snapshot exposes operational controls, evidence, audit, and receipts'
);

select ok(
  pg_get_functiondef('public.airbnb_update_order_status(uuid,text,timestamp with time zone)'::regprocedure)
    like '%address_status <> ''bowie_1''%',
  'dashboard order updates are limited to verified 1 Bowie deliveries'
);

select ok(
  jsonb_array_length(public.airbnb_dashboard_snapshot('00000000-0000-0000-0000-00000000b001')->'replyDeliveries') = 1
  and jsonb_array_length(public.airbnb_dashboard_snapshot('00000000-0000-0000-0000-00000000b001')->'shoppingLists') = 1
  and jsonb_array_length(public.airbnb_dashboard_snapshot('00000000-0000-0000-0000-00000000b001')->'evidence') = 1
  and jsonb_array_length(public.airbnb_dashboard_snapshot('00000000-0000-0000-0000-00000000b001')->'auditEvents') = 1
  and public.airbnb_dashboard_snapshot('00000000-0000-0000-0000-00000000b001')->'jobRuns'->0->'receipt'->>'externalWrites' = 'false',
  'authorized dashboard snapshot returns operational rows and sanitized receipts'
);

select lives_ok(
  $$select public.airbnb_record_stock_adjustment(
    '00000000-0000-0000-0000-00000000b001',
    '00000000-0000-0000-0000-00000000d001',
    3,
    'Fixture count'
  )$$,
  'authorized stock adjustment succeeds'
);

select ok(
  (select quantity_on_hand
   from airbnb.inventory_balances
   where household_id = '00000000-0000-0000-0000-00000000b001'
     and id = '00000000-0000-0000-0000-00000000d001') = 3
  and exists (
    select 1 from airbnb.audit_events
    where household_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'stock_adjusted'
  ),
  'stock adjustment changes the balance and appends an audit event'
);

select is(
  public.airbnb_review_reply(
    '00000000-0000-0000-0000-000000001001',
    'approve',
    'Reviewed fixture reply'
  )->>'status',
  'approved',
  'reply review transitions the draft to approved'
);

select is(
  public.airbnb_update_order_status(
    '00000000-0000-0000-0000-000000002001',
    'ordered',
    null
  )->>'status',
  'ordered',
  'verified 1 Bowie order can be updated'
);

select throws_like(
  $$select public.airbnb_update_order_status(
    '00000000-0000-0000-0000-000000002002',
    'delivered',
    null
  )$$,
  '%Only verified 1 Bowie orders can be managed here.%',
  'non-Bowie order cannot be updated'
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

select ok(
  not has_table_privilege('airbnb_cleaner_worker', 'airbnb.audit_events', 'SELECT')
  and not has_table_privilege('airbnb_stock_worker', 'airbnb.audit_events', 'SELECT')
  and not has_table_privilege('airbnb_support_worker', 'airbnb.audit_events', 'SELECT'),
  'runtime workers cannot rewrite or read the human audit log'
);

select ok(
  (
    select count(*)
    from pg_policies
    where schemaname = 'airbnb'
      and tablename = 'job_runs'
      and policyname in (
        'airbnb cleaner job access',
        'airbnb stock job access',
        'airbnb support job access'
      )
  ) = 3,
  'job receipts have one service-bound policy per worker'
);

select ok(
  (
    select count(*)
    from pg_policies
    where schemaname = 'airbnb'
      and tablename in ('alerts', 'evidence')
      and policyname in (
        'airbnb cleaner alert access',
        'airbnb stock alert access',
        'airbnb support alert access',
        'airbnb cleaner evidence access',
        'airbnb stock evidence access',
        'airbnb support evidence access'
      )
  ) = 6,
  'shared alerts and evidence are partitioned by worker domain'
);

select * from finish();
rollback;
