begin;
create extension if not exists pgcrypto with schema extensions;

create table public.capricorn_shares (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  title text not null check (length(title) between 1 and 180),
  status text not null check (length(status) between 1 and 80),
  version integer not null check (version > 0),
  video_url text check (length(video_url) <= 2000 and video_url ~ '^https?://'),
  expires_at timestamptz not null check (expires_at <= now() + interval '31 days'),
  revoked_at timestamptz
);

create table public.capricorn_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.capricorn_shares(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index capricorn_comments_share on public.capricorn_comments (share_id,created_at,id);
alter table public.capricorn_shares enable row level security;
alter table public.capricorn_comments enable row level security;
revoke all on public.capricorn_shares,public.capricorn_comments from public,anon,authenticated;
grant select,insert on public.capricorn_shares to authenticated;
grant update (revoked_at,status) on public.capricorn_shares to authenticated;
grant select on public.capricorn_comments to authenticated;
create policy capricorn_owner_select on public.capricorn_shares for select to authenticated using (owner = (select auth.uid()));
create policy capricorn_owner_insert on public.capricorn_shares for insert to authenticated with check (owner = (select auth.uid()));
create policy capricorn_owner_revoke on public.capricorn_shares for update to authenticated
  using (owner = (select auth.uid()) and revoked_at is null)
  with check (owner = (select auth.uid()) );
create policy capricorn_owner_comments on public.capricorn_comments for select to authenticated
  using (exists (select 1 from public.capricorn_shares where id = share_id and owner = (select auth.uid())));

create function public.capricorn_review(token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('title',title,'status',status,'version',version,'videoUrl',video_url,'expiresAt',expires_at)
    from public.capricorn_shares
    where length(token) = 43 and token ~ '^[A-Za-z0-9_-]+$'
      and token_hash = encode(extensions.digest(token,'sha256'),'hex') and expires_at > now() and revoked_at is null;
$$;

create function public.capricorn_comment(token text, message text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  link_id uuid;
begin
  if token is null or length(token) <> 43 or token !~ '^[A-Za-z0-9_-]+$'
     or message is null or length(btrim(message)) not between 1 and 2000 then
    return false;
  end if;
  select id into link_id from public.capricorn_shares
    where token_hash = encode(extensions.digest(token,'sha256'),'hex')
      and expires_at > now() and revoked_at is null for update;
  if link_id is null then return false; end if;
  if (select count(*) from public.capricorn_comments where share_id = link_id) >= 200
     or (select count(*) from public.capricorn_comments where share_id = link_id and created_at > now() - interval '1 minute') >= 5 then
    return false;
  end if;
  insert into public.capricorn_comments(share_id,body) values(link_id,btrim(message));
  return true;
end;
$$;

revoke all on function public.capricorn_review(text),public.capricorn_comment(text,text) from public,anon,authenticated;
grant execute on function public.capricorn_review(text),public.capricorn_comment(text,text) to anon;
commit;
