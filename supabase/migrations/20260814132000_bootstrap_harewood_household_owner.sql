-- Bootstrap the private finance household only when the existing site has one
-- unambiguous administrator. Fresh/local databases intentionally no-op until
-- the normal site-admin claim flow establishes that identity.

do $bootstrap$
declare
  owner_user_id uuid;
  target_household_id uuid;
begin
  if (select count(*) from public.site_admins) <> 1 then
    return;
  end if;

  select user_id
    into owner_user_id
  from public.site_admins
  order by added_at, user_id
  limit 1;

  select id
    into target_household_id
  from public.households
  where created_by = owner_user_id
    and name = 'Harewood Household'
  order by created_at, id
  limit 1;

  if target_household_id is null then
    insert into public.households (name, created_by)
    values ('Harewood Household', owner_user_id)
    returning id into target_household_id;
  end if;

  insert into public.household_members (
    household_id,
    user_id,
    role,
    membership_status,
    invited_by,
    joined_at
  )
  values (
    target_household_id,
    owner_user_id,
    'owner',
    'active',
    owner_user_id,
    now()
  )
  on conflict (household_id, user_id) do nothing;
end
$bootstrap$;
