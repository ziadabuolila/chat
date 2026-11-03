-- Initial schema for a fresh Supabase project. Run using Supabase SQL Editor.
-- Passwords and password resets remain managed by Supabase Auth.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text check (display_name is null or char_length(display_name) <= 50),
  bio text check (bio is null or char_length(bio) <= 240),
  avatar_url text,
  accepts_messages boolean not null default true,
  theme text not null default 'lilac' check (theme in ('lilac','sand','mint')),
  created_at timestamptz not null default now()
);
create index if not exists profiles_username_idx on public.profiles(username);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_token_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversations_recipient_created_idx on public.conversations(recipient_id, created_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1000),
  conversation_id uuid references public.conversations(id) on delete cascade,
  author_side text not null default 'sender' check (author_side in ('sender','recipient')),
  image_path text,
  is_read boolean not null default false,
  is_favorite boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  constraint messages_sender_or_image_check check (char_length(body) > 0 or image_path is not null)
);
create index if not exists messages_recipient_created_idx on public.messages(recipient_id, created_at desc);
create index if not exists messages_unread_idx on public.messages(recipient_id, created_at desc) where is_read = false;

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, message_id)
);
create index if not exists favorites_user_created_idx on public.favorites(user_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  kind text not null check (kind in ('new_message','system')),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists reports_status_created_idx on public.reports(status, created_at desc);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, fingerprint)
);
create index if not exists blocks_owner_idx on public.blocks(owner_id);

create table if not exists public.admin_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','moderator')),
  created_at timestamptz not null default now()
);
create table if not exists public.admin_permissions (
  permission text primary key,
  description text not null
);
create table if not exists public.admin_role_permissions (
  role text not null check (role in ('admin','moderator')),
  permission text not null references public.admin_permissions(permission) on delete cascade,
  primary key(role, permission)
);
insert into public.admin_permissions(permission, description) values
  ('manage_users','Manage or suspend user accounts'),
  ('review_reports','Review and resolve abuse reports'),
  ('view_analytics','View platform aggregate analytics')
on conflict do nothing;
insert into public.admin_role_permissions(role, permission) values
  ('admin','manage_users'), ('admin','review_reports'), ('admin','view_analytics'),
  ('moderator','review_reports') on conflict do nothing;

create table if not exists public.message_sender_fingerprints (
  message_id uuid primary key references public.messages(id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create table if not exists private.message_rate_limits (
  fingerprint text not null,
  bucket_start timestamptz not null,
  attempts integer not null default 1,
  primary key(fingerprint, bucket_start)
);

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, lower(coalesce(new.raw_user_meta_data ->> 'username', 'user_' || substr(new.id::text, 1, 8))), nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_profile_for_user();

create or replace function public.add_message_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, message_id, kind) values(new.recipient_id, new.id, 'new_message');
  return new;
end;
$$;
drop trigger if exists on_message_created_notification on public.messages;
create trigger on_message_created_notification after insert on public.messages
for each row execute function public.add_message_notification();

create or replace function public.sync_message_favorite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_favorite and not old.is_favorite then
    insert into public.favorites(user_id, message_id) values(new.recipient_id, new.id) on conflict do nothing;
  elsif not new.is_favorite and old.is_favorite then
    delete from public.favorites where user_id = new.recipient_id and message_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_message_favorite_sync on public.messages;
create trigger on_message_favorite_sync after update of is_favorite on public.messages
for each row execute function public.sync_message_favorite();

create or replace function public.consume_anonymous_message_limit(p_fingerprint text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_allowed boolean := false; v_bucket timestamptz;
begin
  if auth.role() <> 'service_role' or length(p_fingerprint) <> 64 then return false; end if;
  v_bucket := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  insert into private.message_rate_limits(fingerprint, bucket_start) values(p_fingerprint, v_bucket)
  on conflict(fingerprint, bucket_start) do update
    set attempts = private.message_rate_limits.attempts + 1
    where private.message_rate_limits.attempts < 5
  returning true into v_allowed;
  delete from private.message_rate_limits where bucket_start < now() - interval '2 days';
  return coalesce(v_allowed, false);
end;
$$;

create or replace function public.has_admin_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_roles r
    join public.admin_role_permissions rp on rp.role = r.role
    where r.user_id = (select auth.uid()) and rp.permission = p_permission
  );
$$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.favorites enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.message_sender_fingerprints enable row level security;
alter table private.message_rate_limits enable row level security;

revoke all on public.profiles, public.messages, public.favorites, public.notifications,
  public.reports, public.blocks, public.admin_roles, public.admin_permissions,
  public.admin_role_permissions, public.message_sender_fingerprints from anon, authenticated;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;
revoke select on public.profiles from anon, authenticated;
grant select(username, display_name, bio, avatar_url, accepts_messages, theme, created_at) on public.profiles to anon;
grant select(id, username, display_name, bio, avatar_url, accepts_messages, theme, created_at) on public.profiles to authenticated;
grant update(display_name, bio, avatar_url, accepts_messages, theme, username) on public.profiles to authenticated;
grant select, delete on public.messages to authenticated;
grant update(is_read, is_favorite, is_pinned) on public.messages to authenticated;
grant update(body) on public.messages to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select, update on public.notifications to authenticated;
grant insert on public.reports to authenticated;
grant select on public.reports, public.admin_roles, public.admin_permissions, public.admin_role_permissions to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, insert on public.messages to service_role;
grant insert on public.message_sender_fingerprints to service_role;
grant select, insert, update, delete on public.profiles, public.messages, public.notifications to service_role;
grant select, insert, update, delete on public.conversations to service_role;
grant execute on function public.consume_anonymous_message_limit(text) to service_role;
revoke all on function public.consume_anonymous_message_limit(text) from public, anon, authenticated;
grant execute on function public.has_admin_permission(text) to authenticated;
revoke all on function public.has_admin_permission(text) from public, anon;

drop policy if exists "Public profile fields" on public.profiles;
create policy "Public profile fields" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "Owners update own profile" on public.profiles;
create policy "Owners update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "Owners read own messages" on public.messages;
create policy "Owners read own messages" on public.messages for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "Recipients read own conversations" on public.conversations;
create policy "Recipients read own conversations" on public.conversations for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "Owners update own messages" on public.messages;
drop policy if exists "Recipients update inbox message flags" on public.messages;
create policy "Recipients update inbox message flags" on public.messages for update to authenticated using (recipient_id = (select auth.uid()) and author_side = 'sender') with check (recipient_id = (select auth.uid()) and author_side = 'sender');
drop policy if exists "Recipients update their own replies" on public.messages;
create policy "Recipients update their own replies" on public.messages for update to authenticated using (recipient_id = (select auth.uid()) and author_side = 'recipient') with check (recipient_id = (select auth.uid()) and author_side = 'recipient');
create or replace function public.guard_message_owner_edits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and old.recipient_id = auth.uid() and old.author_side = 'sender' and new.body is distinct from old.body then raise exception 'Recipients cannot edit sender messages'; end if;
  if old.image_path is not null and new.image_path is distinct from old.image_path then raise exception 'Message images are immutable'; end if;
  if old.image_path is not null and new.body is distinct from old.body then raise exception 'Messages containing images are immutable'; end if;
  return new;
end;
$$;
drop trigger if exists guard_message_owner_edits on public.messages;
create trigger guard_message_owner_edits before update on public.messages for each row execute function public.guard_message_owner_edits();
drop policy if exists "Owners delete own messages" on public.messages;
create policy "Owners delete own messages" on public.messages for delete to authenticated using (recipient_id = (select auth.uid()) and image_path is null);
drop policy if exists "Owners manage favorites" on public.favorites;
create policy "Owners manage favorites" on public.favorites for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Owners read notifications" on public.notifications;
create policy "Owners read notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Owners update notifications" on public.notifications;
create policy "Owners update notifications" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Owners report a message they received" on public.reports;
create policy "Owners report a message they received" on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()) and exists(select 1 from public.messages m where m.id = message_id and m.recipient_id = (select auth.uid())));
drop policy if exists "Admins review reports" on public.reports;
create policy "Admins review reports" on public.reports for select to authenticated using ((select public.has_admin_permission('review_reports')));
drop policy if exists "Admins update reports" on public.reports;
create policy "Admins update reports" on public.reports for update to authenticated using ((select public.has_admin_permission('review_reports'))) with check ((select public.has_admin_permission('review_reports')));
drop policy if exists "Owners manage blocks" on public.blocks;
create policy "Owners manage blocks" on public.blocks for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Admins read roles" on public.admin_roles;
create policy "Admins read roles" on public.admin_roles for select to authenticated using ((select public.has_admin_permission('manage_users')));
drop policy if exists "Admins read permissions" on public.admin_permissions;
create policy "Admins read permissions" on public.admin_permissions for select to authenticated using ((select public.has_admin_permission('manage_users')));
drop policy if exists "Admins read role permissions" on public.admin_role_permissions;
create policy "Admins read role permissions" on public.admin_role_permissions for select to authenticated using ((select public.has_admin_permission('manage_users')));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('avatars','avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "Public avatar reads" on storage.objects;
create policy "Public avatar reads" on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
drop policy if exists "Owners upload avatar" on storage.objects;
create policy "Owners upload avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners update avatar" on storage.objects;
create policy "Owners update avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners delete avatar" on storage.objects;
create policy "Owners delete avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('message-media','message-media',false,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;
