/**
 * Тесты плана Сверки Б (TRIP-153). Чистая функция → ноль моков, ноль рантайма.
 *
 * ЗЕЛЁНЫЙ ТЕСТ НИЧЕГО НЕ ЗНАЧИТ, ПОКА НЕ УВИДЕЛ ЕГО КРАСНЫМ. Прогнанные мутации
 * (каждая ловится своим тестом, восстановление — снова всё зелёное):
 *   1. `[...losers, ...promotions]` → `[...promotions, ...losers]`
 *      → красный «демоушен идёт раньше повышения»;
 *   2. в pickWinner убрать тай-брейк по created
 *      → красный «тай-брейк при равных датах — по created»;
 *   3. в pickWinner снять фильтр ENTITLING_STATUSES
 *      → красный «победитель выбирается только среди энтайтлинговых»;
 *   4. убрать ветку «совпало — не трогаем»
 *      → красный «совпадающее состояние не порождает записи»;
 *   5. убрать блок «наших нет в Stripe → canceled»
 *      → красный «пропавшая в Stripe энтайтлинг-строка гасится».
 */
import { assertEquals } from 'jsr:@std/assert@1';
import {
  planUserSubscriptions,
  pickWinner,
  ENTITLING_STATUSES,
  type StripeSubView,
  type LocalSubRow,
} from './reconcilePlan.ts';

const sub = (o: Partial<StripeSubView> & { id: string }): StripeSubView => ({
  status: 'active',
  currentPeriodEnd: '2027-01-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  created: 1_700_000_000,
  currency: 'usd',
  productCode: 'account_pro_yearly',
  ...o,
});

const row = (o: Partial<LocalSubRow> & { id: string }): LocalSubRow => ({
  providerSubscriptionId: o.id,
  status: 'active',
  currentPeriodEnd: '2027-01-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  needsReview: false,
  ...o,
});

// Вход планировщика. По умолчанию stripeSubIdsSeen = id ВСЕХ переданных подписок:
// то есть «выгрузка Stripe увидела ровно их». Тесты про живую-но-неучтённую подписку
// передают множество ЯВНО — именно там и жил баг.
const inp = (stripeSubs: StripeSubView[], localRows: LocalSubRow[], seen?: Set<string>) => ({
  stripeSubs, localRows,
  stripeSubIdsSeen: seen ?? new Set(stripeSubs.map((s) => s.id)),
});

Deno.test('совпадающее состояние не порождает записи', () => {
  const plan = planUserSubscriptions(inp([sub({ id: 'sub_A' })], [row({ id: 'sub_A' })]));
  assertEquals(plan.writes, []);
  assertEquals(plan.winnerSubId, 'sub_A');
  assertEquals(plan.liveInStripe, 1);
});

Deno.test('расхождение статуса даёт ровно одну запись', () => {
  const plan = planUserSubscriptions(inp([sub({ id: 'sub_A', status: 'canceled' })], [row({ id: 'sub_A', status: 'active' })]));
  assertEquals(plan.writes.length, 1);
  assertEquals(plan.writes[0].status, 'canceled');
  assertEquals(plan.writes[0].reason, 'sub_status_drift');
  assertEquals(plan.writes[0].before?.status, 'active');
  // canceled не энтайтлинговый → победителя нет
  assertEquals(plan.winnerSubId, null);
});

Deno.test('подписки, которой у нас нет, создаётся запись без localRowId', () => {
  // Ровно кейс «подписка заведена мимо чекаута»: в Stripe есть, у нас ноль строк.
  const plan = planUserSubscriptions(inp([sub({ id: 'sub_NEW' })], []));
  assertEquals(plan.writes.length, 1);
  assertEquals(plan.writes[0].localRowId, null);
  assertEquals(plan.writes[0].subId, 'sub_NEW');
  assertEquals(plan.writes[0].status, 'active');
  assertEquals(plan.writes[0].before, null);
});

Deno.test('победитель выбирается только среди энтайтлинговых', () => {
  const winner = pickWinner([
    sub({ id: 'sub_OLD', status: 'canceled', currentPeriodEnd: '2099-01-01T00:00:00.000Z' }),
    sub({ id: 'sub_LIVE', status: 'active', currentPeriodEnd: '2027-01-01T00:00:00.000Z' }),
  ]);
  // У canceled дата дальше, но статус не даёт права — победитель не он.
  assertEquals(winner?.id, 'sub_LIVE');
});

Deno.test('победитель — максимальный current_period_end', () => {
  const winner = pickWinner([
    sub({ id: 'sub_NEAR', currentPeriodEnd: '2027-01-01T00:00:00.000Z' }),
    sub({ id: 'sub_FAR', currentPeriodEnd: '2028-01-01T00:00:00.000Z' }),
  ]);
  assertEquals(winner?.id, 'sub_FAR');
});

Deno.test('тай-брейк при равных датах — по created', () => {
  const winner = pickWinner([
    sub({ id: 'sub_EARLY', created: 1_000 }),
    sub({ id: 'sub_LATE', created: 2_000 }),
  ]);
  assertEquals(winner?.id, 'sub_LATE');
});

Deno.test('демоушен идёт раньше повышения (uq_subscription_user_live)', () => {
  // Две живые подписки в Stripe: победитель sub_FAR, проигравший sub_NEAR.
  // Локально живой числится sub_NEAR — то есть нужно ОДНОВРЕМЕННО понизить его и
  // повысить sub_FAR. Если порядок перевернуть, между запросами будет две живые
  // строки и вторая запись упадёт на частичном UNIQUE.
  const plan = planUserSubscriptions(inp([
      sub({ id: 'sub_NEAR', currentPeriodEnd: '2027-01-01T00:00:00.000Z' }),
      sub({ id: 'sub_FAR', currentPeriodEnd: '2028-01-01T00:00:00.000Z' }),
    ], [row({ id: 'sub_NEAR' })]));
  assertEquals(plan.winnerSubId, 'sub_FAR');
  assertEquals(plan.writes.length, 2);

  const [first, second] = plan.writes;
  assertEquals(first.subId, 'sub_NEAR', 'первым обязан идти демоушен проигравшего');
  assertEquals(first.status, 'duplicate');
  assertEquals(first.needsReview, true);
  assertEquals(second.subId, 'sub_FAR', 'повышение победителя — только вторым');
  assertEquals(second.status, 'active');
  assertEquals(plan.writes.map((w) => w.order), [0, 1]);
});

Deno.test('две живые подписки видны как двойная оплата', () => {
  const plan = planUserSubscriptions(inp([sub({ id: 'sub_A' }), sub({ id: 'sub_B', currentPeriodEnd: '2028-01-01T00:00:00.000Z' })], []));
  assertEquals(plan.liveInStripe, 2);
  assertEquals(plan.writes.filter((w) => w.reason === 'sub_duplicate_demoted').length, 1);
});

Deno.test('пропавшая в Stripe энтайтлинг-строка гасится', () => {
  const plan = planUserSubscriptions(inp([], [row({ id: 'sub_GONE', status: 'active' })]));
  assertEquals(plan.writes.length, 1);
  assertEquals(plan.writes[0].status, 'canceled');
  assertEquals(plan.writes[0].reason, 'sub_missing_in_stripe');
  // ★Намерение обязано быть ЯВНЫМ. У этой ветки subId ЗАПОЛНЕН (это id подписки,
  // которой нет в Stripe), поэтому исполнитель, выводивший операцию из «есть ли
  // subId», промахивался мимо обеих веток и строка молча не гасилась.
  assertEquals(plan.writes[0].op, 'cancel_local');
  assertEquals(plan.writes[0].subId, 'sub_GONE', 'subId тут НЕ null — на этом и подорвался вывод по nullability');
  assertEquals(plan.writes[0].localRowId, 'sub_GONE');
});

Deno.test('операция объявлена на каждой записи плана', () => {
  // Тотальность: любая запись обязана нести op, иначе исполнитель молча её пропустит.
  const plan = planUserSubscriptions(inp([sub({ id: 'sub_A' }), sub({ id: 'sub_B', currentPeriodEnd: '2028-01-01T00:00:00.000Z' })], [row({ id: 'sub_GONE', status: 'active' })]));
  for (const w of plan.writes) {
    assertEquals(['upsert', 'cancel_local'].includes(w.op), true, `нет op у записи ${w.subId}`);
  }
  assertEquals(plan.writes.filter((w) => w.op === 'cancel_local').length, 1);
  assertEquals(plan.writes.filter((w) => w.op === 'upsert').length, 2);
});

Deno.test('пропавшая в Stripe НЕэнтайтлинг-строка не трогается', () => {
  // Уже canceled у нас и нет в выгрузке — гасить нечего, записи быть не должно.
  const plan = planUserSubscriptions(inp([], [row({ id: 'sub_OLD', status: 'canceled' })]));
  assertEquals(plan.writes, []);
});

// ── Существование в Stripe — ГЛОБАЛЬНЫЙ факт. Три теста ниже пинят ровно то, на
// чём первая редакция гасила ЖИВЫЕ подписки. ────────────────────────────────────

Deno.test('★живая подписка с нераспознанным продуктом НЕ гасится', () => {
  // Продукт не резолвится из каталога (нет/неактивна строка provider_price), но
  // подписка в Stripe ЖИВА и наша строка на неё есть. Раньше каталожный фильтр
  // выкидывал её из среза, существование считалось по обрезанному множеству →
  // 'canceled' → recompute роняет ПЛАТЯЩЕГО во Free.
  const plan = planUserSubscriptions(
    inp([sub({ id: 'sub_LIVE', productCode: null })], [row({ id: 'sub_LIVE' })]),
  );
  assertEquals(plan.writes, [], 'живую подписку нельзя трогать ни при каком каталоге');
});

Deno.test('★неатрибутируемая подписка не гасит строку своего юзера', () => {
  // Подписка есть в выгрузке, но к юзеру не отнеслась (нет metadata.user_id, клиента
  // нет в provider_customer) → в его stripeSubs её НЕТ. В ГЛОБАЛЬНОМ множестве она
  // есть, и этого достаточно, чтобы право не снимать.
  const plan = planUserSubscriptions(
    inp([], [row({ id: 'sub_ORPHAN', status: 'active' })], new Set(['sub_ORPHAN'])),
  );
  assertEquals(plan.writes, [], 'подписка существует в Stripe — гасить нечего');
});

Deno.test('строку без id подписки не гасим — сверять нечем', () => {
  // Доказательства отсутствия нет: у строки просто нет ссылки на Stripe. Снятие
  // права здесь принималось бы вслепую и в опасную сторону.
  const plan = planUserSubscriptions(
    inp([], [row({ id: 'row_NOID', providerSubscriptionId: null, status: 'active' })]),
  );
  assertEquals(plan.writes, []);
});

Deno.test('чужой продукт игнорируется целиком', () => {
  const plan = planUserSubscriptions(inp([sub({ id: 'sub_X', productCode: null })], []));
  assertEquals(plan.writes, []);
  assertEquals(plan.winnerSubId, null);
  assertEquals(plan.liveInStripe, 0);
});

Deno.test('набор энтайтлинговых статусов совпадает с тем, что читает recompute', () => {
  // recompute_user_entitlement фильтрует ровно по этим трём (20260701123715).
  // Разъезд здесь = сверка «чинит» то, что правом и так не является.
  assertEquals([...ENTITLING_STATUSES].sort(), ['active', 'past_due', 'trialing']);
});
