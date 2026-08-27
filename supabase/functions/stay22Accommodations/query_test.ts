import { assertEquals } from 'jsr:@std/assert';
import { buildStay22Query, hasBox, hasPoint, locationError } from './query.ts';

// Тело, которое клиент шлёт СЕГОДНЯ (`buildStay22Params` во фронте: координаты
// посещения, даты, валюта трипа, локаль, страница пула по 100).
const TODAY = {
  lat: 34.05223, lng: -118.24368,
  checkin: '2026-09-02', checkout: '2026-09-06',
  currency: 'EUR', lang: 'ru', page: 1, pageSize: 100,
};

// Точечный режим — половина того, что клиент шлёт сегодня, и появление коробки
// не имело права его тронуть: строка обязана остаться той же ДО ЗНАКА, включая
// порядок параметров. Строка ниже снята с рабочего прода (версия функции 61) и
// вписана СЫРЬЁМ намеренно: сравнение с пересобранным ожиданием проверяло бы код
// кодом.
Deno.test('без коробки строка запроса не изменилась ни на знак', () => {
  assertEquals(
    buildStay22Query(TODAY).toString(),
    'pageSize=100&page=1&aid=triplanio&campaign=fork_api_search&cluster=false&adults=2&children=0'
    + '&lat=34.05223&lng=-118.24368&checkin=2026-09-02&checkout=2026-09-06&currency=EUR&lang=ru',
  );
});

Deno.test('коробка уходит четырьмя углами и вытесняет точку', () => {
  const q = buildStay22Query({ ...TODAY, swlat: 33.9, swlng: -118.55, nelat: 34.2, nelng: -118.1 });
  assertEquals(q.get('nelat'), '34.2');
  assertEquals(q.get('nelng'), '-118.1');
  assertEquals(q.get('swlat'), '33.9');
  assertEquals(q.get('swlng'), '-118.55');
  // Точка и коробка вместе — Stay22 берёт одно гео; шлём коробку и НЕ шлём точку,
  // иначе какой из двух он выберет, решает не наш код.
  assertEquals(q.get('lat'), null);
  assertEquals(q.get('lng'), null);
});

Deno.test('коробка засчитывается ТОЛЬКО целиком: три угла — это не коробка', () => {
  const three = { ...TODAY, swlat: 33.9, swlng: -118.55, nelat: 34.2 };
  assertEquals(hasBox(three), false);
  const q = buildStay22Query(three);
  assertEquals(q.get('lat'), '34.05223'); // молча откатились на точку
  assertEquals(q.get('nelat'), null);     // и обрывка коробки не отправили
});

Deno.test('координата 0 — валидная координата, а не «не задано»', () => {
  // Гвинейский залив: lat=0 / lng=0 ложно-пусты при проверке на truthy.
  assertEquals(hasPoint({ lat: 0, lng: 0 }), true);
  assertEquals(locationError({ lat: 0, lng: 0 }), null);
  assertEquals(hasBox({ nelat: 0, nelng: 0, swlat: 0, swlng: 0 }), true);
});

Deno.test('без гео вовсе — внятная ошибка, а не тихий запрос в никуда', () => {
  assertEquals(locationError({}), 'lat/lng or the full nelat/nelng/swlat/swlng box is required');
  assertEquals(locationError({ lat: 34.05 }), 'lat/lng or the full nelat/nelng/swlat/swlng box is required');
  assertEquals(locationError({ ...TODAY }), null);
});

Deno.test('pageSize зажат в 1..100, page не опускается ниже 1', () => {
  assertEquals(buildStay22Query({ ...TODAY, pageSize: 500 }).get('pageSize'), '100');
  assertEquals(buildStay22Query({ ...TODAY, pageSize: 0 }).get('pageSize'), '10'); // 0 ложно-пуст → дефолт
  // А вот -5 truthy, поэтому до дефолта не доходит и упирается в нижний зажим.
  // Странно, но это поведение ДО правки, и менять его тут нельзя: правка инертная.
  assertEquals(buildStay22Query({ ...TODAY, pageSize: -5 }).get('pageSize'), '1');
  assertEquals(buildStay22Query({ ...TODAY, page: 0 }).get('page'), '1');
  assertEquals(buildStay22Query({ ...TODAY, page: 7 }).get('page'), '7');
});

Deno.test('необязательные фильтры молчат, пока их не задали', () => {
  const q = buildStay22Query(TODAY);
  assertEquals(q.get('rooms'), null);
  assertEquals(q.get('provider'), null);
  assertEquals(q.get('radius'), null);
  const q2 = buildStay22Query({ ...TODAY, rooms: 2, provider: 'booking', radius: 5000 });
  assertEquals(q2.get('rooms'), '2');
  assertEquals(q2.get('provider'), 'booking');
  assertEquals(q2.get('radius'), '5000');
});
