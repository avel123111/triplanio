// Комментарии не уезжают в браузер.
//
// ПОЧЕМУ ЭТО НУЖНО ОТДЕЛЬНЫМ ШАГОМ. Vite вырезает комментарии из всего, что
// проходит через сборку, но `public/` он копирует БАЙТ В БАЙТ — а именно там
// лежит `site.css`, единственная таблица стилей неавторизованной зоны. Замер до
// этого шага: `site.css` 373 КБ, из них 187 КБ комментариев (62%), 887 из них
// по-русски; `index.html` — 56% комментариев. Всё это отдавалось каждому
// посетителю и читалось в «просмотре исходного кода».
//
// Вырезаем НА СБОРКЕ, а не в исходнике, потому что комментарии там несущие:
// 778 из 920 в `site.css` содержат маркеры гардов (`visual-diff-exempt`,
// `prefix-exempt`, `orphan-exempt`…), которые CI читает из ИСХОДНИКА. Удалить
// их в файле — сломать гейт; оставить в сборке — отдать наружу.
//
// Комментарий заменяется ПРОБЕЛОМ, а не пустотой: в CSS он разделяет токены, и
// `a/*x*/b` без пробела склеился бы в `ab`.

/** Границы, внутри которых искать комментарии нельзя (строки и т.п.). */
const isQuote = (c) => c === '"' || c === "'";

/**
 * Убрать блочные комментарии из CSS, не тронув строковые литералы.
 * @param {string} src
 * @returns {string}
 */
export function stripCss(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (isQuote(c)) {
      const q = c;
      out += c;
      i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i += 1; }
        if (i < src.length) { out += src[i]; i += 1; }
      }
      out += src[i] ?? '';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return collapse(out);
}

/**
 * Убрать `<!-- … -->` из HTML, не заходя внутрь `<script>` и `<style>`:
 * там `<!--` может быть частью кода или данных, а не разметки.
 * @param {string} src
 * @returns {string}
 */
export function stripHtml(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = /<(script|style)\b/i.exec(src.slice(i));
    const blockAt = open ? i + open.index : -1;
    const chunkEnd = blockAt === -1 ? src.length : blockAt;
    out += src.slice(i, chunkEnd).replace(/<!--[\s\S]*?-->/g, '');
    if (blockAt === -1) break;
    const closeRe = new RegExp(`</${open[1]}\\s*>`, 'i');
    const rest = src.slice(blockAt);
    const close = closeRe.exec(rest);
    const blockEnd = close ? blockAt + close.index + close[0].length : src.length;
    out += src.slice(blockAt, blockEnd);
    i = blockEnd;
  }
  return collapse(out);
}

/** Схлопнуть дыры, оставшиеся от вырезанных блоков. */
function collapse(s) {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
