create table if not exists public.option_chain_snapshots (
  id uuid primary key,
  underlying text not null,
  expiry text not null,

  source text not null default 'sina',
  source_timestamp timestamptz null,
  captured_at timestamptz not null default now(),

  underlying_spot numeric null,

  contract_count integer not null,
  call_count integer not null,
  put_count integer not null
);

create index if not exists
  option_chain_snapshots_lookup_idx
on public.option_chain_snapshots (
  underlying,
  expiry,
  captured_at desc
);

create table if not exists public.option_contract_snapshots (
  snapshot_id uuid not null
    references public.option_chain_snapshots(id)
    on delete cascade,

  underlying text not null,
  expiry text not null,

  contract_code text not null,
  side text not null
    check (side in ('call', 'put')),

  strike numeric not null,

  volume numeric null,
  open_interest numeric null,
  iv numeric null,

  bid numeric null,
  ask numeric null,
  last numeric null,

  primary key (
    snapshot_id,
    contract_code
  )
);

create index if not exists
  option_contract_snapshots_contract_idx
on public.option_contract_snapshots (
  contract_code,
  snapshot_id
);
