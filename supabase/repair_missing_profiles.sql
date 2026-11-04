-- Repairs public profiles for existing Auth users and ensures future signups get one.
-- Safe to run more than once. Does not read, modify, or expose passwords.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text;
  v_name text;
  v_phone text;
begin
  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  if v_username !~ '^[a-z0-9_]{3,24}$' or exists (
    select 1 from public.profiles p where p.username = v_username and p.id <> new.id
  ) then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 16);
  end if;

  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  insert into public.profiles (id, username, display_name, phone)
  values (new.id, v_username, v_name, v_phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_profile_for_user();

update public.profiles p
set
  display_name = coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), p.display_name),
  phone = coalesce(nullif(btrim(u.raw_user_meta_data ->> 'phone'), ''), p.phone)
from auth.users u
where u.id = p.id;

with auth_profiles as (
  select
    u.id,
    substring(regexp_replace(lower(coalesce(u.raw_user_meta_data ->> 'username', '')), '[^a-z0-9_]', '', 'g') from 1 for 24) as requested_username,
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') as display_name,
    nullif(btrim(u.raw_user_meta_data ->> 'phone'), '') as phone
  from auth.users u
), unique_names as (
  select a.*, count(*) over (partition by requested_username) as name_count
  from auth_profiles a
)
insert into public.profiles (id, username, display_name, phone)
select
  u.id,
  case
    when char_length(u.requested_username) between 3 and 24
      and u.name_count = 1
      and not exists (select 1 from public.profiles p where p.username = u.requested_username)
    then u.requested_username
    else 'user_' || substr(replace(u.id::text, '-', ''), 1, 16)
  end,
  u.display_name,
  u.phone
from unique_names u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
