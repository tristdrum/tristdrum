set lock_timeout = '5s';
set statement_timeout = '60s';

with ranked_drafts as (
  select
    shopping_list.id,
    row_number() over (
      partition by shopping_list.household_id
      order by shopping_list.created_at desc, shopping_list.id desc
    ) as draft_rank
  from airbnb.shopping_lists shopping_list
  where shopping_list.status = 'draft'
)
update airbnb.shopping_lists shopping_list
set status = 'superseded'
from ranked_drafts ranked
where shopping_list.id = ranked.id
  and ranked.draft_rank > 1;

alter function public.airbnb_dashboard_snapshot(uuid) set schema private;
alter function private.airbnb_dashboard_snapshot(uuid) rename to airbnb_dashboard_snapshot_base;

revoke all on function private.airbnb_dashboard_snapshot_base(uuid) from public, anon, authenticated, service_role;

create function public.airbnb_dashboard_snapshot(target_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
begin
  snapshot := private.airbnb_dashboard_snapshot_base(target_household_id);

  snapshot := jsonb_set(
    snapshot,
    '{shoppingLists}',
    coalesce((
      select jsonb_agg(item order by position)
      from jsonb_array_elements(snapshot->'shoppingLists') with ordinality rows(item, position)
      where item->>'status' <> 'superseded'
    ), '[]'::jsonb)
  );

  snapshot := jsonb_set(
    snapshot,
    '{orders}',
    coalesce((
      select jsonb_agg(item order by position)
      from jsonb_array_elements(snapshot->'orders') with ordinality rows(item, position)
      where item->>'addressStatus' = 'bowie_1'
    ), '[]'::jsonb)
  );

  return snapshot;
end;
$$;

revoke all on function public.airbnb_dashboard_snapshot(uuid) from public, anon;
grant execute on function public.airbnb_dashboard_snapshot(uuid) to authenticated, service_role;
