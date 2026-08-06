import React, { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import StartCalendar from '@/components/create/StartCalendar';
import { Popover, PopoverTrigger, PopoverContent, Sheet } from '@/design/index';
import { useIsPhone } from '@/hooks/use-mobile';
import { useT, useI18n } from '@/lib/i18n/I18nContext';

/**
 * Date/time field for the event editor. One shared calendar everywhere
 * (TRIP-176): the field is a trigger that opens our custom <StartCalendar> in a
 * Popover (desktop) or Sheet (phone) — same calendar the trip-start control
 * uses — here in its date+time state.
 *
 * The external contract is unchanged from the old native <datetime-local>
 * wrapper so every call site keeps working:
 *  - value              "yyyy-MM-ddTHH:mm" (or "" when incomplete)
 *  - onChange(value)     the valid value, or "" while a date has no time yet
 *  - onTimeMissingChange(isMissing)  true when a date is picked but the time is
 *    still empty, so the parent can disable Save and flag the field — exactly
 *    the partial-date case the native input used validity.badInput for.
 *
 * Здесь же причина, по которой нативного `<input type="date">` не осталось ни
 * одного во всём `src`: Chrome рисует его по локали ОПЕРАЦИОННОЙ СИСТЕМЫ, а не
 * по языку приложения, и повлиять на это нельзя ни `lang`, ни CSS, ни JS -
 * испанский интерфейс на русской ОС показывал поле как `дд.мм.гггг`. Этот
 * компонент форматирует дату сам, по языку приложения. С `withTime={false}`
 * контракт значения совпадает с нативным полем: `yyyy-MM-dd` либо `''`.
 */
const parse = (v) => {
  if (typeof v !== 'string' || !v) return { date: '', time: '' };
  const [d, tm = ''] = v.split('T');
  return { date: (d || '').slice(0, 10), time: tm.slice(0, 5) };
};

export default function DateTimeInput({
  value,
  onChange,
  onTimeMissingChange,
  withTime = true,
  className,
  // Summary-cell presentation for the date-range block (TRIP-176 design):
  // renders an eyebrow label + big date + time as a clickable cell instead of
  // the plain input button. Same calendar, same value contract.
  variant,
  cellLabel,
  // Обязательность подписи-бровки в ячейке: звёздочку рисует тот же CSS, что и у
  // подписи обычного поля (`[data-required]`), поэтому знак и цвет общие.
  cellRequired,
  // Состояние валидации приходит атрибутами (`{...fieldState(...)}`) и садится
  // на ТРИГГЕР: он и есть видимое поле (TRIP-333).
  ...rest
}) {
  const t = useT();
  const { lang } = useI18n();
  const [{ date, time }, setState] = useState(() => parse(value));
  const [open, setOpen] = useState(false);
  // Remember what WE last emitted so our own "partial → ''" emit doesn't get
  // parsed back and wipe the date the user just picked; a value that differs
  // from it is a genuine external change (entity load / form reset) → resync.
  const emitted = useRef(value);
  const isSheet = useIsPhone();

  useEffect(() => {
    if (value !== emitted.current) {
      setState(parse(value));
      emitted.current = value;
    }
  }, [value]);

  // On unmount clear any raised "time missing" flag so a removed field (e.g. a
  // deleted transfer segment) never keeps Save disabled.
  useEffect(() => () => { onTimeMissingChange?.(false); }, []);

  const emit = (d, tm) => {
    const missing = withTime && !!d && !tm;
    let next = '';
    if (d && withTime && tm) next = `${d}T${tm}`;
    else if (d && !withTime) next = d;
    emitted.current = next;
    setState({ date: d, time: tm });
    onChange?.(next);
    onTimeMissingChange?.(missing);
  };

  // Заголовок обязан совпадать с тем, что поле правда спрашивает: у
  // `withTime={false}` предлагать «дату и время» неверно. Ключ существующий -
  // тот же, которым подписано пусто-состояние ячейки даты. Одна переменная на
  // ДВА места (кнопка + заголовок шторки на телефоне): порознь они уже
  // разъезжались, и половинчатая правка оставила бы это на мобиле.
  const askLabel = t(withTime ? 'event.pick_datetime' : 'event.pick_date_short');
  const label = date
    ? DateTime.fromISO(date, { zone: 'utc' }).setLocale(lang).toFormat('d MMM yyyy')
      + (withTime && time ? `, ${time}` : '')
    : askLabel;

  // Cell variant: split date ("28 июн, вс") and time ("10:00") lines.
  const cellDate = date
    ? DateTime.fromISO(date, { zone: 'utc' }).setLocale(lang).toFormat('d MMM, ccc')
    : t('event.pick_date_short');

  const calendar = (
    <StartCalendar
      value={date || null}
      lang={lang}
      withTime={withTime}
      time={time}
      onPick={(iso) => emit(iso, time)}
      onTimeChange={(tm) => emit(date, tm)}
    />
  );

  // ОДНА кнопка на оба вида: меняются класс и содержимое, а не элемент. Веток
  // было две, и `{...rest}` стоял только на обычной - переданное ячейке МОЛЧА
  // пропадало; через этот же канал едет состояние валидации
  // (`{...fieldState(...)}`), TRIP-333.
  const isCell = variant === 'cell';
  const trigger = (
    <button
      type="button"
      className={`${isCell ? 'sd-cell' : 'input eed-dtbtn'}${date ? '' : ' is-empty'} ${className || ''}`}
      onClick={isSheet ? () => setOpen(true) : undefined}
      {...rest}
    >
      {isCell ? (
        <>
          {cellLabel != null && <span className="sd-cell__lbl" data-required={cellRequired || undefined}>{cellLabel}</span>}
          <span className="sd-cell__d t-strong">{cellDate}</span>
          {withTime && <span className="sd-cell__t t-mono">{time || '—:—'}</span>}
        </>
      ) : label}
    </button>
  );

  if (isSheet) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen} title={askLabel}>
          {calendar}
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="ts-startcal-pop">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}
