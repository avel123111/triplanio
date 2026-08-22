// Перенос галереи обложек dev → prod держится на одном пересчёте: URL картинки
// в dev-проекте ↔ имя файла ↔ URL в prod-проекте. Ошибка здесь не падает, а
// молча сеет в prod-каталог 16 битых ссылок (галерея грузится, картинок нет) —
// поэтому единственное, что тут можно проверить без ключей, проверяем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectName, publicUrl } from './sync-cover-presets.mjs';

const DEV = 'nydhzevdizkfaxdlikgc';
const PROD = 'tizscxrpuopobgcxbekf';

test('publicUrl строит адрес объекта публичного бакета пресетов', () => {
  assert.equal(
    publicUrl(PROD, 'beach.webp'),
    `https://${PROD}.supabase.co/storage/v1/object/public/trip-cover-presets/beach.webp`,
  );
});

test('objectName разбирает свой url и переносит имя в другой проект', () => {
  const name = objectName(publicUrl(DEV, 'road_trip_desert.webp'), DEV);
  assert.equal(name, 'road_trip_desert.webp');
  assert.equal(publicUrl(PROD, name), publicUrl(PROD, 'road_trip_desert.webp'));
});

test('objectName декодирует имя (пробелы/кириллица приезжают %-кодированными)', () => {
  assert.equal(objectName(publicUrl(DEV, 'sea%20view.webp'), DEV), 'sea view.webp');
});

test('objectName отвергает чужое: другой проект, другой бакет, пустое имя, не-строку', () => {
  assert.equal(objectName(publicUrl(PROD, 'beach.webp'), DEV), null);
  assert.equal(objectName(`https://${DEV}.supabase.co/storage/v1/object/public/trips/beach.webp`, DEV), null);
  assert.equal(objectName(publicUrl(DEV, ''), DEV), null);
  assert.equal(objectName(null, DEV), null);
});
