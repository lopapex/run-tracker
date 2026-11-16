begin;
create table if not exists public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot->>'format' = 'run-tracker-workspace'
    and snapshot->>'version' = '1'
    and not (snapshot ?| array['connections', 'stravaActivities'])
    and octet_length(snapshot::text) <= 10485760
  ),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create policy workspace_owner on public.workspaces for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.workspaces from anon;
grant select, insert, update, delete on public.workspaces to authenticated;

create or replace function public.save_workspace(expected_version bigint, new_snapshot jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare result bigint;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if expected_version = 0 then
    insert into public.workspaces(user_id, snapshot) values(auth.uid(), new_snapshot)
      on conflict do nothing returning version into result;
  else
    update public.workspaces set snapshot = new_snapshot, version = version + 1, updated_at = now()
      where user_id = auth.uid() and version = expected_version returning version into result;
  end if;
  if result is null then raise exception 'revision_conflict'; end if;
  return result;
end;
$$;
revoke all on function public.save_workspace(bigint, jsonb) from public, anon;
grant execute on function public.save_workspace(bigint, jsonb) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('plan-documents', 'plan-documents', false, 41943040,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'])
on conflict (id) do nothing;
create policy private_plan_documents on storage.objects for all to authenticated
using (bucket_id = 'plan-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'plan-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
