-- Dedup key for idempotent re-runs of the "AI Usage Logger" n8n poller.
-- NULLs are distinct by default, so manual inserts with null execution_id won't collide.
alter table public.ai_usage_events add column if not exists run_index integer;

create unique index if not exists ux_ai_usage_dedup
  on public.ai_usage_events (execution_id, node_name, run_index);
