import { useLayoutEffect } from 'react';

/**
 * Scroll-reveal for the unauthenticated zone — fades `.rv` / `.rv-l` / `.rv-r`
 * blocks up as they enter the viewport by adding `in`. ONE IntersectionObserver,
 * ONE-directional: a block reveals once and is then un-observed, so it never
 * re-hides. The old bidirectional re-arm (remove `in` when a block scrolled
 * back) made long pages feel janky — sections re-animated their translateY as
 * you scrolled up/down (the demo trip surfaced it: ~12 re-flips per scroll
 * sweep). Shared by the landing, public trip and demo so the reveal behaviour
 * has a single copy. `ready` gates it until the zone CSS + the target nodes
 * exist; re-runs when `ready` flips (e.g. the public page's CTA mounts only
 * after the trip loads).
 *
 * ★★ ЭФФЕКТ ВКЛЮЧАЕТ ТОТ, КТО УМЕЕТ ЕГО ВЫКЛЮЧИТЬ (TRIP-520).
 *
 * Пряталось это раньше в CSS безусловно: `.rv{opacity:0}`, а показывал блок уже
 * наблюдатель. Пока страницу целиком рисовал JavaScript, это было незаметно —
 * без него всё равно не было ни строчки. С приходом готовых файлов стало
 * дефектом: текст лендинга приезжает ВМЕСТЕ С ДОКУМЕНТОМ, но всё ниже первого
 * экрана лежит невидимым, пока не догрузится бандл (замер: 9.6 с на мобильном
 * троттлинге). Читатель без JavaScript видел герой и пустоту.
 *
 * Поэтому прячет теперь не CSS сам по себе, а признак `data-reveal` на
 * документе — его ставит ЭТОТ хук, и ровно он же умеет блок показать. Нет
 * JavaScript — нет признака — видно всё. Это давняя общая практика (`no-js` в
 * HTML5 Boilerplate), а не приём под выпечку: про готовые файлы хук не знает.
 *
 * ★ Признак ставится ДО КАДРА (`useLayoutEffect`): поставь мы его после,
 * свежесозданные React-ом узлы успели бы нарисоваться видимыми и мигнули бы,
 * прежде чем спрятаться.
 */

/**
 * «Содержимое этого документа человек уже видел» — верно РОВНО ОДИН РАЗ и
 * только для документа, который приехал готовым: его текст стоял на экране всё
 * время, пока грузился бандл. Такие блоки помечаются показанными до включения
 * эффекта, иначе на глазах у человека они спрятались бы и проявились заново.
 *
 * Дальше внутри сессии страницы рисует React с нуля — им вступление положено,
 * поэтому флаг гасится после первого применения.
 */
let deliveredContentAlreadySeen = typeof document !== 'undefined'
  && document.documentElement.hasAttribute('data-prerendered');

export function useReveal(ready) {
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const targets = [...document.querySelectorAll('.rv,.rv-l,.rv-r')];
    if (!targets.length) return undefined;

    if (deliveredContentAlreadySeen) {
      deliveredContentAlreadySeen = false;
      targets.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
      });
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target); // reveal once — never re-hide (no scroll jank)
        }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });

    document.documentElement.setAttribute('data-reveal', '');
    targets.forEach((el) => { if (!el.classList.contains('in')) io.observe(el); });
    return () => {
      io.disconnect();
      document.documentElement.removeAttribute('data-reveal');
    };
  }, [ready]);
}
