-- Option snapshots are internal production state. They are written/read by
-- trusted Edge Functions/database roles, not exposed directly via PostgREST.
alter table public.option_chain_snapshots enable row level security;
alter table public.option_contract_snapshots enable row level security;

revoke all privileges on table public.option_chain_snapshots
  from anon, authenticated;

revoke all privileges on table public.option_contract_snapshots
  from anon, authenticated;

comment on table public.option_chain_snapshots is 'Internal option-chain snapshot state; service-only.';
comment on table public.option_contract_snapshots is 'Internal option-contract snapshot state; service-only.';
