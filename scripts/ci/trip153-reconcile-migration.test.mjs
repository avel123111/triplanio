#!/usr/bin/env node
/**
 * Тесты миграций Сверки А (TRIP-153).
 *
 * Почему ТЕКСТОВЫЕ, а не поведенческие: поведение plpgsql проверяется только
 * прогоном на Postgres, а в этом окружении нет ни postgres, ни docker (проверено:
 * psql/pg_ctl/initdb/docker отсутствуют). Поэтому здесь пинятся ровно те три
 * инварианта, которые ломаются МОЛЧА и которых не поймает ни один существующий
 * гард, — и каждый ловится своей мутацией.
 *
 * Что НЕ покрыто и покрыто быть не может без БД: что функция вообще
 * компилируется и что report-режим действительно ничего не пишет. Первый живой
 * прогон — деплой в dev через CI; именно поэтому расписание вводится в режиме
 * report, а не apply.
 *
 * Приём чтения файла как ТЕКСТА — из fileType.test.js / viralLink.test.js.
 *
 * ЗЕЛЁНЫЙ ТЕСТ НИЧЕГО НЕ ЗНАЧИТ, ПОКА НЕ УВИДЕЛ ЕГО КРАСНЫМ. Прогнанные мутации
 * (каждая ловится СВОИМ тестом, восстановление — снова 5/5):
 *
 *   1. убрать `+ interval '1 day'` из формулы в …_recompute_elide_…sql
 *      → красные «формула скопирована дословно» И «грейс past_due остался»;
 *   2. опечатка в классе находки: 'tg_binding_on_non_pro_trip'
 *      → 'tg_binding_on_nonpro_trip' в …_reconcile_entitlement_cache.sql
 *      → красный «каждый записываемый класс объявлен в CHECK»;
 *   3. cron.schedule зовёт reconcile_entitlement_cache('apply')
 *      → красный «расписание вводится в режиме report»;
 *   4. p_mode text default 'apply'
 *      → красный «дефолт режима — report»;
 *   5. вырезать `perform net.http_post(` → красный «находки уходят в Sentry»;
 *   6. 'message', 'x: ' || v_found || ' y'  (переменная в тексте события)
 *      → красный там же. ⚠️Первая редакция теста ЭТУ мутацию ПРОПУСКАЛА: искала
 *      `'[^']*'` после 'message' и видела только первый литерал, а конкатенация
 *      оставалась невидимой. Нашла мутация, не чтение — теперь берётся строка целиком;
 *   7. убрать fingerprint → красный там же.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');
const read = (f) => readFileSync(join(DIR, f), 'utf8');

const TRIP158 = '20260701123715_trip158_deterministic_grace.sql';
const ELIDE = '20260806143857_trip153_recompute_elide_identical_writes.sql';
const CACHE = '20260806144136_trip153_reconcile_entitlement_cache.sql';

// Формула = от `select max(` до конца SELECT'а, заполняющего v_end. Комментарии
// внутри неё — часть текста и сравниваются наравне: они объясняют грейс, и их
// потеря на копировании такой же признак пересказа, как потеря строки кода.
function entitlementFormula(sql) {
  const start = sql.indexOf('select max(');
  assert.notEqual(start, -1, 'в файле нет блока `select max(` — формула не найдена');
  const end = sql.indexOf("s.status in ('active', 'trialing', 'past_due');", start);
  assert.notEqual(end, -1, 'не найден конец SELECT, заполняющего v_end');
  return sql
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

test('формула права скопирована из TRIP-158 дословно, а не пересказана', () => {
  // Тот самый класс ошибки, что уже был допущен в ТЗ: там утверждалось, что
  // recompute_user_entitlement читает status и current_period_end. На деле входов
  // ТРИ — третий это provider_meta->>'next_payment_attempt' + 1 day для past_due.
  // Копия «по описанию» рапортовала бы каждого дённинг-юзера как расхождение
  // ежечасно и уровнем error. Здесь это ловится текстом.
  assert.equal(entitlementFormula(read(ELIDE)), entitlementFormula(read(TRIP158)));
});

test('грейс past_due остался в формуле явно', () => {
  // Отдельно от парности: если КТО-ТО поправит обе копии одинаково, парность
  // останется зелёной. Этот тест держит сам факт наличия третьего входа.
  const f = entitlementFormula(read(ELIDE));
  assert.match(f, /provider_meta->>'next_payment_attempt'/);
  assert.match(f, /interval '1 day'/);
  assert.match(f, /when s\.status = 'past_due' then/);
});

test('каждый записываемый класс находки объявлен в CHECK', () => {
  // Опечатка в классе находки не видна ничем: INSERT упадёт на CHECK только в
  // рантайме, внутри часового прогона, и только на той ветке, которая
  // сработала. То есть класс, который никогда не встречался на dev, свалит
  // прогон в проде.
  const journal = read('20260806143712_trip153_reconcile_journal.sql');
  const checkBlock = journal.slice(
    journal.indexOf("kind         public.short_text not null check (kind in ("),
    journal.indexOf('subject_type public.short_text'),
  );
  const declared = new Set([...checkBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(declared.size >= 10, `в CHECK разобрано подозрительно мало классов: ${declared.size}`);

  const cache = read(CACHE);
  const used = new Set(
    [...cache.matchAll(/(?:values \(|select )v_run, '([a-z_]+)'/g)].map((m) => m[1]),
  );
  assert.ok(used.size > 0, 'в сверке не найдено ни одной записи находки — сломан разбор');

  for (const kind of used) {
    assert.ok(declared.has(kind), `класс '${kind}' пишется, но не объявлен в CHECK`);
  }

  // ★ВТОРАЯ СТОРОНА. Первая редакция этого теста сверяла ТОЛЬКО классы, которые
  // встречаются в самом SQL-файле, и про edge-функцию не знала — а Сверка Б кладёт
  // в `kind` значение `WriteReason` из reconcilePlan.ts. Одно из них ('duplicate')
  // в CHECK отсутствовало: вставка находки падала бы на констрейнте, при этом
  // счётчики прогона уже увеличены, то есть журнал рапортовал бы больше находок,
  // чем в нём строк. Тест был зелёным и ничего не проверял на этой оси.
  const planPath = join(
    import.meta.dirname, '..', '..',
    'supabase', 'functions', '_shared', 'payments', 'reconcilePlan.ts',
  );
  if (!existsSync(planPath)) return; // Сверка Б ещё не в этой ветке — сверять нечего
  const plan = readFileSync(planPath, 'utf8');
  const block = plan.slice(plan.indexOf('export type WriteReason'), plan.indexOf('export type WriteOp'));
  const reasons = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(reasons.length >= 3, `в WriteReason разобрано подозрительно мало значений: ${reasons.length}`);
  for (const r of reasons) {
    assert.ok(declared.has(r), `WriteReason '${r}' пишется в reconcile_finding.kind, но не объявлен в CHECK`);
  }
});

test('расписание вводится в режиме report, а не apply', () => {
  // Н9: первое, что новый механизм делает в проде, не должно быть массовым
  // изменением прав. Перевод на apply — отдельной миграцией, видимой в диффе.
  const cache = read(CACHE);
  const schedule = cache.slice(cache.indexOf('cron.schedule('));
  assert.match(schedule, /reconcile_entitlement_cache\('report'\)/);
  assert.doesNotMatch(schedule, /reconcile_entitlement_cache\('apply'\)/);
});

test('находки уходят в Sentry, и группировка не разваливается', () => {
  // Я один раз уже вырезал этот алерт «из соображений» — решение Pavel было
  // обратным (environment зашит 'production', молчащая сверка бесполезна).
  // Тест держит и сам факт отправки, и два свойства, без которых алерт
  // бесполезен по-другому: стабильный fingerprint и сообщение БЕЗ переменных
  // частей — иначе Sentry заводит новый issue каждый час.
  const cache = read(CACHE);
  assert.match(cache, /perform net\.http_post\(/, 'алерт в Sentry пропал');
  assert.match(cache, /'environment', 'production'/);
  assert.match(cache, /'level', 'error'/);
  assert.match(cache, /'fingerprint', jsonb_build_array\(/, 'без fingerprint сырой POST не сгруппируется');

  // Берём СТРОКУ целиком, а не первый литерал после 'message': первая редакция
  // этого теста ловила `'[^']*'` и потому пропускала
  // `'message', 'x: ' || v_found || ' y'` — конкатенация оставалась невидимой.
  // Нашла мутация, не чтение.
  const msgLine = cache.split('\n').find((l) => l.includes("'message',"));
  assert.ok(msgLine, 'не нашёл поле message у события Sentry');
  assert.ok(
    !/\|\||format\s*\(|v_run|v_found|v_fixed/.test(msgLine),
    `message должен быть константой (числа и id — в extra), а он: ${msgLine.trim()}`,
  );
});

test('дефолт режима — report, а не apply', () => {
  // Голый `select reconcile_entitlement_cache()` из SQL-редактора не должен
  // оказаться массовой правкой прав по недосмотру.
  assert.match(
    read(CACHE),
    /reconcile_entitlement_cache\(p_mode text default 'report'\)/,
  );
});
