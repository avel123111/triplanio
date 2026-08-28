import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, replaceExtension, prepareImage, MAX_IMAGE_EDGE } from './prepareImage.js';

test('fitWithin: картинка меньше потолка не трогается', () => {
  assert.equal(fitWithin(1920, 1080), null);
  assert.equal(fitWithin(800, 600), null);
  assert.equal(fitWithin(1080, 1920), null, 'ровно потолок по длинной стороне — это не «больше»');
});

test('fitWithin: пропорции сохраняются, длинная сторона = потолок', () => {
  const p = fitWithin(4032, 3024);
  assert.deepEqual(p, { width: 1920, height: 1440 });
  const l = fitWithin(3024, 4032);
  assert.deepEqual(l, { width: 1440, height: 1920 });
  assert.equal(Math.max(p.width, p.height), MAX_IMAGE_EDGE);
});

test('fitWithin: панорама не схлопывается в ноль пикселей', () => {
  const { height } = fitWithin(20000, 500);
  assert.ok(height >= 1, `высота ${height}`);
});

test('replaceExtension: расширение обязано совпасть с байтами', () => {
  assert.equal(replaceExtension('IMG_4823.HEIC', 'webp'), 'IMG_4823.webp');
  assert.equal(replaceExtension('фото.из.отпуска.jpg', 'webp'), 'фото.из.отпуска.webp');
  assert.equal(replaceExtension('noext', 'webp'), 'noext.webp');
  assert.equal(replaceExtension('.gitkeep', 'webp'), '.gitkeep.webp', 'точка первым символом — не расширение');
});

test('prepareImage: браузер не открыл картинку → исходник наружу, без исключения', async () => {
  // В node нет ни createImageBitmap, ни canvas — ровно то же положение, в котором
  // оказывается десктопный Chrome с HEIC. Ужать не смогли — загрузить всё равно даём.
  const file = { name: 'IMG_4823.HEIC', size: 9_000_000 };
  assert.equal(await prepareImage(file), file);
});
