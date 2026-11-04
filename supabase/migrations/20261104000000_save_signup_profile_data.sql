alter table public.profiles add column if not exists phone text;

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text;
  v_name text;
  v_phone text;
begin
  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  if v_username !~ '^[a-z0-9_]{3,24}$' or exists (
    select 1 from public.profiles p where p.username = v_username and p.id <> new.id
  ) then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 16);
  end if;

  insert into public.profiles (id, username, display_name, phone)
  values (new.id, v_username, v_name, v_phone)
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, public.profiles.display_name),
        phone = coalesce(excluded.phone, public.profiles.phone);
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