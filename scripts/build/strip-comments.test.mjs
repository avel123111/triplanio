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

test('★★ шаг подключён к сборке — иначе функции просто лежат', () => {
  // Чистые функции без вызова из `vite.config.js` не чистят ничего, и заметить
  // это можно только открыв исходный код страницы на проде.
  const cfg = readFileSync('vite.config.js', 'utf8');
  assert.match(cfg, /strip-shipped-comments/, 'плагин не объявлен');
  assert.match(cfg, /\['index\.html', stripHtml\]/, 'index.html не чистится');
  assert.match(cfg, /\['site\.css', stripCss\]/, 'site.css не чистится');
});
