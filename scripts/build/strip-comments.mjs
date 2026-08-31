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
  const BLOCK = /<(script|style)\b/i;
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const cmtAt = rest.indexOf('<!--');
    const block = BLOCK.exec(rest);
    const blockAt = block ? block.index : -1;

    if (cmtAt === -1 && blockAt === -1) { out += rest; break; }

    // ПОРЯДОК ЗДЕСЬ НЕСУЩИЙ: комментарий разбирается ПЕРВЫМ, если он ближе.
    // Искать блоки в тексте, где комментарии ещё живы, значит принять
    // `<script>`, НАПИСАННЫЙ ВНУТРИ комментария, за начало настоящего блока —
    // и вынести наружу всё от него до следующего `</script>`, вместе с самим
    // комментарием. Ровно это и случилось: комментарий заставки объясняет,
    // почему она инлайном «а не `<link>`/`<script>`», и из-за этого упоминания
    // `index.html` возвращался из чистки байт в байт (11 029 → 11 029), а на
    // странице лежало полтора экрана русского текста.
    if (blockAt === -1 || (cmtAt !== -1 && cmtAt < blockAt)) {
      out += rest.slice(0, cmtAt);
      const end = rest.indexOf('-->', cmtAt + 4);
      i += end === -1 ? rest.length : end + 3;
      continue;
    }

    // Блок ближе — копируем его целиком, внутрь не заходим.
    out += rest.slice(0, blockAt);
    const close = new RegExp(`</${block[1]}\\s*>`, 'i').exec(rest.slice(blockAt));
    const blockEnd = close ? blockAt + close.index + close[0].length : rest.length;
    out += rest.slice(blockAt, blockEnd);
    i += blockEnd;
  }
  return collapse(out);
}

/** Схлопнуть дыры, оставшиеся от вырезанных блоков. */
function collapse(s) {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
