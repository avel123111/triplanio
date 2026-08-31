// @ts-check
import React from 'react';
import { Btn } from '@/design/index';
import { Row, Trunc } from '@/design/Layout';
import { useT } from '@/lib/i18n/I18nContext';
import CountryFlag from '@/components/common/CountryFlag';

/**
 * ВЫБРАННЫЙ ГОРОД + «ИЗМЕНИТЬ» — ОДИН РЯД НА ВСЕ ЭКРАНЫ.
 *
 * ★ ЕГО ПИСАЛИ ДВАЖДЫ, И ОБА РАЗА ПО-РАЗНОМУ. Композер города (визард и редактор
 * маршрута) рисовал `.te-add-city` с кнопкой `quiet`+иконка; диалог «добавить
 * место» в статистике собирал тот же ряд ЗАНОВО — своей карточкой с шестью
 * инлайнами (`display/alignItems/gap/padding/borderColor` + три на имени),
 * кнопкой `link` БЕЗ иконки и своим ключом подписи (`stats.change_city` против
 * `tse.pt_change`, при одинаковом тексте «Изменить»).
 * Один объект, две реализации: расходились они уже по трём осям — скин, вид
 * кнопки и адрес строки.
 *
 * Канон (решение Pavel): флаг · имя · brand-link с карандашом. Скин — `.te-add-city`
 * (существующий класс композера), новых имён не заводится.
 *
 * @param {{ city: any, onChange: () => void, changeLabel?: string }} p
 */
export default function SelectedCity({ city, onChange, changeLabel }) {
  const t = useT();
  return (
    <Row gap="g3" className="te-add-city">
      <CountryFlag code={city?.country_code} />
      <Trunc as="span" className="te-add-cityname">{city?.city_name}</Trunc>
      <Btn variant="link" icon="edit" onClick={onChange}>{changeLabel || t('tse.pt_change')}</Btn>
    </Row>
  );
}
