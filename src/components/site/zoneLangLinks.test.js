// Адрес зоны НЕ читается мимо роутера (TRIP-520/533).
//
// ЧТО СЛУЧИЛОСЬ. Язык меняется БЕЗ перезагрузки документа — переключатель уводит
// на соседний адрес роутером, — поэтому любое значение, посчитанное один раз за
// загрузку, после смены остаётся от прежнего языка. Ровно так сломался
// `zoneHome()`: он кэшировал адрес главной на весь документ (`home ??= …`), и на
// демо логотип после смены языка вёл на прежний.
//
// `window.location.pathname` нереактивен и доступен ВНЕ рендера — то есть он и
// есть то, чем такой кэш можно написать. Хуки (`useZoneHref`/`useZoneNav`) вне
// рендера вызвать нельзя, это запрещает штатный `react-hooks/rules-of-hooks`;
// здесь остаётся половина, которой линтер не видит.
//
// ★ ЧЕГО В ЭТОМ ФАЙЛЕ БОЛЬШЕ НЕТ И ПОЧЕМУ (TRIP-533). Тут стояли ещё две
// проверки, и обе доказывали не то, ради чего писались:
//   · «ссылка на демо обёрнута в `useZonePath`» — разбор ФОРМЫ ЗАПИСИ адреса.
//     Полным такой предикат быть не может (шаблонную строку `` to={`/${k}`} ``
//     он не видел), а после появления двери он краснел бы на ВЕРНОМ коде:
//     `to={DEMO_PATH}` через `<ZoneLink>` — правильная форма. Вопрос «можно ли
//     уйти мимо двери» задаёт теперь гард 2ah, и задаёт его по ИМПОРТУ, то есть
//     полно.
//   · «`useZonePath` строит адрес через `withLangPath(routeLocale ?? lang)`» —
//     регулярка по тексту функции. Она пинила буквы реализации, а не поведение,
//     и разъехалась с ней на первом же переносе. Настоящий гейт этого правила —
//     `routePaths.test.js`: `zoneHref` там чистая функция, и её можно ВЫЗВАТЬ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_ZONE } from '../../../scripts/ci/zone-perimeter.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

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

test('разбор действительно видит файлы зоны', () => {
  // Без этого предыдущая проверка зеленела бы и на пустом списке файлов.
  const files = zoneFiles().map((f) => relative(ROOT, f));
  assert.ok(files.includes('src/components/site/SiteChrome.jsx'), `обвязка зоны не найдена: ${files.length} файлов`);
  assert.ok(files.some((f) => f.startsWith('src/pages/Landing/')), 'страницы лендинга не найдены');
});
