-- TRIP-32 — reconcile-on-read для разовой Trip Pro: троттл-отметка на purchase.
--
-- Симметрично users.entitlement_synced_at (троттл подписочного reconcile). Держит
-- сверку Trip Pro со Stripe не чаще раза в 10 мин на трип — закрывает асимметрию,
-- когда потерянный refund/dispute-вебхук оставлял is_pro_trip=true навсегда.
-- Аддитивно, NULL = «ни разу не сверяли» (первое чтение сверит).

ALTER TABLE public.purchase ADD COLUMN IF NOT EXISTS synced_at timestamptz;
