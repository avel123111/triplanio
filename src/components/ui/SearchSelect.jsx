import React from 'react';
import { flushSync } from 'react-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown } from 'lucide-react';
// Напрямую из модуля, а НЕ из '@/design': барраль реэкспортит этот файл, и
// импорт оттуда замкнул бы зависимость в кольцо (TRIP-333).
import { Input } from '@/design/Input';
import { useIsPhone } from '@/hooks/use-mobile';
import { PickerSheet } from '@/components/ui/PickerSheet';

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
 *   triggerClassName (default 'input'), width (desktop popover px), disabled
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
  triggerClassName = 'input',
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
  // ★ Синхронный коммит — половина клавиатуры на iOS: поле поиска должно
  // ОКАЗАТЬСЯ В DOM ещё внутри обработчика тапа, иначе фокусить в жесте нечего,
  // а поздний фокус Safari принимает без клавиатуры (разбор — в `PickerSheet`).
  const openSheet = () => flushSync(() => setOpen(true));
  const pick = (o) => { onChange(getKey(o)); close(); };
  const onOpenChange = (o) => (o ? setOpen(true) : close());

  // TRIP-391 объект 1 → объект 5: контрол-триггер комбобокса (поле) — className задаёт
  // вызыватель (triggerClassName), открывает лист, не кнопка-примитив.
  const trigger = (extra = {}) => (
    <button
      type="button"
      className={triggerClassName}
      disabled={disabled}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left' }}
      {...rest}
      {...extra}
    >
      {/* Тон незаполненной подписи — канон `.muted-2` (он уже есть в app.css), а
          не свой инлайн с тем же токеном. */}
      <span className={current ? undefined : 'muted-2'}>
        {current ? (renderValue ? renderValue(current) : getKey(current)) : placeholder}
      </span>
      <ChevronDown size={14} style={{ opacity: 0.5 }} />
    </button>
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
        icon="search"
        /* ТОЛЬКО десктоп. На телефоне каретку ставит сама поверхность
           (`PickerSheet`) и только после того, как шторка доехала: `autoFocus`
           срабатывает на монтировании, посреди входной анимации, и уносит
           поверхность вслед за доскроллом браузера к полю. */
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
        {trigger({ onClick: () => !disabled && openSheet() })}
        <PickerSheet open={open} onOpenChange={onOpenChange} title={title} search={searchEl}>
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
