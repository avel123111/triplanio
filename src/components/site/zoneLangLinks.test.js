// Внутри зоны ссылка на ПЕРЕВЕДЁННУЮ страницу обязана нести язык (TRIP-520).
//
// ЧТО СЛУЧИЛОСЬ. У лендинга и демо есть по три адреса (`/`, `/es`, `/ru`), и
// строит их `useZonePath()` — он читает префикс текущего адреса. Обе кнопки
// лендинга через него и шли, а пункт «посмотреть пример» в бургер-меню — нет:
// там стоял голый `DEMO_PATH`. С русского лендинга он уводил на АНГЛИЙСКОЕ
// демо, то есть язык терялся на первом же переходе внутри зоны.
//
// Глазами это не видно: обе ссылки выглядят одинаково, отличается одна обёртка.
// Поэтому инвариант закреплён здесь — разбором исходников, а не сценарием в
// браузере: сценарий проверил бы те ссылки, о которых мы вспомнили, а забытая
// как раз и есть дефект.
//
// ★ ВТОРАЯ ПОЛОВИНА ИНВАРИАНТА — «АДРЕС ЗОНЫ СЧИТАЕТСЯ В РЕНДЕРЕ». Язык теперь
// меняется БЕЗ перезагрузки документа (переключатель уводит на соседний адрес
// роутером), поэтому любое значение, посчитанное один раз за загрузку, после
// смены остаётся от прежнего языка. Ровно так и сломался `zoneHome()`: он
// кэшировал адрес главной на весь документ (`home ??= …`), и на демо логотип
// после смены языка вёл на прежний.
//
// Мертвее всего эту дыру закрывает НЕ отдельная проверка, а имя: `useZonePath`
// и `useZoneHome` — хуки, и вызвать их вне рендера запрещает штатный
// `react-hooks/rules-of-hooks` в `npm run lint`. Здесь остаётся то, чего он не
// видит: чтение адреса мимо роутера — `window.location.pathname`. Именно оно и
// делало кэш возможным.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_ZONE } from '../../../scripts/ci/zone-perimeter.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = join(ROOT, 'src');

/**
 * Все файлы зоны — из ОБЩЕГО периметра (`scripts/ci/zone-perimeter.mjs`), а не
 * своим списком.
 *
 * ★ ЗДЕСЬ СТОЯЛ ЧЕТВЁРТЫЙ ПЕРИМЕТР, И ОН СТОИЛ ПРОДА. Свой список
 * (`components/site`, `Landing`, `Demo`, `Legal.jsx`) не знал ни про
 * `PublicTrip.jsx`, ни про `Login.jsx`, ни про `JoinTrip.jsx` — то есть ровно
 * та болезнь, ради лечения которой заведён `zone-perimeter.mjs`: «разъехавшийся
 * периметр молча становится вердиктом — гейт отвечает „чисто“ про дерево,
 * половину которого не открывал». Из-за него кнопка «На главную» на ошибке
 * приглашения (`JoinTrip.jsx`) не судилась вообще.
 *
 * Периметр — половина беды; вторая половина была в ПРЕДИКАТЕ: проверка №1 ниже
 * смотрит только на `DEMO_PATH` и литерал `to="/"` не видит, поэтому логотип
 * входа (`AuthShell.jsx`, В ПЕРИМЕТРЕ) сбрасывал язык на глазах у зелёного
 * гейта. Обобщённый предикат теперь несёт гард 2ah `check-zone-lang-links`.
 */
function zoneFiles() {
  const out = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) { readdirSync(p).forEach((f) => walk(join(p, f))); return; }
    if (/\.(jsx?|tsx?)$/.test(p) && !p.endsWith('.test.js')) out.push(p);
  };
  SITE_ZONE.forEach((r) => walk(join(ROOT, r)));
  return out;
}

/** Строки файла без комментариев — разбор смотрит на код, а не на разбор. */
function codeLines(file) {
  return readFileSync(file, 'utf8').split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
}

test('★ адрес переведённой страницы внутри зоны строится useZonePath, а не литералом', () => {
  const offenders = [];
  for (const file of zoneFiles()) {
    for (const [n, line] of codeLines(file)) {
      // Ссылка строится на DEMO_PATH мимо useZonePath(...) — тот самый дефект.
      if (!/DEMO_PATH/.test(line)) continue;
      if (/useZonePath\(\s*DEMO_PATH\s*\)/.test(line)) continue;
      if (/^\s*(import|export const DEMO_PATH|const DEMO_PATH)/.test(line)) continue;
      // Маршрут в таблице и текст ссылки для показа языка не несут.
      if (/<Route|SHARE_URL|EXACT/.test(line)) continue;
      offenders.push(`${relative(ROOT, file)}:${n}  ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [],
    `ссылка на демо мимо useZonePath — язык потеряется на переходе:\n  ${offenders.join('\n  ')}`);
});

test('★★ адрес зоны не читается мимо роутера', () => {
  // `window.location.pathname` не перерисовывает вызывателя и доступен вне
  // рендера — то есть разрешает посчитать адрес один раз на весь документ. Один
  // раз это уже стоило бага (`zoneHome`), поэтому источник закрыт целиком:
  // внутри зоны путь берётся у роутера (`useLocation`).
  const offenders = [];
  for (const file of zoneFiles()) {
    for (const [n, line] of codeLines(file)) {
      if (!/window\s*\.\s*location\s*\.\s*pathname/.test(line)) continue;
      // ★ ИСКЛЮЧЕНИЕ — ПЕРЕПИСЬ САМОГО АДРЕСА, а не вычисление ссылки.
      // `history.replaceState`/`pushState` обязаны получить ЖИВОЙ адрес
      // документа: роутер здесь не источник — он про то, что нарисовано, а
      // переписывается то, что в строке браузера (`Login.jsx` снимает из адреса
      // отказ OAuth). Пережить смену языка такому значению нечем: оно
      // вычисляется и тут же уходит в вызов, никакой переменной не остаётся.
      // Исключение узкое НАМЕРЕННО — оно требует ВЫЗОВА history в той же
      // строке, поэтому `const home = window.location.pathname` (тот самый
      // кэш, ради которого проверка написана) под него не попадает.
      if (/history\s*\.\s*(replace|push)State\s*\(/.test(line)) continue;
      {
        offenders.push(`${relative(ROOT, file)}:${n}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `адрес зоны прочитан мимо роутера — значение переживёт смену языка:\n  ${offenders.join('\n  ')}`);
});

test('★★★ там, где адрес языка НЕ называет, ссылка зоны наследует язык экрана', () => {
  // Локаль есть только у переведённых страниц. На юр-документах её нет — они
  // английские по решению (TRIP-465 §7), — а обвязка там переведена и язык
  // берётся из профиля либо из выбора посетителя. Фолбэк на `DEFAULT_LANG`
  // терял его молча и ровно на выходе: `/ru` → «Terms» → логотип → английский
  // лендинг. Дефект того же класса, что и голый `DEMO_PATH` выше, только язык
  // лежит не в адресе, — поэтому предыдущие две проверки его не видели.
  const code = codeLines(join(SRC, 'components/site/zoneCta.js')).map(([, l]) => l).join('\n');
  const call = /return\s+withLangPath\(([^)]*)\)/.exec(code)?.[1];
  assert.ok(call, 'useZonePath больше не строит адрес через withLangPath — проверку надо перечитать');
  assert.match(call, /routeLocale\s*\?\?\s*lang\b/,
    `язык ссылки зоны обязан падать на язык ЭКРАНА, а не на язык по умолчанию; сейчас: withLangPath(${call})`);
});

test('разбор действительно видит файлы зоны', () => {
  // Без этого предыдущая проверка зеленела бы и на пустом списке файлов.
  const files = zoneFiles().map((f) => relative(ROOT, f));
  assert.ok(files.includes('src/components/site/SiteChrome.jsx'), `обвязка зоны не найдена: ${files.length} файлов`);
  assert.ok(files.some((f) => f.startsWith('src/pages/Landing/')), 'страницы лендинга не найдены');
});
