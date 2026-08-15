set lock_timeout = '5s';
set statement_timeout = '30s';

-- Question numbers identify a logical review item rather than one revision of
-- it. This keeps a spoken reference stable when a correction supersedes the
-- current review row or when inbox priority changes.
create sequence public.finance_review_question_number_seq as bigint;

create table public.finance_review_question_numbers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  logical_review_item_id uuid not null,
  question_number bigint not null default nextval('public.finance_review_question_number_seq')
    check (question_number > 0),
  assigned_from_review_item_id uuid not null,
  assigned_at timestamptz not null default now(),
  constraint finance_review_question_numbers_household_logical_key
    unique (household_id, logical_review_item_id),
  constraint finance_review_question_numbers_number_key unique (question_number),
  constraint finance_review_question_numbers_review_same_household_fkey
    foreign key (household_id, assigned_from_review_item_id)
    references public.finance_review_items (household_id, id) on delete restrict
);

alter sequence public.finance_review_question_number_seq
  owned by public.finance_review_question_numbers.question_number;

create index finance_review_question_numbers_review_idx
  on public.finance_review_question_numbers (household_id, assigned_from_review_item_id);

comment on table public.finance_review_question_numbers is
  'Permanent human-facing integer for each logical finance review question.';
comment on column public.finance_review_question_numbers.question_number is
  'Stable forever across priority changes and superseding review-item revisions.';

-- Match the existing inbox ranking for the one-time assignment so the current
-- first question becomes #1, the current second question becomes #2, and so on.
with current_reviews as (
  select
    review_item.id,
    review_item.household_id,
    review_item.logical_review_item_id,
    review_item.created_at,
    review_item.record_status = 'active' as is_active,
    (
      case review_item.priority
        when 'critical' then 4::bigint
        when 'high' then 3::bigint
        when 'medium' then 2::bigint
        else 1::bigint
      end * 1000000000::bigint
      + least(abs(coalesce(review_item.tax_impact_cents, 0)), 100000000::bigint) * 10
      + least(
          abs(coalesce(review_item.amount_cents, review_transaction.amount_cents, 0)),
          100000000::bigint
        )
      + case
          when review_item.review_type in ('income', 'transfer')
            or lower(coalesce(review_item.context_snapshot ->> 'income_transfer_risk', 'false'))
              in ('true', '1', 'yes')
          then 500000000::bigint
          else 0::bigint
        end
      + greatest(review_item.priority_score, 0)::bigint * 10000::bigint
    ) as inbox_score
  from public.finance_review_items review_item
  left join public.finance_transactions review_transaction
    on review_transaction.household_id = review_item.household_id
   and review_transaction.id = review_item.transaction_id
  where not exists (
    select 1
    from public.finance_review_items successor
    where successor.supersedes_review_item_id = review_item.id
  )
), numbered_reviews as (
  select
    current_review.*,
    row_number() over (
      order by current_review.is_active desc,
        current_review.inbox_score desc,
        current_review.created_at,
        current_review.id
    ) as permanent_number
  from current_reviews current_review
)
insert into public.finance_review_question_numbers (
  household_id,
  logical_review_item_id,
  question_number,
  assigned_from_review_item_id,
  assigned_at
)
select
  numbered_review.household_id,
  numbered_review.logical_review_item_id,
  numbered_review.permanent_number,
  numbered_review.id,
  now()
from numbered_reviews numbered_review
order by numbered_review.permanent_number;

select setval(
  'public.finance_review_question_number_seq',
  greatest(coalesce((select max(question_number) from public.finance_review_question_numbers), 0), 1),
  exists (select 1 from public.finance_review_question_numbers)
);

create or replace function private.assign_finance_review_question_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.finance_review_question_numbers existing_number
    where existing_number.household_id = new.household_id
      and existing_number.logical_review_item_id = new.logical_review_item_id
  ) then
    return new;
  end if;

  insert into public.finance_review_question_numbers (
    household_id,
    logical_review_item_id,
    assigned_from_review_item_id
  )
  values (
    new.household_id,
    new.logical_review_item_id,
    new.id
  )
  on conflict (household_id, logical_review_item_id) do nothing;

  return new;
end;
$$;

revoke all on function private.assign_finance_review_question_number()
  from public, anon, authenticated, service_role;

create trigger finance_assign_question_number
after insert on public.finance_review_items
for each row execute function private.assign_finance_review_question_number();

alter table public.finance_review_question_numbers enable row level security;
alter table public.finance_review_question_numbers force row level security;

create policy "household members can read"
  on public.finance_review_question_numbers
  for select
  to authenticated
  using (private.has_household_role(household_id, null));

revoke all on table public.finance_review_question_numbers
  from public, anon, authenticated, service_role;
grant select on table public.finance_review_question_numbers
  to authenticated, service_role;

revoke all on sequence public.finance_review_question_number_seq
  from public, anon, authenticated, service_role;

create trigger finance_no_hard_delete
before delete on public.finance_review_question_numbers
for each row execute function private.prevent_finance_delete();

create trigger finance_no_in_place_update
before update on public.finance_review_question_numbers
for each row execute function private.prevent_finance_update();
