// Гейт для `plannerDraft.js` (TRIP-505).
//
// Два правила, и оба ломаются МОЛЧА — то есть глазами их не поймать, а гарда у
// них нет:
//   1. ПРОТУХАНИЕ. Ошибись предикат в сторону «свежий» — человек, вернувшийся
//      через неделю, получит чужой на ощущение маршрут. Ошибись в сторону
//      «протух» — работа выброшена молча.
//   2. ПЕРЕЕЗД ГОСТЬ → ВОШЕДШИЙ. Не сработал — человек зарегистрировался и не
//      нашёл своего маршрута. Сработал лишний раз — вошедшему подставился
//      чужой брошенный черновик.
// Оба стоят конверсии, оба невидимы. Отсюда чистые функции и этот файл.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DRAFT_TTL_MS, GUEST_ID,
  draftKey, parseDraft, serializeDraft, HANDOFF_TTL_MS,
  readDraft, writeDraft, clearDraft, markHandoff, takeHandoff, hasPendingHandoff,
} from './plannerDraft.js';

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);
const DRAFT = { step: 'cities', nodes: [{ id: 'a', city_name: 'Рим', nights: 3 }], startDate: '2026-10-01' };

/** Подменяет глобальный localStorage на минимальную рабочую копию. */
function withStorage(run) {
  const map = new Map();
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    },
  });
  try {
    return run(map);
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  }
}

/** Хранилище, которое бросает на всём, — приватный режим / отключённые куки. */
function withBrokenStorage(run) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const boom = () => { throw new Error('storage disabled'); };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: boom, setItem: boom, removeItem: boom },
  });
  try {
    return run();
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  }
}

// ─── Ключ ────────────────────────────────────────────────────────────────────

test('ключ разделяет владельца и метод', () => {
  assert.equal(draftKey('u1', 'manual'), 'triplanio-planner-v4-manual-u1');
  assert.equal(draftKey('u1', 'ai'), 'triplanio-planner-v4-ai-u1');
  // Гость — тот же ключ при любом «пустом» владельце: null / undefined / ''.
  const guest = draftKey(GUEST_ID, 'manual');
  assert.equal(draftKey(null, 'manual'), guest);
  assert.equal(draftKey(undefined, 'manual'), guest);
  assert.equal(draftKey('', 'manual'), guest);
  // Ручной и AI не затекают друг в друга, гость и вошедший — тоже.
  assert.notEqual(draftKey('u1', 'manual'), draftKey('u1', 'ai'));
  assert.notEqual(draftKey('u1', 'manual'), guest);
});

// ─── Протухание ──────────────────────────────────────────────────────────────

test('черновик живёт ровно TTL и ни секундой дольше', () => {
  const raw = serializeDraft(DRAFT, NOW);
  assert.deepEqual(parseDraft(raw, NOW)?.draft, DRAFT, 'свежий должен читаться');
  assert.deepEqual(parseDraft(raw, NOW + DRAFT_TTL_MS)?.draft, DRAFT, 'ровно на границе ещё жив');
  assert.equal(parseDraft(raw, NOW + DRAFT_TTL_MS + 1), null, 'на миллисекунду позже — протух');
});

test('метка времени не переезжает в сам черновик', () => {
  // Иначе `ts` и `handoff` уехали бы в состояние планировщика как поля шага.
  const out = parseDraft(serializeDraft(DRAFT, NOW), NOW)?.draft;
  assert.deepEqual(Object.keys(out).sort(), Object.keys(DRAFT).sort());
});

test('мусор и странные формы — это null, а не исключение', () => {
  for (const raw of [null, undefined, '', 'не json', '{битый', 'null', '42', '"строка"', '[1,2]']) {
    assert.equal(parseDraft(raw, NOW), null, `${JSON.stringify(raw)} обязан читаться как «черновика нет»`);
  }
});

test('черновик БЕЗ метки времени считается протухшим', () => {
  // Он пришёл из формы, которой больше нет. «Метки нет, значит свежий» — ровно
  // та ошибка, из-за которой протухшее выглядит как новое.
  assert.equal(parseDraft(JSON.stringify(DRAFT), NOW), null);
  assert.equal(parseDraft(JSON.stringify({ ...DRAFT, ts: 'вчера' }), NOW), null);
  assert.equal(parseDraft(JSON.stringify({ ...DRAFT, ts: null }), NOW), null);
});

test('черновик из будущего отдаётся, а не выбрасывается', () => {
  // Часы уехали назад (сменили таймзону, поправили время). Выбросить работу
  // человека из-за перевода часов хуже, чем показать её.
  const raw = serializeDraft(DRAFT, NOW + 60_000);
  assert.deepEqual(parseDraft(raw, NOW)?.draft, DRAFT);
});

// ─── Оболочка ────────────────────────────────────────────────────────────────

test('запись → чтение → снос', () => withStorage(() => {
  writeDraft('u1', 'manual', DRAFT, NOW);
  assert.deepEqual(readDraft('u1', 'manual', NOW), DRAFT);
  assert.equal(readDraft('u2', 'manual', NOW), null, 'чужой черновик не читается');
  assert.equal(readDraft('u1', 'ai', NOW), null, 'черновик другого метода не читается');
  assert.equal(readDraft('u1', 'manual', NOW + DRAFT_TTL_MS + 1), null, 'протухший не читается');
  clearDraft('u1', 'manual');
  assert.equal(readDraft('u1', 'manual', NOW), null);
}));

test('отказавшее хранилище не роняет экран', () => withBrokenStorage(() => {
  // Приватный режим бросает на КАЖДОМ обращении. Черновик — удобство, и его
  // отказ не имеет права стать крахом планировщика.
  assert.doesNotThrow(() => writeDraft('u1', 'manual', DRAFT, NOW));
  assert.doesNotThrow(() => clearDraft('u1', 'manual'));
  assert.doesNotThrow(() => markHandoff('manual', DRAFT, NOW));
  assert.equal(readDraft('u1', 'manual', NOW), null);
  assert.equal(takeHandoff('u1', 'manual', NOW), null);
}));

// ─── Переезд гость → вошедший ────────────────────────────────────────────────

test('переданный черновик переезжает под ключ вошедшего, гостевой сносится', () => withStorage(() => {
  markHandoff('manual', DRAFT, NOW);
  assert.deepEqual(takeHandoff('u1', 'manual', NOW), DRAFT, 'переезд не состоялся');
  assert.deepEqual(readDraft('u1', 'manual', NOW), DRAFT, 'черновик не лёг под ключ вошедшего');
  assert.equal(readDraft(GUEST_ID, 'manual', NOW), null, 'гостевой черновик остался лежать');
}));

test('переезд идемпотентен: повтор ничего не делает', () => withStorage(() => {
  markHandoff('manual', DRAFT, NOW);
  takeHandoff('u1', 'manual', NOW);
  // StrictMode монтирует эффекты дважды — второй заход обязан быть пустым.
  assert.equal(takeHandoff('u1', 'manual', NOW), null);
  assert.deepEqual(readDraft('u1', 'manual', NOW), DRAFT, 'повтор не должен стирать уже переехавшее');
}));

test('★ гостевой черновик БЕЗ метки передачи не забирается', () => withStorage((map) => {
  // Несущее. Без этого правила брошенный кем-то гостевой маршрут (общий
  // компьютер, своя же прошлая сессия) молча подставился бы человеку, который
  // его не составлял, при КАЖДОМ открытии планировщика.
  writeDraft(GUEST_ID, 'manual', DRAFT, NOW);
  assert.equal(takeHandoff('u1', 'manual', NOW), null, 'забрали черновик без метки передачи');
  assert.deepEqual(readDraft(GUEST_ID, 'manual', NOW), DRAFT, 'чужую работу нельзя и сносить тоже');
  assert.equal(readDraft('u1', 'manual', NOW), null);
  assert.ok(map.has(draftKey(GUEST_ID, 'manual')));
}));

test('протухший переданный черновик не забирается', () => withStorage(() => {
  markHandoff('manual', DRAFT, NOW);
  assert.equal(takeHandoff('u1', 'manual', NOW + DRAFT_TTL_MS + 1), null);
}));

test('переданный черновик побеждает свой прежний', () => withStorage(() => {
  // Под ключом вошедшего могла лежать заброшенная вчера попытка; пришёл он
  // дописывать ТОТ маршрут, который только что составил гостем.
  const old = { step: 'home', nodes: [], startDate: '2026-01-01' };
  writeDraft('u1', 'manual', old, NOW);
  markHandoff('manual', DRAFT, NOW);
  assert.deepEqual(takeHandoff('u1', 'manual', NOW), DRAFT);
  assert.deepEqual(readDraft('u1', 'manual', NOW), DRAFT);
}));

test('переезжать некуда — гостевой черновик не трогаем', () => withStorage(() => {
  markHandoff('manual', DRAFT, NOW);
  for (const who of [null, undefined, '', GUEST_ID]) {
    assert.equal(takeHandoff(/** @type {any} */ (who), 'manual', NOW), null, `владелец ${JSON.stringify(who)}`);
  }
  assert.deepEqual(readDraft(GUEST_ID, 'manual', NOW), DRAFT, 'гостевой черновик пропал в никуда');
}));

test('★ планировщик забирает переданный черновик ДО чтения своего', () => {
  // Единственное, чего чистые функции выше доказать не могут, — ПОРЯДОК их
  // вызова в самом экране. Наоборот (`readDraft` первым) прочитало бы пустоту:
  // под ключом вошедшего ещё ничего нет, — и следующий же кадр записал бы эту
  // пустоту поверх переехавшего черновика. Человек зарегистрировался бы и не
  // нашёл своего маршрута, при этом все пятнадцать проверок выше остались бы
  // зелёными. Тот же приём, каким `routePaths.test.js` пинит порядок веток в
  // `App.jsx`: инвариант, который живёт в расположении кода, читается из кода.
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'pages', 'ManualPlanner.jsx'), 'utf8');
  assert.match(
    src,
    /takeHandoff\([^)]*\)[\s\S]{0,200}?\|\|\s*readDraft\(/,
    'порядок «сначала забрать переданное, потом читать своё» нарушен — черновик гостя потеряется молча',
  );

  /* ★ И ВЕРНУВШИЙСЯ ПОПАДАЕТ НА ШАГ СОХРАНЕНИЯ. Он ушёл, УЖЕ нажав «Сохранить
     трип»; верни его эффект на ту же ступень — он увидел бы пройденный экран с
     кнопкой «Дальше», то есть два нажатия после регистрации вместо нуля. Ровно
     то «нажмите ещё раз», ради отсутствия которого перехват и поставлен после
     шага 3, — и заметить это можно только пройдя весь путь с настоящей
     регистрацией, поэтому правило пинится здесь. */
  assert.match(
    src,
    /if\s*\(handed\)\s*setStep\('review'\)/,
    'вернувшийся после регистрации больше не попадает на шаг сохранения — ему придётся жать «Дальше» по уже пройденному шагу',
  );
});

test('«маршрут ждёт» видит только ПОМЕЧЕННЫЙ и живой черновик', () => withStorage(() => {
  // На этом предикате стоит подпись экрана входа («маршрут уже собран — войдите,
  // и он сохранится»). Соври он — человеку обещают сохранить то, чего нет.
  assert.equal(hasPendingHandoff('manual', NOW), false, 'пусто → обещать нечего');

  writeDraft(GUEST_ID, 'manual', DRAFT, NOW);
  assert.equal(hasPendingHandoff('manual', NOW), false, 'черновик без метки — человек не просил его сохранять');

  markHandoff('manual', DRAFT, NOW);
  assert.equal(hasPendingHandoff('manual', NOW), true);
  assert.equal(hasPendingHandoff('ai', NOW), false, 'метод чужой');
  assert.equal(hasPendingHandoff('manual', NOW + DRAFT_TTL_MS + 1), false, 'протухший больше не ждёт');

  // Только смотрит: после проверки черновик на месте и его ещё можно забрать.
  assert.deepEqual(takeHandoff('u1', 'manual', NOW), DRAFT, 'предикат съел черновик');
}));

test('передача по методу раздельная', () => withStorage(() => {
  markHandoff('manual', DRAFT, NOW);
  assert.equal(takeHandoff('u1', 'ai', NOW), null, 'AI забрал ручной черновик');
  assert.deepEqual(takeHandoff('u1', 'manual', NOW), DRAFT);
}));

test('★★★ обычная запись НЕ стирает метку передачи — иначе вернувшийся получит пустой планировщик', () => withStorage(() => {
  // Метку ставит один момент (уход на регистрацию), а пишет черновик эффект
  // персистенции — на каждое изменение состояния, ТЕМ ЖЕ ключом. Стоит одной
  // поздней правке доехать между нажатием и уходом со страницы (обновились
  // города от `resolveCities`, пересчиталась цепочка дат) — и метка снята, а
  // человек после регистрации не находит своего маршрута. Обе записи валидны
  // сами по себе: ни гард, ни глаз этого не видят.
  const now = Date.now();
  markHandoff('manual', { step: 'cities', nodes: [1] }, now);
  writeDraft(GUEST_ID, 'manual', { step: 'cities', nodes: [1, 2] }, now);
  assert.equal(hasPendingHandoff('manual', now), true, 'обычная запись сняла метку передачи');
  // И метку по-прежнему ТРАТИТ только получатель.
  assert.deepEqual(takeHandoff('u1', 'manual', now), { step: 'cities', nodes: [1, 2] },
    'переезд не отдал последнюю версию черновика');
  assert.equal(hasPendingHandoff('manual', now), false, 'метка осталась после получения');
  // А своему черновику вошедшего метка не липнет: её там никто не ставил.
  writeDraft('u1', 'manual', { step: 'review' }, now);
  assert.equal(takeHandoff('u2', 'manual', now), null);
}));


// ── окно метки передачи ──────────────────────────────────────────────────────
// Метка описывает ПЕРЕХОД («иду регистрироваться»), а не черновик, поэтому у
// неё своё окно. Живи она сутки — брошенная регистрация оставляла бы её
// взведённой на весь день, и следующий вошедший в этом браузере получил бы
// чужой маршрут ПОВЕРХ своего.
//
// ⚠️ МУТАЦИИ, КОТОРЫМИ ЭТИ ТРИ ПРОВЕРЕНЫ КРАСНЫМИ: вернуть `handoff: true` без
// времени — падает «протухает»; в `writeDraft` передавать `now` вместо
// сохранённой отметки — падает «правка черновика окно НЕ продлевает».

test('★★★ метка передачи протухает раньше черновика — брошенная регистрация не отдаёт маршрут чужому', () => {
  withStorage(() => {
    markHandoff('manual', DRAFT, NOW);
    assert.equal(hasPendingHandoff('manual', NOW + HANDOFF_TTL_MS), true, 'ровно на границе ещё ждёт');
    assert.equal(hasPendingHandoff('manual', NOW + HANDOFF_TTL_MS + 1), false, 'на миллисекунду позже — нет');
    assert.equal(takeHandoff('u1', 'manual', NOW + HANDOFF_TTL_MS + 1), null,
      'протухшая метка обязана не отдавать черновик');
  });
});

test('★★ правка черновика окно метки НЕ продлевает — иначе оно перестаёт быть окном', () => {
  withStorage(() => {
    markHandoff('manual', DRAFT, NOW);
    // Гость вернулся и правит маршрут спустя полчаса: черновик свежеет, метка нет.
    writeDraft(null, 'manual', { ...DRAFT, tripTitle: 'ещё' }, NOW + HANDOFF_TTL_MS / 2);
    assert.equal(hasPendingHandoff('manual', NOW + HANDOFF_TTL_MS + 1), false,
      'отметка метки обязана остаться исходной');
    assert.equal(readDraft(null, 'manual', NOW + HANDOFF_TTL_MS + 1)?.tripTitle, 'ещё',
      'сам черновик при этом жив — протухла только метка');
  });
});

test('★ старая форма метки (`handoff: true`, без времени) читается как «метки нет»', () => {
  assert.equal(parseDraft(JSON.stringify({ ...DRAFT, ts: NOW, handoff: true }), NOW)?.handoff, false);
});
