// @ts-check
import React from 'react';
import CountryFlag from '@/components/common/CountryFlag';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

// Country — страна города одной строкой: флаг и имя. ОДИН элемент на все
// поверхности, где рядом с городом стоит его страна: ряд редактора и шага 2
// (`CityRow`), якоря старта/финиша (`CityAnchorRow`), маршрут под лентой ИИ
// (`RouteRow`), шапка панели города (`CityPanel`), список городов рядом.
// До сведения композиция `<CountryFlag/> {country}` жила литералом в пяти
// файлах с тремя скинами (`.te-country`, `.lp-country`, `muted t-meta`) —
// элемент ДС по решению Pavel (TRIP-527).
//
// Имя: `name`, если вызыватель уже несёт локализованное (узел драфта/газеттира),
// иначе — из кода по языку зрителя (`fmtCountry`, канон TRIP-223: страна
// хранится кодом и локализуется в точке показа). Нет ни имени, ни кода —
// не рисуется ничего, проверка на вызывателе не нужна.
//
// Носитель — существующий `.te-country` (co-selector `.t-meta`, muted, nowrap,
// обрез многоточием; в `.te-cityline` уступает городу до 55% строки). Своих
// имён элемент не заводит; `.lp-country` снят вместе с литералом.
/**
 * @param {{ code?: string|null, name?: string|null }} p
 */
export function Country({ code, name }) {
  const { fmtCountry } = useI18nFormat();
  if (!code && !name) return null;
  const label = name || (code ? fmtCountry(code) : '');
  return (
    <span className="te-country">
      {code ? <><CountryFlag code={code} /> </> : null}{label}
    </span>
  );
}
