// Гард DOM-операций от переводчиков и расширений (TRIP-515).
//
// Встроенные переводчики Chrome/Safari И расширения (Google Translate, DeepL,
// Grammarly, менеджеры паролей, блокировщики) УДАЛЯЮТ наши текстовые узлы и
// вставляют вместо них свои внутри <font>/<span>. React продолжает держать
// ссылку на старый узел; следующая мутация рядом с ним — insertBefore (спиннер
// перед подписью), removeChild (размонтирование) — бросает NotFoundError, и
// падает всё приложение (TRIPLANIO-3A).
//
// translate="no" (index.html) глушит ВСТРОЕННЫЕ переводчики. Расширения его
// игнорируют — поэтому здесь мы делаем три мутирующие DOM-операции НЕбросающими,
// когда узел уже переусыновлён: если узел, который обязан быть ребёнком `this`,
// им не является, нативный вызов НЕ зовём и возвращаем узел вместо исключения.
// Операция React в этот кадр становится no-op; подпись может залипнуть (отдельный
// симптом, разметкой не лечится), но приложение остаётся живым. Это устоявшийся
// воркэраунд связки React + переводчик.
//
// Предикат ЧИСТЫЙ и юнит-тестируется на фейках (в `node --test` нет DOM);
// установка — тонкая браузерная обвязка. Репорт — РАЗ НА СЕССИЮ на операцию:
// Sentry получает число сессий с мутирующим DOM без потопа.

/**
 * Пропустить нативную мутацию, потому что опорный узел — не наш ребёнок?
 *
 * `parent` — узел, на котором вызвана операция (`this`). `refNode` — узел,
 * который для этой операции ОБЯЗАН уже быть ребёнком `parent`:
 *   • insertBefore(new, ref) → ref (2-й аргумент);
 *   • removeChild(child)     → child (1-й аргумент);
 *   • replaceChild(new, old) → old (2-й аргумент).
 * Пустой `refNode` (null/undefined) → пусть решает нативный вызов (семантика
 * append / его собственный TypeError), поэтому возвращаем false.
 *
 * @param {Node} parent
 * @param {Node|null|undefined} refNode
 * @returns {boolean}
 */
export function shouldSkip(parent, refNode) {
  return !!refNode && refNode.parentNode !== parent;
}

let installed = false;

/**
 * Установить гард на Node.prototype. Идемпотентно; no-op вне браузера (нет Node).
 * `onSkip(op)` вызывается РАЗ НА СЕССИЮ на каждую операцию — сюда вешается
 * Sentry-репорт из main.jsx (модуль сам Sentry не импортирует, чтобы чистый
 * предикат оставался импортируемым в node без алиасов `@/`).
 *
 * @param {(op: 'insertBefore'|'removeChild'|'replaceChild') => void} [onSkip]
 */
export function installDomGuard(onSkip) {
  if (installed) return;
  if (typeof Node === 'undefined' || !Node.prototype) return;
  installed = true;

  const P = Node.prototype;
  const rawInsert = P.insertBefore;
  const rawRemove = P.removeChild;
  const rawReplace = P.replaceChild;

  const reported = /** @type {Set<string>} */ (new Set());
  const report = (op) => {
    if (reported.has(op)) return;
    reported.add(op);
    try { onSkip?.(op); } catch { /* репорт не должен ронять гард */ }
  };

  P.insertBefore = function (newNode, refNode) {
    if (shouldSkip(this, refNode)) { report('insertBefore'); return newNode; }
    return rawInsert.call(this, newNode, refNode);
  };
  P.removeChild = function (child) {
    if (shouldSkip(this, child)) { report('removeChild'); return child; }
    return rawRemove.call(this, child);
  };
  P.replaceChild = function (newChild, oldChild) {
    if (shouldSkip(this, oldChild)) { report('replaceChild'); return oldChild; }
    return rawReplace.call(this, newChild, oldChild);
  };
}
