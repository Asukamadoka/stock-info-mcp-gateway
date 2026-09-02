create table if not exists public.codespace_control_registry (
 generation_id uuid primary key default gen_random_uuid(),
 endpoint text not null,
 repo text not null,
 branch text,
 head text,
 started_at timestamptz not null default now(),
 expires_at timestamptz not null,
 health jsonb not null default '{}'::jsonb,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create index if not exists codespace_control_registry_active_idx on public.codespace_control_registry(active,created_at desc);
alter table public.codespace_control_registry enable row level security;
revoke all on table public.codespace_control_registry from anon, authenticated;
