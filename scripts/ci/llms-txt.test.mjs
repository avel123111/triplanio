// Гейт для `public/llms.txt` (TRIP-497).
//
// ЗАЧЕМ ВООБЩЕ ФАЙЛ. Сайт — приложение на JavaScript: сервер на любой адрес
// отдаёт один `index.html`, в теле которого нет ни строчки текста. Краулеры
// движков ответов (GPTBot, ClaudeBot, PerplexityBot) JS не выполняют и в список
// краулеров превью `middleware.js` не входят — поисковики оттуда исключены
// намеренно (TRIP-445 Ф11). То есть в этом канале продукта не существовало
// вовсе. `llms.txt` — единственная страница сайта, которую такой агент читает
// без рендера, поэтому он САМОНЕСУЩИЙ: не оглавление ссылок, а сам текст.
//
// ЗАЧЕМ ГЕЙТ. У файла ДВА способа начать врать, и оба молчаливые:
//   1. он обещает адреса, которых нет (или молчит про те, что мы сами просим
//      индексировать в `sitemap.xml`);
//   2. его FAQ расходится с FAQ на самой странице. Ровно та причина, по которой
//      в PR #1036 шесть блоков FAQ схлопнули в один источник: пока источников
//      два, правку видит только один из них, и никто не краснеет.
//   3. он называет ЯЗЫКИ, которых у сайта уже нет (или молчит о новом). Состав
//      адресов держит цепочка `LOCALISED_PAGES` → `prerenderedUrls()` →
//      `sitemap.xml` → этот файл, и она замкнута в обе стороны на каждом звене
//      (TRIP-520). Но ПРОЗА про языки — «English, Spanish and Russian», ярлык
//      «(Spanish)» у ссылки — не пришпилена ничем, а именно её движок ответов и
//      цитирует. Четвёртый язык дописал бы себе строку со ссылкой (её требует
//      цепочка) и оставил бы соседнее предложение врущим — молча.
// Цены гейтом не покрыты по построению — их истина живёт в Stripe, а не в
// репозитории; это названо вслух в PR как принятая цена.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANGUAGES } from '../../src/lib/i18n/translations.js';
import { PREFIXED_LANGS, localeOf } from '../../src/lib/routePaths.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const LLMS = read('public/llms.txt');
const LANDING_EN = JSON.parse(read('src/lib/i18n/locales/en/landing.json'));

// Английские имена языков не выписываем: у `LANGUAGES` метки РОДНЫЕ («Español»),
// а файл написан по-английски. Берём их у платформы — тем же `Intl.DisplayNames`,
// которым в приложении локализуются страны (`fmtCountry`).
const languageName = new Intl.DisplayNames(['en'], { type: 'language' });
/** Секция файла по её заголовку `## <name>` — до следующего заголовка. */
function section(name) {
  const at = LLMS.indexOf(`## ${name}\n`);
  assert.notEqual(at, -1, `в llms.txt нет раздела «${name}»`);
  const rest = LLMS.slice(at + 3 + name.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

test('обещанные адреса = адреса из sitemap.xml, в обе стороны', () => {
  const inMap = new Set(
    [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
  );
  const inFile = new Set(
    [...LLMS.matchAll(/https:\/\/www\.triplanio\.com\/\S*/g)].map((m) => m[0].replace(/[.,)]$/, '')),
  );

  for (const url of inMap) {
    assert.ok(inFile.has(url), `${url} обещан краулеру в sitemap.xml, но в llms.txt его нет`);
  }
  for (const url of inFile) {
    assert.ok(inMap.has(url), `${url} назван в llms.txt, но в sitemap.xml его нет — ведём агента на адрес, который сами не признаём`);
  }
});

test('обещание вверху файла — тот же текст, что и описание сайта', () => {
  // ★ Один текст на все обещания — то же правило, что записано в `index.html`
  // над description/og/twitter: две формулировки одного и того же расходятся на
  // первой же правке, а обещать поиску, мессенджеру и движку ответов мы обязаны
  // одно и то же.
  const quote = LLMS.match(/^> (.+)$/m);
  assert.ok(quote, 'в llms.txt пропала строка-обещание (blockquote)');
  assert.equal(quote[1], LANDING_EN['meta.description']);
});

test('FAQ в файле дословно совпадает с FAQ на странице', () => {
  for (let n = 1; n <= 6; n += 1) {
    const question = LANDING_EN[`faq.q${n}`];
    const answer = LANDING_EN[`faq.a${n}`];
    assert.ok(question && answer, `в словаре нет пары faq.q${n}/faq.a${n}`);

    const at = LLMS.indexOf(`### ${question}\n`);
    assert.notEqual(at, -1, `вопрос «${question}» есть на странице, но не в llms.txt`);

    // Ответ — СЛЕДУЮЩАЯ непустая строка после вопроса, целиком: перенос по
    // строкам сделал бы сверку побайтово невозможной, поэтому ответ живёт одной
    // строкой (длинные строки в .txt никому не мешают).
    const rest = LLMS.slice(at).split('\n').slice(1).filter((l) => l.trim() !== '');
    assert.equal(rest[0], answer, `ответ на «${question}» разошёлся со страницей`);
  }
});

test('цены названы и в той валюте, в которой их берёт Stripe', () => {
  // Не проверка истины (она в Stripe), а проверка ФОРМЫ: цена без валюты или в
  // долларах — то, чем этот файл уже однажды чуть не соврал (в памяти проекта
  // тарифы записаны в USD, а живой каталог прода их берёт в EUR).
  for (const amount of ['EUR 6.99', 'EUR 39.99', 'EUR 8.99']) {
    assert.ok(LLMS.includes(amount), `в llms.txt нет цены «${amount}»`);
  }
  assert.doesNotMatch(LLMS, /\$\d/, 'цена в долларах: живой каталог прода берёт EUR');
});


test('раздел «Languages» называет РОВНО те языки, что есть у сайта', () => {
  // Языки живут в двух списках, и оба здесь нужны: `LANGUAGES` — что вообще
  // умеет интерфейс, `PREFIXED_LANGS` — у кого есть свой адрес. Английский в
  // первом и не во втором: он канонический и живёт без префикса.
  const langs = section('Languages');
  for (const { code } of LANGUAGES) {
    assert.match(langs, new RegExp(`\\b${languageName.of(code)}\\b`),
      `язык ${code} у сайта есть, а раздел «Languages» его не называет`);
  }
  for (const lang of PREFIXED_LANGS) {
    assert.ok(langs.includes(`/${lang}/`),
      `префикс /${lang}/ существует, а раздел «Languages» о нём молчит`);
  }
  // И обратная сторона: не обещать префикс, которого нет. Ищем любой `/xx/` в
  // обратных кавычках — так в этом разделе записаны именно префиксы.
  for (const [, seg] of langs.matchAll(/`\/([a-z]{2})\/`/g)) {
    assert.ok(PREFIXED_LANGS.includes(seg),
      `раздел «Languages» обещает префикс /${seg}/, которого у сайта нет`);
  }
});

test('у каждой ссылки назван язык, который называет её адрес', () => {
  // Ярлык «(Spanish)» — утверждение о языке, и решать его обязан ТОТ ЖЕ
  // предикат, что решает язык в приложении (`localeOf`), а не глаз редактора.
  // У юр-документов языкового адреса нет (TRIP-465 §7) — у них и ярлыка быть не
  // должно, иначе файл обещает версии, которых не существует.
  for (const line of section('Links').split('\n')) {
    const m = line.match(/https:\/\/www\.triplanio\.com(\S*)/);
    if (!m) continue;
    const locale = localeOf(m[1] || '/');
    if (locale) {
      assert.ok(line.includes(`(${languageName.of(locale)})`),
        `${m[0]} — адрес называет язык ${locale}, а строка ссылки его не называет`);
    } else {
      for (const { code } of LANGUAGES) {
        assert.ok(!line.includes(`(${languageName.of(code)})`),
          `${m[0]} — у этого адреса языковой версии нет, а строка обещает ${languageName.of(code)}`);
      }
    }
  }
});
