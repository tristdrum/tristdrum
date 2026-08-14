begin;

select plan(18);

create temp table finance_test_tables (table_name text primary key) on commit drop;
insert into finance_test_tables (table_name)
values
  ('households'),
  ('household_members'),
  ('finance_sources'),
  ('financial_accounts'),
  ('finance_import_runs'),
  ('finance_import_records'),
  ('finance_evidence_objects'),
  ('finance_documents'),
  ('finance_document_pages'),
  ('finance_document_line_items'),
  ('finance_document_relationships'),
  ('finance_transactions'),
  ('finance_transaction_relationships'),
  ('finance_review_items'),
  ('finance_human_decisions'),
  ('finance_classification_rules'),
  ('finance_allocations'),
  ('finance_transaction_document_matches'),
  ('finance_close_periods'),
  ('finance_tax_scenarios'),
  ('finance_tax_scenario_lines'),
  ('finance_tax_scenario_line_allocations'),
  ('finance_submission_packs'),
  ('finance_submission_pack_items');

create temp table finance_test_views (view_name text primary key) on commit drop;
insert into finance_test_views (view_name)
values
  ('finance_current_sources'),
  ('finance_current_accounts'),
  ('finance_current_import_runs'),
  ('finance_current_evidence_objects'),
  ('finance_effective_evidence_objects'),
  ('finance_current_documents'),
  ('finance_effective_documents'),
  ('finance_current_document_pages'),
  ('finance_current_document_line_items'),
  ('finance_current_transactions'),
  ('finance_effective_transactions'),
  ('finance_current_review_items'),
  ('finance_current_human_decisions'),
  ('finance_current_classification_rules'),
  ('finance_current_allocations'),
  ('finance_effective_allocations'),
  ('finance_current_transaction_document_matches'),
  ('finance_current_tax_scenarios'),
  ('finance_current_tax_scenario_lines'),
  ('finance_effective_tax_scenario_lines'),
  ('finance_current_submission_packs'),
  ('finance_source_health'),
  ('finance_anomaly_inbox'),
  ('finance_transaction_balances'),
  ('finance_dashboard_summary');

select ok(
  (select count(*) from information_schema.tables table_info
    join finance_test_tables expected on expected.table_name = table_info.table_name
    where table_info.table_schema = 'public') = 24,
  'all finance foundation tables exist'
);

select ok(
  not exists (
    select 1
    from finance_test_tables expected
    left join pg_class relation on relation.relname = expected.table_name
    left join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname is distinct from 'public'
      or not coalesce(relation.relrowsecurity, false)
      or not coalesce(relation.relforcerowsecurity, false)
  ),
  'every finance table has RLS enabled and forced'
);

select ok(
  not exists (
    select 1 from finance_test_tables expected
    where has_table_privilege('authenticated', format('public.%I', expected.table_name), 'DELETE')
  ),
  'authenticated has no DELETE privilege on finance tables'
);

select ok(
  not exists (
    select 1 from finance_test_tables expected
    where has_table_privilege('service_role', format('public.%I', expected.table_name), 'DELETE')
  ),
  'service_role has no DELETE privilege on finance tables'
);

select ok(
  not exists (
    select 1 from finance_test_tables expected
    where has_table_privilege('anon', format('public.%I', expected.table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', expected.table_name), 'INSERT')
       or has_table_privilege('anon', format('public.%I', expected.table_name), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', expected.table_name), 'DELETE')
  ),
  'anon has no finance table privileges'
);

select ok(
  not exists (
    select 1 from finance_test_tables expected
    where expected.table_name not in ('households', 'household_members')
      and (
        has_table_privilege('authenticated', format('public.%I', expected.table_name), 'UPDATE')
        or has_table_privilege('service_role', format('public.%I', expected.table_name), 'UPDATE')
      )
  ),
  'append-only finance tables have no UPDATE grants'
);

select ok(
  (
    select count(*)
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join finance_test_tables expected on expected.table_name = relation.relname
    where namespace.nspname = 'public'
      and trigger.tgname = 'finance_no_hard_delete'
      and not trigger.tgisinternal
  ) = 24,
  'every finance table has a no-hard-delete trigger'
);

select ok(
  (
    select count(*)
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join finance_test_tables expected on expected.table_name = relation.relname
    where namespace.nspname = 'public'
      and trigger.tgname = 'finance_no_in_place_update'
      and not trigger.tgisinternal
  ) = 22,
  'every revisioned finance table has a no-in-place-update trigger'
);

select ok(
  not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name like 'finance\_%' escape '\'
      and column_info.column_name like '%\_cents' escape '\'
      and column_info.data_type <> 'bigint'
  ),
  'all finance cent columns are bigint'
);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_info
    join pg_class child_relation on child_relation.oid = constraint_info.conrelid
    join pg_namespace child_namespace on child_namespace.oid = child_relation.relnamespace
    where constraint_info.contype = 'f'
      and child_namespace.nspname = 'public'
      and child_relation.relname like 'finance\_%' escape '\'
      and constraint_info.confrelid = 'storage.objects'::regclass
  ),
  'finance tables do not foreign-key to storage.objects'
);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_info
    join pg_class child_relation on child_relation.oid = constraint_info.conrelid
    join pg_namespace child_namespace on child_namespace.oid = child_relation.relnamespace
    where constraint_info.contype = 'f'
      and child_namespace.nspname = 'public'
      and (
        child_relation.relname in ('households', 'household_members', 'financial_accounts')
        or child_relation.relname like 'finance\_%' escape '\'
      )
      and not exists (
        select 1 from pg_index index_info
        where index_info.indrelid = constraint_info.conrelid
          and constraint_info.conkey <@ (index_info.indkey::smallint[])
      )
  ),
  'every finance foreign key has a child-side index'
);

select ok(
  exists (
    select 1 from storage.buckets bucket
    where bucket.id = 'finance-evidence' and bucket.public = false
  ),
  'finance-evidence bucket exists and is private'
);

select ok(
  (
    select array_agg(policy.cmd order by policy.cmd)
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname like '%finance evidence'
  ) = array['INSERT', 'SELECT'],
  'finance Storage is append-only with SELECT and INSERT policies only'
);

select ok(
  has_column_privilege('authenticated', 'public.finance_evidence_objects', 'has_local_copy', 'SELECT')
  and has_column_privilege('authenticated', 'public.finance_evidence_objects', 'has_storage_copy', 'SELECT')
  and not has_column_privilege('authenticated', 'public.finance_evidence_objects', 'local_path', 'SELECT')
  and not has_column_privilege('authenticated', 'public.finance_evidence_objects', 'storage_path', 'SELECT'),
  'browser evidence grants expose copy state but not filesystem paths'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'finance_current_evidence_objects'
      and column_name = 'has_local_copy'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'finance_current_evidence_objects'
      and column_name in ('local_path', 'storage_path', 'storage_bucket')
  ),
  'current evidence view is path-safe'
);

select ok(
  not exists (
    select 1
    from finance_test_views expected
    left join pg_class relation on relation.relname = expected.view_name
    left join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname is distinct from 'public'
       or not coalesce(relation.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ),
  'all browser finance views use security_invoker'
);

select ok(
  not exists (
    select 1
    from pg_proc function_info
    join pg_namespace namespace on namespace.oid = function_info.pronamespace
    cross join lateral aclexplode(
      coalesce(function_info.proacl, acldefault('f', function_info.proowner))
    ) function_acl
    where namespace.nspname = 'public'
      and function_info.proname in ('claim_initial_site_admin', 'site_admin_bootstrap_available')
      and function_acl.privilege_type = 'EXECUTE'
      and function_acl.grantee in (
        0,
        (select oid from pg_roles where rolname = 'anon')
      )
  )
  and has_function_privilege('authenticated', 'public.claim_initial_site_admin()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.site_admin_bootstrap_available()', 'EXECUTE'),
  'site-admin security-definer RPCs are authenticated-only'
);

select ok(
  (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'site_admins'
      and policy.cmd = 'SELECT'
  ) = 1
  and not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'site_admins'
      and policy.cmd = 'ALL'
  ),
  'site_admins has no overlapping permissive SELECT policy'
);

select * from finish();
rollback;
