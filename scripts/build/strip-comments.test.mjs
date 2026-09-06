/**
 * Комментарии не уезжают в браузер (TRIP-445).
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ. Вырезание комментариев регуляркой ломает CSS двумя
 * тихими способами: съедает то, что лежит ВНУТРИ строки (`content: "/*"`), и
 * склеивает соседние токены (склейка соседних токенов → `ab`). Оба дефекта не роняют сборку
 * и не видны в диффе — их видно только на странице, и то не сразу.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripCss, stripHtml } from './strip-comments.mjs';

test('CSS: комментарий уходит, объявления остаются', () => {
  assert.equal(stripCss('a{color:red}/* эссе на три абзаца */b{x:1}').replace(/\s+/g, ' ').trim(),
    'a{color:red} b{x:1}');
});

test('★★ CSS: комментарий заменяется ПРОБЕЛОМ — иначе токены склеятся', () => {
  // `a/*x*/b` без пробела превращается в `ab` — другой селектор.
  assert.match(stripCss('a/*x*/b{c:1}'), /^a\s+b\{c:1\}$/);
});

test('★★★ CSS: то, что внутри строки, не комментарий', () => {
  for (const src of ['a{content:"/* not a comment */"}', "a{content:'/* x */'}"]) {
    assert.equal(stripCss(src), src);
  }
});

test('CSS: незакрытый комментарий не роняет и не оставляет хвост', () => {
  assert.doesNotThrow(() => stripCss('a{x:1}/* забыли закрыть'));
  assert.ok(!stripCss('a{x:1}/* забыли закрыть').includes('забыли'));
});

test('HTML: комментарий уходит', () => {
  assert.equal(stripHtml('<p>x</p><!-- эссе --><b>y</b>'), '<p>x</p><b>y</b>');
});

test('★★★ HTML: внутрь <script> и <style> не заходим', () => {
  const js = '<script>var s = "<!-- не разметка -->";</script>';
  assert.ok(stripHtml(js).includes('<!-- не разметка -->'), 'содержимое скрипта тронуто');
  const ld = '<script type="application/ld+json">{"@type":"Organization"}</script>';
  assert.ok(stripHtml(`<!-- x -->${ld}`).includes('"@type":"Organization"'));
  assert.ok(!stripHtml(`<!-- x -->${ld}`).includes('<!-- x -->'));
});

test('★★★ HTML: `<script>`, УПОМЯНУТЫЙ в комментарии, не открывает блок', () => {
  // Тот самый дефект. Сканер искал блоки в тексте, где комментарии ещё живы,
  // принимал упоминание за настоящий тег и выносил наружу всё до ближайшего
  // закрывающего — вместе с комментарием. Проявилось на комментарии заставки,
  // объясняющем, почему она инлайном «а не `<link>`/`<script>`».
  const src = '<p>a</p><!-- инлайном, а не `<link>`/`<script>` --><p>b</p>';
  const out = stripHtml(src);
  assert.ok(!out.includes('инлайном'), 'комментарий уехал бы в браузер');
  assert.equal(out.replace(/\s+/g, ''), '<p>a</p><p>b</p>');
});

test('★★★ HTML: в отдаваемом index.html не остаётся НИ ОДНОГО комментария', () => {
  // Пинится реальный файл, а не выдуманная строка: дефект был не в теории, а
  // именно в нём, и заметить его можно было только «просмотром исходного кода».
  const out = stripHtml(readFileSync('index.html', 'utf8'));
  assert.equal((out.match(/<!--/g) || []).length, 0, 'комментарии уезжают на страницу');
});

test('★★ шаг подключён к сборке — иначе функции просто лежат', () => {
  // Чистые функции без вызова из `vite.config.js` не чистят ничего, и заметить
  // это можно только открыв исходный код страницы на проде.
  const cfg = readFileSync('vite.config.js', 'utf8');
  assert.match(cfg, /strip-shipped-comments/, 'плагин не объявлен');
  // Документов стало много (оболочка + по файлу на испечённый адрес, TRIP-520),
  // поэтому чистятся они СПИСКОМ. Список берётся из того же источника, что и
  // выпечка, — второй перечень адресов разъехался бы с первым молча.
  assert.match(cfg, /prerenderedDocPaths\(\)/, 'испечённые страницы не попадают в чистку');
  assert.match(cfg, /docs\.map\(\(d\) => \[d, stripHtml\]\)/, 'документы не чистятся');
  assert.match(cfg, /\['site\.css', stripCss\]/, 'site.css не чистится');
});
