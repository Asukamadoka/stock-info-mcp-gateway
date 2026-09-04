create table if not exists public.decision_handoffs (
  trading_date date not null,
  stage text not null check (stage in ('premarket','midday','tail')),
  generated_at timestamptz not null,
  source_cutoff timestamptz,
  payload jsonb not null,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trading_date, stage)
);

alter table public.decision_handoffs enable row level security;
revoke all on table public.decision_handoffs from anon, authenticated;

comment on table public.decision_handoffs is
  'Service-only persistent handoff store for the 09:29/11:25/14:45 A-share decision loop.';
