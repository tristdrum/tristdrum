-- Personal Life Hub finance foundation.
--
-- Finance data is deliberately append-only. Source facts and interpretation
-- revisions can be superseded, voided, or marked not relevant, but never
-- updated in place or hard-deleted. All money values are signed integer cents.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- Tighten the existing site-admin bootstrap surface without changing the
-- browser-facing RPC names or behavior.
revoke all on function public.is_site_admin() from public, anon;
revoke all on function public.site_admin_bootstrap_available() from public, anon;
revoke all on function public.claim_initial_site_admin() from public, anon;

grant execute on function public.is_site_admin() to authenticated;
grant execute on function public.site_admin_bootstrap_available() to authenticated;
grant execute on function public.claim_initial_site_admin() to authenticated;

-- Avoid overlapping permissive SELECT policies on site_admins. UPDATE still
-- has the required SELECT policy, while each mutation has one policy only.
drop policy if exists "Site admins can manage site_admins" on public.site_admins;

drop policy if exists "Site admins can insert site_admins" on public.site_admins;
create policy "Site admins can insert site_admins"
  on public.site_admins
  for insert
  to authenticated
  with check (public.is_site_admin());

drop policy if exists "Site admins can update site_admins" on public.site_admins;
create policy "Site admins can update site_admins"
  on public.site_admins
  for update
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

drop policy if exists "Site admins can delete site_admins" on public.site_admins;
create policy "Site admins can delete site_admins"
  on public.site_admins
  for delete
  to authenticated
  using (public.is_site_admin());

-- This function exists in the linked project (it predates the checked-in
-- migrations). Keep it safe when present without making a fresh local reset
-- depend on it.
do $do$
begin
  if to_regprocedure('public.update_updated_at_column()') is not null then
    alter function public.update_updated_at_column() set search_path = pg_catalog;
  end if;
end
$do$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.households is
  'Invite-only household workspaces. Finance rows are isolated by household_id.';

create table public.household_members (
  household_id uuid not null references public.households (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('owner', 'manager')),
  membership_status text not null default 'active'
    check (membership_status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users (id) on delete restrict,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

comment on table public.household_members is
  'Household authorization source of truth. Never use user_metadata for finance roles.';

create table public.finance_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_source_id uuid not null default gen_random_uuid(),
  source_type text not null check (
    source_type in (
      'bank_email', 'bank_export', 'mailbox', 'local_folder', 'platform_export',
      'platform_email', 'payroll_repo', 'tax_pack', 'manual_upload', 'other'
    )
  ),
  display_name text not null check (btrim(display_name) <> ''),
  owner_scope text not null default 'household'
    check (owner_scope in ('tristan', 'jane', 'household', 'shared')),
  connection_mode text not null default 'manual'
    check (connection_mode in ('manual', 'email', 'folder', 'export', 'repository', 'api')),
  connection_status text not null default 'not_configured'
    check (connection_status in ('not_configured', 'healthy', 'degraded', 'blocked', 'disabled')),
  credential_reference text,
  expected_frequency text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  coverage_start_on date,
  coverage_end_on date,
  health_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(health_summary) = 'object'),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_source_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_sources_household_id_id_key unique (household_id, id),
  constraint finance_sources_logical_revision_key
    unique (household_id, logical_source_id, revision_number),
  constraint finance_sources_supersedes_key unique (supersedes_source_id),
  constraint finance_sources_supersedes_same_household_fkey
    foreign key (household_id, supersedes_source_id)
    references public.finance_sources (household_id, id) on delete restrict,
  constraint finance_sources_coverage_order_check
    check (coverage_end_on is null or coverage_start_on is null or coverage_end_on >= coverage_start_on)
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_account_id uuid not null default gen_random_uuid(),
  source_id uuid,
  account_type text not null check (
    account_type in (
      'cheque', 'savings', 'credit_card', 'mortgage', 'cash', 'platform_clearing',
      'loan', 'wallet', 'other'
    )
  ),
  institution_name text,
  display_name text not null check (btrim(display_name) <> ''),
  masked_identifier text,
  owner_scope text not null default 'household'
    check (owner_scope in ('tristan', 'jane', 'household', 'shared')),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  opened_on date,
  closed_on date,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_account_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint financial_accounts_household_id_id_key unique (household_id, id),
  constraint financial_accounts_logical_revision_key
    unique (household_id, logical_account_id, revision_number),
  constraint financial_accounts_supersedes_key unique (supersedes_account_id),
  constraint financial_accounts_source_same_household_fkey
    foreign key (household_id, source_id)
    references public.finance_sources (household_id, id) on delete restrict,
  constraint financial_accounts_supersedes_same_household_fkey
    foreign key (household_id, supersedes_account_id)
    references public.financial_accounts (household_id, id) on delete restrict,
  constraint financial_accounts_date_order_check
    check (closed_on is null or opened_on is null or closed_on >= opened_on)
);

create table public.finance_import_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_import_id uuid not null default gen_random_uuid(),
  source_id uuid not null,
  financial_account_id uuid,
  run_key text not null check (btrim(run_key) <> ''),
  adapter_name text not null check (btrim(adapter_name) <> ''),
  adapter_version text not null check (btrim(adapter_version) <> ''),
  import_mode text not null check (import_mode in ('dry_run', 'apply')),
  run_status text not null check (run_status in ('running', 'succeeded', 'partial', 'failed')),
  source_fingerprint text not null check (btrim(source_fingerprint) <> ''),
  coverage_start_on date,
  coverage_end_on date,
  discovered_record_count bigint not null default 0 check (discovered_record_count >= 0),
  inserted_record_count bigint not null default 0 check (inserted_record_count >= 0),
  duplicate_record_count bigint not null default 0 check (duplicate_record_count >= 0),
  review_record_count bigint not null default 0 check (review_record_count >= 0),
  error_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(error_summary) = 'object'),
  started_at timestamptz not null,
  completed_at timestamptz,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_import_run_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_import_runs_household_id_id_key unique (household_id, id),
  constraint finance_import_runs_logical_revision_key
    unique (household_id, logical_import_id, revision_number),
  constraint finance_import_runs_idempotency_key
    unique (household_id, run_key, revision_number),
  constraint finance_import_runs_supersedes_key unique (supersedes_import_run_id),
  constraint finance_import_runs_source_same_household_fkey
    foreign key (household_id, source_id)
    references public.finance_sources (household_id, id) on delete restrict,
  constraint finance_import_runs_account_same_household_fkey
    foreign key (household_id, financial_account_id)
    references public.financial_accounts (household_id, id) on delete restrict,
  constraint finance_import_runs_supersedes_same_household_fkey
    foreign key (household_id, supersedes_import_run_id)
    references public.finance_import_runs (household_id, id) on delete restrict,
  constraint finance_import_runs_coverage_order_check
    check (coverage_end_on is null or coverage_start_on is null or coverage_end_on >= coverage_start_on),
  constraint finance_import_runs_completion_check
    check (completed_at is null or completed_at >= started_at)
);

create table public.finance_import_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_import_record_id uuid not null default gen_random_uuid(),
  import_run_id uuid not null,
  source_id uuid not null,
  record_type text not null check (
    record_type in (
      'bank_row', 'email', 'file', 'booking', 'payout', 'payroll_row',
      'contract', 'invoice', 'tax_record', 'other'
    )
  ),
  source_record_key text not null check (btrim(source_record_key) <> ''),
  occurred_at timestamptz,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_locator jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_locator) = 'object'),
  raw_payload jsonb not null default '{}'::jsonb,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_import_record_id uuid,
  created_at timestamptz not null default now(),
  constraint finance_import_records_household_id_id_key unique (household_id, id),
  constraint finance_import_records_logical_revision_key
    unique (household_id, logical_import_record_id, revision_number),
  constraint finance_import_records_source_record_revision_key
    unique (household_id, source_id, record_type, source_record_key, revision_number),
  constraint finance_import_records_supersedes_key unique (supersedes_import_record_id),
  constraint finance_import_records_run_same_household_fkey
    foreign key (household_id, import_run_id)
    references public.finance_import_runs (household_id, id) on delete restrict,
  constraint finance_import_records_source_same_household_fkey
    foreign key (household_id, source_id)
    references public.finance_sources (household_id, id) on delete restrict,
  constraint finance_import_records_supersedes_same_household_fkey
    foreign key (household_id, supersedes_import_record_id)
    references public.finance_import_records (household_id, id) on delete restrict
);

create table public.finance_evidence_objects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_evidence_id uuid not null default gen_random_uuid(),
  source_id uuid,
  import_run_id uuid,
  import_record_id uuid,
  evidence_kind text not null check (
    evidence_kind in ('file', 'email', 'attachment', 'statement', 'export', 'web_capture', 'generated_pack', 'other')
  ),
  source_object_key text,
  original_filename text,
  media_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  storage_bucket text,
  storage_path text,
  local_path text,
  has_storage_copy boolean generated always as (storage_path is not null) stored,
  has_local_copy boolean generated always as (local_path is not null) stored,
  exact_sha256 text not null check (exact_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_sha256 text check (normalized_sha256 is null or normalized_sha256 ~ '^[0-9a-f]{64}$'),
  page_text_sha256 text check (page_text_sha256 is null or page_text_sha256 ~ '^[0-9a-f]{64}$'),
  duplicate_of_evidence_id uuid,
  retention_status text not null default 'retained_forever'
    check (retention_status in ('retained_forever', 'legal_hold')),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  source_created_at timestamptz,
  acquired_at timestamptz not null default now(),
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_evidence_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_evidence_objects_household_id_id_key unique (household_id, id),
  constraint finance_evidence_objects_logical_revision_key
    unique (household_id, logical_evidence_id, revision_number),
  constraint finance_evidence_objects_supersedes_key unique (supersedes_evidence_id),
  constraint finance_evidence_objects_storage_pair_check check (
    (storage_bucket is null and storage_path is null)
    or (storage_bucket = 'finance-evidence' and storage_path is not null)
  ),
  constraint finance_evidence_objects_storage_prefix_check check (
    storage_path is null or storage_path like household_id::text || '/%'
  ),
  constraint finance_evidence_objects_local_path_check check (
    local_path is null or left(local_path, 1) = '/'
  ),
  constraint finance_evidence_objects_duplicate_status_check check (
    duplicate_of_evidence_id is null or record_status = 'duplicate'
  ),
  constraint finance_evidence_objects_source_same_household_fkey
    foreign key (household_id, source_id)
    references public.finance_sources (household_id, id) on delete restrict,
  constraint finance_evidence_objects_run_same_household_fkey
    foreign key (household_id, import_run_id)
    references public.finance_import_runs (household_id, id) on delete restrict,
  constraint finance_evidence_objects_import_record_same_household_fkey
    foreign key (household_id, import_record_id)
    references public.finance_import_records (household_id, id) on delete restrict,
  constraint finance_evidence_objects_duplicate_same_household_fkey
    foreign key (household_id, duplicate_of_evidence_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_evidence_objects_supersedes_same_household_fkey
    foreign key (household_id, supersedes_evidence_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict
);

comment on table public.finance_evidence_objects is
  'Application-owned immutable evidence registry. It intentionally has no foreign key to storage.objects.';

create table public.finance_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_document_id uuid not null default gen_random_uuid(),
  evidence_object_id uuid not null,
  document_type text not null check (
    document_type in (
      'quote', 'invoice', 'statement', 'receipt', 'proof_of_payment',
      'order_confirmation', 'contract', 'lease', 'bank_statement',
      'mortgage_statement', 'payslip', 'tax_record', 'email',
      'booking_confirmation', 'cancellation', 'other'
    )
  ),
  issuer_name text,
  recipient_name text,
  document_number text,
  issued_on date,
  due_on date,
  service_start_on date,
  service_end_on date,
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_cents bigint,
  vat_cents bigint,
  total_cents bigint,
  payment_status text check (payment_status is null or payment_status in ('unknown', 'unpaid', 'part_paid', 'paid', 'refunded')),
  normalized_text_sha256 text
    check (normalized_text_sha256 is null or normalized_text_sha256 ~ '^[0-9a-f]{64}$'),
  extraction_method text,
  extraction_confidence numeric(5, 4)
    check (extraction_confidence is null or extraction_confidence between 0 and 1),
  extracted_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extracted_metadata) = 'object'),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_document_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_documents_household_id_id_key unique (household_id, id),
  constraint finance_documents_logical_revision_key
    unique (household_id, logical_document_id, revision_number),
  constraint finance_documents_supersedes_key unique (supersedes_document_id),
  constraint finance_documents_evidence_same_household_fkey
    foreign key (household_id, evidence_object_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_documents_supersedes_same_household_fkey
    foreign key (household_id, supersedes_document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_documents_due_order_check
    check (due_on is null or issued_on is null or due_on >= issued_on),
  constraint finance_documents_service_order_check
    check (service_end_on is null or service_start_on is null or service_end_on >= service_start_on)
);

create table public.finance_document_pages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_page_id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  evidence_object_id uuid,
  page_number integer not null check (page_number > 0),
  extracted_text text,
  ocr_method text,
  text_sha256 text check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  image_sha256 text check (image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
  extraction_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extraction_metadata) = 'object'),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_page_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_document_pages_household_id_id_key unique (household_id, id),
  constraint finance_document_pages_logical_revision_key
    unique (household_id, logical_page_id, revision_number),
  constraint finance_document_pages_document_page_revision_key
    unique (household_id, document_id, page_number, revision_number),
  constraint finance_document_pages_supersedes_key unique (supersedes_page_id),
  constraint finance_document_pages_document_same_household_fkey
    foreign key (household_id, document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_document_pages_evidence_same_household_fkey
    foreign key (household_id, evidence_object_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_document_pages_supersedes_same_household_fkey
    foreign key (household_id, supersedes_page_id)
    references public.finance_document_pages (household_id, id) on delete restrict
);

create table public.finance_document_line_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_line_item_id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  document_page_id uuid,
  line_number integer not null check (line_number > 0),
  description text not null check (btrim(description) <> ''),
  merchant_sku text,
  quantity numeric(18, 6),
  unit_price_cents bigint,
  net_cents bigint,
  vat_cents bigint,
  gross_cents bigint,
  proposed_category text,
  proposed_use text check (
    proposed_use is null or proposed_use in ('property', 'airbnb', 'worker', 'personal', 'mixed', 'unknown')
  ),
  extraction_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extraction_metadata) = 'object'),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_line_item_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_document_line_items_household_id_id_key unique (household_id, id),
  constraint finance_document_line_items_logical_revision_key
    unique (household_id, logical_line_item_id, revision_number),
  constraint finance_document_line_items_document_line_revision_key
    unique (household_id, document_id, line_number, revision_number),
  constraint finance_document_line_items_supersedes_key unique (supersedes_line_item_id),
  constraint finance_document_line_items_document_same_household_fkey
    foreign key (household_id, document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_document_line_items_page_same_household_fkey
    foreign key (household_id, document_page_id)
    references public.finance_document_pages (household_id, id) on delete restrict,
  constraint finance_document_line_items_supersedes_same_household_fkey
    foreign key (household_id, supersedes_line_item_id)
    references public.finance_document_line_items (household_id, id) on delete restrict
);

create table public.finance_document_relationships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_relationship_id uuid not null default gen_random_uuid(),
  from_document_id uuid not null,
  to_document_id uuid not null,
  relationship_type text not null check (
    relationship_type in (
      'duplicate_of', 'normalized_duplicate_of', 'page_duplicate_of',
      'quote_for', 'invoice_for', 'statement_contains', 'proof_of_payment_for',
      'receipt_for', 'refund_for', 'reimbursement_supports', 'replaces', 'other'
    )
  ),
  related_amount_cents bigint,
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  rationale text,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_relationship_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_document_relationships_household_id_id_key unique (household_id, id),
  constraint finance_document_relationships_logical_revision_key
    unique (household_id, logical_relationship_id, revision_number),
  constraint finance_document_relationships_supersedes_key unique (supersedes_relationship_id),
  constraint finance_document_relationships_distinct_documents_check
    check (from_document_id <> to_document_id),
  constraint finance_document_relationships_from_same_household_fkey
    foreign key (household_id, from_document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_document_relationships_to_same_household_fkey
    foreign key (household_id, to_document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_document_relationships_supersedes_same_household_fkey
    foreign key (household_id, supersedes_relationship_id)
    references public.finance_document_relationships (household_id, id) on delete restrict
);

create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_transaction_id uuid not null default gen_random_uuid(),
  financial_account_id uuid not null,
  import_record_id uuid,
  source_event_key text not null check (btrim(source_event_key) <> ''),
  transaction_kind text not null default 'bank'
    check (transaction_kind in ('bank', 'cash', 'platform', 'loan', 'payroll', 'journal', 'other')),
  transaction_at timestamptz not null,
  booked_on date,
  value_on date,
  amount_cents bigint not null,
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  running_balance_cents bigint,
  raw_description text not null default '',
  counterparty_name text,
  reference text,
  raw_payload jsonb not null default '{}'::jsonb,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_transaction_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_transactions_household_id_id_key unique (household_id, id),
  constraint finance_transactions_logical_revision_key
    unique (household_id, logical_transaction_id, revision_number),
  constraint finance_transactions_source_event_revision_key
    unique (household_id, financial_account_id, source_event_key, revision_number),
  constraint finance_transactions_supersedes_key unique (supersedes_transaction_id),
  constraint finance_transactions_account_same_household_fkey
    foreign key (household_id, financial_account_id)
    references public.financial_accounts (household_id, id) on delete restrict,
  constraint finance_transactions_import_record_same_household_fkey
    foreign key (household_id, import_record_id)
    references public.finance_import_records (household_id, id) on delete restrict,
  constraint finance_transactions_supersedes_same_household_fkey
    foreign key (household_id, supersedes_transaction_id)
    references public.finance_transactions (household_id, id) on delete restrict
);

comment on column public.finance_transactions.amount_cents is
  'Signed integer cents: inflows are positive and outflows are negative.';

create table public.finance_transaction_relationships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_relationship_id uuid not null default gen_random_uuid(),
  from_transaction_id uuid not null,
  to_transaction_id uuid not null,
  relationship_type text not null check (
    relationship_type in (
      'transfer_pair', 'refund_of', 'reimbursement_of', 'settles',
      'cash_withdrawal_for', 'payout_for', 'loan_split', 'other'
    )
  ),
  related_amount_cents bigint,
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  rationale text,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_relationship_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_transaction_relationships_household_id_id_key unique (household_id, id),
  constraint finance_transaction_relationships_logical_revision_key
    unique (household_id, logical_relationship_id, revision_number),
  constraint finance_transaction_relationships_supersedes_key unique (supersedes_relationship_id),
  constraint finance_transaction_relationships_distinct_transactions_check
    check (from_transaction_id <> to_transaction_id),
  constraint finance_transaction_relationships_from_same_household_fkey
    foreign key (household_id, from_transaction_id)
    references public.finance_transactions (household_id, id) on delete restrict,
  constraint finance_transaction_relationships_to_same_household_fkey
    foreign key (household_id, to_transaction_id)
    references public.finance_transactions (household_id, id) on delete restrict,
  constraint finance_tx_relationships_supersedes_household_fkey
    foreign key (household_id, supersedes_relationship_id)
    references public.finance_transaction_relationships (household_id, id) on delete restrict
);

create table public.finance_review_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_review_item_id uuid not null default gen_random_uuid(),
  transaction_id uuid,
  document_id uuid,
  evidence_object_id uuid,
  review_type text not null check (
    review_type in (
      'classification', 'transaction_match', 'document_match', 'transfer', 'cash',
      'reimbursement', 'mixed_use', 'income', 'tax_treatment', 'missing_source', 'other'
    )
  ),
  title text not null check (btrim(title) <> ''),
  question text not null check (btrim(question) <> ''),
  proposed_interpretation text,
  ambiguity_reason text not null check (btrim(ambiguity_reason) <> ''),
  answer_options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(answer_options) = 'array'),
  context_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context_snapshot) = 'object'),
  workflow_status text not null default 'open'
    check (workflow_status in ('open', 'answered', 'resolved', 'deferred')),
  priority text not null default 'medium'
    check (priority in ('critical', 'high', 'medium', 'low')),
  priority_score integer not null default 0,
  amount_cents bigint,
  tax_impact_cents bigint,
  due_at timestamptz,
  assigned_to uuid references auth.users (id) on delete restrict,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_review_item_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_review_items_household_id_id_key unique (household_id, id),
  constraint finance_review_items_logical_revision_key
    unique (household_id, logical_review_item_id, revision_number),
  constraint finance_review_items_supersedes_key unique (supersedes_review_item_id),
  constraint finance_review_items_transaction_same_household_fkey
    foreign key (household_id, transaction_id)
    references public.finance_transactions (household_id, id) on delete restrict,
  constraint finance_review_items_document_same_household_fkey
    foreign key (household_id, document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_review_items_evidence_same_household_fkey
    foreign key (household_id, evidence_object_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_review_items_supersedes_same_household_fkey
    foreign key (household_id, supersedes_review_item_id)
    references public.finance_review_items (household_id, id) on delete restrict
);

create table public.finance_human_decisions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_decision_id uuid not null default gen_random_uuid(),
  review_item_id uuid not null,
  question_snapshot text not null check (btrim(question_snapshot) <> ''),
  selected_option text,
  answer_text text not null check (btrim(answer_text) <> ''),
  application_scope text not null default 'once'
    check (application_scope in ('once', 'recurring_rule')),
  decision_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(decision_context) = 'object'),
  answered_by uuid not null references auth.users (id) on delete restrict,
  answered_at timestamptz not null default now(),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_decision_id uuid,
  created_at timestamptz not null default now(),
  constraint finance_human_decisions_household_id_id_key unique (household_id, id),
  constraint finance_human_decisions_logical_revision_key
    unique (household_id, logical_decision_id, revision_number),
  constraint finance_human_decisions_supersedes_key unique (supersedes_decision_id),
  constraint finance_human_decisions_review_same_household_fkey
    foreign key (household_id, review_item_id)
    references public.finance_review_items (household_id, id) on delete restrict,
  constraint finance_human_decisions_supersedes_same_household_fkey
    foreign key (household_id, supersedes_decision_id)
    references public.finance_human_decisions (household_id, id) on delete restrict
);

create table public.finance_classification_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_rule_id uuid not null default gen_random_uuid(),
  source_id uuid,
  financial_account_id uuid,
  created_from_decision_id uuid,
  name text not null check (btrim(name) <> ''),
  priority integer not null default 0,
  match_conditions jsonb not null check (jsonb_typeof(match_conditions) = 'object'),
  rule_actions jsonb not null check (jsonb_typeof(rule_actions) = 'object'),
  rule_status text not null default 'active' check (rule_status in ('draft', 'active', 'disabled')),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_rule_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_classification_rules_household_id_id_key unique (household_id, id),
  constraint finance_classification_rules_logical_revision_key
    unique (household_id, logical_rule_id, revision_number),
  constraint finance_classification_rules_supersedes_key unique (supersedes_rule_id),
  constraint finance_classification_rules_source_same_household_fkey
    foreign key (household_id, source_id)
    references public.finance_sources (household_id, id) on delete restrict,
  constraint finance_classification_rules_account_same_household_fkey
    foreign key (household_id, financial_account_id)
    references public.financial_accounts (household_id, id) on delete restrict,
  constraint finance_classification_rules_decision_same_household_fkey
    foreign key (household_id, created_from_decision_id)
    references public.finance_human_decisions (household_id, id) on delete restrict,
  constraint finance_classification_rules_supersedes_same_household_fkey
    foreign key (household_id, supersedes_rule_id)
    references public.finance_classification_rules (household_id, id) on delete restrict
);

create table public.finance_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_allocation_id uuid not null default gen_random_uuid(),
  transaction_id uuid not null,
  evidence_object_id uuid,
  human_decision_id uuid,
  classification_rule_id uuid,
  amount_cents bigint not null,
  allocation_type text not null check (
    allocation_type in (
      'income', 'expense', 'transfer', 'capital', 'private', 'liability',
      'equity', 'tax_review', 'unclassified'
    )
  ),
  category_code text not null check (btrim(category_code) <> ''),
  income_stream text,
  property_unit text,
  person_key text check (person_key is null or person_key in ('tristan', 'jane', 'household', 'worker', 'other')),
  tax_treatment text not null default 'accountant_review'
    check (tax_treatment in ('taxable', 'deductible', 'capital', 'private', 'transfer', 'accountant_review')),
  tax_year integer check (tax_year is null or tax_year between 2000 and 2200),
  memo text,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_allocation_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_allocations_household_id_id_key unique (household_id, id),
  constraint finance_allocations_logical_revision_key
    unique (household_id, logical_allocation_id, revision_number),
  constraint finance_allocations_supersedes_key unique (supersedes_allocation_id),
  constraint finance_allocations_transaction_same_household_fkey
    foreign key (household_id, transaction_id)
    references public.finance_transactions (household_id, id) on delete restrict,
  constraint finance_allocations_evidence_same_household_fkey
    foreign key (household_id, evidence_object_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_allocations_decision_same_household_fkey
    foreign key (household_id, human_decision_id)
    references public.finance_human_decisions (household_id, id) on delete restrict,
  constraint finance_allocations_rule_same_household_fkey
    foreign key (household_id, classification_rule_id)
    references public.finance_classification_rules (household_id, id) on delete restrict,
  constraint finance_allocations_supersedes_same_household_fkey
    foreign key (household_id, supersedes_allocation_id)
    references public.finance_allocations (household_id, id) on delete restrict
);

comment on column public.finance_allocations.amount_cents is
  'Signed integer cents using the same sign as the transaction amount.';

create table public.finance_transaction_document_matches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_match_id uuid not null default gen_random_uuid(),
  transaction_id uuid not null,
  document_id uuid not null,
  human_decision_id uuid,
  match_type text not null check (
    match_type in ('exact_reference_amount', 'date_amount_vendor', 'aggregate', 'partial', 'manual', 'other')
  ),
  match_status text not null default 'proposed'
    check (match_status in ('proposed', 'confirmed', 'rejected')),
  matched_amount_cents bigint,
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  rationale text,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_match_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_transaction_document_matches_household_id_id_key unique (household_id, id),
  constraint finance_transaction_document_matches_logical_revision_key
    unique (household_id, logical_match_id, revision_number),
  constraint finance_transaction_document_matches_supersedes_key unique (supersedes_match_id),
  constraint finance_tx_doc_matches_transaction_household_fkey
    foreign key (household_id, transaction_id)
    references public.finance_transactions (household_id, id) on delete restrict,
  constraint finance_tx_doc_matches_document_household_fkey
    foreign key (household_id, document_id)
    references public.finance_documents (household_id, id) on delete restrict,
  constraint finance_tx_doc_matches_decision_household_fkey
    foreign key (household_id, human_decision_id)
    references public.finance_human_decisions (household_id, id) on delete restrict,
  constraint finance_tx_doc_matches_supersedes_household_fkey
    foreign key (household_id, supersedes_match_id)
    references public.finance_transaction_document_matches (household_id, id) on delete restrict
);

create table public.finance_close_periods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_close_period_id uuid not null default gen_random_uuid(),
  period_start_on date not null,
  period_end_on date not null,
  close_status text not null default 'open'
    check (close_status in ('open', 'soft_closed', 'locked')),
  closed_by uuid references auth.users (id) on delete restrict,
  closed_at timestamptz,
  notes text,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_close_period_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_close_periods_household_id_id_key unique (household_id, id),
  constraint finance_close_periods_logical_revision_key
    unique (household_id, logical_close_period_id, revision_number),
  constraint finance_close_periods_supersedes_key unique (supersedes_close_period_id),
  constraint finance_close_periods_date_order_check check (period_end_on >= period_start_on),
  constraint finance_close_periods_status_timestamp_check check (
    (close_status = 'open' and closed_at is null)
    or (close_status <> 'open' and closed_at is not null and closed_by is not null)
  ),
  constraint finance_close_periods_supersedes_same_household_fkey
    foreign key (household_id, supersedes_close_period_id)
    references public.finance_close_periods (household_id, id) on delete restrict
);

create table public.finance_tax_scenarios (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_tax_scenario_id uuid not null default gen_random_uuid(),
  tax_year integer not null check (tax_year between 2000 and 2200),
  provisional_period text not null check (provisional_period in ('first', 'second', 'third', 'annual', 'other')),
  scenario_name text not null check (btrim(scenario_name) <> ''),
  scenario_type text not null check (scenario_type in ('conservative', 'intended_management_fee', 'custom')),
  scenario_status text not null default 'draft'
    check (scenario_status in ('draft', 'accountant_review', 'confirmed', 'superseded')),
  period_start_on date not null,
  period_end_on date not null,
  calculated_management_fee_cents bigint,
  paid_management_fee_cents bigint,
  accrued_management_fee_cents bigint,
  tristan_taxable_income_cents bigint,
  jane_taxable_income_cents bigint,
  combined_household_tax_cents bigint,
  calculation_basis jsonb not null default '{}'::jsonb
    check (jsonb_typeof(calculation_basis) = 'object'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  calculated_at timestamptz,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_tax_scenario_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_tax_scenarios_household_id_id_key unique (household_id, id),
  constraint finance_tax_scenarios_logical_revision_key
    unique (household_id, logical_tax_scenario_id, revision_number),
  constraint finance_tax_scenarios_supersedes_key unique (supersedes_tax_scenario_id),
  constraint finance_tax_scenarios_date_order_check check (period_end_on >= period_start_on),
  constraint finance_tax_scenarios_management_fee_math_check check (
    accrued_management_fee_cents is null
    or calculated_management_fee_cents is null
    or paid_management_fee_cents is null
    or accrued_management_fee_cents = calculated_management_fee_cents - paid_management_fee_cents
  ),
  constraint finance_tax_scenarios_supersedes_same_household_fkey
    foreign key (household_id, supersedes_tax_scenario_id)
    references public.finance_tax_scenarios (household_id, id) on delete restrict
);

comment on table public.finance_tax_scenarios is
  'Versioned calculations. intended_management_fee is never equivalent to accountant confirmation.';

create table public.finance_tax_scenario_lines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_tax_scenario_line_id uuid not null default gen_random_uuid(),
  tax_scenario_id uuid not null,
  person_key text not null check (person_key in ('tristan', 'jane', 'household')),
  line_type text not null check (
    line_type in (
      'income', 'paye', 'running_cost', 'bond_interest', 'domestic_worker',
      'capital_addition', 'asset', 'management_fee', 'provisional_payment',
      'tax_liability', 'reserve', 'other'
    )
  ),
  category_code text not null check (btrim(category_code) <> ''),
  label text not null check (btrim(label) <> ''),
  amount_cents bigint not null,
  tax_treatment text not null
    check (tax_treatment in ('taxable', 'deductible', 'capital', 'private', 'transfer', 'accountant_review')),
  line_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(line_metadata) = 'object'),
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_tax_scenario_line_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_tax_scenario_lines_household_id_id_key unique (household_id, id),
  constraint finance_tax_scenario_lines_logical_revision_key
    unique (household_id, logical_tax_scenario_line_id, revision_number),
  constraint finance_tax_scenario_lines_supersedes_key unique (supersedes_tax_scenario_line_id),
  constraint finance_tax_scenario_lines_scenario_same_household_fkey
    foreign key (household_id, tax_scenario_id)
    references public.finance_tax_scenarios (household_id, id) on delete restrict,
  constraint finance_tax_scenario_lines_supersedes_same_household_fkey
    foreign key (household_id, supersedes_tax_scenario_line_id)
    references public.finance_tax_scenario_lines (household_id, id) on delete restrict
);

create table public.finance_tax_scenario_line_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  tax_scenario_line_id uuid not null,
  allocation_id uuid not null,
  included_amount_cents bigint not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_tax_scenario_line_allocations_household_id_id_key unique (household_id, id),
  constraint finance_tax_scenario_line_allocations_unique_link
    unique (tax_scenario_line_id, allocation_id),
  constraint finance_tax_scenario_line_allocations_line_same_household_fkey
    foreign key (household_id, tax_scenario_line_id)
    references public.finance_tax_scenario_lines (household_id, id) on delete restrict,
  constraint finance_tax_line_allocations_allocation_household_fkey
    foreign key (household_id, allocation_id)
    references public.finance_allocations (household_id, id) on delete restrict
);

create table public.finance_submission_packs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_submission_pack_id uuid not null default gen_random_uuid(),
  tax_scenario_id uuid not null,
  pack_name text not null check (btrim(pack_name) <> ''),
  pack_status text not null default 'draft'
    check (pack_status in ('draft', 'review_ready', 'approved', 'sent')),
  accountant_workbook_evidence_id uuid,
  evidence_zip_evidence_id uuid,
  manifest_evidence_id uuid,
  cover_email_evidence_id uuid,
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz,
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  sent_at timestamptz,
  record_status text not null default 'active'
    check (record_status in ('active', 'void', 'duplicate', 'private', 'not_relevant')),
  revision_number integer not null default 1 check (revision_number > 0),
  supersedes_submission_pack_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_submission_packs_household_id_id_key unique (household_id, id),
  constraint finance_submission_packs_logical_revision_key
    unique (household_id, logical_submission_pack_id, revision_number),
  constraint finance_submission_packs_supersedes_key unique (supersedes_submission_pack_id),
  constraint finance_submission_packs_approval_check check (
    (approved_at is null and approved_by is null) or (approved_at is not null and approved_by is not null)
  ),
  constraint finance_submission_packs_scenario_same_household_fkey
    foreign key (household_id, tax_scenario_id)
    references public.finance_tax_scenarios (household_id, id) on delete restrict,
  constraint finance_submission_packs_workbook_same_household_fkey
    foreign key (household_id, accountant_workbook_evidence_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_submission_packs_zip_same_household_fkey
    foreign key (household_id, evidence_zip_evidence_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_submission_packs_manifest_same_household_fkey
    foreign key (household_id, manifest_evidence_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_submission_packs_email_same_household_fkey
    foreign key (household_id, cover_email_evidence_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict,
  constraint finance_submission_packs_supersedes_same_household_fkey
    foreign key (household_id, supersedes_submission_pack_id)
    references public.finance_submission_packs (household_id, id) on delete restrict
);

create table public.finance_submission_pack_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  submission_pack_id uuid not null,
  evidence_object_id uuid not null,
  item_type text not null check (
    item_type in ('workbook', 'schedule', 'ledger', 'exception_register', 'evidence', 'manifest', 'email', 'other')
  ),
  display_order integer not null default 0,
  item_label text not null check (btrim(item_label) <> ''),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_submission_pack_items_household_id_id_key unique (household_id, id),
  constraint finance_submission_pack_items_unique_evidence
    unique (submission_pack_id, evidence_object_id, item_type),
  constraint finance_submission_pack_items_pack_same_household_fkey
    foreign key (household_id, submission_pack_id)
    references public.finance_submission_packs (household_id, id) on delete restrict,
  constraint finance_submission_pack_items_evidence_same_household_fkey
    foreign key (household_id, evidence_object_id)
    references public.finance_evidence_objects (household_id, id) on delete restrict
);

-- RLS membership lookups and the main review/ledger access paths.
create index household_members_user_status_household_idx
  on public.household_members (user_id, membership_status, household_id, role);
create index finance_sources_household_status_idx
  on public.finance_sources (household_id, connection_status, last_success_at desc);
create index finance_import_runs_household_started_idx
  on public.finance_import_runs (household_id, started_at desc);
create index finance_evidence_objects_exact_sha_idx
  on public.finance_evidence_objects (household_id, exact_sha256);
create index finance_evidence_objects_normalized_sha_idx
  on public.finance_evidence_objects (household_id, normalized_sha256)
  where normalized_sha256 is not null;
create index finance_evidence_objects_page_text_sha_idx
  on public.finance_evidence_objects (household_id, page_text_sha256)
  where page_text_sha256 is not null;
create index finance_documents_type_date_idx
  on public.finance_documents (household_id, document_type, issued_on desc);
create index finance_transactions_account_date_idx
  on public.finance_transactions (household_id, financial_account_id, transaction_at desc);
create index finance_transactions_household_date_idx
  on public.finance_transactions (household_id, transaction_at desc);
create index finance_allocations_tax_rollup_idx
  on public.finance_allocations (household_id, tax_year, tax_treatment, category_code)
  where record_status = 'active';
create index finance_review_items_effective_inbox_idx
  on public.finance_review_items (
    household_id,
    workflow_status,
    priority_score desc,
    tax_impact_cents desc nulls last,
    amount_cents desc nulls last,
    created_at
  )
  where record_status = 'active';
create index finance_tax_scenarios_period_idx
  on public.finance_tax_scenarios (household_id, tax_year desc, provisional_period, scenario_type);
create index finance_submission_packs_status_idx
  on public.finance_submission_packs (household_id, pack_status, created_at desc);

-- PostgreSQL does not create child-side indexes for foreign keys. Generate a
-- deterministic index for each still-uncovered FK in this migration's tables.
do $do$
declare
  fk record;
  column_list text;
  index_name text;
begin
  for fk in
    select c.oid, c.conrelid, c.conkey
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where c.contype = 'f'
      and nsp.nspname = 'public'
      and (
        rel.relname in ('households', 'household_members', 'financial_accounts')
        or rel.relname like 'finance\_%' escape '\'
      )
      and not exists (
        select 1
        from pg_index idx
        where idx.indrelid = c.conrelid
          and c.conkey <@ (idx.indkey::smallint[])
      )
  loop
    select string_agg(format('%I', att.attname), ', ' order by key_col.ordinality)
      into column_list
    from unnest(fk.conkey) with ordinality as key_col(attnum, ordinality)
    join pg_attribute att
      on att.attrelid = fk.conrelid and att.attnum = key_col.attnum;

    index_name := 'finance_fk_' || substr(
      md5(fk.conrelid::regclass::text || ':' || fk.conkey::text),
      1,
      20
    );

    execute format(
      'create index %I on %s (%s)',
      index_name,
      fk.conrelid::regclass,
      column_list
    );
  end loop;
end
$do$;

-- Current views show the leaf revision. Effective views additionally exclude
-- rows currently marked void, duplicate, private, or not relevant.
create view public.finance_current_sources
with (security_invoker = true)
as
select source.*
from public.finance_sources source
where not exists (
  select 1
  from public.finance_sources successor
  where successor.supersedes_source_id = source.id
);

create view public.finance_current_accounts
with (security_invoker = true)
as
select account.*
from public.financial_accounts account
where not exists (
  select 1
  from public.financial_accounts successor
  where successor.supersedes_account_id = account.id
);

create view public.finance_current_import_runs
with (security_invoker = true)
as
select import_run.*
from public.finance_import_runs import_run
where not exists (
  select 1
  from public.finance_import_runs successor
  where successor.supersedes_import_run_id = import_run.id
);

create view public.finance_current_evidence_objects
with (security_invoker = true)
as
select
  evidence.id,
  evidence.household_id,
  evidence.logical_evidence_id,
  evidence.source_id,
  evidence.import_run_id,
  evidence.import_record_id,
  evidence.evidence_kind,
  evidence.source_object_key,
  evidence.original_filename,
  evidence.media_type,
  evidence.byte_size,
  evidence.has_storage_copy,
  evidence.has_local_copy,
  evidence.exact_sha256,
  evidence.normalized_sha256,
  evidence.page_text_sha256,
  evidence.duplicate_of_evidence_id,
  evidence.retention_status,
  evidence.record_status,
  evidence.source_created_at,
  evidence.acquired_at,
  evidence.last_verified_at,
  evidence.metadata,
  evidence.revision_number,
  evidence.supersedes_evidence_id,
  evidence.created_by,
  evidence.created_at
from public.finance_evidence_objects evidence
where not exists (
  select 1
  from public.finance_evidence_objects successor
  where successor.supersedes_evidence_id = evidence.id
);

comment on view public.finance_current_evidence_objects is
  'Browser-safe evidence index. Local and Storage paths are intentionally omitted.';

create view public.finance_effective_evidence_objects
with (security_invoker = true)
as
select *
from public.finance_current_evidence_objects
where record_status = 'active';

create view public.finance_current_documents
with (security_invoker = true)
as
select document.*
from public.finance_documents document
where not exists (
  select 1
  from public.finance_documents successor
  where successor.supersedes_document_id = document.id
);

create view public.finance_effective_documents
with (security_invoker = true)
as
select *
from public.finance_current_documents
where record_status = 'active';

create view public.finance_current_document_pages
with (security_invoker = true)
as
select page.*
from public.finance_document_pages page
where not exists (
  select 1
  from public.finance_document_pages successor
  where successor.supersedes_page_id = page.id
);

create view public.finance_current_document_line_items
with (security_invoker = true)
as
select line_item.*
from public.finance_document_line_items line_item
where not exists (
  select 1
  from public.finance_document_line_items successor
  where successor.supersedes_line_item_id = line_item.id
);

create view public.finance_current_transactions
with (security_invoker = true)
as
select txn.*
from public.finance_transactions txn
where not exists (
  select 1
  from public.finance_transactions successor
  where successor.supersedes_transaction_id = txn.id
);

create view public.finance_effective_transactions
with (security_invoker = true)
as
select *
from public.finance_current_transactions
where record_status = 'active';

create view public.finance_current_review_items
with (security_invoker = true)
as
select review_item.*
from public.finance_review_items review_item
where not exists (
  select 1
  from public.finance_review_items successor
  where successor.supersedes_review_item_id = review_item.id
);

create view public.finance_current_human_decisions
with (security_invoker = true)
as
select decision.*
from public.finance_human_decisions decision
where not exists (
  select 1
  from public.finance_human_decisions successor
  where successor.supersedes_decision_id = decision.id
);

create view public.finance_current_classification_rules
with (security_invoker = true)
as
select rule.*
from public.finance_classification_rules rule
where not exists (
  select 1
  from public.finance_classification_rules successor
  where successor.supersedes_rule_id = rule.id
);

create view public.finance_current_allocations
with (security_invoker = true)
as
select allocation.*
from public.finance_allocations allocation
where not exists (
  select 1
  from public.finance_allocations successor
  where successor.supersedes_allocation_id = allocation.id
);

create view public.finance_effective_allocations
with (security_invoker = true)
as
select *
from public.finance_current_allocations
where record_status = 'active';

create view public.finance_current_transaction_document_matches
with (security_invoker = true)
as
select transaction_match.*
from public.finance_transaction_document_matches transaction_match
where not exists (
  select 1
  from public.finance_transaction_document_matches successor
  where successor.supersedes_match_id = transaction_match.id
);

create view public.finance_current_tax_scenarios
with (security_invoker = true)
as
select scenario.*
from public.finance_tax_scenarios scenario
where not exists (
  select 1
  from public.finance_tax_scenarios successor
  where successor.supersedes_tax_scenario_id = scenario.id
);

create view public.finance_current_tax_scenario_lines
with (security_invoker = true)
as
select scenario_line.*
from public.finance_tax_scenario_lines scenario_line
where not exists (
  select 1
  from public.finance_tax_scenario_lines successor
  where successor.supersedes_tax_scenario_line_id = scenario_line.id
);

create view public.finance_effective_tax_scenario_lines
with (security_invoker = true)
as
select *
from public.finance_current_tax_scenario_lines
where record_status = 'active';

create view public.finance_current_submission_packs
with (security_invoker = true)
as
select submission_pack.*
from public.finance_submission_packs submission_pack
where not exists (
  select 1
  from public.finance_submission_packs successor
  where successor.supersedes_submission_pack_id = submission_pack.id
);

create view public.finance_source_health
with (security_invoker = true)
as
select
  source.id as source_id,
  source.household_id,
  source.logical_source_id,
  source.source_type,
  source.display_name,
  source.owner_scope,
  source.connection_mode,
  source.connection_status,
  source.expected_frequency,
  source.last_checked_at,
  source.last_success_at,
  source.coverage_start_on,
  source.coverage_end_on,
  source.health_summary,
  latest_import.id as latest_import_id,
  latest_import.import_mode as latest_import_mode,
  latest_import.run_status as latest_import_status,
  latest_import.started_at as latest_import_started_at,
  latest_import.completed_at as latest_import_completed_at,
  latest_import.discovered_record_count as latest_discovered_record_count,
  latest_import.inserted_record_count as latest_inserted_record_count,
  latest_import.duplicate_record_count as latest_duplicate_record_count,
  latest_import.review_record_count as latest_review_record_count,
  coalesce(latest_import.run_status = 'succeeded', false) as latest_import_succeeded
from public.finance_current_sources source
left join lateral (
  select import_run.*
  from public.finance_current_import_runs import_run
  where import_run.source_id in (
    select source_revision.id
    from public.finance_sources source_revision
    where source_revision.logical_source_id = source.logical_source_id
      and source_revision.household_id = source.household_id
  )
    and import_run.record_status = 'active'
  order by import_run.started_at desc, import_run.created_at desc
  limit 1
) latest_import on true
where source.record_status = 'active';

create view public.finance_anomaly_inbox
with (security_invoker = true)
as
select
  review_item.id as review_item_id,
  review_item.household_id,
  review_item.logical_review_item_id,
  review_item.review_type,
  review_item.title,
  review_item.question,
  review_item.proposed_interpretation,
  review_item.ambiguity_reason,
  review_item.answer_options,
  review_item.context_snapshot,
  review_item.workflow_status,
  review_item.priority,
  review_item.priority_score,
  review_item.amount_cents,
  review_item.tax_impact_cents,
  review_item.due_at,
  review_item.assigned_to,
  review_item.transaction_id,
  txn.financial_account_id,
  txn.transaction_at,
  txn.amount_cents as transaction_amount_cents,
  txn.currency as transaction_currency,
  txn.raw_description as transaction_description,
  txn.counterparty_name,
  txn.reference as transaction_reference,
  review_item.document_id,
  review_item.evidence_object_id,
  review_item.revision_number,
  review_item.created_by,
  review_item.created_at
from public.finance_current_review_items review_item
left join public.finance_current_transactions txn
  on txn.id = review_item.transaction_id
  and txn.household_id = review_item.household_id
where review_item.record_status = 'active'
  and review_item.workflow_status <> 'resolved';

create view public.finance_transaction_balances
with (security_invoker = true)
as
select
  txn.*,
  coalesce(allocation_totals.allocated_amount_cents, 0::bigint) as allocated_amount_cents,
  txn.amount_cents - coalesce(allocation_totals.allocated_amount_cents, 0::bigint)
    as unallocated_amount_cents,
  coalesce(allocation_totals.allocation_count, 0::bigint) as allocation_count,
  txn.amount_cents = coalesce(allocation_totals.allocated_amount_cents, 0::bigint)
    as is_fully_allocated
from public.finance_effective_transactions txn
left join lateral (
  select
    sum(allocation.amount_cents)::bigint as allocated_amount_cents,
    count(*)::bigint as allocation_count
  from public.finance_effective_allocations allocation
  where allocation.transaction_id = txn.id
    and allocation.household_id = txn.household_id
) allocation_totals on true;

create view public.finance_dashboard_summary
with (security_invoker = true)
as
select
  household.id as household_id,
  coalesce(transaction_summary.transaction_count, 0::bigint) as transaction_count,
  coalesce(transaction_summary.unallocated_transaction_count, 0::bigint)
    as unallocated_transaction_count,
  coalesce(transaction_summary.unallocated_absolute_cents, 0::bigint)
    as unallocated_absolute_cents,
  coalesce(review_summary.open_review_count, 0::bigint) as open_review_count,
  coalesce(review_summary.open_tax_impact_absolute_cents, 0::bigint)
    as open_tax_impact_absolute_cents,
  source_summary.latest_import_completed_at
from public.households household
left join lateral (
  select
    count(*)::bigint as transaction_count,
    count(*) filter (where not txn.is_fully_allocated)::bigint
      as unallocated_transaction_count,
    coalesce(
      sum(abs(txn.unallocated_amount_cents))
        filter (where not txn.is_fully_allocated),
      0::numeric
    )::bigint as unallocated_absolute_cents
  from public.finance_transaction_balances txn
  where txn.household_id = household.id
) transaction_summary on true
left join lateral (
  select
    count(*)::bigint as open_review_count,
    coalesce(sum(abs(review_item.tax_impact_cents)), 0::numeric)::bigint
      as open_tax_impact_absolute_cents
  from public.finance_anomaly_inbox review_item
  where review_item.household_id = household.id
) review_summary on true
left join lateral (
  select max(source_health.latest_import_completed_at) as latest_import_completed_at
  from public.finance_source_health source_health
  where source_health.household_id = household.id
) source_summary on true;

do $do$
declare
  view_name text;
begin
  foreach view_name in array array[
    'finance_current_sources', 'finance_current_accounts',
    'finance_current_import_runs', 'finance_current_evidence_objects',
    'finance_effective_evidence_objects', 'finance_current_documents',
    'finance_effective_documents', 'finance_current_document_pages',
    'finance_current_document_line_items', 'finance_current_transactions',
    'finance_effective_transactions', 'finance_current_review_items',
    'finance_current_human_decisions', 'finance_current_classification_rules',
    'finance_current_allocations', 'finance_effective_allocations',
    'finance_current_transaction_document_matches',
    'finance_current_tax_scenarios', 'finance_current_tax_scenario_lines',
    'finance_effective_tax_scenario_lines', 'finance_current_submission_packs',
    'finance_source_health', 'finance_anomaly_inbox',
    'finance_transaction_balances', 'finance_dashboard_summary'
  ]
  loop
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      view_name
    );
    execute format(
      'grant select on table public.%I to authenticated, service_role',
      view_name
    );
  end loop;
end
$do$;

create or replace function private.has_household_role(
  target_household_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.household_members member
      where member.household_id = target_household_id
        and member.user_id = (select auth.uid())
        and member.membership_status = 'active'
        and (allowed_roles is null or member.role = any (allowed_roles))
    );
$$;

create or replace function private.can_bootstrap_household(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.households household
      where household.id = target_household_id
        and household.created_by = (select auth.uid())
        and not exists (
          select 1
          from public.household_members member
          where member.household_id = household.id
        )
    );
$$;

create or replace function private.can_access_finance_storage_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then private.has_household_role(split_part(object_name, '/', 1)::uuid, null)
    else false
  end;
$$;

revoke all on function private.has_household_role(uuid, text[]) from public, anon;
revoke all on function private.can_bootstrap_household(uuid) from public, anon;
revoke all on function private.can_access_finance_storage_path(text) from public, anon;

grant execute on function private.has_household_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.can_bootstrap_household(uuid) to authenticated, service_role;
grant execute on function private.can_access_finance_storage_path(text) to authenticated, service_role;

-- Enable and force RLS on every exposed finance table.
do $do$
declare
  table_name text;
begin
  foreach table_name in array array[
    'households', 'household_members', 'finance_sources', 'financial_accounts',
    'finance_import_runs', 'finance_import_records', 'finance_evidence_objects',
    'finance_documents', 'finance_document_pages', 'finance_document_line_items',
    'finance_document_relationships', 'finance_transactions',
    'finance_transaction_relationships', 'finance_review_items',
    'finance_human_decisions', 'finance_classification_rules',
    'finance_allocations', 'finance_transaction_document_matches',
    'finance_close_periods', 'finance_tax_scenarios',
    'finance_tax_scenario_lines', 'finance_tax_scenario_line_allocations',
    'finance_submission_packs', 'finance_submission_pack_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end
$do$;

create policy "members can read households"
  on public.households
  for select
  to authenticated
  using (
    private.has_household_role(id, null)
    or private.can_bootstrap_household(id)
  );

create policy "authenticated users can create households"
  on public.households
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "owners can update households"
  on public.households
  for update
  to authenticated
  using (private.has_household_role(id, array['owner']))
  with check (private.has_household_role(id, array['owner']));

create policy "members can read household memberships"
  on public.household_members
  for select
  to authenticated
  using (
    private.has_household_role(household_id, null)
    or (
      user_id = (select auth.uid())
      and private.can_bootstrap_household(household_id)
    )
  );

create policy "owners can add household memberships"
  on public.household_members
  for insert
  to authenticated
  with check (
    private.has_household_role(household_id, array['owner'])
    or (
      user_id = (select auth.uid())
      and role = 'owner'
      and membership_status = 'active'
      and private.can_bootstrap_household(household_id)
    )
  );

create policy "owners can update household memberships"
  on public.household_members
  for update
  to authenticated
  using (private.has_household_role(household_id, array['owner']))
  with check (private.has_household_role(household_id, array['owner']));

-- All active household members may read finance data. Mutation policies are
-- INSERT-only because corrections are represented by superseding revisions.
do $do$
declare
  table_name text;
begin
  foreach table_name in array array[
    'finance_sources', 'financial_accounts', 'finance_import_runs',
    'finance_import_records', 'finance_evidence_objects', 'finance_documents',
    'finance_document_pages', 'finance_document_line_items',
    'finance_document_relationships', 'finance_transactions',
    'finance_transaction_relationships', 'finance_review_items',
    'finance_human_decisions', 'finance_classification_rules',
    'finance_allocations', 'finance_transaction_document_matches',
    'finance_close_periods', 'finance_tax_scenarios',
    'finance_tax_scenario_lines', 'finance_tax_scenario_line_allocations',
    'finance_submission_packs', 'finance_submission_pack_items'
  ]
  loop
    execute format(
      'create policy "household members can read" on public.%I '
      'for select to authenticated using (private.has_household_role(household_id, null))',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'finance_import_runs', 'finance_import_records', 'finance_evidence_objects',
    'finance_documents', 'finance_document_pages', 'finance_document_line_items',
    'finance_document_relationships', 'finance_transactions',
    'finance_transaction_relationships', 'finance_review_items',
    'finance_human_decisions', 'finance_classification_rules',
    'finance_allocations', 'finance_transaction_document_matches'
  ]
  loop
    execute format(
      'create policy "household members can append" on public.%I '
      'for insert to authenticated '
      'with check (private.has_household_role(household_id, null))',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'finance_sources', 'financial_accounts', 'finance_close_periods',
    'finance_tax_scenarios', 'finance_tax_scenario_lines',
    'finance_tax_scenario_line_allocations', 'finance_submission_packs',
    'finance_submission_pack_items'
  ]
  loop
    execute format(
      'create policy "household owners can append" on public.%I '
      'for insert to authenticated '
      'with check (private.has_household_role(household_id, array[''owner'']))',
      table_name
    );
  end loop;
end
$do$;

-- Explicit Data API grants. There are intentionally no anon grants and no
-- UPDATE or DELETE grants on append-only finance data.
do $do$
declare
  table_name text;
begin
  foreach table_name in array array[
    'households', 'household_members', 'finance_sources', 'financial_accounts',
    'finance_import_runs', 'finance_import_records', 'finance_evidence_objects',
    'finance_documents', 'finance_document_pages', 'finance_document_line_items',
    'finance_document_relationships', 'finance_transactions',
    'finance_transaction_relationships', 'finance_review_items',
    'finance_human_decisions', 'finance_classification_rules',
    'finance_allocations', 'finance_transaction_document_matches',
    'finance_close_periods', 'finance_tax_scenarios',
    'finance_tax_scenario_lines', 'finance_tax_scenario_line_allocations',
    'finance_submission_packs', 'finance_submission_pack_items'
  ]
  loop
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      table_name
    );
  end loop;

  foreach table_name in array array['households', 'household_members']
  loop
    execute format(
      'grant select, insert, update on table public.%I to authenticated, service_role',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'finance_sources', 'financial_accounts', 'finance_import_runs',
    'finance_import_records', 'finance_documents', 'finance_document_pages',
    'finance_document_line_items', 'finance_document_relationships',
    'finance_transactions', 'finance_transaction_relationships',
    'finance_review_items', 'finance_human_decisions',
    'finance_classification_rules', 'finance_allocations',
    'finance_transaction_document_matches', 'finance_close_periods',
    'finance_tax_scenarios', 'finance_tax_scenario_lines',
    'finance_tax_scenario_line_allocations', 'finance_submission_packs',
    'finance_submission_pack_items'
  ]
  loop
    execute format(
      'grant select, insert on table public.%I to authenticated, service_role',
      table_name
    );
  end loop;
end
$do$;

-- Evidence paths stay server-side. The browser can append registry rows and
-- read only the safe columns used by finance_current_evidence_objects.
grant insert on table public.finance_evidence_objects to authenticated;
grant select, insert on table public.finance_evidence_objects to service_role;
grant select (
  id,
  household_id,
  logical_evidence_id,
  source_id,
  import_run_id,
  import_record_id,
  evidence_kind,
  source_object_key,
  original_filename,
  media_type,
  byte_size,
  has_storage_copy,
  has_local_copy,
  exact_sha256,
  normalized_sha256,
  page_text_sha256,
  duplicate_of_evidence_id,
  retention_status,
  record_status,
  source_created_at,
  acquired_at,
  last_verified_at,
  metadata,
  revision_number,
  supersedes_evidence_id,
  created_by,
  created_at
) on public.finance_evidence_objects to authenticated;

insert into storage.buckets (id, name, public)
values ('finance-evidence', 'finance-evidence', false)
on conflict (id) do update
set public = false;

drop policy if exists "household members can read finance evidence" on storage.objects;
create policy "household members can read finance evidence"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'finance-evidence'
    and private.can_access_finance_storage_path(name)
  );

drop policy if exists "household members can upload finance evidence" on storage.objects;
create policy "household members can upload finance evidence"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'finance-evidence'
    and private.can_access_finance_storage_path(name)
  );

-- Deliberately no UPDATE or DELETE policy for finance-evidence. Uploads use a
-- new revision path so an original Storage object cannot be overwritten.

create or replace function private.set_finance_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.prevent_finance_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Finance records are retained forever; hard delete is disabled for %.%', tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$$;

create or replace function private.prevent_finance_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Finance records are append-only; insert a superseding revision for %.%', tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$$;

revoke all on function private.set_finance_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.prevent_finance_delete() from public, anon, authenticated, service_role;
revoke all on function private.prevent_finance_update() from public, anon, authenticated, service_role;

create trigger households_set_updated_at
before update on public.households
for each row execute function private.set_finance_updated_at();

create trigger household_members_set_updated_at
before update on public.household_members
for each row execute function private.set_finance_updated_at();

-- Every finance table rejects hard delete, including privileged application
-- roles. Revisioned domain tables additionally reject in-place updates.
do $do$
declare
  table_name text;
begin
  foreach table_name in array array[
    'households', 'household_members', 'finance_sources', 'financial_accounts',
    'finance_import_runs', 'finance_import_records', 'finance_evidence_objects',
    'finance_documents', 'finance_document_pages', 'finance_document_line_items',
    'finance_document_relationships', 'finance_transactions',
    'finance_transaction_relationships', 'finance_review_items',
    'finance_human_decisions', 'finance_classification_rules',
    'finance_allocations', 'finance_transaction_document_matches',
    'finance_close_periods', 'finance_tax_scenarios',
    'finance_tax_scenario_lines', 'finance_tax_scenario_line_allocations',
    'finance_submission_packs', 'finance_submission_pack_items'
  ]
  loop
    execute format(
      'create trigger finance_no_hard_delete before delete on public.%I '
      'for each row execute function private.prevent_finance_delete()',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'finance_sources', 'financial_accounts', 'finance_import_runs',
    'finance_import_records', 'finance_evidence_objects', 'finance_documents',
    'finance_document_pages', 'finance_document_line_items',
    'finance_document_relationships', 'finance_transactions',
    'finance_transaction_relationships', 'finance_review_items',
    'finance_human_decisions', 'finance_classification_rules',
    'finance_allocations', 'finance_transaction_document_matches',
    'finance_close_periods', 'finance_tax_scenarios',
    'finance_tax_scenario_lines', 'finance_tax_scenario_line_allocations',
    'finance_submission_packs', 'finance_submission_pack_items'
  ]
  loop
    execute format(
      'create trigger finance_no_in_place_update before update on public.%I '
      'for each row execute function private.prevent_finance_update()',
      table_name
    );
  end loop;
end
$do$;
