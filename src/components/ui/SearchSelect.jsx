// @ts-check
import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown } from 'lucide-react';
// Напрямую из модуля, а НЕ из '@/design': барраль реэкспортит этот файл, и
// импорт оттуда замкнул бы зависимость в кольцо (TRIP-333).
import { Input } from '@/design/Input';
import { useIsPhone } from '@/hooks/use-mobile';
import { PickerSheet, usePickerFocus } from '@/components/ui/PickerSheet';
import { tapPick } from '@/lib/tapGesture';

/**
 * C4 · SearchSelect — the canonical searchable picker (currency, language, …).
 *
 * Desktop: an anchored Radix popover with a search box + scrollable list.
 * Mobile (useIsPhone): the same search + list inside <PickerSheet> — общая
 * поверхность пикера, которая и решает, шторка по содержимому или во весь рост
 * (правило «есть поиск -> полный рост» записано ТАМ, не здесь: второй экземпляр
 * правила разъехался бы с первым). Esc / outside-click close it for free.
 *
 * Props:
 *   value, onChange(key)         — controlled selected key
 *   options[]                    — arbitrary option objects
 *   getKey(option)               — unique key (defaults to .code/.value/self)
 *   matches(option, qLower)      — search predicate (defaults to key includes)
 *   renderOption(option, sel)    — inner content of an option row
 *   renderValue(current)         — trigger label for the current option
 *   placeholder, searchPlaceholder, emptyText, title (mobile sheet header)
 *   triggerClassName            — РАСКЛАДКА ряда, уезжает на обёртку поля. Скин
 *     контрола даёт сам примитив (`.input` на кнопке), передавать его тут не надо.
 *   width (desktop popover px), disabled
 *   searchable                   — строка поиска (по умолчанию есть). Списку из
 *     пяти категорий бюджета или трёх ролей участника искать нечего, а пустая
 *     строка поиска над коротким листом — шум; закрытые списки поэтому берут
 *     `searchable={false}`. Это ПРОП примитива, а не второй компонент: пикер в
 *     приложении один (TRIP-484 §3).
 *   ...rest                      — садятся на ТРИГГЕР: он и есть видимое поле,
 *     поэтому через этот же канал едет состояние валидации (`{...fieldState()}`),
 *     как у DateTimeInput.
 *
 * @param {{ value: any, onChange: (key: any) => any, options?: any[], getKey?: (o: any) => any,
 *   matches?: (o: any, q: string) => boolean, renderOption?: (o: any, selected: boolean) => any,
 *   renderValue?: (o: any) => any, placeholder?: string, searchPlaceholder?: string,
 *   emptyText?: string, title?: any, triggerClassName?: string, width?: number,
 *   disabled?: boolean, searchable?: boolean, [x: string]: any }} p
 */
export default function SearchSelect({
  value,
  onChange,
  options = [],
  getKey = (o) => o?.code ?? o?.value ?? o,
  matches,
  renderOption,
  renderValue,
  placeholder = '',
  searchPlaceholder = '',
  emptyText = '—',
  title,
  triggerClassName = '',
  width = 264,
  disabled = false,
  searchable = true,
  ...rest
}) {
  const isPhone = useIsPhone();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const current = options.find((o) => getKey(o) === value);
  const q = searchable ? query.trim().toLowerCase() : '';
  const filtered = !q
    ? options
    : options.filter((o) => (matches ? matches(o, q) : String(getKey(o)).toLowerCase().includes(q)));

  const close = () => { setOpen(false); setQuery(''); };

  // Дисциплина фокуса — у поверхности (`usePickerFocus` в `PickerSheet`), здесь
  // только вызовы. На десктопе поверхность другая (попап), и правило к ней не
  // применяется: там фокус ставит `autoFocus` поля.
  const { searchRef, inGesture } = usePickerFocus();
  const openSheet = () => (isPhone ? inGesture(() => setOpen(true)) : setOpen(true));
  /* Фокус здесь НЕ снимается: это делает поверхность на закрытии, где правило
     накрывает все четыре двери (выбор, Esc, тап мимо, свайп). */
  /* Тот же жест выбора, что у второго движка (`common/Autocomplete`), и это
     один вызов `lib/tapGesture`, а не копия правила: строка листа у них одна
     (`.ss-opt`), поверхность одна, поле поиска одно — дефект общий. */
  const tapRef = React.useRef(/** @type {any} */ (null));
  const pickedRef = React.useRef(false);
  const pick = (o) => {
    if (pickedRef.current) return;
    pickedRef.current = true;
    onChange(getKey(o));
    close();
  };
  // Лист открыт заново — снова можно выбрать.
  React.useEffect(() => { if (open) pickedRef.current = false; }, [open]);
  const onOpenChange = (o) => (o ? setOpen(true) : close());

  // TRIP-391 объект 1 → объект 5: контрол-триггер комбобокса (поле) — открывает
  // лист, не кнопка-примитив.
  //
  // ★ РИСУЕТ ЕГО ПРИМИТИВ, А НЕ ЭТОТ ФАЙЛ. Шесть инлайнов, которыми триггер
  // собирался здесь (`display/align/justify/gap/cursor/textAlign`), — это
  // объявления, которых не хватало классу `.input` на кнопке; они переехали в
  // правило `button.input`, а форма «поле в роли триггера» стала `<Input
  // as="button">`. Тот же примитив несёт теперь и триггер пикера города, то есть
  // копий этой кнопки в приложении больше нет.
  // `triggerClassName` уезжает на ОБЁРТКУ поля (`className` примитива) — там ему
  // и место: вызыватели передают в нём раскладку ряда, а не скин контрола.
  const trigger = (extra = {}) => (
    <Input
      as="button"
      className={triggerClassName}
      disabled={disabled}
      {...rest}
      {...extra}
    >
      {/* Тон незаполненной подписи — канон `.muted-2` (он уже есть в app.css), а
          не свой инлайн с тем же токеном. */}
      <span className={current ? 'grow--fit' : 'grow--fit muted-2'}>
        {current ? (renderValue ? renderValue(current) : getKey(current)) : placeholder}
      </span>
      <ChevronDown size={14} style={{ opacity: 0.5 }} />
    </Input>
  );

  /* `.ss-search` остаётся ОТДЕЛЬНОЙ обёрткой, а не уезжает в className поля: у
     неё собственный padding, а обёртка декораций обязана облегать поле вплотную
     - иначе иконка отсчитывается от края паддинга и встаёт на 6px вместо 12
     (поймано замером).
     Поле объявлено ОТДЕЛЬНО от листа, потому что на телефоне они живут в разных
     слотах поверхности: поле пришпилено, лист скроллит. */
  const searchEl = searchable ? (
    <div className="ss-search">
      <Input
        ref={searchRef}
        icon="search"
        /* ТОЛЬКО десктоп. На телефоне `autoFocus` срабатывает на монтировании —
           то есть уже ПОСЛЕ жеста, и клавиатуры не даёт (даёт каретку, вдобавок
           посреди входной анимации, из-за чего её видно отдельно от поля).
           Фокус там ставит триггер, внутри тапа — разбор у `openSheet`. */
        autoFocus={!isPhone}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
      />
    </div>
  ) : null;

  const listEl = (
    /* `scrollbar-thin` — канон ДС (app.css), а не свои правила скролла: лист
       длинный (валюты, языки), и полоса браузера по умолчанию рисуется мимо
       системы. Тот же класс несёт лист автокомплита — хром у них общий. */
    <div className="ss-list scrollbar-thin" onWheel={(e) => e.stopPropagation()}>
      {filtered.length === 0 ? (
        <div className="ss-empty">{emptyText}</div>
      ) : (
        filtered.map((o) => {
          const selected = getKey(o) === value;
          // TRIP-391 объект 1 → объект 5: опция листа комбобокса (поле), не кнопка-примитив.
          return (
            <button
              key={getKey(o)}
              type="button"
              className="ss-opt"
              data-active={selected ? '' : undefined}
              onPointerDown={(e) => { tapRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, row: o }; }}
              onPointerCancel={() => { tapRef.current = null; }}
              onPointerUp={(e) => {
                const picked = tapPick(tapRef.current, { id: e.pointerId, x: e.clientX, y: e.clientY });
                tapRef.current = null;
                // `!== null`, а не «истинно»: опцией листа законно бывает 0 или пустая
                // строка, и такую нельзя молча объявить «не выбрано».
                if (picked !== null) pick(picked);
              }}
              // Вход для клавиатуры и ВТ (`el.click()` pointer-событий не шлёт).
              onClick={() => pick(o)}
            >
              {renderOption ? renderOption(o, selected) : <span className="grow">{getKey(o)}</span>}
              {selected && <Check className="chk" />}
            </button>
          );
        })
      )}
    </div>
  );

  if (isPhone) {
    return (
      <>
        {/* Роль триггера объявляется ЗДЕСЬ, а не у примитива: на десктопе те же
            атрибуты дорисовывает `PopoverTrigger`, а в этой ветке Radix нет
            вовсе — без них комбобокс объявлялся скринридеру просто кнопкой.
            `dialog`, а не `listbox`: лист живёт ВНУТРИ шторки и размонтирован,
            пока она закрыта, — обещать лист, которого нет в дереве, нельзя (тот
            же разбор у мобильного триггера `common/Autocomplete`). */}
        {trigger({
          onClick: () => !disabled && openSheet(),
          role: 'combobox',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
        })}
        <PickerSheet open={open} onOpenChange={onOpenChange} title={title} search={searchEl} full>
          {listEl}
        </PickerSheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger()}</PopoverTrigger>
      <PopoverContent
        className="pop-flush"
        align="start"
        style={{ width }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {searchEl}
        {listEl}
      </PopoverContent>
    </Popover>
  );
}
