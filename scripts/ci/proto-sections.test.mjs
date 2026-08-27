// proto-sections: что именно сравнивает приёмка.
//
// ★ ГЛАВНЫЙ ТЕСТ — «пустое пересечение это ОТКАЗ». Ровно этого не хватало:
// харнесс со списком секций лендинга не находил на демо ни одной, печатал
// «худшая секция: 0%» и выходил с нулём — ложно-зелёная приёмка. Здесь это
// зафиксировано как контракт, а не как поведение, о котором надо помнить.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey, parseOnly, parseAliases, commonSections, unpairedVerdict, SECTION_SELECTOR, sectionSel } from './proto-sections.mjs';

test('опознаватель секции — первое СОДЕРЖАТЕЛЬНОЕ имя', () => {
  assert.equal(sectionKey('hero'), 'hero');
  assert.equal(sectionKey('tl-sec sheet-pane section-pad'), 'tl-sec');
  // Служебное имя впереди не должно становиться ключом: иначе `section-pad`
  // станет «секцией» и склеит десяток разных блоков в один.
  assert.equal(sectionKey('section-pad tl-sec'), 'tl-sec');
  assert.equal(sectionKey('sheet-pane dark final'), 'final');
});

test('нечего опознавать — null, а не пустая строка', () => {
  for (const v of ['', '   ', 'section-pad sheet-pane', null, undefined, 42, {}]) {
    assert.equal(sectionKey(v), null, String(v));
  }
});

test('--sections разбирается, пустое значение = «все»', () => {
  assert.deepEqual(parseOnly('hero, final ,tl-sec'), ['hero', 'final', 'tl-sec']);
  assert.equal(parseOnly(''), null);
  assert.equal(parseOnly('  , ,'), null);
  assert.equal(parseOnly(undefined), null);
});

test('пересечение идёт в порядке ПРОТОТИПА — он эталон', () => {
  const r = commonSections(['hero', 'pain', 'final'], ['final', 'hero', 'pain']);
  assert.deepEqual(r.sections, ['hero', 'pain', 'final']);
});

test('★ нет общих секций — список пуст, и это видно вызывающему', () => {
  const r = commonSections(['hero', 'pain'], ['dm-hero', 'tl-sec']);
  assert.deepEqual(r.sections, [], 'ноль общих секций обязан быть пустым списком, а не тихим «всё хорошо»');
  assert.deepEqual(r.onlyProto, ['hero', 'pain']);
  assert.deepEqual(r.onlyImpl, ['dm-hero', 'tl-sec']);
});

test('что есть только у одной стороны — отчёт, а не ошибка', () => {
  const r = commonSections(['hero', 'pain', 'final'], ['hero', 'final', 'extra']);
  assert.deepEqual(r.sections, ['hero', 'final']);
  assert.deepEqual(r.onlyProto, ['pain'], 'секция макета, которой нет в реализации');
  assert.deepEqual(r.onlyImpl, ['extra'], 'секция реализации, которой нет в макете');
});

test('повтор имени берётся один раз (харнесс снял бы первую)', () => {
  const r = commonSections(['hero', 'hero', 'final'], ['hero', 'final', 'final']);
  assert.deepEqual(r.sections, ['hero', 'final']);
});

test('★ опечатка в --sections не выглядит как «секция в порядке»', () => {
  const r = commonSections(['hero', 'final'], ['hero', 'final'], ['hero', 'finl']);
  assert.deepEqual(r.sections, ['hero']);
  assert.deepEqual(r.missing, ['finl'], 'несуществующее имя обязано вернуться вызывающему');
});

test('--sections только СУЖАЕТ, добавить секцию им нельзя', () => {
  const r = commonSections(['hero', 'pain'], ['hero'], ['hero', 'pain']);
  assert.deepEqual(r.sections, ['hero'], 'pain нет в реализации — просьба сравнить её не создаёт секцию');
  assert.deepEqual(r.missing, [], 'pain существует у прототипа, это не опечатка');
});

test('★ псевдоним возвращает намеренно переименованную секцию в сравнение', () => {
  const alias = parseAliases('dm-hero=hero');
  assert.equal(alias.get('dm-hero'), 'hero');

  const implRaw = ['dm-hero', 'tl-sec'];
  const implNamed = implRaw.map((k) => alias.get(k) ?? k);
  const r = commonSections(['hero', 'tl-sec'], implNamed);
  assert.deepEqual(r.sections, ['hero', 'tl-sec'], 'без псевдонима первый экран демо выпадал из приёмки молча');
  assert.deepEqual(r.onlyProto, []);
  assert.deepEqual(r.onlyImpl, []);
});

test('мусор в --alias не роняет и не выдумывает пар', () => {
  assert.equal(parseAliases(undefined).size, 0);
  assert.equal(parseAliases('').size, 0);
  assert.equal(parseAliases('a=,=b,  ,c').size, 0);
  assert.equal(parseAliases('a=b,c=d').size, 2);
});

/* ── Непарные секции и селектор (TRIP-445, блок 1) ─────────────────────────── */

test('★★★ непарное с ОБЕИХ сторон = блокирует: это переименование, а не «не перенесли»', () => {
  // Живой случай: демо назвало первый экран dm-hero (hero занято лендингом),
  // и худшая секция 88.5% исчезла из сравнения при коде выхода 0.
  const v = unpairedVerdict(['hero'], ['dm-hero']);
  assert.equal(v.blocking, true);
  assert.deepEqual(v.proto, ['hero']);
  assert.deepEqual(v.impl, ['dm-hero']);
});

test('непарное ТОЛЬКО у макета — не блокирует: секцию законно не переносили', () => {
  // В документе лендинга живёт ещё и публичная поездка (pt-hero): на самом
  // лендинге её нет и быть не должно.
  assert.equal(unpairedVerdict(['pt-hero'], []).blocking, false);
  assert.equal(unpairedVerdict(['pt-hero', 'doc'], []).blocking, false);
});

test('непарное ТОЛЬКО у реализации — не блокирует: продуктовое добавление', () => {
  assert.equal(unpairedVerdict([], ['pricing']).blocking, false);
});

test('--allow-unpaired снимает блокировку ровно у названных имён', () => {
  assert.equal(unpairedVerdict(['hero'], ['dm-hero'], ['hero', 'dm-hero']).blocking, false);
  // половинчатое объявление НЕ снимает: пара всё ещё непарна
  const half = unpairedVerdict(['hero'], ['dm-hero'], ['hero']);
  assert.equal(half.blocking, false, 'одна сторона вычтена — блокировать нечего');
  assert.deepEqual(half.impl, ['dm-hero'], 'но остаток обязан быть виден в отчёте');
  // объявление ЧУЖОГО имени ничего не снимает
  assert.equal(unpairedVerdict(['hero'], ['dm-hero'], ['final']).blocking, true);
});

test('ничего непарного — не блокирует', () => {
  assert.equal(unpairedVerdict([], []).blocking, false);
});

test('селектор секций видит и <main class> — иначе юр-страницы не принять по построению', () => {
  // Прототип Terms/Privacy — <main class="doc" id="doc">, реализация —
  // <section class="doc">. Без <main> в селекторе пересечение пусто ВСЕГДА.
  assert.match(SECTION_SELECTOR, /\bsection\b/);
  assert.match(SECTION_SELECTOR, /\bmain\[class\]/);
});

test('★ перечисление и съёмка смотрят на ОДИН набор тегов', () => {
  // Разойдись они — имя находилось бы в списке и не находилось при съёмке, и
  // секция выпадала бы со строкой «не снялась» вместо сравнения.
  const tags = SECTION_SELECTOR.split(',').map((s) => s.trim().replace(/\[.*$/, ''));
  const shot = sectionSel('doc').split(',').map((s) => s.trim().replace(/\..*$/, ''));
  assert.deepEqual(shot, tags, `${sectionSel('doc')} против ${SECTION_SELECTOR}`);
  assert.equal(sectionSel('hero'), 'section.hero, main.hero');
});
