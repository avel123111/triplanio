import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCardBg } from './shareCardBg.js';

// Фикстура повторяет структуру шаблона render-share-card (TRIP-443): фон —
// full-bleed <image> с токеном __SHARE_CARD_BG__ в самом низу; карта — свой токен.
const SVG =
  '<svg><image href="__SHARE_CARD_BG__" x="0" y="0" width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/>' +
  '<image href="__SHARE_CARD_MAP__" x="10" y="10"/><text>t</text></svg>';

test('applyCardBg подставляет выбранную подложку в токен фона', () => {
  const out = applyCardBg(SVG, 'data:image/webp;base64,USER+PIC/9=');
  assert.ok(out.includes('href="data:image/webp;base64,USER+PIC/9="'));
  assert.ok(!out.includes('__SHARE_CARD_BG__'));
  // Токен карты не трогаем.
  assert.ok(out.includes('__SHARE_CARD_MAP__'));
});

test('applyCardBg: пустой bgDataUri удаляет элемент фона (прозрачно)', () => {
  const out = applyCardBg(SVG, '');
  assert.ok(!out.includes('__SHARE_CARD_BG__'));
  assert.ok(!out.includes('<image href="data:'));
  // Удалён только фон — карта и текст на месте.
  assert.ok(out.includes('__SHARE_CARD_MAP__'));
  assert.ok(out.includes('<text>t</text>'));
});

test('applyCardBg: пустой/битый вход', () => {
  assert.equal(applyCardBg('', 'data:image/webp;base64,A'), '');
  assert.equal(applyCardBg(undefined, 'data:image/webp;base64,A'), undefined);
});

test('applyCardBg не интерпретирует спецпаттерны replace в подменяемом URI', () => {
  // Base64-алфавит не содержит `$`, но замена обязана быть дословной и для
  // будущих форм URI — фиксируем поведение на строке с "$&".
  const out = applyCardBg(SVG, 'data:image/webp;base64,$&');
  assert.ok(out.includes('href="data:image/webp;base64,$&"'));
});
