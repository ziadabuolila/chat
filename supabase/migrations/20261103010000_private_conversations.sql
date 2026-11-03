-- Private reply threads for anonymous messages. Apply after the initial schema.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_token_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversations_recipient_created_idx on public.conversations(recipient_id, created_at desc);
alter table public.messages add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
alter table public.messages add column if not exists author_side text not null default 'sender' check (author_side in ('sender','recipient'));
alter table public.messages add column if not exists image_path text;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (char_length(body) <= 1000);
alter table public.messages drop constraint if exists messages_sender_or_image_check;
alter table public.messages add constraint messages_sender_or_image_check check (char_length(body) > 0 or image_path is not null);
alter table public.messages alter column body set default '';
alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;
create policy "Recipients read own conversations" on public.conversations for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "Owners update own messages" on public.messages;
drop policy if exists "Recipients update inbox message flags" on public.messages;
create policy "Recipients update inbox message flags" on public.messages for update to authenticated
  using (recipient_id = (select auth.uid()) and author_side = 'sender')
  with check (recipient_id = (select auth.uid()) and author_side = 'sender');
drop policy if exists "Recipients update their own replies" on public.messages;
create policy "Recipients update their own replies" on public.messages for update to authenticated
  using (recipient_id = (select auth.uid()) and author_side = 'recipient')
  with check (recipient_id = (select auth.uid()) and author_side = 'recipient');
drop policy if exists "Owners delete own messages" on public.messages;
create policy "Owners delete own messages" on public.messages for delete to authenticated
  using (recipient_id = (select auth.uid()) and image_path is null);
create or replace function public.guard_message_owner_edits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and old.recipient_id = auth.uid() and old.author_side = 'sender' and new.body is distinct from old.body then
    raise exception 'Recipients cannot edit sender messages';
  end if;
  if old.image_path is not null and new.image_path is distinct from old.image_path then
    raise exception 'Message images are immutable';
  end if;
  if old.image_path is not null and new.body is distinct from old.body then
    raise exception 'Messages containing images are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_message_owner_edits on public.messages;
create trigger guard_message_owner_edits before update on public.messages for each row execute function public.guard_message_owner_edits();
grant update(body) on public.messages to authenticated;
grant insert on public.messages to service_role;
grant usage, select on all sequences in schema public to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('message-media','message-media',false,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];
