// @ts-check
import React from 'react';
import { Icon } from './icons';

// ----- Tile ----- (TRIP-391, объект 3 — плитка-иконка, PR-0 Фундамент)
// Квадрат с радиусом и тинтом, внутри отцентрирована иконка (или число/буква).
// Схлопывает 47 приватных пространств имён, рисовавших ОДИН объект своими
// сторонами (17·18·30·34·38·44·66) и своими тинтами (`background:--brand-soft;
// color:--brand` встречается побайтно 7 раз, `--ev-*-soft`/`--ev-*-ink` — ещё 24).
//
// ★ НОВОГО ИМЕНИ НЕТ. `.tile` — уже канон-семья (`app.css:2702`, апрув Pavel
// TRIP-321 Ф12.0). Правится не имя, а то, что у неё появляется ОБЪЯВЛЕННЫЙ
// компонент-обёртка, а частные копии умирают экран за экраном (пересадки —
// следующими PR, здесь только фундамент, как карточка (PR 791) и `IconBtn` (PR 708).
//
// ★ ДВЕ ОСИ — РАЗМЕР и ТОН — И ОБЕ УЖЕ В CSS. Размер = ступень ручек
// `--tile`/`--tile-ic`/`--tile-r` (`.tile--sm/lg/xl/2xl`, дефолт 34px). Тон = роль-
// токен мягкого оттенка значка (`.tile--brand/danger/ai/info/success/quiet/
// warning`), заливка `--solid`, круг `--round`. Компонент их только ЭМИТИТ —
// ни одного нового правила. Размер плитки и кегль иконки — РАЗНЫЕ оси: кегль
// несёт `--tile-ic` внутри ступени, `.tile > svg` МОЛЧА бьёт проп `size`
// у `<Icon>` (так и задумано, см. канон), поэтому `<Icon>` тут без размера —
// его диктует ступень.
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ, а не в барреле `design/index.jsx` — ровно как `IconBtn`,
// поле (TRIP-333) и раскладка (TRIP-388): баррель реэкспортит `components/ui/*`,
// объявление ЗДЕСЬ замкнуло бы кольцо через них. Экраны зовут плитку через
// баррель (точка входа в ДС одна); напрямую отсюда — только тот, кому иначе
// кольцо не разорвать.
//
// ★ БАЗА АННОТАЦИИ = `<div>` — туда уезжает остаток пропов (урок ревью Codex,
// TRIP-388). Носитель полиморфен (`as`), но плитка декоративна: кликабельная
// плитка получает кнопку из объекта 1 (`IconBtn`/`Btn`), а не мутирует `as` тут.
// Закрыты СВОИ оси: `tone="compact"` — ошибка типа; `data-*`/`aria-*` законны.
//
// `children` — для НЕ-иконочного содержимого (номер точки маршрута, буква):
// плитка не всегда несёт `<Icon>`. Если задан `icon`, рисуется он; иначе `children`.
/** @typedef {'sm'|'lg'|'xl'|'2xl'} TileSize */
/** @typedef {'brand'|'danger'|'ai'|'info'|'success'|'quiet'|'warning'|'warm'} TileTone */
export const Tile = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<'div'> & {
   *   icon?: string,
   *   size?: TileSize,
   *   tone?: TileTone,
   *   round?: boolean,
   *   solid?: boolean,
   *   as?: 'div'|'span',
   *   children?: any,
   * }} p
   */
  ({
    icon, size, tone, round, solid, as = "div",
    className = "", children, ...rest
  }, ref) => {
    const El = /** @type {any} */ (as);
    return (
      <El
        ref={ref}
        className={[
          "tile",
          size && `tile--${size}`,
          tone && `tile--${tone}`,
          round && "tile--round",
          solid && "tile--solid",
          className,
        ].filter(Boolean).join(" ")}
        {...rest}
      >
        {icon ? <Icon name={icon} /> : children}
      </El>
    );
  },
);
Tile.displayName = "Tile";

// ── Карты осей — источник витрины `/kit` и теста дрейфа (TRIP-344/391). Тот же
// union, что типизирует пропы (не параллельный массив): `size="huge"` — ошибка
// типа, страница объекта полна по построению. Дефолт (34px) в карту не входит —
// у него нет класса-модификатора, его рисует базовый образец. `round`/`solid`
// (булевы оси) и `warm` идут в `extras` реестра витрины.
//
// ★ `warm` НЕ в `TILE_TONES`, хотя есть в `TileTone`. У него нет ОТДЕЛЬНОГО
// мягкого правила: единственная форма — `.tile--solid.tile--warm` (канон,
// `app.css:2867`: «--warm мягким тоном НЕ заводится, его единственный вызов
// залитый»). Значит `warm` — валидный литерал ТОЛЬКО с `solid`; в карте мягких
// тонов его быть не должно (иначе витрина нарисовала бы плитку без фона).
/** @type {readonly TileSize[]} */
export const TILE_SIZES = ["sm", "lg", "xl", "2xl"];
/** @type {readonly TileTone[]} */
export const TILE_TONES = ["brand", "danger", "ai", "info", "success", "quiet", "warning"];
