import React from 'react';
import { Icon } from '../../design/icons';
import { Card, Tile } from '../../design/index';
import { useT } from '@/lib/i18n/I18nContext';

// ─── CityAnchorRow ────────────────────────────────────────────────────────────
// ЯКОРЬ МАРШРУТА — ОДИН РЯД НА ОБА ЭКРАНА (TRIP-484 §4).
//
// ★ ЕГО РИСОВАЛИ ДВА КОМПОНЕНТА, И ОБА НА ОДНОМ КЛАССЕ `.te-end`: этот и
// `GridEndpoint` в редакторе маршрута. Один объект, две реализации — и они уже
// разошлись, причём молча:
//   • ОБЛИК: планировщик рисовал синий флаг обоим концам, редактор — зелёную
//     галочку финишу. Сведено к флагу (решение Pavel): у старта и финиша одна
//     роль — конец маршрута, и красить их по-разному незачем.
//   • УДАЛЕНИЕ: у редактора кнопка `.ts-step` с ЧЕТЫРЬМЯ инлайнами, у
//     планировщика `.te-step--del`, который НЕ БЫЛО ВИДНО ВООБЩЕ: у `.te-step`
//     базовый `opacity: 0`, открывает его правило `.te-row:hover .te-step`, а
//     якорь — не `.te-row`. То есть кнопка была в разметке и не показывалась
//     никогда, ни на одном экране, ни на десктопе, ни на тач.
//
// Слоты необязательные, потому что экраны показывают РАЗНОЕ об одном узле:
// планировщику важна страна (рядом с именем), редактору — дата вылета/прилёта
// (строкой ниже, `.te-dts`). Это не два облика одного ряда, а один ряд с двумя
// местами под факты.
//
// Режимы:
//   • read-only (по умолчанию): показывает город, либо «не указан», если пусто.
//   • editable: пусто → пунктирный аффорданс «+ {label}», нажатие ведёт в ОБЩИЙ
//     композер города (`cities/CityAdder`) с предвыбранным видом; заполнено →
//     кнопка удаления. Своего поля города у плитки нет намеренно: вход в
//     добавление на экране один.
/**
 * @param {{ label: any, city?: any, editable?: boolean, addLabel?: string,
 *   meta?: any, onAdd?: () => void, onRemove?: () => void }} p
 */
export function CityAnchorRow({ label, city, editable = false, addLabel, meta, onAdd, onRemove }) {
  const t = useT();
  const hasCity = !!city?.city_name;
  const accent = 'var(--brand)';
  const soft = 'var(--brand-soft)';

  if (editable && !hasCity) {
    return (
      <Card as="button" variant="add" radius="btn" pad="none" className="row row--g6 te-end te-end--add" onClick={onAdd}>
        <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name="plus" size={13} /></Tile>
        <div className="te-citycell grow">
          <span className="te-endlabel" style={{ color: accent }}>{label}</span>
          <span className="trunc te-cityname muted">{addLabel || t('planner.add_start')}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card recessed radius="btn" pad="none" className="row row--g6 te-end">
      <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name="flag" size={13} /></Tile>
      <div className="te-citycell grow">
        <span className="te-endlabel" style={{ color: accent }}>{label}</span>
        <div className="row row--g3 te-cityline">
          <span className="trunc te-cityname">{city?.city_name || <span className="muted">{t('planner.not_set')}</span>}</span>
          {city?.country && <span className="muted t-meta">{city.country}</span>}
        </div>
        {meta ? <div className="row row--g3 te-dts">{meta}</div> : null}
      </div>
      {/* Удаление — тот же контрол, что у ряда города (`.te-step--del`), а не своя
          кнопка с инлайнами. Видимость держит правило на `.te-end` в app.css:
          у якоря нет ховера ряда, которым `.te-step` открывается в таблице
          редактора, и на тач его нет ни у кого. */}
      {editable && hasCity && onRemove && (
        <button type="button" className="te-step te-step--del" onClick={onRemove} title={t('common.delete')} aria-label={t('common.delete')}><Icon name="trash" size={13} /></button>
      )}
    </Card>
  );
}
