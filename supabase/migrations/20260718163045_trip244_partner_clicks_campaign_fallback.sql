-- TRIP-244 — атрибуция партнёрских кликов: кампания (source) + флаг фоллбека.
--
-- Две новые колонки в partner_clicks:
--   campaign — источник клика (машинный enum-токен): fork_modal_button (пилюля
--              ForkPartnerModal) | fork_api_search (живой список Stay22/Viator API).
--   fallback — true, если отдали фоллбек-ссылку (нет точного deep-link по городу)
--              либо ссылка неаффилиатная (provider NULL).
--
-- Аддитив, метаданные-only: обе колонки nullable, историчные строки остаются NULL
-- (не переписываем). Откат = DROP COLUMN.
--
-- caps-guard: allow-uncapped — campaign is an enum-constrained machine token (CHECK bounds it)
alter table public.partner_clicks
  add column campaign text,
  add column fallback boolean;

alter table public.partner_clicks
  add constraint partner_clicks_campaign_check
  check (campaign is null or campaign in ('fork_modal_button', 'fork_api_search'));

comment on column public.partner_clicks.campaign is 'Источник клика: fork_modal_button (пилюля) | fork_api_search (живой список API). TRIP-244.';
comment on column public.partner_clicks.fallback is 'true = отдали фоллбек-ссылку (нет точного deep-link) либо неаффилиатная ссылка. TRIP-244.';
