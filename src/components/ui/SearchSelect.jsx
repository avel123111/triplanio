import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet } from '@/components/ui/Sheet';

/**
 * C4 · SearchSelect — the canonical searchable picker (currency, language, …).
 *
 * Desktop: an anchored Radix popover with a search box + scrollable list.
 * Mobile (useIsMobile): the same search + list inside a bottom-sheet (.sheet).
 * One component, so currency and language pickers (and any future one) share a
 * single behaviour and style. Esc / outside-click close it for free.
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
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const current = options.find((o) => getKey(o) === value);
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? options
    : options.filter((o) => (matches ? matches(o, q) : String(getKey(o)).toLowerCase().includes(q)));

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (o) => { onChange(getKey(o)); close(); };
  const onOpenChange = (o) => (o ? setOpen(true) : close());

  const trigger = (extra = {}) => (
    <button
      type="button"
      className={triggerClassName}
      disabled={disabled}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left' }}
      {...extra}
    >
      <span style={current ? undefined : { color: 'var(--muted-2)' }}>
        {current ? (renderValue ? renderValue(current) : getKey(current)) : placeholder}
      </span>
      <ChevronDown size={14} style={{ opacity: 0.5 }} />
    </button>
  );

  const body = (
    <>
      <div className="ss-search">
        <Search />
        <input
          className="input ss-input"
          autoFocus={!isMobile}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      </div>
      <div className="ss-list" onWheel={(e) => e.stopPropagation()}>
        {filtered.length === 0 ? (
          <div className="ss-empty">{emptyText}</div>
        ) : (
          filtered.map((o) => {
            const selected = getKey(o) === value;
            return (
              <button
                key={getKey(o)}
                type="button"
                className="ss-opt"
                data-active={selected ? '' : undefined}
                onClick={() => pick(o)}
              >
                {renderOption ? renderOption(o, selected) : <span style={{ flex: 1 }}>{getKey(o)}</span>}
                {selected && <Check className="chk" />}
              </button>
            );
          })
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        {trigger({ onClick: () => !disabled && setOpen(true) })}
        <Sheet open={open} onOpenChange={onOpenChange} title={title}>{body}</Sheet>
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
        {body}
      </PopoverContent>
    </Popover>
  );
}
