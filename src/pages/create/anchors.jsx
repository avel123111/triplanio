import React from 'react';
import { Icon } from '../../design/icons';
import { Card, Tile } from '../../design/index';
import { useT } from '@/lib/i18n/I18nContext';

// ─── CityAnchorRow ────────────────────────────────────────────────────────────
// Start / finish plate — the SAME element as the editor's GridEndpoint (.te-end:
// flag node, eyebrow label, bold .te-cityname). One look across every create
// screen (planner steps + AI draft). Endpoint marker is a single blue flag
// (unified — no green-check / orange-globe divergence).
//
// Modes:
//   • read-only (default): shows the resolved city, or "не указан" when empty.
//   • editable: пусто → пунктирный аффорданс «+ {label}», нажатие ведёт в ОБЩИЙ
//     композер города (`cities/CityAdder`) с предвыбранным видом; заполнено →
//     кнопка удаления. Своего поля города у плитки нет намеренно: вход в
//     добавление на экране один (TRIP-484 §4).
export function CityAnchorRow({ label, city, editable = false, onAdd, onRemove }) {
  const t = useT();
  const hasCity = !!city?.city_name;
  const accent = 'var(--brand)';
  const soft = 'var(--brand-soft)';

  // Пусто и можно править → аффорданс «добавить». Своего пикера у него БОЛЬШЕ
  // НЕТ: раньше плитка разворачивалась в собственное поле города — четвёртый вход
  // добавления со своими правилами (без выбора вида, без подтверждения). Теперь
  // нажатие ведёт в общий композер, и вид точки там предвыбран стартом.
  if (editable && !hasCity) {
    return (
      <Card as="button" variant="add" radius="btn" pad="none" className="row row--g6 te-end te-end--add" onClick={onAdd}>
        <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name="plus" size={13} /></Tile>
        <div className="te-citycell grow">
          <span className="te-endlabel" style={{ color: accent }}>{label}</span>
          <span className="trunc te-cityname muted">{t('planner.add_start')}</span>
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
      </div>
      {/* TRIP-391 объект 1: .te-step — КОНТРОЛ степпера маршрута (удалить точку),
          не кнопка-примитив. */}
      {editable && hasCity && onRemove && (
        <button type="button" className="te-step te-step--del" onClick={onRemove} title={t('common.delete')} aria-label={t('common.delete')}><Icon name="trash" size={13} /></button>
      )}
    </Card>
  );
}
