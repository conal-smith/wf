-- Gust's spend, one row per calendar month (UTC), added to after every model
-- call (companion/api/budget.ts). Micro-dollars at list price, rounded up per
-- call: an estimate that errs high, compared with COMPANION_MONTHLY_BUDGET_USD.
create table companion_usage (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  calls bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_micro_usd bigint not null default 0,
  updated_at timestamptz not null default now()
);
