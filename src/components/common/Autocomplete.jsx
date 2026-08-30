import React, { useEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/design/Input';
import { useI18n, useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import { PickerSheet, usePickerFlight } from '@/components/ui/PickerSheet';
import GeoAttribution from '@/components/common/GeoAttribution';

/**
 * Autocomplete — the single, canonical async search-as-you-type field + dropdown
 * for the whole app. City pickers (CitySearch, ManualPlanner) and the address
 * picker (AddressAutocomplete) are thin facades over this one engine, so they
 * all share ONE dropdown shell, ONE hover, ONE scroll behaviour.
 *
 * Design decisions (why this shape):
 *  • Built on the DS `Popover` primitive (the same Radix-backed popover that the
 *    other searchable picker, `SearchSelect`, uses). That gives, for free and
 *    WITHOUT hand-rolled code: anchored positioning + automatic FLIP/collision so
 *    the list is never clipped by a short dialog body (TRIP-337), a z-index above
 *    the modal layer, and — crucially — membership in Radix's dismissable-layer
 *    STACK, so a click on a row never leaks out as "outside" and closes the host
 *    dialog. The old hand-rolled fixed-portal + manual outside-close + flip math
 *    are all deleted; this is the reuse-first version.
 *  • The list reuses `.ss-list` / `.ss-opt` — the SAME list chrome as SearchSelect
 *    (both are searchable pickers), so the two share one look and one hover
 *    (`--accent`). Keyboard highlight rides the same `[data-highlighted]` accent.
 *  • The input keeps focus while the list is open: `onOpenAutoFocus` is prevented
 *    (Radix would otherwise move focus into the content), and `onInteractOutside`
 *    is prevented when the target is the anchor (input), so clicking/typing in the
 *    field never dismisses the list. Arrow/Enter/Esc are handled on the input.
 *  • overscroll-behavior:contain + -webkit-overflow-scrolling:touch (on .ss-list)
 *    keep the gesture inside the list on phones.
 *
 * ★ ТЕЛЕФОН — НЕ ПОПАП, А ПОЛНОРОСТНАЯ ШТОРКА (TRIP-484 §4). Якорный лист на
 * телефоне был единственной поверхностью в аппе, которая ОБЯЗАНА была дёргаться:
 * поле стоит посреди скроллящегося экрана, клавиатура сжимает вьюпорт
 * (клавиатура сжимает видимую область), якорь уезжает - и Radix честно
 * пересчитывает позицию с флипом на каждый кадр. Лечить это позиционированием
 * нельзя: двигался не лист, а точка привязки.
 * Поэтому на телефоне поле в разметке становится ТРИГГЕРОМ (то же `<Input>`, тот
 * же флаг и та же «×» - поле не подменяется, оно только перестаёт принимать
 * ввод), а поиск переезжает в `<PickerSheet>`: поле пришпилено сверху, лист под
 * ним, высота от вьюпорта. Привязываться больше не к чему.
 * Шторка над шторкой (пикер из окна события или из «добавить место») работает
 * без веток здесь - вложенность разбирает шов `ui/sheetShell`.
 *
 * The engine is data-agnostic: callers pass `search`, `getKey`, `renderRow`,
 * `onPick`, so the city/address contracts live in the facades, not here.
 *
 * @param {{
 *   inputValue?: string, onInputChange?: (v: string) => void,
 *   search: (query: string, lang: string) => any, getKey: (r: any) => any,
 *   renderRow: (r: any) => any, onPick?: (r: any) => void,
 *   placeholder?: string, title?: string, autoFocus?: boolean, disabled?: boolean,
 *   icon?: string, minChars?: number, debounceMs?: number,
 *   attribution?: boolean, inputProps?: object,
 * }} p
 */
export default function Autocomplete({
  inputValue = '',
  onInputChange,
  search,
  getKey,
  renderRow,
  onPick,
  placeholder,
  title,
  autoFocus,
  disabled,
  icon = 'pin',
  minChars = 2,
  debounceMs = 300,
  attribution = true,
  inputProps = {},
}) {
  const { lang } = useI18n();
  const t = useT();
  const isPhone = useIsPhone();
  const uid = React.useId();
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  // Открытость ШТОРКИ — отдельное состояние от открытости попапа: попап живёт,
  // только пока есть результаты, а шторка обязана стоять и на пустом запросе,
  // и пока идёт поиск. Свести их в одну переменную = закрывать поверхность под
  // пальцем на каждый неудачный запрос.
  //
  // ★★ НА ТЕЛЕФОНЕ ШТОРКА НИКОГДА НЕ ОТКРЫВАЕТ СЕБЯ САМА. Всегда `false`, и это
  // ПРАВИЛО ДВИЖКА, а не решение вызывателя.
  // У поверхности было два входа, и они не равны по построению. Вход тапом
  // работает: фокус попадает внутрь жеста, платформа отдаёт клавиатуру. Вход
  // «открыться на монтировании» не работает и не может: поле живёт в портале
  // vaul, портал монтируется НЕ В ТОМ ЖЕ КАДРЕ, и в момент layout-эффекта
  // фокусить ещё нечего — а когда поле появится, жест уже кончился. Симптом
  // ровно такой: в планировщике при автооткрытии каретки нет, а если закрыть и
  // тапнуть по полю — есть; в редакторе маршрута есть всегда, потому что там
  // вызыватель гасил `autoFocus` вручную и вход был только один.
  // Поэтому вход остаётся ОДИН, и правило записано ЗДЕСЬ. Иначе оно живёт
  // флажком `!isPhone` у каждого вызывателя — их было пять, с двумя разными
  // соглашениями и двумя комментариями, объясняющими платформу на месте вызова.
  // `autoFocus` снова значит ровно одно: «каретка в поле» — на десктопе, где
  // поле в разметке. На телефоне поле — это триггер, и его не фокусируют.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // ЗАПРОС, ПО КОТОРОМУ УЖЕ ЕСТЬ ОТВЕТ. Без него «ничего не найдено» врёт дважды,
  // и оба раза в обычном потоке: сразу после выбора города (в поле стоит имя, а
  // `results` уже очищен выбором — поиска по этому тексту не было вовсе) и все
  // 300 мс дебаунса первого запроса (ответа ещё нет, а «пусто» уже нарисовано).
  // Признак не «список пуст», а «на ЭТОТ текст пришёл пустой ответ».
  const [settled, setSettled] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  // Перелёт поля — у поверхности (`usePickerFlight`), здесь только вызовы.
  const { flyRef, slotRef, capture, flying } = usePickerFlight(sheetOpen);
  const timerRef = useRef(null);
  const lastQueryRef = useRef('');
  const wrapRef = useRef(null);
  // Read inside the debounce timer so a mid-debounce language switch isn't stale.
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);


  const runSearch = (query) => {
    clearTimeout(timerRef.current);
    if (!query || query.trim().length < minChars) {
      setResults([]); setOpen(false); setHighlighted(-1); setLoading(false);
      return;
    }
    lastQueryRef.current = query;
    timerRef.current = setTimeout(async () => {
      // Raise `loading` only once the debounce settled and a request is really
      // in flight — doing it per keystroke spun the icon while idle (TRIP-277).
      setLoading(true);
      try {
        const r = (await search(query.trim(), langRef.current)) || [];
        if (lastQueryRef.current !== query) return; // ignore stale
        setResults(r);
        setSettled(query.trim());
        setOpen(r.length > 0);
        setHighlighted(-1);
      } catch {
        // Сбой сети «ничем не найденным» не объявляем: пустой ответ и молчащий
        // сервер — разные факты, и второй не должен читаться как первый.
        setResults([]); setOpen(false);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    onInputChange?.(v);
    runSearch(v);
  };

  const pick = (r) => {
    flyRef.current?.querySelector('input')?.blur();
    setOpen(false);
    setSheetOpen(false);
    setResults([]);
    setHighlighted(-1);
    onPick?.(r);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      pick(results[highlighted]);
    } else if (e.key === 'Escape') {
      // Close the list without bubbling to a host Radix Dialog (EventEditDialog),
      // which would otherwise tear down the whole form on the same Esc.
      e.stopPropagation();
      setOpen(false);
    }
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const isOpen = open && results.length > 0;
  // «Ничего не найдено» показываем, только когда ответ пришёл ИМЕННО НА ЭТОТ
  // текст и оказался пуст. На попапе развилки не было вовсе — он просто не
  // открывался, и человек не отличал «не найдено» от «сломалось».
  const noMatches = !loading && results.length === 0 && !!settled && settled === (inputValue || '').trim();

  /* Строки листа объявлены ОДИН раз на обе поверхности: у попапа и у шторки
     разная оболочка, но лист один и тот же объект — расхождение здесь и было бы
     тем самым «два пикера, похожие на один». */
  const rows = results.map((r, i) => (
    <button
      key={getKey(r)}
      id={`${uid}-opt-${i}`}
      type="button"
      role="option"
      aria-selected={highlighted === i}
      className="ss-opt"
      data-highlighted={highlighted === i ? '' : undefined}
      onMouseEnter={() => setHighlighted(i)}
      // Keep the input focused on tap (no keyboard flicker / iOS double-tap).
      // mousedown does NOT fire on a touch-drag, so this never blocks scroll.
      onMouseDown={(e) => e.preventDefault()}
      // Select on a real tap/click only — a touch-drag scrolls the list and
      // fires no click, so the user can scroll before choosing.
      onClick={() => pick(r)}
    >
      {renderRow(r)}
    </button>
  ));

  /* ...и САМ ЛИСТ тоже один — вместе с контейнером, ролью и `id`, на который
     ссылается `aria-controls`. Вторая копия контейнера (она тут была ровно один
     заход) — это не «почти то же самое»: у неё свои условия показа пустоты и
     атрибуции, то есть развилка поведения, которую никто не увидит, пока экраны
     не разъедутся.
     Условия здесь СИЛЬНЕЕ, и на десктопе это ничего не меняет: попап открыт
     только при `results.length > 0` (`isOpen`), значит `noMatches` там не
     наступает по построению, а `results.length > 0` у атрибуции — тавтология. */
  const listEl = (
    <div id={`${uid}-list`} role="listbox" className="ss-list scrollbar-thin">
      {rows}
      {/* Пусто — только когда искать УЖЕ было что: до порога лист молчит, иначе
          «ничего не найдено» встречало бы человека до первой буквы. */}
      {noMatches && <div className="ss-empty">{t('common.not_found')}</div>}
      {/* Атрибуция обязательна там, где показаны данные поставщика, — на пустом
          экране ей нечего атрибутировать. */}
      {attribution && results.length > 0 && <GeoAttribution />}
    </div>
  );

  // Общие атрибуты комбобокса — на том поле, которое В ДАННЫЙ МОМЕНТ принимает
  // ввод (на десктопе это поле в разметке, на телефоне — поле в шторке).
  const comboAria = {
    autoComplete: 'off',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-controls': `${uid}-list`,
    'aria-activedescendant': highlighted >= 0 ? `${uid}-opt-${highlighted}` : undefined,
  };

  if (isPhone) {
    const closeSheet = () => { setSheetOpen(false); setOpen(false); setHighlighted(-1); };
    return (
      <>
        {/* ★★ ОДНО ПОЛЕ, КОТОРОЕ УЛЕТАЕТ НАВЕРХ. Не триггер и его двойник в
            шторке, а тот же самый узел: тапнул — клавиатуру поднял НАТИВНЫЙ тап
            по настоящему полю, каретка родилась в нём и никуда не переезжает,
            поле поехало к верху экрана, под ним раскрылся список.
            Отсюда исчезают все задачи, которые мы решали пять заходов: ловить
            жест синхронным коммитом (клавиатуру даёт платформа), переносить
            фокус между двумя полями (второго нет), объяснять каретке, где встать
            (она всё время в одном элементе). Кода стало меньше, а не больше. */}
        <Input
          /* Летит ОБЁРТКА самого примитива, а не своя вокруг него: `boxRef` и
             `className` у `<Input>` для этого и существуют — обёртка там уже
             есть, и вторая означала бы, что декорации поля (иконка, кольцо
             загрузки) остались в одной коробке, а летит другая. */
          boxRef={flyRef}
          className={flying ? 'ss-fly' : ''}
          icon={icon}
          loading={loading}
          value={inputValue || ''}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (disabled) return; capture(); setSheetOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
          aria-expanded={isOpen}
          {...comboAria}
          {...inputProps}
        />
        <PickerSheet
          open={sheetOpen}
          onOpenChange={(o) => { if (!o) closeSheet(); }}
          title={title || t('common.search')}
          /* Слот ПУСТ намеренно: поле в него не кладут, оно садится НАД ним,
             долетев. Слот держит его рост, чтобы лист начинался там, где надо. */
          search={<div className="ss-search" ref={slotRef} />}
        >
          {listEl}
        </PickerSheet>
      </>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={(o) => { if (!o) setOpen(false); }}>
      {/* Anchor = the field wrapper; the list positions against it and keeps the
          input's width via --radix-popover-trigger-width. The loading indicator
          is owned by <Input> itself (ring in place of the leading icon). */}
      <PopoverAnchor asChild>
        <div ref={wrapRef} style={{ minWidth: 0 }}>
          <Input
            icon={icon}
            loading={loading}
            value={inputValue || ''}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-expanded={isOpen}
            {...comboAria}
            {...inputProps}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="pop-flush"
        align="start"
        sideOffset={4}
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        // Keep focus on the typing input, and don't let a pointer-down on the
        // input (the anchor) dismiss the list — only a click truly outside does.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => { if (wrapRef.current?.contains(e.target)) e.preventDefault(); }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {listEl}
      </PopoverContent>
    </Popover>
  );
}
