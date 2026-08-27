/**
 * Структурированные данные не имеют права расходиться с видимым (TRIP-445).
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ. Разметка не видна человеку — её читает только
 * поисковик, поэтому «разъехалось» тут не замечает никто, включая автора. А
 * цена конкретная: Google штрафует за разметку, не совпадающую с содержимым
 * страницы, и это самый лёгкий способ им заработать. Второй способ сломать —
 * объявить `FAQPage` там, где вопросов нет.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faqPageLd } from './jsonLd.js';

/** Типы schema.org, реально объявленные в `index.html`, — из разметки, не из текста. */
function ldTypes() {
  const html = readFileSync('index.html', 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        if (typeof n['@type'] === 'string') out.push(n['@type']);
        Object.values(n).forEach(walk);
      }
    };
    walk(JSON.parse(m[1]));
  }
  return out;
}

const ITEMS = [
  { q: 'Нужен ли аккаунт, чтобы посмотреть поездку?', a: 'Нет.' },
  { q: 'Сколько стоит?', a: 'Есть бесплатный тариф.' },
];

test('FAQPage несёт РОВНО те пары, что пришли из разметки', () => {
  const ld = faqPageLd(ITEMS);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity.length, ITEMS.length);
  ITEMS.forEach((it, i) => {
    assert.equal(ld.mainEntity[i].name, it.q);
    assert.equal(ld.mainEntity[i].acceptedAnswer.text, it.a);
  });
});

test('★★ без вопросов разметки НЕТ — пустой FAQPage это ложь о странице', () => {
  for (const empty of [[], null, undefined, [{ q: '', a: 'x' }], [{ q: 'x', a: '' }]]) {
    assert.equal(faqPageLd(empty), null, JSON.stringify(empty));
  }
});

test('неполная пара выбрасывается, а не едет полупустой', () => {
  const ld = faqPageLd([...ITEMS, { q: 'Вопрос без ответа', a: '' }]);
  assert.equal(ld.mainEntity.length, 2);
});

test('★★★ страничная разметка НЕ лежит в index.html — он отдаётся на каждый адрес', () => {
  // `index.html` — один файл на все маршруты SPA. `FAQPage` оттуда означал бы,
  // что этот FAQ несёт и `/trips`, и `/settings`, и юр-страницы. Та же ловушка,
  // из-за которой туда сознательно не положен `canonical`.
  // Смотрим В САМУ РАЗМЕТКУ, а не в текст файла: комментарий рядом с ней
  // объясняет, почему страничных типов здесь нет, и называет их по имени —
  // предикат по файлу целиком поймал бы это объяснение и покраснел на правде.
  const types = ldTypes();
  assert.ok(types.length, 'общесайтовая разметка потерялась');
  for (const pageScoped of ['FAQPage', 'Question', 'Answer', 'Article', 'BreadcrumbList', 'WebPage']) {
    assert.ok(!types.includes(pageScoped), `${pageScoped} страничный — ему не место в index.html`);
  }
  assert.deepEqual(types, ['Organization', 'WebSite']);
});

test('общесайтовая разметка — валидный JSON и абсолютные адреса', () => {
  const html = readFileSync('index.html', 'utf8');
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(raw); // упадёт на сломанном JSON — молча его никто не заметит
  const nodes = data['@graph'];
  assert.deepEqual(nodes.map((n) => n['@type']), ['Organization', 'WebSite']);
  for (const n of nodes) {
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'string' && (k === 'url' || k === 'logo')) {
        assert.match(v, /^https:\/\/www\.triplanio\.com\//, `${n['@type']}.${k} обязан быть абсолютным`);
      }
    }
  }
});
