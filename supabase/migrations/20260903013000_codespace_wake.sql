create table if not exists public.codespace_wake_events (
  id bigint generated always as identity primary key,
  codespace_name text not null,
  repository text not null,
  github_status integer,
  created_at timestamptz not null default now()
);

create index if not exists codespace_wake_events_lookup_idx
  on public.codespace_wake_events(codespace_name, created_at desc);

alter table public.codespace_wake_events enable row level security;
revoke all on table public.codespace_wake_events from anon, authenticated;
