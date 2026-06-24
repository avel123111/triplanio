---
name: triplanio-vercel-hobby-blocks-collaborator-commits
description: "почему деплои Triplanio иногда BLOCKED в Vercel — Hobby-план блокирует коммиты не-владельца (Ильи); фикс = Redeploy владельцем или PR-мерж Pavel'ом / Pro"
metadata: 
  node_type: memory
  type: project
  originSessionId: 072cd9d2-98d4-49ae-9f55-92f89b386de7
---

Проект `triplanio_app` (Vercel, team `team_nm6JmpPTllnXGr7nO27AgxLE` / slug `avel123111-5277s-projects`, projectId `prj_KFPb5dTc91gzk1OQfPgx4Kvg94Sf`) на **Hobby (бесплатном)** плане.

**Симптом:** часть деплоев в статусе `BLOCKED` (и dev-превью, и прод), хотя git-ветки в порядке. Подтверждено 2026-06-11 на коммите `729219d` (notifications, автор Ilia) — заблокированы оба деплоя (dev + main); прод остался на предыдущем READY `0237187`.

**Причина:** Hobby блокирует деплои, **автор коммита которых != владелец Vercel-аккаунта**. Коммиты Ильи подписаны локальным email `ilia@Noutbuk-Dasha.local` (unverified, не привязан к Vercel) -> BLOCKED. Все коммиты Pavel (`avel123111@gmail.com`) -> READY. Поэтому PR #36 `c993f73` (мердж за авторством Pavel) собрался, а прямой пуш фичи Ильёй — нет.

**Фикс немедленный:** Pavel открывает заблоченный деплой в дашборде -> **Redeploy / Promote to Production** (сборку инициирует владелец -> проходит). Re-push НЕ помогает — коммит остаётся за Ильёй. Альтернатива: пустой коммит `git commit --allow-empty` за авторством Pavel.

**Чтобы не повторялось:** (A бесплатно) Илья работает только через feature-ветку + PR, мержит **Pavel** -> мердж-коммит авторства Pavel, деплой не блокируется (совпадает с правилом ветка->PR из [[triplanio-deploy-topology]]); (B платно) Vercel Pro + добавить Илью в команду.

Связано: [[triplanio-deploy-topology]] (фронт авто-деплой по пушу в dev+main).
