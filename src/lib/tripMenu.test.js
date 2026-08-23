import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, DEFAULT_SECTION, DOCK_SECTIONS, DOCK_SECTION_IDS,
  sectionById, isSectionAvailable, availableSections, resolveSection, loadingSections,
} from './tripMenu.js';
import { normalizeAddons } from './tripAddons.js';

// Реестр — единственный источник состава экрана трипа, а у состава нет
// скриншота: ни один гард не связывает пункт меню с веткой рендера. Поэтому
// поведение пинится здесь.

// Предикат принимает ФАКТЫ, а не трип: аддоны в него приходят из двух источников
// (дверь трипа и карточка главной) и оба проходят через ОДИН нормализатор —
// поэтому и тест гоняет их через него, а не подсовывает готовый булев объект.
const tripWith = (addons) => normalizeAddons(addons);
const plainTrip = tripWith({});

test('у каждой секции есть id, группа, подпись, иконка и событие; id уникальны', () => {
  const ids = new Set();
  for (const s of SECTIONS) {
    assert.ok(s.id, 'id');
    assert.ok(['lens', 'manage'].includes(s.group), `group у ${s.id}`);
    assert.ok(s.labelKey, `labelKey у ${s.id}`);
    assert.ok(s.icon, `icon у ${s.id}`);
    assert.ok(s.event, `event у ${s.id}`);
    assert.equal(ids.has(s.id), false, `дубль id ${s.id}`);
    ids.add(s.id);
  }
});

test('дефолтная секция существует и доступна всегда', () => {
  assert.ok(sectionById(DEFAULT_SECTION));
  assert.equal(isSectionAvailable(DEFAULT_SECTION, null, 'participant'), true);
  assert.equal(isSectionAvailable(DEFAULT_SECTION, plainTrip, undefined), true);
});

test('каждый пункт дока — существующая секция, и стороны не пересекаются', () => {
  for (const id of DOCK_SECTION_IDS) assert.ok(sectionById(id), `нет секции ${id}`);
  assert.deepEqual(DOCK_SECTION_IDS, [...DOCK_SECTIONS.left, ...DOCK_SECTIONS.right]);
  assert.equal(new Set(DOCK_SECTION_IDS).size, DOCK_SECTION_IDS.length, 'пункт дока продублирован');
  assert.ok(DOCK_SECTIONS.left.length > 0 && DOCK_SECTIONS.right.length > 0, 'кнопка «+» стоит между сторонами');
});

test('пункт дока не может быть гейтованным', () => {
  // У дока нет ни трипа, ни роли — проверить гейт ему нечем. Гейтованный пункт
  // отрисовался бы там, где секция недоступна, и вёл бы на подмену дефолтом.
  for (const id of DOCK_SECTION_IDS) {
    const s = sectionById(id);
    assert.equal(s.addon, undefined, `${id} закрыт аддоном`);
    assert.equal(s.canAccess, undefined, `${id} закрыт ролью`);
  }
});

// ── аддоны ───────────────────────────────────────────────────────────────────
// Гейт СТРОГИЙ: аддон включён только явным true. Отсутствующий ключ, null и
// «похожие на правду» значения — это ВЫКЛЮЧЕНО, иначе Pro-линза открывалась бы
// на бесплатном трипе.

test('бюджет и чат закрыты, пока аддон не включён явным true', () => {
  for (const id of ['budget', 'chat']) {
    assert.equal(isSectionAvailable(id, plainTrip, 'owner'), false, `${id} без аддона`);
    assert.equal(isSectionAvailable(id, null, 'owner'), false, `${id} без трипа`);
    assert.equal(isSectionAvailable(id, tripWith({ [id]: 1 }), 'owner'), false, `${id} при 1`);
    assert.equal(isSectionAvailable(id, tripWith({ [id]: 'true' }), 'owner'), false, `${id} при строке`);
    assert.equal(isSectionAvailable(id, tripWith({ [id]: true }), 'owner'), true, `${id} при true`);
  }
});

test('секции без аддона не зависят от трипа', () => {
  for (const id of ['overview', 'timeline', 'map', 'calendar', 'docs', 'settings']) {
    assert.equal(isSectionAvailable(id, null, 'owner'), true, id);
  }
});

// ── ступени доступа ──────────────────────────────────────────────────────────

test('наблюдатель (participant) не видит Участников, но видит Настройки (TRIP-137)', () => {
  assert.equal(isSectionAvailable('members', plainTrip, 'participant'), false);
  assert.equal(isSectionAvailable('settings', plainTrip, 'participant'), true);
  // Не на трипе вовсе (step=null) — тоже без Участников (fail-closed).
  assert.equal(isSectionAvailable('members', plainTrip, null), false);
  for (const step of ['owner', 'editor']) {
    assert.equal(isSectionAvailable('members', plainTrip, step), true, step);
  }
});

// ── выборки ──────────────────────────────────────────────────────────────────

test('availableSections отдаёт группу в порядке реестра', () => {
  const lenses = availableSections(tripWith({ budget: true, chat: true }), 'owner', 'lens');
  assert.deepEqual(lenses.map((s) => s.id), ['overview', 'timeline', 'map', 'calendar', 'budget', 'docs', 'chat']);
  const manage = availableSections(plainTrip, 'owner', 'manage');
  assert.deepEqual(manage.map((s) => s.id), ['edit', 'members', 'settings']);
});

test('availableSections режет и по аддону, и по ступени одновременно', () => {
  const all = availableSections(tripWith({ budget: true }), 'participant').map((s) => s.id);
  assert.equal(all.includes('budget'), true, 'бюджет включён аддоном');
  assert.equal(all.includes('chat'), false, 'чат аддоном не включён');
  assert.equal(all.includes('members'), false, 'наблюдателю участники недоступны');
  assert.equal(all.includes('settings'), true, 'настройки наблюдателю доступны');
});

test('без группы возвращаются обе группы', () => {
  const ids = availableSections(plainTrip, 'owner').map((s) => s.id);
  assert.equal(ids.includes('overview'), true);
  assert.equal(ids.includes('settings'), true);
});

// ── разрешение адреса ────────────────────────────────────────────────────────

test('несуществующая секция падает на дефолт, а не оставляет пустой экран', () => {
  // До реестра `?lens=опечатка` проходил гейт видимости насквозь (аддона у
  // такого id нет) и не совпадал ни с одной веткой рендера — тело экрана
  // оставалось пустым.
  assert.equal(resolveSection('опечатка', plainTrip, 'owner'), DEFAULT_SECTION);
  assert.equal(resolveSection('', plainTrip, 'owner'), DEFAULT_SECTION);
  assert.equal(resolveSection(undefined, plainTrip, 'owner'), DEFAULT_SECTION);
});

test('редактор структуры закрыт наблюдателю и открыт правящим ролям', () => {
  // Это ЕДИНСТВЕННЫЙ гард на вход в редактор: своей проверки роли у секции
  // больше нет (была — в отдельном роуте), а по прямому `?lens=edit`
  // наблюдателя разворачивает resolveSection. Ломается предикат — открывается
  // экран записи тому, кто писать не может.
  assert.equal(isSectionAvailable('edit', plainTrip, 'participant'), false);
  assert.equal(resolveSection('edit', plainTrip, 'participant'), DEFAULT_SECTION);
  assert.equal(isSectionAvailable('edit', plainTrip, null), false); // не на трипе — тоже нет
  for (const step of ['owner', 'editor']) {
    assert.equal(isSectionAvailable('edit', plainTrip, step), true, step);
    assert.equal(resolveSection('edit', plainTrip, step), 'edit', step);
  }
});

test('недоступная секция падает на дефолт, доступная остаётся', () => {
  assert.equal(resolveSection('budget', plainTrip, 'owner'), DEFAULT_SECTION);
  assert.equal(resolveSection('budget', tripWith({ budget: true }), 'owner'), 'budget');
  assert.equal(resolveSection('members', plainTrip, 'participant'), DEFAULT_SECTION);
  assert.equal(resolveSection('members', plainTrip, 'editor'), 'members');
});

// ── раскладка ────────────────────────────────────────────────────────────────

test('flush стоит ровно у секций, которые сами владеют своим скроллом', () => {
  const flush = SECTIONS.filter((s) => s.flush).map((s) => s.id);
  assert.deepEqual(flush, ['map', 'chat', 'edit']);
});

test('док прячут только чат и редактор, и у каждого НАЗВАНА причина', () => {
  const hiding = SECTIONS.filter((s) => s.hidesDock);
  assert.deepEqual(hiding.map((s) => s.id), ['chat', 'edit']);
  // Значение — ПРИЧИНА, а не true: у чата нижнюю кромку забрал композер, у
  // редактора раскладка под док вынесена отдельной задачей. `true` или пустая
  // строка означали бы «причину забыли», и следующий, кто придёт возвращать
  // док, не поймёт, какой из двух случаев он закрывает.
  const REASONS = new Set(['composer', 'pending-layout']);
  for (const s of hiding) {
    assert.equal(typeof s.hidesDock, 'string', `${s.id}: причина не строка`);
    assert.ok(REASONS.has(s.hidesDock), `${s.id}: незнакомая причина ${s.hidesDock}`);
    // Прячущая док секция обязана быть flush: док убирают ради того, чтобы
    // поверхность дошла до края, а падающее тело этот край отдаёт обратно.
    assert.equal(s.flush, true, `${s.id} прячет док, но не flush`);
  }
});

test('sectionById на незнакомом id отдаёт null, а не undefined-объект', () => {
  assert.equal(sectionById('нет-такого'), null);
  assert.equal(sectionById('overview').labelKey, 'trip_menu.overview');
});

// ── Фаза загрузки: что рисует рейл, пока ответа read-двери нет ────────────────
// У этого поведения тоже нет скриншота, а цена ошибки видна только глазом на
// живом трипе: меню, которое доцветает со сдвигом, и есть та «дёрганость», ради
// которой всё затевалось. Поэтому свойство пинится числами.

test('loadingSections: аддонных секций нет вовсе, ролевые — местом под пункт', () => {
  const all = [...loadingSections('lens'), ...loadingSections('manage')];
  for (const s of all) {
    assert.equal(!!s.addon, false, `${s.id}: аддонная секция не должна попадать в фазу загрузки`);
    assert.equal(s.pending, !!s.canAccess, `${s.id}: место держим ровно под ролевыми`);
  }
  // Живых (кликабельных с первого кадра) должно быть большинство — иначе смысла
  // рисовать рейл на загрузке нет и проще вернуть скелетон.
  const live = all.filter((s) => !s.pending);
  assert.ok(live.length >= all.length - live.length, `живых ${live.length} из ${all.length}`);
});

test('loadingSections: порядок — реестра, без пересортировки', () => {
  for (const group of ['lens', 'manage']) {
    const order = loadingSections(group).map((s) => s.id);
    const canon = SECTIONS.filter((s) => s.group === group && !s.addon).map((s) => s.id);
    assert.deepEqual(order, canon, group);
  }
});

// ★ Само свойство «меню не дёргается» в самом частом случае: владелец Free-трипа
// (аддоны у нового трипа выключены и требуют Pro). Позиция КАЖДОГО пункта в фазе
// загрузки обязана совпасть с его позицией после ответа — включая те, что были
// местом под пункт: место затем заполняется, а не вдвигается между живыми.
test('★ владелец Free-трипа: позиции пунктов до и после ответа совпадают', () => {
  const freeTrip = tripWith({});
  for (const group of ['lens', 'manage']) {
    const before = loadingSections(group).map((s) => s.id);
    const after = availableSections(freeTrip, 'owner', group).map((s) => s.id);
    assert.deepEqual(before, after, `${group}: меню сдвинулось бы`);
  }
});

// Обратный случай — цена решения, названная вслух: у трипа с включёнными
// аддонами пункты аддонов появляются после ответа и сдвигают тех, кто ниже.
// Держать под них место нельзя (у большинства трипов они выключены — место
// схлопнулось бы), поэтому сдвиг здесь принят осознанно, а не забыт.
test('трип с аддонами: аддонные пункты приходят после ответа', () => {
  const proTrip = tripWith({ budget: true, chat: true });
  const before = loadingSections('lens').map((s) => s.id);
  const after = availableSections(proTrip, 'owner', 'lens').map((s) => s.id);
  assert.deepEqual(after.filter((id) => !before.includes(id)), ['budget', 'chat']);
});
