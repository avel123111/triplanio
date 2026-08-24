import test from 'node:test';
import assert from 'node:assert/strict';
import { cardBgUri, applyCardBg } from './shareCardBg.js';

// Фикстура повторяет структуру шаблона render-share-card: фон — единственный
// jpeg-data-URI, остальные <image> — png (самолётик, карта).
const SVG =
  '<svg><image href="data:image/png;base64,PLANE=="/>' +
  '<image href="data:image/jpeg;base64,BG+DEFAULT/0=" x="0"/>' +
  '<image href="data:image/png;base64,MAP=="/><text>t</text></svg>';

test('cardBgUri вытаскивает единственный jpeg-фон шаблона', () => {
  assert.equal(cardBgUri(SVG), 'data:image/jpeg;base64,BG+DEFAULT/0=');
});

test('cardBgUri: нет jpeg — пусто (сторож контракта в ShareCardDialog)', () => {
  assert.equal(cardBgUri('<svg><image href="data:image/png;base64,A"/></svg>'), '');
  assert.equal(cardBgUri(''), '');
  assert.equal(cardBgUri(undefined), '');
});

test('applyCardBg подменяет ТОЛЬКО фон, png-ассеты не трогает', () => {
  const out = applyCardBg(SVG, 'data:image/webp;base64,USER+PIC/9=');
  assert.ok(out.includes('data:image/webp;base64,USER+PIC/9='));
  assert.ok(!out.includes('BG+DEFAULT'));
  assert.ok(out.includes('data:image/png;base64,PLANE=='));
  assert.ok(out.includes('data:image/png;base64,MAP=='));
});

test('applyCardBg: пустой bgDataUri / нет матча = SVG без изменений', () => {
  assert.equal(applyCardBg(SVG, ''), SVG);
  const noJpeg = '<svg><rect fill="#fff"/></svg>';
  assert.equal(applyCardBg(noJpeg, 'data:image/webp;base64,A'), noJpeg);
});

test('applyCardBg не интерпретирует спецпаттерны replace в подменяемом URI', () => {
  // Base64-алфавит не содержит `$`, но замена обязана быть дословной и для
  // будущих форм URI — фиксируем поведение на строке с "$&".
  const out = applyCardBg(SVG, 'data:image/webp;base64,$&');
  assert.ok(out.includes('href="data:image/webp;base64,$&"'));
});
