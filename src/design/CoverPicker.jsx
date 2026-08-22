// @ts-check
import React, { useEffect, useRef, useState } from 'react';
import { Carousel } from './Carousel';
import { Cover } from './Cover';
import { IconBtn } from './IconBtn';
import { Swatch } from './Swatch';
import { useT } from '@/lib/i18n/I18nContext';

// ----- CoverPicker ----- (выбор картинки-обложки как примитив ДС, TRIP-421)
// Раньше вся эта механика жила внутри `TripCoverPicker` вместе с каталогом
// пресетов и заливкой в Storage — то есть «как это листается» было прибито к
// «откуда берутся картинки». Отсюда примитив ничего не знает ни про трип, ни про
// supabase: ему дают ГОТОВЫЙ список url-ов и говорят, какой выбран.
//
// ★ ОБЛОЖКА = СКРОЛЛ-ЛЕНТА, А НЕ КНОПКИ «СЛЕДУЮЩАЯ». Слайды едут нативным
// `scroll-snap` (тот же приём, что у <Carousel>): свайп на тач-устройстве
// ФИЗИЧЕСКИ проматывает картинку, снап доводит до края, а осевший слайд
// становится выбранным. Стрелки не «меняют значение» мимо ленты — они скроллят
// ту же ленту на один слайд, поэтому у мыши и у пальца ОДИН путь, а не два.
//
// ★ ВЫБОР КОММИТИТСЯ НА ОСАДКЕ СКРОЛЛА (дебаунс 120мс), а подсветка активной
// миниатюры идёт В НОГУ со свайпом: иначе картинка сменилась, а ряд догоняет
// через полсекунды. Живой индекс держит `scrollUrl`, коммит наверх — `onChange`.
//
// ★ РЕШЕНИЕ О ЗАПИСИ — НЕ ЗДЕСЬ. `onChange` сообщает «выбрано вот это»;
// сохранять сразу или ждать кнопки «Сохранить» — дело вызывателя (в планнере это
// черновик, в настройках трипа — форма с явным сохранением).
//
// slides — url-ы по порядку ленты; ПУСТАЯ строка = слайд «без обложки»
//   (рисуется фоллбеком примитива <Cover>). value — выбранный url ('' = без
//   обложки). onUpload(file) — не задан → кнопки загрузки нет.
// className уезжает на КАДР обложки: он же задаёт геометрию (дефолт кадра — 4:3
//   со скруглением; планнер перебивает на full-bleed полосу).
/**
 * @param {{
 *   slides?: string[],
 *   value?: string,
 *   onChange?: (url: string) => void,
 *   onUpload?: (file: File) => void,
 *   uploading?: boolean,
 *   error?: string,
 *   overlay?: any,
 *   disabled?: boolean,
 *   className?: string,
 *   ariaLabel: string,
 *   uploadLabel?: string,
 *   accept?: string,
 * }} p
 */
export function CoverPicker({
  slides = [],
  value = '',
  onChange,
  onUpload,
  uploading = false,
  error = '',
  overlay = null,
  disabled = false,
  className = '',
  ariaLabel,
  uploadLabel = '',
  accept,
}) {
  const t = useT();
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const stripRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const trackRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  // Стрелку прячем, когда в ту сторону ехать некуда: «влево» на первом слайде,
  // «вправо» на последнем (1px допуск на дробный zoom).
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const syncEdges = () => {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  };

  // Единая точка выбора — ТОЛЬКО коммит наверх. Куда после этого встают обе
  // ленты, решает эффект ниже: пока «доведи миниатюру» жило здесь, у выбора было
  // ДВА исполнителя (клик доводил ленту сам, а открытие экрана — никак), и
  // открытая с пресетной обложкой форма показывала невыбранный ряд.
  // Тот же url — no-op, иначе свайп бил бы onChange на каждом кадре осадки.
  const select = (url) => {
    if (url === undefined || url === value) return;
    onChange?.(url);
  };

  // Подсветка активной миниатюры — по ЖИВОМУ индексу скролла, коммит — по осадке.
  const [scrollUrl, setScrollUrl] = useState(/** @type {string | null} */ (null));
  const activeUrl = scrollUrl ?? value;

  // ★ ОДИН ИНДЕКС НА ДВЕ ЛЕНТЫ. Обложка и ряд миниатюр — не два независимых
  // скроллера, а два вида ОДНОГО положения. Раньше они двигались по очереди
  // (кадр вставал мгновенным `scrollLeft`, а ряд догонял плавным скроллом уже
  // после коммита) — отсюда рывок. Теперь обе едут от одного индекса и стартуют
  // в одном кадре; ряд следует за ЖИВЫМ индексом, поэтому во время свайпа он
  // идёт вместе с пальцем, а не догоняет после осадки.
  const activeIndex = slides.indexOf(activeUrl);
  // Первая установка — без анимации: экран открывается на нужном слайде, а не
  // приезжает к нему. Дальше всё плавно.
  const firstSync = useRef(true);
  // Плавную доводку кадра НЕ считаем жестом (см. onTrackScroll).
  const programmatic = useRef(false);

  useEffect(() => {
    if (activeIndex < 0) return;
    stripRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({
      inline: 'center', block: 'nearest', behavior: firstSync.current ? 'auto' : 'smooth',
    });
  }, [activeIndex]);

  // Значение сменили НЕ свайпом (аплоад / клик по миниатюре / приехало сверху) →
  // подвести ленту слайдов к нему. Уже на месте — no-op (снап сам её туда привёл).
  //
  // ★ ПОКА ИДЁТ СВАЙП — НЕ ТРОГАТЬ. Во время жеста `value` ещё СТАРОЕ (коммит
  // на осадке), поэтому доводчик считает целью прежний слайд и, сработай он
  // сейчас, дёрнул бы ленту назад под пальцем. Живой скролл — это ровно
  // `scrollUrl !== null`. Условие держит правило само, а не надеется, что
  // вызыватель мемоизировал `slides`: массив-литерал в пропе даёт новую ссылку
  // на каждый рендер, а рендер во время свайпа как раз и происходит.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || slides.length === 0 || scrollUrl !== null) return;
    const target = Math.max(0, slides.indexOf(value)) * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2) {
      programmatic.current = !firstSync.current;
      el.scrollTo({ left: target, behavior: firstSync.current ? 'auto' : 'smooth' });
    }
    syncEdges();
    firstSync.current = false;
  }, [value, slides, scrollUrl]);
  const settle = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  useEffect(() => () => clearTimeout(settle.current), []);
  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    syncEdges();
    const at = () => slides[Math.round(el.scrollLeft / el.clientWidth)];
    // Собственная плавная доводка кадра — не жест пользователя: публикуй мы её
    // промежуточные слайды, ряд миниатюр гнался бы за каждым, через который
    // кадр проезжает по дороге к выбранному. Флаг снимает тот же таймер осадки,
    // что и коммитит жест, — второй механизм для этого не нужен.
    if (!programmatic.current) setScrollUrl(at() ?? null);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (programmatic.current) { programmatic.current = false; return; }
      select(at());
      setScrollUrl(null);
    }, 120);
  };

  const page = (dir) => {
    const el = trackRef.current;
    el?.scrollBy({ left: dir * (el.clientWidth || 0), behavior: 'smooth' });
  };

  const pickFile = () => fileRef.current?.click();
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUpload?.(file);
  };

  return (
    /* `.tcp` на корне — не декорация: он несёт `min-width: 0`, без которого лента
       миниатюр не сжимается и распирает контейнер (см. правило в app.css). */
    <div className="col col--g6 tcp">
      <div className={["tcp__hero", className].filter(Boolean).join(" ")}>
        {/* Лента слайдов. `data-disabled` глушит ИМЕННО прокрутку: у зрителя
            (read-only) нативный свайп не выключается ни `disabled` у кнопок, ни
            <fieldset disabled> — прокрутка не элемент формы. */}
        <div
          className="tcp__track"
          ref={trackRef}
          onScroll={onTrackScroll}
          data-disabled={disabled || undefined}
          role="group"
          aria-label={ariaLabel}
        >
          {(slides.length ? slides : ['']).map((url) => (
            <Cover key={url || 'none'} className="tcp__slide" image={url} />
          ))}
        </div>
        <div className="tc__scrim" />
        {onUpload && !disabled && (
          <IconBtn
            icon="image-up"
            disabled={uploading}
            onClick={pickFile}
            ariaLabel={uploadLabel}
            className="tcp__ctl tcp__upload"
          />
        )}
        {slides.length > 1 && !disabled && !atStart && (
          <IconBtn icon="chevL" ariaLabel={t('common.prev')} onClick={() => page(-1)} className="tcp__ctl tcp__nav tcp__nav--prev" />
        )}
        {slides.length > 1 && !disabled && !atEnd && (
          <IconBtn icon="chev" ariaLabel={t('common.next')} onClick={() => page(1)} className="tcp__ctl tcp__nav tcp__nav--next" />
        )}
        {overlay && <div className="tcp__title t-title">{overlay}</div>}
      </div>

      {/* Лента миниатюр — примитив Carousel с круглыми свотчами.
          Слайд «без обложки» миниатюрой НЕ дублируется: у него нет своей
          картинки, а пустая плитка в ряду читается как сбой загрузки. */}
      <Carousel className="tcp__strip" ariaLabel={ariaLabel} ref={stripRef}>
        {slides.map((url, i) => {
          if (!url) return null;
          /* Картинка ЕСТЬ содержимое миниатюры — классом её не выразить. Фон из
             данных держим переменной (как в VisitPanel/TripDot): инлайн-храповик
             считает литерал в разметке, а не значение, приехавшее из данных.
             data-idx — адрес для доводчика ленты. */
          const bg = { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
          return (
            <Swatch
              key={url}
              variant="round"
              on={activeUrl === url}
              disabled={disabled || undefined}
              onClick={() => select(url)}
              aria-label={ariaLabel}
              style={bg}
              data-idx={i}
            />
          );
        })}
      </Carousel>

      {onUpload && (
        <input ref={fileRef} type="file" accept={accept} onChange={handleFile} className="tcp__file" />
      )}
      {error && <p className="tcp__err">{error}</p>}
    </div>
  );
}
