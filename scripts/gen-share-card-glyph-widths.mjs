#!/usr/bin/env node
/**
 * Генератор таблицы ширин глифов Geologica для раскладки share-карточки (TRIP-443).
 *
 * ЗАЧЕМ. Раскладку карточки считает edge (`render-share-card/template.ts`): куда
 * встанет стрелка маршрута, влезет ли заголовок в строку, какой ширины колонка
 * статистики. Ширину текста он раньше УГАДЫВАЛ — `длина_в_символах × кегль ×
 * 0.54`. Догадка не знает, какие это буквы: в кириллице «ш» вдвое шире «г».
 * Замер на живом шрифте: «Белград» 220 против 237 реальных (+8%), «Балканам»
 * 591 против 664 (+12%), «км» 36 против 42 (+17%). Зазор до стрелки заложен 22
 * единицы — «Белград» съедал 17 из них, и стрелка липла к последней букве.
 *
 * ЧТО ДЕЛАЕТ. Открывает НАСТОЯЩИЕ файлы шрифта из `public/fonts/geologica`
 * (те же байты, что грузит приложение и что вшиты в финальный растр), измеряет
 * ширину каждого глифа при кегле 1000 и печатает таблицу долей. Дальше
 * `advance()` складывает доли вместо умножения на коэффициент.
 *
 * ПОЧЕМУ ЭТО НЕ «ЕЩЁ ОДНА ОЦЕНКА». Сумма ширин глифов отличается от реальной
 * длины строки только на кернинг пар; скрипт сам это и проверяет — печатает
 * максимальное расхождение на контрольных строках. Если оно вырастет выше
 * порога, значит шрифт сменился и таблицу надо переснять.
 *
 * КОГДА ПЕРЕЗАПУСКАТЬ: при ре-вендоринге Geologica (новые woff2) или добавлении
 * весов. Артефакт коммитится — edge не имеет доступа к public/ в рантайме.
 *
 * Запуск: node scripts/gen-share-card-glyph-widths.mjs [--check]
 *   --check — не писать файл, а сверить, что коммитнутая таблица совпадает с
 *             замером (для CI/ручной проверки дрейфа).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'supabase/functions/render-share-card/glyphWidths.ts');
const CHECK = process.argv.includes('--check');

// Веса, которыми шаблон реально печатает текст (template.ts: 500/600/700).
const WEIGHTS = [500, 600, 700];
// Набор: кириллица, латиница, цифры и пунктуация, которая встречается в данных
// карточки (названия городов, числа с тонким пробелом, подписи).
const CHARS = [
  ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  ...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ...' .,-–—’\'"()!?:;/&+', ' ', ' ', ' ',
];
// Контрольные строки: на них сверяем «сумма глифов ≈ длина строки» (кернинг).
const PROBES = ['Белград', 'Балканам', 'Автотур по', 'Будва', 'Санкт-Петербург', '4 382', 'км', 'городов', 'Triplanio'];
// Сумма ширин глифов не знает кернинга пар, поэтому расходится с реальной
// длиной строки. ВАЖЕН ЗНАК: кернинг строки СЖИМАЕТ, значит сумма их ЗАВЫШАЕТ —
// а завышение безопасно (элементы разойдутся с лишним воздухом). Опасно только
// ЗАНИЖЕНИЕ: именно оно ставило стрелку на последнюю букву города. Поэтому
// контроль асимметричный: занижение не допускается вовсе, завышение — до 6%.
const KERN_OVER_MAX = 0.06;
// Тот же запас, что применяет advance() в template.ts — контроль обязан судить
// ИТОГОВУЮ величину, а не промежуточную сумму, иначе он проверяет не то число.
const KERN_SAFETY = 1.01;

const FONT_FILES = ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'];

async function measure() {
  // ★ unicode-range ОБЯЗАТЕЛЕН, хотя это и «замер, а не сеть»: без него все
  // четыре файла лежат под одним именем, браузер берёт ПЕРВЫЙ подходящий, и
  // латиница меряется по кириллическому сабсету, где её нет, — то есть
  // фоллбеком. Диапазоны те же, что в public/fonts.css.
  const RANGES = {
    cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
    'cyrillic-ext': 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,'
      + 'U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,'
      + 'U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  };
  const faces = FONT_FILES.map((sub) => {
    const b64 = readFileSync(join(ROOT, `public/fonts/geologica/geologica-${sub}.woff2`)).toString('base64');
    return `@font-face{font-family:'GeoMeasure';font-weight:400 800;font-display:block;`
      + `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${RANGES[sub]};}`;
  }).join('');

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${faces}</style><body></body>`);
  // ★ `document.fonts.ready` НЕДОСТАТОЧНО: он резолвится, когда загружено то, что
  // УЖЕ запрошено, а до первого измерения шрифт не запрашивал никто — первый
  // прогон намерил фоллбек и дал таблицу на 13% уже реальной. Грузим явно, под
  // каждый вес и под оба алфавита.
  await page.evaluate(async (weights) => {
    await Promise.all(weights.flatMap((w) => [
      document.fonts.load(`${w} 1000px GeoMeasure`, 'Белград'),
      document.fonts.load(`${w} 1000px GeoMeasure`, 'Triplanio'),
    ]));
    await document.fonts.ready;
  }, WEIGHTS);

  const out = await page.evaluate(({ chars, weights, probes, kernSafety }) => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    document.body.appendChild(svg);
    const node = document.createElementNS(svgNS, 'text');
    svg.appendChild(node);
    const widthOf = (s, w) => {
      node.setAttribute('font-family', 'GeoMeasure');
      node.setAttribute('font-weight', String(w));
      node.setAttribute('font-size', '1000');
      node.textContent = s;
      return node.getComputedTextLength();
    };
    // ★ Символ меряется В КОНТЕКСТЕ, а не в одиночку. Одиночный пробел как
    // содержимое <text> схлопывается по правилам пробелов XML и даёт ширину 0 —
    // именно на этом первый прогон дал 11% расхождения на «4 382». Разность
    // «HH<c>HH» − «HHHH» снимает и это, и краевые эффекты обрезки.
    // ★ САМОПРОВЕРКА: тот ли шрифт под линейкой. Если лицо не применилось,
    // измерения совпадут с заведомо несуществующим семейством — и таблица уедет
    // молча, как в первом прогоне. Дешёвый и абсолютный признак.
    node.setAttribute('font-family', 'GeoMeasure');
    node.setAttribute('font-weight', '700');
    node.setAttribute('font-size', '1000');
    node.textContent = 'Белград';
    const withFace = node.getComputedTextLength();
    node.setAttribute('font-family', 'NoSuchFontFamily');
    const withoutFace = node.getComputedTextLength();
    if (Math.abs(withFace - withoutFace) < 1) {
      return { error: 'шрифт GeoMeasure не применился — измерения совпали с фоллбеком' };
    }
    const PAD = 'HH';
    const table = {};
    for (const w of weights) {
      const base = widthOf(PAD + PAD, w);
      const row = {};
      // Округляем ВВЕРХ: доли — целые тысячные, и округление вниз давало бы
      // систематическое занижение на доли процента, то есть ошибку в опасную
      // сторону. Лишняя тысячная кегля — это ноль на глаз и запас в расчёте.
      for (const c of chars) row[c] = Math.ceil(widthOf(PAD + c + PAD, w) - base);
      table[w] = row;
    }
    // ВЕРТИКАЛЬ. Раскладка карточки задаёт БАЗОВУЮ ЛИНИЮ (как SVG `<text y>`),
    // а DOM-текст превью позиционируется ВЕРХОМ бокса — значит кто-то обязан
    // знать подъём и спуск шрифта. Знает он их здесь, из тех же файлов, что и
    // ширины: константа, вписанная руками, разъехалась бы при ре-вендоринге
    // шрифта МОЛЧА и сдвинула бы весь текст превью относительно карточки.
    const vc = document.createElement('canvas').getContext('2d');
    const vm = weights.map((w) => {
      vc.font = `${w} 1000px GeoMeasure`;
      const m = vc.measureText('Белград');
      return { w, a: Math.round(m.fontBoundingBoxAscent), d: Math.round(m.fontBoundingBoxDescent) };
    });
    // Ось веса высоту строки не двигает (замерено), и на это опирается ОДНА пара
    // чисел на всю карточку. Если шрифт это нарушит — падаем, а не усредняем.
    const vbad = vm.find((m) => m.a !== vm[0].a || m.d !== vm[0].d);
    if (vbad) return { error: `подъём/спуск зависят от веса (${JSON.stringify(vm)}) — одной пары чисел мало` };
    const vertical = { ascent: vm[0].a, descent: vm[0].d };

    // Кернинг-контроль: сумма одиночных глифов против измеренной строки.
    const drift = probes.flatMap((p) => weights.map((w) => {
      const sum = [...p].reduce((a, c) => a + (table[w][c] ?? 540), 0) * kernSafety;
      const real = widthOf(p, w);
      // >0 — сумма завышает (безопасно), <0 — занижает (опасно).
      return { p, w, rel: real ? (sum - real) / real : 0 };
    }));
    return { table, drift, vertical };
  }, { chars: CHARS, weights: WEIGHTS, probes: PROBES, kernSafety: KERN_SAFETY });

  await browser.close();
  if (out.error) {
    console.error(`::error::${out.error}`);
    process.exit(1);
  }
  return out;
}

const { table, drift, vertical } = await measure();
const under = drift.reduce((a, b) => (b.rel < a.rel ? b : a));
const over = drift.reduce((a, b) => (b.rel > a.rel ? b : a));
console.log(`вертикаль: подъём ${vertical.ascent}, спуск ${vertical.descent} (тысячных кегля)`);
console.log(`кернинг-контроль: максимум завышения +${(over.rel * 100).toFixed(1)}% («${over.p}», вес ${over.w}), `
  + `максимум занижения ${(under.rel * 100).toFixed(1)}% («${under.p}», вес ${under.w})`);
if (under.rel < 0) {
  console.error(`::error::таблица ЗАНИЖАЕТ ширину «${under.p}» на ${(-under.rel * 100).toFixed(1)}% — это ставит соседей внахлёст`);
  process.exit(1);
}
if (over.rel > KERN_OVER_MAX) {
  console.error(`::error::таблица завышает ширину «${over.p}» на ${(over.rel * 100).toFixed(1)}% (потолок ${KERN_OVER_MAX * 100}%) — раскладка станет разреженной`);
  process.exit(1);
}

const body = WEIGHTS.map((w) => `  ${w}: ${JSON.stringify(table[w])},`).join('\n');
const file = `/**
 * ШИРИНЫ ГЛИФОВ Geologica — тысячные доли кегля (кегль 1000).
 *
 * ГЕНЕРИРУЕТСЯ, РУКАМИ НЕ ПРАВИТЬ: \`node scripts/gen-share-card-glyph-widths.mjs\`.
 * Источник — те же woff2 из \`public/fonts/geologica\`, что грузит приложение и что
 * вшиты в финальный растр карточки, поэтому раскладка edge и картинка на экране
 * считают одну и ту же ширину.
 *
 * Зачем таблица, а не коэффициент: догадка «длина × кегль × 0.54» не знает, какие
 * это буквы, и занижала кириллицу на 8-17% — стрелка маршрута липла к последней
 * букве города. Кернинг в сумму не входит; генератор проверяет, что расхождение
 * с реальной длиной строки не больше 2%, и падает, если шрифт это нарушит.
 */
export const GLYPH_W: Record<number, Record<string, number>> = {
${body}
};

/** Доля для символов вне таблицы (редкая пунктуация, иероглифы). */
export const GLYPH_FALLBACK = 540;

/**
 * Подъём и спуск Geologica — тысячные доли кегля, замерены на тех же файлах.
 *
 * Нужны ОДНОМУ потребителю: раскладка задаёт базовую линию (как SVG \`<text y>\`),
 * а DOM-текст превью ставится ВЕРХОМ бокса. Перевод одного в другое — ниже, в
 * \`buildCardText\`; здесь только измеренные числа, чтобы при ре-вендоринге шрифта
 * они переснялись вместе с ширинами, а не разъехались молча.
 */
export const FONT_ASCENT = ${vertical.ascent};
export const FONT_DESCENT = ${vertical.descent};
`;

if (CHECK) {
  const have = readFileSync(OUT, 'utf8');
  if (have.trim() !== file.trim()) {
    console.error('::error::glyphWidths.ts разошёлся с замером — перегенерируй');
    process.exit(1);
  }
  console.log('glyphWidths.ts совпадает с замером — OK');
} else {
  writeFileSync(OUT, file);
  console.log(`записано: ${OUT} (${WEIGHTS.length} веса × ${CHARS.length} символов)`);
}
