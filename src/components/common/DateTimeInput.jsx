import React, { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import StartCalendar from '@/components/create/StartCalendar';
import { Popover, PopoverTrigger, PopoverContent, Sheet } from '@/design/index';
import { useIsPhone } from '@/hooks/use-mobile';
import { useT, useI18n } from '@/lib/i18n/I18nContext';

/**
 * The date / date+time / time field of the app (TRIP-277). One trigger, one
 * panel (<StartCalendar> in a Popover on desktop, Sheet on phone), three modes
 * — so every place that asks for a moment in time looks and behaves the same.
 * No native <input type="date|time"> is left anywhere in src/ (guarded by
 * datetime-canon.test.js).
 *
 *  - mode="datetime" (default)  value "yyyy-MM-ddTHH:mm"  (or "" when incomplete)
 *  - mode="date"                value "yyyy-MM-dd"
 *  - mode="time"                value "HH:mm"
 *  - onChange(value)     the valid value, or "" while a date has no time yet
 *  - onTimeMissingChange(isMissing)  true when a date is picked but the time is
 *    still empty, so the parent can disable Save and flag the field — exactly
 *    the partial-date case the native input used validity.badInput for.
 *  - variant="cell"  summary-cell presentation for the date-range block
 *    (eyebrow label + big value) instead of the .input-styled button.
 */
const parse = (v, mode) => {
  const s = typeof v === 'string' ? v : '';
  if (mode === 'time') return { date: '', time: s.slice(0, 5) };
  const [d, tm = ''] = s.split('T');
  return { date: (d || '').slice(0, 10), time: tm.slice(0, 5) };
};

// One string per mode does both jobs: the empty-state placeholder on the
// trigger and the title of the sheet the trigger opens.
const TITLE_KEY = {
  date: 'event.pick_date_short',
  datetime: 'event.pick_datetime',
  time: 'common.time',
};

export default function DateTimeInput({
  value,
  onChange,
  onTimeMissingChange,
  mode = 'datetime',
  className,
  variant,
  cellLabel,
}) {
  const t = useT();
  const { lang } = useI18n();
  const isTime = mode === 'time';
  const [{ date, time }, setState] = useState(() => parse(value, mode));
  const [open, setOpen] = useState(false);
  // Remember what WE last emitted so our own "partial → ''" emit doesn't get
  // parsed back and wipe the date the user just picked; a value that differs
  // from it is a genuine external change (entity load / form reset) → resync.
  const emitted = useRef(value);
  const isSheet = useIsPhone();

  useEffect(() => {
    if (value !== emitted.current) {
      setState(parse(value, mode));
      emitted.current = value;
    }
  }, [value, mode]);

  // On unmount clear any raised "time missing" flag so a removed field (e.g. a
  // deleted transfer segment) never keeps Save disabled.
  useEffect(() => () => { onTimeMissingChange?.(false); }, []);

  const emit = (d, tm) => {
    const missing = mode === 'datetime' && !!d && !tm;
    let next = '';
    if (isTime) next = tm || '';
    else if (mode === 'date') next = d || '';
    else if (d && tm) next = `${d}T${tm}`;
    emitted.current = next;
    setState({ date: d, time: tm });
    onChange?.(next);
    onTimeMissingChange?.(missing);
  };

  const fmtDate = (fmt) => DateTime.fromISO(date, { zone: 'utc' }).setLocale(lang).toFormat(fmt);
  const empty = isTime ? !time : !date;
  const title = t(TITLE_KEY[mode]);

  // Trigger text: the placeholder while empty, the picked value otherwise.
  let label = title;
  if (isTime && time) label = time;
  else if (date) label = fmtDate('d MMM yyyy') + (mode === 'datetime' && time ? `, ${time}` : '');

  // Cell variant: eyebrow + big value. Date modes split the value over two
  // lines (date · time), time mode carries the clock alone.
  let cellMain = t('event.pick_date_short');
  if (isTime) cellMain = time || '—:—';
  else if (date) cellMain = fmtDate('d MMM, ccc');

  const panel = (
    <StartCalendar
      value={date || null}
      lang={lang}
      mode={mode}
      time={time}
      // Date-only has nothing left to choose after the day, so it closes;
      // date+time keeps the panel open for the hour/minute columns.
      onPick={(iso) => { emit(iso, time); if (mode === 'date') setOpen(false); }}
      onTimeChange={(tm) => emit(date, tm)}
    />
  );

  const trigger = variant === 'cell' ? (
    <button
      type="button"
      className={`sd-cell${empty ? ' is-empty' : ''} ${className || ''}`}
      onClick={isSheet ? () => setOpen(true) : undefined}
    >
      {cellLabel != null && <span className="sd-cell__lbl eyebrow">{cellLabel}</span>}
      <span className="sd-cell__d t-strong">{cellMain}</span>
      {mode === 'datetime' && <span className="sd-cell__t t-mono">{time || '—:—'}</span>}
    </button>
  ) : (
    <button
      type="button"
      className={`input eed-dtbtn${empty ? ' is-empty' : ''} ${className || ''}`}
      onClick={isSheet ? () => setOpen(true) : undefined}
    >
      {label}
    </button>
  );

  if (isSheet) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen} title={title}>
          {panel}
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start">
        {panel}
      </PopoverContent>
    </Popover>
  );
}
