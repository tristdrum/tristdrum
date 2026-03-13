create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  added_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.site_admins
    where user_id = auth.uid()
  );
$$;

create or replace function public.site_admin_bootstrap_available()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select not exists (select 1 from public.site_admins);
$$;

create or replace function public.claim_initial_site_admin()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if exists (select 1 from public.site_admins where user_id = auth.uid()) then
    return true;
  end if;

  if exists (select 1 from public.site_admins) then
    return false;
  end if;

  insert into public.site_admins (user_id, email)
  values (
    auth.uid(),
    nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
  );

  return true;
end;
$$;

grant execute on function public.is_site_admin() to authenticated;
grant execute on function public.site_admin_bootstrap_available() to authenticated;
grant execute on function public.claim_initial_site_admin() to authenticated;

drop policy if exists "Site admins can view site_admins" on public.site_admins;
create policy "Site admins can view site_admins"
  on public.site_admins
  for select
  to authenticated
  using (public.is_site_admin());

drop policy if exists "Site admins can manage site_admins" on public.site_admins;
create policy "Site admins can manage site_admins"
  on public.site_admins
  for all
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

drop policy if exists "Allow public INSERT on artworks" on public.artworks;
drop policy if exists "Allow public UPDATE on artworks" on public.artworks;
drop policy if exists "Allow public DELETE on artworks" on public.artworks;

create policy "Allow site admin INSERT on artworks"
  on public.artworks
  for insert
  to authenticated
  with check (public.is_site_admin());

create policy "Allow site admin UPDATE on artworks"
  on public.artworks
  for update
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

create policy "Allow site admin DELETE on artworks"
  on public.artworks
  for delete
  to authenticated
  using (public.is_site_admin());
