-- TRIP-248: drop dead AI-usage DB objects after moving usage logging to the push model.
--
-- Usage logging moved off the polling model to the "AI Usage save" n8n sub-workflow
-- (each AI flow calls it with its own execution_id). Cost is now computed in n8n, not
-- in the DB. This removes the objects that only the old model used:
--   * get_ai_usage_cursor()    - high-water-mark cursor read by the old "AI Usage Logger" poller.
--   * compute_ai_usage_cost()  - BEFORE INSERT/UPDATE trigger fn that priced rows from
--                                ai_model_prices; cost is now set by n8n on insert.
--   * trg_ai_usage_cost        - the trigger binding compute_ai_usage_cost to ai_usage_events.
--
-- Kept: ai_usage_events (the sub-workflow still inserts here, incl. cost_usd written by n8n)
-- and ai_model_prices (retained as the price book; drop separately if n8n stops reading it).
drop trigger if exists trg_ai_usage_cost on public.ai_usage_events;
drop function if exists public.compute_ai_usage_cost();
drop function if exists public.get_ai_usage_cursor();
