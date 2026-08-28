/**
 * Скрим карточки обязан накрывать ИМЕННО те полосы, где стоит текст (TRIP-443).
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ. Дефект, который он сторожит, невидим обычными средствами:
 * если подложка сползёт с текста, скрим ПРИ ЭТОМ ЕСТЬ — картинка выглядит
 * осмысленно, гарды CSS сюда не смотрят (это SVG на бэке), а разница «читается
 * / не читается» проявляется только на светлом фоне и только на том формате,
 * который забыли открыть. Ровно так живой баг и приехал в прод: белые буквы на
 * произвольном фото, где ЛОТЕРЕЯ решала, видно их или нет.
 *
 * Полосы плавают по трём осям сразу — формат (story/post), число строк
 * заголовка (1 или 2) и раскладка `LAYOUTS`. Поэтому тест не проверяет
 * конкретные проценты (они разные и меняются вместе с дизайном), а спрашивает
 * координаты у ЕДИНСТВЕННОГО источника — самой раскладки — и требует
 * непрозрачности там, где по этой раскладке стоит текст.
 */
import { assert, assertAlmostEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { LAYOUTS, scrimGradient, type Layout } from './template.ts';

/** Непрозрачность градиента на доле высоты `off` — линейная интерполяция стопов. */
function alphaAt(stops: string, off: number): number {
  const pts = [...stops.matchAll(/offset="([\d.]+)" stop-color="rgba\(8,10,20,([\d.]+)\)"/g)]
    .map((m) => ({ o: Number(m[1]), a: Number(m[2]) }));
  assert(pts.length >= 2, 'градиент должен иметь стопы');
  if (off <= pts[0].o) return pts[0].a;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    if (off <= q.o) {
      if (q.o === p.o) return q.a;
      return p.a + ((q.a - p.a) * (off - p.o)) / (q.o - p.o);
    }
  }
  return pts[pts.length - 1].a;
}

/** Где по раскладке стоит текст: доли высоты кадра, которые обязаны быть закрыты. */
function textBands(L: Layout, titleLines: number): Record<string, number> {
  const lineH = Math.round(L.titleSize * 0.94);
  const routeBase = L.titleTop + (titleLines - 1) * lineH + L.routeGap;
  return {
    'верх заголовка': (L.titleTop - L.titleSize * 0.7) / L.h,
    'низ заголовка': (L.titleTop + (titleLines - 1) * lineH) / L.h,
    'строка городов': routeBase / L.h,
    'верх цифр': (L.stats.y - L.stats.numSize) / L.h,
    'подписи цифр': (L.stats.y + L.stats.labSize) / L.h,
    'бренд': L.brand.cy / L.h,
  };
}

// Порог выведён из контраста: белый текст на подложке rgba(8,10,20,a) поверх
// БЕЛОГО фона даёт ~4.5:1 при a=0.55. Ниже — текст на светлом фото пропадает.
const MIN_ALPHA = 0.55;

for (const format of ['story', 'post'] as const) {
  for (const titleLines of [1, 2]) {
    Deno.test(`${format}, заголовок в ${titleLines} стр.: подложка под КАЖДОЙ строкой текста`, () => {
      const L = LAYOUTS[format];
      const g = scrimGradient(L, titleLines);
      for (const [what, off] of Object.entries(textBands(L, titleLines))) {
        const a = alphaAt(g, off);
        assert(a >= MIN_ALPHA - 1e-9,
          `${what} (offset ${off.toFixed(3)}): непрозрачность ${a.toFixed(3)} < ${MIN_ALPHA} — текст ляжет на голое фото`);
      }
    });

    Deno.test(`${format}, заголовок в ${titleLines} стр.: середина кадра НЕ затемняется`, () => {
      const L = LAYOUTS[format];
      const g = scrimGradient(L, titleLines);
      // Центр окна карты: там текста нет, подложка только испортила бы фото.
      const winMid = (L.pola.top + L.pola.padT + L.pola.winH / 2) / L.h;
      assertAlmostEquals(alphaAt(g, winMid), 0, 1e-9,
        'над окном карты подложки быть не должно');
    });
  }
}

Deno.test('две строки заголовка опускают подложку вместе с маршрутом', () => {
  const L = LAYOUTS.story;
  const one = scrimGradient(L, 1);
  const two = scrimGradient(L, 2);
  const routeTwo = (L.titleTop + Math.round(L.titleSize * 0.94) + L.routeGap) / L.h;
  // На однострочной раскладке эта высота уже свободна, на двухстрочной — текст.
  assert(alphaAt(two, routeTwo) >= MIN_ALPHA - 1e-9, 'маршрут 2-й раскладки не закрыт');
  assert(alphaAt(one, routeTwo) < MIN_ALPHA,
    'подложка не следует за раскладкой: одна и та же для 1 и 2 строк');
});
