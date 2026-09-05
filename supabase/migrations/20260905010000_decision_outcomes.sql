create table if not exists public.decision_outcomes (
  trading_date            date not null,
  stage                   text not null check (stage in ('premarket','midday','tail')),
  subject                 text not null,
  revision                integer not null default 1,

  handoff_generated_at    timestamptz not null,
  handoff_source_cutoff   timestamptz,

  predicted_stance        text not null check (predicted_stance in ('bullish','neutral','bearish')),
  predicted_score         numeric,
  predicted_confidence    numeric,

  settle_date             date,
  entry_price             numeric,
  exit_price              numeric,
  return_pct              numeric,
  horizon_days            integer not null default 1,

  settlement_status       text not null check (settlement_status in ('settled','unmeasurable')),
  unmeasurable_reason     text,
  fillable                boolean not null,
  unfillable_reason       text,

  market_source           text,
  market_source_timestamp timestamptz,
  data_kind               text not null default 'derived' check (data_kind in ('raw','derived')),
  computed_at             timestamptz not null default now(),

  primary key (trading_date, stage, subject, revision),

  -- A settled row must carry a return; an unmeasurable row must not.
  -- This is the schema-level guarantee that a missing outcome can never
  -- quietly become a zero.
  constraint decision_outcomes_settled_has_return check (
    (settlement_status = 'settled'      and return_pct is not null and unmeasurable_reason is null)
    or
    (settlement_status = 'unmeasurable' and return_pct is null     and unmeasurable_reason is not null)
  )
);

create index if not exists decision_outcomes_window_idx
  on public.decision_outcomes (trading_date, stage);

alter table public.decision_outcomes enable row level security;
revoke all on table public.decision_outcomes from anon, authenticated;

comment on table public.decision_outcomes is
  'Service-only settlement of decision handoffs against realized sessions. Append-only: re-settlement adds a revision rather than overwriting.';

comment on column public.decision_outcomes.fillable is
  'False when A-share execution rules blocked the trade (limit-up at open on a bullish call, limit-down on a bearish call, or a halt). An unfillable signal is not a win.';

comment on column public.decision_outcomes.revision is
  'Monotonic per (trading_date, stage, subject). Settled rows are never updated in place, so a re-run cannot quietly improve a past result.';
