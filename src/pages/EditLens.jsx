// @ts-check
/*
 * TRIP-349 — объявление изменений для гарда 2p (визуальный дифф CSS).
 *
 * Маркеры лежат ЗДЕСЬ, а не в app.css, намеренно: внутри CSS они попадают под
 * собственное гашение комментариев гарда, и многострочный блок с {@media …} он
 * начинает разбирать как правила — получил 20 ложных ключей и единицу «.css»,
 * вытащенную из слова app.css. Гард читает маркеры из ДОБАВЛЕННЫХ строк диффа,
 * поэтому файл значения не имеет.
 *
 * Почему их так много: правила редактора жили в теге <style> ВНУТРИ рендера
 * этого компонента, а 2p читает только .css — поэтому перенос выглядит для него
 * массовым появлением и сносом объявлений.
 *
 * Бланкетного маркера у 2p нет намеренно, и это правильно: один общий пропустил
 * бы вместе с переносом любую правку общего класса.
 *
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} background — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} box-shadow — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} max-width — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} transform — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} transition — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .is-open {@media (max-width: 880px)} opacity — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .is-open {@media (max-width: 880px)} pointer-events — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .is-open {@media (max-width: 880px)} transform — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .lp margin — артефакт одного победителя на ключ: .flow-editcol и .ts-leftbox в DOM не пересекаются
 * visual-diff-exempt: .te-panefade animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .te-panefade {@media (prefers-reduced-motion: reduce)} animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-col-right {@media (max-width: 1080px)} height — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-drawer display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} background — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} bottom — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} box-shadow — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} inset — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} left — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} max-width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} opacity — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} pointer-events — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} position — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} top — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} transform — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} transition — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} z-index — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} background — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} inset — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} opacity — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} position — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} transition — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-fab transition — FAB схлопнут на <IconBtn size="fab">, приватный .ts-fab снят; облик нажатия несёт примитив
 * visual-diff-exempt: .ts-fab:active transform — FAB схлопнут на <IconBtn size="fab">, scale-press снят намеренно (у примитива filter brightness)
 * visual-diff-exempt: .ts-fab:active {@media (prefers-reduced-motion: reduce)} transform — FAB схлопнут на <IconBtn size="fab">, приватный .ts-fab снят
 * visual-diff-exempt: .ts-fab:hover transform — FAB схлопнут на <IconBtn size="fab">, scale-press снят намеренно (у примитива filter brightness)
 * visual-diff-exempt: .ts-fab:hover {@media (prefers-reduced-motion: reduce)} transform — FAB схлопнут на <IconBtn size="fab">, приватный .ts-fab снят
 * visual-diff-exempt: .ts-grid display — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid gap — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid grid-template-columns — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid height — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid min-height — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid min-width — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid overflow — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 1080px)} grid-auto-rows — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 1080px)} grid-template-columns — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 1080px)} overflow-y — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} background — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} border — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} box-shadow — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} column-gap — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} display — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} grid-template-columns — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} margin — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} padding — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-in font-family — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in font-size — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in font-weight — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in letter-spacing — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in line-height — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-leftbox background — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox display — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox flex — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox flex-direction — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox margin — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox min-height — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox min-width — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox overflow — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox {@media (max-width: 1080px)} margin — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftscroll margin — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftscroll {@media (max-width: 1080px)} overflow — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-map {@media (max-width: 1080px)} left — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-pdrawer animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer background — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer border — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer border-radius — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer border-right — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer box-shadow — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer display — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer flex — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer flex-direction — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer inset — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer min-height — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer position — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer z-index — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer {@media (prefers-reduced-motion: reduce)} animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} background — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} border — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} box-shadow — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} column-gap — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} grid-template-columns — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} margin — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} padding — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} background — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} bottom — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} box-shadow — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} inset — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} left — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} max-width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} opacity — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} pointer-events — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} position — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} top — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} transform — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} transition — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} z-index — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol flex — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol height — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol min-height — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol min-width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol position — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol {@media (max-width: 880px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-step:active {@media (prefers-reduced-motion: reduce)} transform — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: from {@keyframes tePaneIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes tePaneIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tePaneIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tePaneIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes tsDrawerIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes tsDrawerIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tsDrawerIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tsDrawerIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 *
 * Шаги кейфреймов — тоже единицы 2p (имя анимации ЧАСТЬ ключа: from/to
 * повторяются у 19 анимаций, и без имени один маркер гасил бы чужую).
 *
 * Пол 2o: классы +4 при СНЕСЁННЫХ .ts-screen/.ts-sidecol/.ts-drawer/
 * .ts-drawer__scrim. Прироста имён нет — это те же правила, что жили в теге
 * style внутри рендера, где аудит их не видел; переехав в app.css, они стали
 * видимыми. Инлайны при этом −9, пространств имён 0.
 * floor-exempt: classes +4 — правила переехали из тега style внутри рендера в app.css, новых имён не заведено (апрув Pavel: перенос согласован в разборе TRIP-349)
 * floor-exempt: triage +4 — те же четыре класса, семья ts и так на разборе (апрув Pavel)
 * * Перенос скоупа мобильной компактной таблицы: .ts-screen (снесённая оболочка)
 * -> .ts-grid, живой класс и тоже только редакторский, значения те же.
 * visual-diff-move: .ts-screen .te-row -> ts-grid
 * visual-diff-move: .ts-screen .te-cell--act -> ts-grid
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { rpcSetCityNights, rpcSetTripStartDate, rpcAddCity, rpcRemoveCity, rpcReorderCities, refetchTrip } from '@/lib/tripEdit';
import { errorText } from '@/lib/errorText';
import { layoutDates } from '@/lib/tripDates';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { useIsPhone } from '@/hooks/use-mobile';
import { useRouteDnD } from '@/lib/useRouteDnD';
import CityRow from '@/components/trip/CityRow';
import NightsStepper from '@/components/trip/NightsStepper';
import { sortVisits, validateTrip, primaryIssues } from '@/lib/validation';
import { uniqueCityCount, localizeVisits } from '@/lib/trip-cities';
import { formatTripRange, formatDateRange } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import { Badge, Btn, IconBtn, Chip, Card, Tile, PageHead, useToast } from '../design/index';
import { Row, Grid, Trunc, Grow } from '../design/Layout';
import CitySearch from '@/components/cities/CitySearch';
import { tzFromCoords } from '@/lib/timezone';
import LpSheet from '@/components/ui/LpSheet';
import MapView from '@/components/views/MapView';
import EventSourcePanel from '@/components/common/EventSourcePanel';
import CityPanel from '@/components/common/CityPanel';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import AddBookingPanel from '@/components/bookings/AddBookingPanel';
import { ConflictsPanel } from '@/components/common/ValidationUI';
import { useT, useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { useStay22Bundle } from '@/lib/stay22';
import { useConfirm } from '@/components/common/ConfirmProvider';
import TripStartControl from '@/components/trip/TripStartControl';
import { transferKind } from '@/lib/transport';

// =====================================================================
// TRIP STRUCTURE EDITOR - "Сетка" (grid) design from the trip-structure-*
// prototype, wired to the real id-based model (city_visits + position),
// validateTrip conflicts (unified engine), live id-based RPC writes
// (add_city / remove_city / reorder_cities / set_city_nights). Live Google map.
// =====================================================================
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const fmtD = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d MMM') : '-'; };
const nightsBetween = (a, b) => { const x = toDT(a), y = toDT(b); return x && y ? Math.max(0, Math.round(y.diff(x, 'days').days)) : null; };
// Calendar-day helpers. nights/gap are counted by DATE (not by the raw timestamp),
// so a checkout stored at 23:59 isn't rounded up to an extra night. This is what
// makes recompute idempotent on load: re-deriving dates from (nights, gap)
// reproduces exactly what's stored, so editor = timeline = DB.
const dayOf = (iso) => { const d = toDT(iso); return d ? d.startOf('day') : null; };
const dayWord = (n, t) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';
// A city added in the editor but not yet persisted carries a 'tmp-…' id (no real uuid
// until add_city inserts it). A LIVE transfer write to such a city fails the
// uuid type, so transfer creation is gated until the new city is persisted.
const isTmpId = (id) => String(id || '').startsWith('tmp-');

// Canonical date-chain layout (start = prevEnd + gap; end = start + nights) now
// lives in lib/tripDates.layoutDates, shared with ManualPlanner and mirroring the
// server recompute_trip. Used here only as optimistic reorder layout.
const recompute = layoutDates;

// Adjacency-driven gap, mirroring server recompute_trip [R1]: a city's gap is 1
// ONLY when the transfer between it and the PREVIOUS node has day_change — not any
// transfer that merely points at this city. A baked gap goes stale after a reorder
// (the overnight transfer is no longer adjacent) and would drift +1 vs the server,
// so it must be re-derived on every (re)layout. ManualPlanner passes no transfers
// → all gap 0. The first non-anchor's gap now applies too (0043): an overnight
// start->first leg counts, anchored at the start-leg departure day.
function applyAdjacencyGaps(nodes, transfers = []) {
  let prevId = null;
  return nodes.map((n) => {
    // The finish anchor needs its incoming-leg gap so layoutDates can push the finish
    // +1 on an overnight last->finish leg (mirror server recompute_trip end branch).
    // The start anchor is the base — no incoming gap applies to it.
    if (isAnchor(n)) {
      const tr = (n.kind === 'end' && prevId) ? (transfers || []).find((t) => t.from_city_visit_id === prevId && t.to_city_visit_id === n.id) : null;
      const next = n.kind === 'end' ? { ...n, gap: tr?.day_change ? 1 : 0 } : n;
      prevId = n.id;
      return next;
    }
    const tr = prevId ? (transfers || []).find((t) => t.from_city_visit_id === prevId && t.to_city_visit_id === n.id) : null;
    const next = { ...n, gap: tr?.day_change ? 1 : 0 };
    prevId = n.id;
    return next;
  });
}

function buildDraft(shell, transfers = [], lang) {
  const visits = localizeVisits(sortVisits(shell?.cityVisits || []), lang);
  // nights = stored date span. gap (days between the previous checkout and this
  // check-in) now comes from the INCOMING transfer's day_change flag: an overnight
  // / day-change transfer means this city starts +1 day after the previous one.
  // No incoming transfer or day_change=false → gap 0 (flush). Source of truth =
  // transfers.day_change; the stored city dates are just the baked-in result.
  // gap is adjacency-driven (mirror server recompute_trip [R1]): a city's gap is 1
  // only if the transfer between it and the PREVIOUS node has day_change, NOT any
  // transfer that merely points at this city (which would survive a reorder and
  // drift +1 vs the server). The first non-anchor's gap applies too (mirror 0043):
  // an overnight start->first leg is the adjacency from the `start` anchor.
  const trBetween = (a, b) => (transfers || []).find((t) => t.from_city_visit_id === a && t.to_city_visit_id === b);
  let prevId = null;
  const nodes = visits.map((v, i) => {
    const base = { ...v, position: Number.isFinite(v.position) ? v.position : i };
    if (isAnchor(v)) { prevId = v.id; return { ...base, nights: null, gap: null }; }
    const sd = dayOf(v.start_date), ed = dayOf(v.end_date);
    const isWp = v.kind === 'waypoint';
    const nights = isWp ? null : Math.max(0, (sd && ed ? Math.round(ed.diff(sd, 'days').days) : 1));
    const tr = prevId ? trBetween(prevId, v.id) : null;
    const gap = tr?.day_change ? 1 : 0;
    prevId = v.id;
    return { ...base, nights, gap };
  });
  // Draft holds ONLY structure (nodes + removed cities + a FIXED trip start date).
  // Bookings are read LIVE from `content` (edits/adds via real dialogs → DB → refetch).
  // Trip base = the START anchor's own start_date — the single source of truth the
  // server writes via recompute_trip / set_trip_start_date. Mirrors the server's
  // _trip_anchor_date (which now prioritizes the same value). We must NOT derive it
  // from the start→first-leg transfer's departure datetime: recompute never updates
  // that datetime, so after a start-date shift it stays stale and the selector +
  // start-row would snap back to the old day while the cities show the new one
  // (TRIP-209). Fallback: first city's start.
  const firstTransit = nodes.find((n) => !isAnchor(n));
  const startAnchor = visits.find((v) => v.kind === 'start');
  const startDate = startAnchor?.start_date || firstTransit?.start_date || null;
  return { nodes, startDate };
}

// Compact month-grid date picker for the trip-start control. Tokens/icons from
// the design system; no new shared component. Picks an absolute start date which
// the caller turns into a delta shift (shiftStart) of the whole itinerary.
// Секция «Структура» — содержимое, а не экран. До TRIP-349 это был отдельный
// роут со СВОЕЙ оболочкой (шапка, два инстанса меню, свой drawer, свои запросы
// и гейты), дублировавшей оболочку экранов трипа. Теперь оболочку держит
// TripShell, а сюда приезжает уже загруженное и уже отгейченное:
//   shell   — тот же ответ TRIP_SHELL_KEY, что у TripView (trip + cityVisits)
//   content — тот же ответ TRIP_CONTENT_KEY (hotels/activities/transfers/members)
// Роль сюда НЕ передаётся: право на редактор проверяет реестр секций
// (canAccess: clearsStep(step,'editor')), а resolveSection подменяет недоступную секцию
// дефолтной — то есть по прямому адресу `?lens=edit` наблюдатель просто не
// попадёт. Своего ролевого гарда здесь нет намеренно, второй такой проверки
// быть не должно.
export default function EditLens({ tripId, shell, content }) {
  const t = useT();
  const { lang } = useI18n();
  const { fmtMoney } = useI18nFormat();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState(null);
  // Left-column panel FSM (replaces the old view/add modals). null = the city
  // list; otherwise the left pane swaps in-place to a panel:
  //   { type:'event', kind, id, warning }    - view/edit/delete a booking (EventSourcePanel)
  //   { type:'createTransfer', fromVisit, toVisit } - create a transfer (EventEditDialog panel variant)
  const [leftPanel, setLeftPanel] = useState(null);
  const closeLeftPanel = () => setLeftPanel(null);
  // ≤640px: the editor panel opens as a bottom sheet (same Radix sheet + swipe
  // mechanism as the modals), matching the .lp-sheet CSS breakpoint.
  const isSheet = useIsPhone();
  // TRIP-161: the two-column desktop layout (>1080px, mirrors the .ts-grid CSS
  // breakpoint). Only there do side panels open as a full-height drawer over the
  // left column; below it we keep the in-flow swap, ≤640 the bottom sheet.
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1081px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1081px)');
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // A11y: when an in-place left panel opens, move focus into it (its back button
  // if present) so keyboard/SR users land in the new context; Esc closes it.
  const leftPaneRef = useRef(null);
  useEffect(() => {
    if (!leftPanel || !leftPaneRef.current) return;
    const el = leftPaneRef.current.querySelector('button, [tabindex]') || leftPaneRef.current;
    requestAnimationFrame(() => el?.focus?.({ preventScroll: true }));
  }, [leftPanel]);
  const [showWarn, setShowWarn] = useState(false); // collapsible warnings overlay on the map
  const confirm = useConfirm(); // city delete → shared confirm (sheet on mobile)
  const [previewTransfer, setPreviewTransfer] = useState(null); // synthetic leg drawn on the map while creating a transfer
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // itinerary row hovered → highlight its map marker
  // Drag / FLIP / keyboard reorder live in the shared useRouteDnD hook (also used by
  // the trip-creation flow). It's instantiated below — once `ordered`, `isAnchor`
  // and the commit callback are in scope — and its returns are destructured there.
  // Живая модель: каждое изменение пишется сразу (ни драфта, ни лока, ни
  // «сохранить»), поэтому уход из секции — это просто размонтирование.
  // Optimistic local patch only; the server owns the authoritative state (refetched
  // after each action via runAction/closePanelAndSync). No undo/dirty/reset.
  const editDraft = (updater) => setDraft((d) => (d ? updater(d) : d));
  // Live edit: the optimistic local patch already ran. Persist via RPC, then reconcile
  // with the authoritative server state — but ONLY if this is still the latest action.
  // A monotonic seq drops stale reconciles so rapid edits don't snap the UI back to an
  // intermediate server state (no jitter). Per-action RPCs are also coalesced/debounced
  // by their callers (e.g. the nights stepper) so the server receives only the final value.
  const seqRef = useRef(0);
  // onResult(result) runs ONLY on RPC success, under the seq-guard, BEFORE the refetch —
  // e.g. addCity reconciles the real city_visit uuid returned by add_city into the draft
  // immediately (shrinks the tmp- window to the RPC latency instead of the full refetch).
  // okKey: optional `toast` subtitle key fired ONLY on real success. Passed by the
  // discrete actions (start date / add city / remove city); the frequent ones
  // (nights, reorder) leave it undefined so they stay silent and don't spam.
  const runAction = async (rpcFn, onResult, refetchOpts, okKey) => {
    const mySeq = ++seqRef.current;
    let result;
    try { result = await rpcFn(); }
    catch (e) {
      // Honest refusal: the seam carries a generic `code` → localized line via
      // errorText (never raw server prose, TRIP-378). A client-side throw without
      // a code falls back to the generic save-failed copy.
      const desc = e && 'code' in e ? errorText(t, e.code) : t('tse.err_save');
      toast({ description: desc, variant: 'destructive' });
      // RPC failed → drop the optimistic patch RIGHT AWAY by rebuilding from the last
      // good server state (cache-backed buildDraft). Don't gate the rollback on a
      // refetch that would also fail offline. If a newer action superseded us it owns
      // the state, so leave it alone.
      if (mySeq === seqRef.current) setDraft(null);
      return;
    }
    if (mySeq !== seqRef.current) return;           // superseded by a newer action → keep optimistic state
    if (onResult) { try { onResult(result); } catch { /* ignore */ } }
    // refetchOpts lets date-only actions (nights/start/reorder) skip the CONTENT half
    // (hotels/activities/transfers unchanged) → less work, less flicker. Default: both.
    try { await refetchTrip(qc, tripId, refetchOpts); } catch { /* ignore */ }
    if (mySeq !== seqRef.current) return;           // a newer action started during the refetch
    setDraft(null); // rebuild from fresh server state on next render (buildDraft)
    if (okKey) successToast(t, okKey);
  };
  // Any panel that may have WRITTEN transfers/bookings (create/event) closes through
  // here: pull fresh server state and rebuild the draft from it. The server already
  // recomputed the date chain (incl. overnight day_change, Ф2 trigger) and added any
  // layover cities to the shell, so the rebuild reflects them with no client-side
  // gap mirror or manual shell merge. seq-guard so a concurrent runAction wins.
  const closePanelAndSync = async () => {
    closeLeftPanel();
    const mySeq = ++seqRef.current;
    try { await refetchTrip(qc, tripId); } catch { /* ignore */ }
    if (mySeq !== seqRef.current) return;
    setDraft(null);
  };
  // Coalesced/debounced server commit for the nights stepper (one RPC after the burst).
  const nightsCommit = useRef(new Map());   // cityId -> timeout handle
  const nightsTarget = useRef(new Map());   // cityId -> latest target nights (sync source of truth)
  const startCommit = useRef(null);         // debounce handle for trip start shift
  const startTarget = useRef(null);         // latest target trip start ISO (sync source of truth)

  // ДОСЫЛКА ОТЛОЖЕННОГО ПРИ УХОДЕ. Оба дебаунса ждут 350 мс после последнего
  // клика, и до TRIP-349 у них не было ни cleanup, ни досылки: тап по степперу
  // ночей и уход в эти 350 мс — и RPC не улетал НИКОГДА. Локальная правка при
  // этом уже отрисована, поэтому потеря выглядит как «сервер молча откатил».
  //
  // Раньше, чтобы нарваться, надо было успеть сменить РОУТ; теперь уход — это
  // один тап по пункту меню, то есть попасть в окно стало заметно проще. Шлём
  // из cleanup напрямую, а не через runAction: компонент уже размонтирован,
  // seq-guard и рефетч ему ни к чему, а показать тост уже негде.
  //
  // Зависимостей нет намеренно: эффект обязан сработать РОВНО один раз, на
  // размонтировании, и прочитать refs в их последнем состоянии.
  // ...и ОБЯЗАТЕЛЬНО перезапрашиваем трип после досылки. Обычный путь делает это
  // через runAction; здесь его нет, а TripView остаётся смонтированным со своим
  // кэшем — то есть без рефетча Хронология нарисует СТАРЫЕ даты, а возврат в
  // «Структуру» пересоберёт драфт из того же протухшего кэша, и правка исчезнет
  // с экрана, оставшись в БД. Это ровно тот симптом «сервер молча откатил»,
  // ради которого досылка и писалась, — без рефетча она лечит половину.
  useEffect(() => () => {
    const pending = [];
    const nights = nightsCommit.current;
    for (const [id, handle] of nights) {
      clearTimeout(handle);
      const finalN = nightsTarget.current.get(id);
      if (finalN != null) pending.push(rpcSetCityNights(tripId, id, finalN));
    }
    nights.clear();
    nightsTarget.current.clear();
    if (startCommit.current) {
      clearTimeout(startCommit.current);
      startCommit.current = null;
      const finalBase = startTarget.current;
      startTarget.current = null;
      if (finalBase) pending.push(rpcSetTripStartDate(tripId, toDT(finalBase).toISODate()));
    }
    if (!pending.length) return;
    // Рефетч ПОСЛЕ того, как RPC доехали: пущенный сразу, он успел бы вернуть
    // ещё дореформенное состояние и записать в кэш именно его — то есть сам
    // стал бы причиной того отката, который лечит. allSettled, а не all:
    // упавшая RPC не должна отменять перезапрос остальных.
    // qc жив после размонтирования (это клиент приложения, а не наш стейт).
    Promise.allSettled(pending).then(() => refetchTrip(qc, tripId, { content: false })).catch(() => {});
  }, [tripId, qc]);

  // Запросов тут больше НЕТ: shell и content приезжают пропами от TripView.
  // Свои useQuery были не «второй загрузкой» (ключи и include те же, кэш общий),
  // а вторым набором ГЕЙТОВ рядом с первым - и разъехаться они могли молча, что
  // для экрана записи опаснее лишнего запроса.

  // Драфт строится СИНХРОННО в рендере (не эффектом), как только есть обе
  // половины: они уже в кэше у родителя, поэтому секция рисуется первым же
  // кадром, без скелетона.
  if (draft === null && shell && content) {
    setDraft(buildDraft(shell, content.transfers, lang));
  }

  const trip = shell?.trip;
  // Bookings are read LIVE from content. A removed city + its bookings are deleted
  // server-side immediately (remove_city cascade) and gone on the next refetch.
  const liveHotels = useMemo(() => (content?.hotels || []), [content]);
  const liveActivities = useMemo(() => (content?.activities || []), [content]);
  const liveTransfers = useMemo(() => (content?.transfers || []), [content]);
  // While creating a transfer, draw a synthetic leg on the map (shaped by the
  // picked transport type) so the route appears instantly, before saving.
  const mapTransfers = useMemo(() => {
    if (!previewTransfer) return liveTransfers;
    const others = liveTransfers.filter((t) => !(t.from_city_visit_id === previewTransfer.from_city_visit_id && t.to_city_visit_id === previewTransfer.to_city_visit_id));
    return [...others, previewTransfer];
  }, [liveTransfers, previewTransfer]);
  useEffect(() => { if (!(leftPanel?.type === 'create' && leftPanel.kind === 'transfer')) setPreviewTransfer(null); }, [leftPanel]);

  // ── Hotel-pick map badges (TRIP-140) ───────────────────────────────────────
  // While the hotel "fork" panel is open the map swaps the trip route for live
  // Stay22 badges. The SINGLE query + paging + committed filters + hovered/selected
  // live HERE (the common ancestor of MapView and the panel) so one pool feeds both
  // the list (now presentational) and the map badges. Desktop-only by design — the
  // editor map is hidden on phones via CSS.
  const hotelPickVisit = leftPanel?.type === 'pick' && leftPanel.kind === 'hotel' ? leftPanel.visit : null;
  const isHotelPick = !!hotelPickVisit;
  const stayCurrency = trip?.details?.main_currency || 'EUR';
  // TRIP-141/195: whole-city hotel pool + list state, packaged as the stay22
  // bundle by the shared useStay22Bundle hook (same hook the timeline's add-
  // booking drawer uses). Feeds the list (client pagination) here AND the map
  // pins below (editor only — timeline has no map).
  const { bundle: stay22Bundle, query: stayQuery, selectedId: staySelectedId, hoveredId: stayHoveredId, setSelectedId: setStaySelectedId, setHoveredId: setStayHoveredId, openHotelLink } = useStay22Bundle({
    visit: hotelPickVisit, currency: stayCurrency, lang, enabled: isHotelPick, tripId,
  });
  // Map pins: only stays that carry coordinates, with a compact price label (the
  // badge is tiny — long amounts like 252 400 ₽ are shortened to "252K"). While the
  // pool shows a PREVIOUS city (isPlaceholderData, keepPreviousData), emit no pins
  // so the camera doesn't fit to the old city while the new one loads.
  const hotelPins = useMemo(() => {
    if (!isHotelPick || stayQuery.isPlaceholderData) return isHotelPick ? [] : null;
    const list = stayQuery.data?.hotels || [];
    const cur = stayQuery.data?.meta?.currency || stayCurrency;
    return list
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => ({
        id: h.id, name: h.name, lat: h.lat, lng: h.lng,
        supplierLogo: h.supplierLogo,
        priceLabel: h.price != null ? fmtMoney(h.price, h.currency || cur, { compact: true }) : null,
      }));
  }, [isHotelPick, stayQuery.data, stayQuery.isPlaceholderData, stayCurrency, fmtMoney]);
  // Unified engine: validateTrip emits codes; primaryIssues collapses to <=1 per
  // entity (anti-pile). Adapt to the shape this screen already consumes
  // (resolved message + cityId/hotelId/activityId/transferId aliases + 'warn' level).
  const issues = useMemo(() => {
    if (!draft) return [];
    const raw = primaryIssues(validateTrip({ visits: draft.nodes, hotels: liveHotels, activities: liveActivities, transfers: liveTransfers }));
    return raw.map((i) => ({
      // All validation issues are advisory in the editor: nothing blocks Save.
      // Engine-level severity is collapsed to 'warn' so errors never gate saving
      // and the whole list renders as (orange) warnings.
      level: 'warn',
      code: i.code,
      message: t(`validation.${i.code}`, i.values),
      // raw refs for describeIssue/ConflictsPanel:
      entityKind: i.entityKind,
      entityId: i.entityId,
      values: i.values,
      // aliases consumed by openConflict / cityConflicts / transferMismatch:
      cityId: i.entityKind === 'city' ? i.entityId : undefined,
      hotelId: i.entityKind === 'hotel' ? i.entityId : undefined,
      activityId: i.entityKind === 'activity' ? i.entityId : undefined,
      transferId: i.entityKind === 'transfer' ? i.entityId : undefined,
      fromId: i.fromId,
      toId: i.toId,
    }));
  }, [draft, liveHotels, liveActivities, liveTransfers, t]);
  const errors = issues.filter((i) => i.level === 'error').length; // always 0 now (all issues are 'warn')
  const warns = issues.length - errors;

  // ---- structural edits ----
  // Trip start (d.startDate) is FIXED until shiftStart changes it. recompute chains
  // nodes from that date preserving each node's nights+gap, so editing one node only
  // moves the nodes after it; the start and earlier nodes never move. The reorder
  // commit (commitOrder, below) applies this same recompute before persisting.
  // Live-persist a new chain order (drag/keyboard reorder). tmp cities aren't in the
  // DB yet so skip until they're real (their add already refetches). One
  // reorder_cities → server recompute → refetch.
  const persistOrder = (ids) => { if (ids.some(isTmpId)) return; runAction(() => rpcReorderCities(tripId, ids), undefined, { content: false }); };
  // Shared drag/FLIP/keyboard reorder engine. `commitOrder` reproduces the prior
  // inline behavior EXACTLY: optimistic client recompute (adjacency gaps + date
  // chain from the fixed trip start) then live-persist the new chain order. Anchors
  // (start/end) stay pinned via the module-level `isAnchor`.
  const dndOrdered = draft ? sortVisits(draft.nodes) : [];
  const commitOrder = (ids) => {
    editDraft((d) => {
      if (!d) return d;
      const byId = new Map(d.nodes.map((n) => [n.id, n]));
      const nextNodes = ids.map((id) => byId.get(id)).filter(Boolean);
      return { ...d, nodes: recompute(applyAdjacencyGaps(nextNodes, liveTransfers), d.startDate) };
    });
    persistOrder(ids);
  };
  const { draggingId, overGap, pressingId, displayNodes, setRowRef, armDrag, moveNodeById, justDraggedRef } =
    useRouteDnD({ ordered: dndOrdered, isAnchor, onCommitOrder: commitOrder });
  // Nights 0..60. Hitting 0 turns a city into a waypoint (a 0-night transit
  // stop); raising a waypoint above 0 turns it back into a transit city.
  const nudgeNights = (id, delta) => {
    const node = draft.nodes.find((n) => n.id === id);
    if (!node || isAnchor(node)) return;
    // synchronous target survives rapid clicks before re-render; clamp 0..60
    const base = nightsTarget.current.has(id)
      ? nightsTarget.current.get(id)
      : (node.kind === 'waypoint' ? 0 : (node.nights || 0));
    const next = Math.max(0, Math.min(60, base + delta));
    if (next === base) return;
    nightsTarget.current.set(id, next);
    // partial optimism: instantly reflect ONLY the touched city (its nights + its own
    // end_date). Downstream dates are NOT recomputed on the client — they come from the
    // server (recompute_trip) on refetch. No second date engine in the editor.
    editDraft((d) => ({ ...d, nodes: d.nodes.map((n) => {
      if (n.id !== id) return n;
      const end = next > 0 && n.start_date ? toDT(n.start_date).plus({ days: next }).toISODate() : n.start_date;
      return next === 0
        ? { ...n, kind: 'waypoint', nights: 0, end_date: n.start_date }
        : { ...n, kind: 'transit', nights: next, end_date: end };
    }) }));
    if (String(id).startsWith('tmp-')) return;
    // debounce: send ONE set_city_nights with the FINAL value ~350ms after the last click
    const timers = nightsCommit.current;
    if (timers.has(id)) clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const finalN = nightsTarget.current.get(id);
      nightsTarget.current.delete(id);
      runAction(() => rpcSetCityNights(tripId, id, finalN), undefined, { content: false });
    }, 350));
  };
  const shiftStart = (delta) => {
    const cur = startTarget.current ?? draft?.startDate;
    const base = cur ? toDT(cur).plus({ days: delta }).toISO() : null;
    if (!base) return;
    startTarget.current = base;
    // partial optimism: shift ALL dates by the same delta (exact, no recompute engine)
    editDraft((d) => ({ ...d, startDate: base, nodes: d.nodes.map((n) => ({
      ...n,
      start_date: n.start_date ? toDT(n.start_date).plus({ days: delta }).toISODate() : n.start_date,
      end_date: n.end_date ? toDT(n.end_date).plus({ days: delta }).toISODate() : n.end_date,
    })) }));
    // debounce: send ONE set_trip_start_date with the FINAL value ~350ms after last click
    if (startCommit.current) clearTimeout(startCommit.current);
    startCommit.current = setTimeout(() => {
      startCommit.current = null;
      const finalBase = startTarget.current;
      startTarget.current = null;
      runAction(() => rpcSetTripStartDate(tripId, toDT(finalBase).toISODate()), undefined, { content: false }, 'start_date_updated');
    }, 350);
  };
  // Remove a city → confirm first. On confirm the city AND its attached bookings
  // leave the grid immediately (live remove_city cascade-deletes the city + children).
  // Bookings are stashed on the node so Restore brings them back.
  const removeCity = async (id) => {
    const n = draft.nodes.find((x) => x.id === id);
    if (!n) return;
    const ok = await confirm({
      title: t('tse.delete_city_q', { city: n.city_name }),
      description: t('tse.delete_city_desc'),
      confirmLabel: t('tse.delete_city'),
      variant: 'destructive',
    });
    if (ok) doRemoveCity(id);
  };
  // partial optimism: drop the node from the list now; downstream dates are NOT
  // recomputed on the client — the server (remove_city → recompute_trip) reflows
  // the chain and runAction refetches it. (removed-tray push stays until the
  // draft/tray teardown slice.)
  const doRemoveCity = (id) => {
    editDraft((d) => {
      const node = d.nodes.find((n) => n.id === id); if (!node) return d;
      return { ...d, nodes: d.nodes.filter((n) => n.id !== id) };
    });
    if (String(id).startsWith('tmp-')) return; // never persisted → no server rows / files
    // remove_city cascade-deletes this city's hotels/activities/transfers server-side, but
    // SQL can't reach Storage. Collect the SAME set's document paths and sweep them via the
    // single shared file primitive (removeTripFiles) — only AFTER the RPC succeeds (onResult),
    // else those bookings' files orphan until the whole trip is deleted (TRIP-137). Mirrors
    // remove_city's cascade set: transfers touching the city on either end.
    const orphanPaths = [
      ...liveHotels.filter((h) => h.city_visit_id === id),
      ...liveActivities.filter((a) => a.city_visit_id === id),
      ...liveTransfers.filter((tr) => tr.from_city_visit_id === id || tr.to_city_visit_id === id),
    ].flatMap((e) => collectDocPaths(e.documents));
    runAction(() => rpcRemoveCity(tripId, id), () => removeTripFiles(orphanPaths), undefined, 'city_removed');
  };
  const addCity = (city, kind = 'transit') => {
    if ((kind === 'start' && draft.nodes.some((n) => n.kind === 'start')) || (kind === 'end' && draft.nodes.some((n) => n.kind === 'end'))) {
      toast({ description: kind === 'start' ? t('tse.start_already_set') : t('tse.end_already_set'), variant: 'warning' });
      return;
    }
    // Optimistic placement: a new transit city must render at the END of the
    // route immediately. sortVisits orders by start_date, so a null-date node
    // would sort to the FRONT and then snap to the end once add_city →
    // recompute_trip returns real dates (the "jumps to the end" glitch). Seed it
    // with the trip's last known date (+ its nights) and a trailing position so it
    // lands in its final slot right away; it stays muted (tmp- id) until the
    // refetch swaps in real dates. 'start'/'end' are anchors ordered by rank, so
    // their dates don't affect placement.
    const provNights = kind === 'transit' ? 2 : null;
    const lastDate = draft.nodes.reduce((m, n) => { const e = n.end_date || n.start_date; return e && (!m || e > m) ? e : m; }, null);
    const maxPos = draft.nodes.reduce((m, n) => (Number.isFinite(n.position) && n.position > m ? n.position : m), -1);
    const provStart = kind === 'start' ? null : lastDate;
    const provEnd = provStart && kind === 'transit' ? toDT(provStart).plus({ days: provNights }).toISODate() : provStart;
    const node = {
      id: 'tmp-' + Math.random().toString(36).slice(2), kind,
      city_name: city.city_name, country_code: city.country_code || null,
      geonameid: city.geonameid ?? null, name_i18n: city.name_i18n || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || 'UTC', external_city_id: city.external_city_id || null,
      nights: provNights, gap: 0, start_date: provStart, end_date: provEnd,
      position: kind === 'start' ? -1 : maxPos + 1,
    };
    let insertIdx = null;
    // partial optimism: splice the tmp node into place; its dates stay null until
    // the server (add_city → recompute_trip) lays them and runAction refetches.
    // No client recompute — existing cities keep their dates.
    editDraft((d) => {
      const arr = d.nodes.slice();
      if (kind === 'start') { arr.unshift(node); insertIdx = 0; }
      else if (kind === 'end') { arr.push(node); insertIdx = null; }
      else { const endIdx = arr.findIndex((n) => n.kind === 'end'); insertIdx = endIdx === -1 ? null : endIdx; arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node); }
      return { ...d, nodes: arr };
    });
    const tmpId = node.id; // swap this tmp- id for the real uuid the moment add_city returns
    runAction(() => rpcAddCity(tripId, {
      kind,
      geonameid: city.geonameid ?? null, name_i18n: city.name_i18n || null,
      city_name_en: city.city_name_en || null,
      country_code: city.country_code || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || null, external_city_id: city.external_city_id || null,
    }, insertIdx), (realId) => {
      if (realId) editDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === tmpId ? { ...n, id: realId } : n)) }));
    }, undefined, 'city_added');
  };
  const onPickCity = async (c, kind) => {
    closeLeftPanel();
    const tz = tzFromCoords(c.latitude, c.longitude);
    addCity({ ...c, timezone: tz }, kind);
  };

  // ---- conflict / transfer dialogs (REAL app dialogs → write to DB → refetch) ----
  const openConflict = (c) => {
    if (c.hotelId) setLeftPanel({ type: 'event', kind: 'hotel', id: c.hotelId, warning: c.message });
    else if (c.activityId) setLeftPanel({ type: 'event', kind: 'activity', id: c.activityId, warning: c.message });
    else if (c.transferId) setLeftPanel({ type: 'event', kind: 'transfer', id: c.transferId, warning: c.message });
    else toast({ description: `${c.message} ${t('tse.fix_hint_suffix')}`, variant: 'warning' });
  };
  const openTransferRow = (a, b, tr) => {
    if (tr) {
      // Hierarchy guarantees ≤1 issue per transfer → show that real message.
      const issue = issues.find((i) => i.transferId === tr.id);
      setLeftPanel({ type: 'event', kind: 'transfer', id: tr.id, warning: issue?.message || null });
      return;
    }
    if (isTmpId(a?.id) || isTmpId(b?.id)) return; // pending city → seam is muted; silent safety net
    setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: a, toVisit: b });
  };

  // Ни шапки, ни гейтов, ни ролевого гарда тут больше нет:
  //   шапку и меню держит TripShell (раньше это была вторая, своя копия);
   //   гейты shell/content отработал TripView до того, как отрисовать секцию;
  //   право на редактор проверил реестр секций (canAccess: clearsStep(step,'editor')), и
  //   он же не пускает сюда по прямому адресу - resolveSection подменит
  //   недоступную секцию дефолтной.
  // Осталась ОДНА собственная проверка: без content драфт не построить.
  if (!draft) return null;

  const ordered = sortVisits(draft.nodes);
  const seq = ordered.filter((n) => !isAnchor(n));          // cities + waypoints, in order
  const cityCount = uniqueCityCount(draft.nodes);
  const dateRange = formatTripRange(draft.nodes, '-');
  const startDate = seq[0]?.start_date;
  const endDate = seq[seq.length - 1]?.end_date;
  const totalNights = nightsBetween(startDate, endDate);
  const cityConflicts = (id) => issues.filter((i) => i.cityId === id).length;
  const transferFor = (aId, bId) => liveTransfers.find((t) => t.from_city_visit_id === aId && t.to_city_visit_id === bId);
  // A transfer row is flagged (orange "не совпадает") when it has ANY conflict -   // date mismatch (D2), non-adjacent (D5) or dangling (D6).
  const transferMismatch = (t) => !!t && issues.some((i) => i.transferId === t.id);
  // booking lookups for the inline list cells + city panel
  const hotelFor = (id) => liveHotels.find((h) => h.city_visit_id === id);
  // Multiple hotels per city are allowed (parity with activities); the city
  // panel lists them all, while the compact grid cell still shows the first.
  const hotelsFor = (id) => liveHotels.filter((h) => h.city_visit_id === id);
  const actsFor = (id) => liveActivities.filter((a) => a.city_visit_id === id);
  const hotelWarnId = (hid) => !!hid && issues.some((i) => i.hotelId === hid);
  const actWarnId = (aid) => !!aid && issues.some((i) => i.activityId === aid);
  const arrivalFor = (id) => liveTransfers.find((t) => t.to_city_visit_id === id);
  const departureFor = (id) => liveTransfers.find((t) => t.from_city_visit_id === id);
  // Anchor dates: start = trip start (first city's start); finish = last city's
  // end, +1 day when the final leg into the finish is an overnight transfer
  // (day_change) — mirrors server recompute_trip's gap rule.
  const endNode = ordered.find((n) => n.kind === 'end') || null;
  const finishTransfer = endNode ? arrivalFor(endNode.id) : null;
  const finishDate = endDate && finishTransfer?.day_change
    ? (toDT(endDate)?.plus({ days: 1 })?.toISODate() || endDate)
    : endDate;
  // panel navigation
  const openCity = (id) => { if (justDraggedRef.current) { justDraggedRef.current = false; return; } setLeftPanel({ type: 'city', id }); };
  const openEvent = (kind, id) => setLeftPanel({ type: 'event', kind, id, warning: (issues.find((i) => i[`${kind}Id`] === id)?.message) || null });
  // hotel/transfer/activity have partner offers → show the PickPanel ("Развилка")
  // first; others go straight to the form.
  // A hotel/activity can only attach to a city with a real uuid — block while the
  // city is still pending (tmp- id, add_city in flight) so the write can't hit an FK.
  const createBooking = (kind, node) => { if (isTmpId(node?.id)) return; setLeftPanel(kind === 'hotel' || kind === 'activity' ? { type: 'pick', kind, visit: node } : { type: 'create', kind, visit: node }); };
  // Stay numbering (only nights-cities are numbered).
  const stayNumById = {};
  { let sc = 0; ordered.forEach((n) => { if (n.kind === 'transit') stayNumById[n.id] = ++sc; }); }
  // Live preview order, FLIP reorder, keyboard move, pointer-drag arm/move/end and
  // justDraggedRef are all provided by the shared useRouteDnD hook instantiated
  // above (destructured: displayNodes, draggingId, overGap, setRowRef, armDrag,
  // moveNodeById, justDraggedRef). The hook's commit path is `commitOrder`.
  // Transfers whose from/to cities are NOT adjacent in the route (or dangle on a
  // removed city) — shown in the "out of plan" tray instead of a connector.
  const adjPairs = new Set();
  for (let k = 0; k < ordered.length - 1; k++) adjPairs.add(`${ordered[k].id}>${ordered[k + 1].id}`);
  const outOfPlanTransfers = liveTransfers.filter((tr) => !adjPairs.has(`${tr.from_city_visit_id}>${tr.to_city_visit_id}`));
  const nodeName = (id) => draft.nodes.find((n) => n.id === id)?.city_name || '?';

  // Left-column panel (in-place, replaces the old modals). null → city list.
  let leftPanelEl = null;
  if (leftPanel?.type === 'cityadd') {
    leftPanelEl = (
      <CityAddPanel
        onPick={onPickCity} onBack={closeLeftPanel}
        hasStart={ordered.some((n) => n.kind === 'start')} hasEnd={ordered.some((n) => n.kind === 'end')}
      />
    );
  } else if (leftPanel?.type === 'event') {
    leftPanelEl = (
      <EventSourcePanel
        tripId={tripId}
        kind={leftPanel.kind} id={leftPanel.id} warning={leftPanel.warning}
        autoEdit={leftPanel.autoEdit} canEdit onClose={closePanelAndSync}
      />
    );
  } else if (leftPanel?.type === 'pick' || leftPanel?.type === 'create') {
    // TRIP-176: hotel / activity / transfer open the unified AddBookingPanel
    // (fork + manual form merged behind a tab). Services (esim/car/insurance)
    // keep the standalone fork → manual navigation.
    const isMergedKind = leftPanel.kind === 'hotel' || leftPanel.kind === 'activity' || leftPanel.kind === 'transfer';
    if (isMergedKind) {
      leftPanelEl = (
        <AddBookingPanel
          kind={leftPanel.kind} tripId={tripId} trip={trip}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          stay22={stay22Bundle}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          initialTab={leftPanel.type === 'create' ? 'manual' : 'find'}
          onPreviewTransfer={setPreviewTransfer}
          onClose={() => { setPreviewTransfer(null); closePanelAndSync(); }}
        />
      );
    } else if (leftPanel.type === 'pick') {
      leftPanelEl = (
        <ForkPartnerModal
          open variant="panel" type={leftPanel.kind} tripId={tripId} trip={trip}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          stay22={stay22Bundle}
          onManual={() => setLeftPanel({ type: 'create', kind: leftPanel.kind, visit: leftPanel.visit, fromVisit: leftPanel.fromVisit, toVisit: leftPanel.toVisit })}
          onOpenChange={(o) => { if (!o) closeLeftPanel(); }}
        />
      );
    } else {
      leftPanelEl = (
        <EventEditDialog
          open variant="panel" kind={leftPanel.kind} tripId={tripId}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          onPreviewTransfer={setPreviewTransfer}
          onOpenChange={(o) => { if (!o) { setPreviewTransfer(null); closePanelAndSync(); } }}
        />
      );
    }
  } else if (leftPanel?.type === 'city') {
    const node = ordered.find((n) => n.id === leftPanel.id);
    if (!node) { leftPanelEl = null; }
    else {
      const idx = ordered.indexOf(node);
      const prev = ordered.slice(0, idx).reverse().find((n) => !isAnchor(n) || n.kind === 'start');
      const next = ordered.slice(idx + 1).find((n) => !isAnchor(n) || n.kind === 'end');
      leftPanelEl = (
        <CityPanel
          node={node} cityNo={stayNumById[node.id]}
          hotels={hotelsFor(node.id)} acts={actsFor(node.id)}
          arrival={arrivalFor(node.id)} departure={departureFor(node.id)}
          arrivalWarn={transferMismatch(arrivalFor(node.id))} departureWarn={transferMismatch(departureFor(node.id))}
          prevCity={prev?.city_name} nextCity={next?.city_name}
          isHotelWarn={(h) => hotelWarnId(h?.id)} isActWarn={(a) => actWarnId(a.id)}
          onBack={closeLeftPanel}
          onRemove={() => { closeLeftPanel(); removeCity(node.id); }}
          onNightsMinus={() => nudgeNights(node.id, -1)} onNightsPlus={() => nudgeNights(node.id, 1)}
          onOpenHotel={(id) => openEvent('hotel', id)} onAddHotel={() => createBooking('hotel', node)}
          onOpenActivity={(id) => openEvent('activity', id)} onAddActivity={() => createBooking('activity', node)}
          onOpenTransfer={(tr) => openEvent('transfer', tr.id)}
          onAddArrival={() => { if (!prev) return; if (isTmpId(prev.id) || isTmpId(node.id)) return; setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: prev, toVisit: node }); }}
          onAddDeparture={() => { if (!next) return; if (isTmpId(node.id) || isTmpId(next.id)) return; setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: node, toVisit: next }); }}
        />
      );
    }
  }

  // Map camera focus following the open panel: city/hotel/activity → that city;
  // transfer → both cities. Falsy → whole-route auto-fit stays in charge.
  const coordOf = (n) => (n && n.latitude != null && n.longitude != null ? [n.longitude, n.latitude] : null);
  const byId = (id) => draft.nodes.find((n) => n.id === id);
  let mapFocus = null;
  if (leftPanel?.type === 'city') {
    const p = coordOf(byId(leftPanel.id)); if (p) mapFocus = [p];
  } else if (leftPanel?.type === 'event') {
    if (leftPanel.kind === 'transfer') {
      const tr = liveTransfers.find((x) => x.id === leftPanel.id);
      if (tr) mapFocus = [coordOf(byId(tr.from_city_visit_id)), coordOf(byId(tr.to_city_visit_id))].filter(Boolean);
    } else {
      const e = (leftPanel.kind === 'hotel' ? liveHotels : liveActivities).find((x) => x.id === leftPanel.id);
      const p = e && coordOf(byId(e.city_visit_id)); if (p) mapFocus = [p];
    }
  } else if (leftPanel?.type === 'create' || leftPanel?.type === 'pick') {
    if (leftPanel.kind === 'transfer') mapFocus = [coordOf(leftPanel.fromVisit), coordOf(leftPanel.toVisit)].filter(Boolean);
    else { const p = coordOf(leftPanel.visit); if (p) mapFocus = [p]; }
  }
  if (mapFocus && mapFocus.length === 0) mapFocus = null;
  // Which city node the open panel belongs to → its map marker shows the selected
  // state (single-city panels only; a transfer panel highlights no single city).
  let selectedNodeId = null;
  if (leftPanel?.type === 'city') {
    selectedNodeId = leftPanel.id;
  } else if (leftPanel?.type === 'event' && leftPanel.kind !== 'transfer') {
    const e = (leftPanel.kind === 'hotel' ? liveHotels : liveActivities).find((x) => x.id === leftPanel.id);
    selectedNodeId = e?.city_visit_id ?? null;
  } else if ((leftPanel?.type === 'create' || leftPanel?.type === 'pick') && leftPanel.kind !== 'transfer') {
    selectedNodeId = leftPanel.visit?.id ?? null;
  }
  // When a transfer panel is open, that leg shows the "selected route" state on
  // the map. We pass only the leg's id pair; MapView resolves geometry + kind
  // from the live transfers (which include the in-progress previewTransfer), so
  // the highlight is a single arc that updates as transport is added/changed.
  let selectedLegKey = null;
  if (leftPanel?.type === 'event' && leftPanel.kind === 'transfer') {
    const tr = liveTransfers.find((x) => x.id === leftPanel.id);
    if (tr) selectedLegKey = `${tr.from_city_visit_id}__${tr.to_city_visit_id}`;
  } else if ((leftPanel?.type === 'create' || leftPanel?.type === 'pick') && leftPanel.kind === 'transfer') {
    if (leftPanel.fromVisit?.id && leftPanel.toVisit?.id) {
      selectedLegKey = `${leftPanel.fromVisit.id}__${leftPanel.toVisit.id}`;
    }
  }
  // Key the left pane on its identity so React remounts it on panel change →
  // the .te-panefade entry animation replays.
  const panelKey = leftPanel ? `${leftPanel.type}:${leftPanel.id || leftPanel.kind || ''}` : 'list';
  // TRIP-161: on the desktop two-column layout every side panel EXCEPT "add
  // city" opens as a full-height drawer over the left column (route rail stays
  // mounted underneath; the map keeps interactive — no scrim). Add-city and the
  // ≤1080 / ≤640 fallbacks keep swapping the rail in place.
  const isDrawerPanel = !!leftPanel && leftPanel.type !== 'cityadd';
  const useDrawer = isWide && isDrawerPanel && !!leftPanelEl;
  const onPanelEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLeftPanel(); } };

  // Trip-start control — lives in the "Маршрут" panel header. The stepper shifts
  // the whole itinerary by ±1 day; tapping the date opens a calendar to jump to
  // any start (translated into a single delta shift, reusing shiftStart).
  const pickStart = (iso) => {
    if (!iso || !draft?.startDate) return;
    const delta = Math.round(toDT(iso).startOf('day').diff(toDT(draft.startDate).startOf('day'), 'days').days);
    if (delta !== 0) shiftStart(delta);
  };
  // Shared trip-start control (one element with the planner). The editor steps
  // by ±1 day via shiftStart and jumps via pickStart (delta → shiftStart).
  const startDateControl = draft ? (
    <TripStartControl date={draft.startDate} onStep={(d) => shiftStart(d)} onPickDate={pickStart} label={t('ai_plan.start')} popoverAlign="end" />
  ) : null;

  // Trip actions (Share / Settings / Members) all live in the left trip menu
  // (TripSidebar drawer); Copy trip moved into the Settings lens. The editor
  // header carries no duplicate buttons.

  // Секция отдаёт ТОЛЬКО своё содержимое. Оболочка (`.trip-shell` -> шапка ->
  // меню -> `.trip-content` -> скроллящееся тело) приезжает от TripShell, а
  // секция объявлена flush - тело без паддинга и без своего скролла, потому что
  // скроллит она сама, внутри колонок.
  //
  // Раньше здесь стояла ВТОРАЯ оболочка: `.ts-screen` с раскладкой инлайном
  // (`height: 100vh` вместо `100dvh` у трип-экранов), своя шапка, СВОЙ
  // выезжающий `.ts-drawer` и ДВА инстанса TripSidebar - для рельса и для
  // ящика. Телефонного шита меню у неё не было вовсе, поэтому на ≤640 меню
  // редактора вело себя не так, как на всех остальных экранах трипа.
  return (
      <div className="ts-grid">
        {/* LEFT - bordered container (same 14px inset / radius as the map box on
            the right). The "Маршрут" header is the container's header; an open
            side panel fills the same box. */}
        <div className="ts-col-left" style={{ position: 'relative', minWidth: 0, display: 'flex', minHeight: 0, background: 'var(--bg)' }}>
          <div className="ts-leftbox">
          <div key={useDrawer ? 'list' : panelKey} ref={useDrawer ? null : leftPaneRef} tabIndex={-1} onKeyDown={(leftPanel && !useDrawer) ? onPanelEsc : undefined} className="te-panefade" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
          {/* Desktop (>1080): "add city" replaces the column; other panels open as
              a drawer overlay (below) and the rail stays here. ≤1080: the panel
              replaces the column. ≤640: the column keeps the cities list and the
              panel opens as a Radix bottom-sheet (rendered below). */}
          {(!isSheet && !useDrawer && leftPanelEl) || (<>
          <div className="scrollbar-thin ts-leftscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '12px 12px 18px', background: 'transparent' }}>
          {/* Container header — канон `PageHead` (как на Budget): заголовок «Маршрут»
              + сводка маршрута сабтитлом (реюз totalNights/cityCount/dateRange, без
              новой логики), степпер старта трипа — в слот actions вместо кнопок.
              Скроллится ВМЕСТЕ со списком (не sticky); левая панель заменяет колонку. */}
          <PageHead
            title={t('planner.step_cities')}
            subtitle={[
              totalNights != null ? `${totalNights} ${dayWord(totalNights, t)}` : null,
              cityCount > 0 ? `${cityCount} ${cityCount === 1 ? t('trip.cities_count_one') : t('trip.cities_count_many')}` : null,
              dateRange && dateRange !== '-' ? dateRange : null,
            ].filter(Boolean).join(' · ') || undefined}
            actions={startDateControl}
          />
          <Grid className="te-thead" style={{ padding: '0 4px 6px' }}>
            <Trunc as="span" className="te-th" style={{ gridColumn: 3 }}>{t('tse.col_destination')}</Trunc>
            <Trunc as="span" className="te-th te-th--c" style={{ gridColumn: 4 }}>{t('tse.col_nights')}</Trunc>
            <Trunc as="span" className="te-th te-th--c" style={{ gridColumn: 5 }}>{t('tse.col_stay')}</Trunc>
            <Trunc as="span" className="te-th te-th--c" style={{ gridColumn: 6 }}>{t('budget.source_activity')}</Trunc>
          </Grid>
          <div className={'te-table' + (draggingId != null ? ' is-dragging' : '')}>
            {displayNodes.map((n) => {
              const next = displayNodes[displayNodes.indexOf(n) + 1];
              const tr = next ? transferFor(n.id, next.id) : null;
              const pending = isTmpId(n.id);       // city awaiting its real uuid (add_city in flight) → muted, non-editable
              const dragging = draggingId === n.id;
              const dragProps = {
                dragging,
                pressing: pressingId === n.id,
                onArm: (e) => armDrag(e, n.id),
                onMove: (dir) => moveNodeById(n.id, dir),
              };
              let body;
              if (isAnchor(n)) {
                body = <GridEndpoint node={n} date={n.kind === 'start' ? draft.startDate : finishDate} onRemove={() => removeCity(n.id)} />;
              } else if (n.kind === 'waypoint') {
                const aa = actsFor(n.id);
                body = <GridNode seg={n} cityConf={cityConflicts(n.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onAct={() => (aa.length ? openCity(n.id) : createBooking('activity', n))}
                  onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                  drag={dragProps} />;
              } else {
                const h = hotelFor(n.id); const aa = actsFor(n.id);
                body = <GridNode seg={n} stayNum={stayNumById[n.id]} cityConf={cityConflicts(n.id)}
                  hotel={h} hotelWarn={hotelWarnId(h?.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onHotel={() => (h ? openEvent('hotel', h.id) : createBooking('hotel', n))}
                  onAct={() => (aa.length ? openCity(n.id) : createBooking('activity', n))}
                  onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                  drag={dragProps} />;
              }
              return (
                <div className={'te-seamwrap' + (pending ? ' is-pending' : '')} key={n.id} ref={setRowRef(n.id)}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId((p) => (p === n.id ? null : p))}>
                  {body}
                  {/* Transfer chip straddles the seam to the next city. Stays
                      mounted during drag but melts away via CSS (.is-dragging),
                      then eases back on drop — adjacency is in flux mid-drag.
                      A seam touching a pending (tmp) city on either side is muted
                      (the incoming seam lives in the PREVIOUS row, so pass it
                      explicitly — CSS from this wrap can't reach it). */}
                  {next && (
                    <SeamTransfer a={n} b={next} t={tr} mismatch={transferMismatch(tr)} disabled={pending || isTmpId(next.id)} onOpen={() => openTransferRow(n, next, tr)} />
                  )}
                </div>
              );
            })}
          </div>

          {draggingId != null && ordered[ordered.length - 1]?.kind !== 'end' && (
            /* TRIP-343 объект 2 (H): НЕ карточка — drop-плейсхолдер DnD (add-аффорданс).
               Не surface-инлайн (фона нет). Рамка динамически подсвечивается brand при
               наведении перетаскивания (overGap) — это состояние dragover по ДАННЫМ, а у
               .card--add канона dragover нет (решение D «только существующий канон»),
               поэтому остаётся инлайном. */
            <div className="t-meta" style={{ marginTop: 8, height: 36, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-sm)', border: '1px dashed ' + (overGap === ordered.length ? 'var(--brand)' : 'var(--line)'), color: overGap === ordered.length ? 'var(--brand)' : 'var(--muted)', transition: 'color .15s var(--ease-out), border-color .15s var(--ease-out)' }}>
              {t('tse.move_to_end')}
            </div>
          )}
          <AddPointButton onOpen={() => setLeftPanel({ type: 'cityadd' })} />
          {outOfPlanTransfers.length > 0 && (
            /* TRIP-343 объект 2 (канал 3): утоплённая поверхность (--wash+рамка+радиус)
               снята с инлайна на <Card recessed>; остался раскладочный инлайн. */
            <Card recessed radius="md" pad="none" style={{ marginTop: 14, padding: '11px 13px' }}>
              <div className="eyebrow" style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="warning" size={12} style={{ color: 'var(--warning)' }} /> {t('tse.transfers_out_of_plan')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {outOfPlanTransfers.map((tr) => (
                  <Chip key={tr.id} icon="warning" onClick={() => openEvent('transfer', tr.id)}>
                    {nodeName(tr.from_city_visit_id)} → {nodeName(tr.to_city_visit_id)}
                  </Chip>
                ))}
              </div>
            </Card>
          )}
          </div>{/* /ts-leftscroll */}
          </>)}
          </div>{/* /te-panefade */}

          {/* Mobile: the editor panel opens as a bottom sheet — the SAME shared
              LpSheet shell as the global EventDrawerHost (native swipe +
              keyboard-safe reposition; backdrop / swipe-down / Back all close). */}
          {isSheet && leftPanelEl && (
            <LpSheet open onClose={closeLeftPanel} title={t('trip.edit_structure')}>
              {leftPanelEl}
            </LpSheet>
          )}
          </div>{/* /ts-leftbox */}

          {/* TRIP-161: side-panel DRAWER (city / fork / event view+edit) on the
              desktop two-column layout. Overlays the left column edge-to-edge, up
              to the map — no scrim, so the map (and its hotel pins) stays
              interactive. The route rail stays mounted underneath. */}
          {useDrawer && (
            <div key={panelKey} ref={leftPaneRef} tabIndex={-1} onKeyDown={onPanelEsc} className="ts-pdrawer">
              {leftPanelEl}
            </div>
          )}
        </div>

        {/* RIGHT - full-height map (always on; hidden on phones via CSS);
            warnings live in a collapsible overlay widget */}
        <div className="ts-col-right" style={{ position: 'relative', minWidth: 0, minHeight: 0, background: 'var(--bg)' }}>
          <div className="ts-map" style={{ position: 'absolute', inset: 14, left: 7, overflow: 'hidden', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
            {/* `visitsById` тут не было смысла: MapView его не объявляет и остаток
                пропов не собирает, а во всём репо это было единственное вхождение -
                то есть карта его никогда не читала, а Object.fromEntries считался
                на каждый рендер редактора. Нашла прагма. */}
            <MapView visits={draft.nodes} transfers={mapTransfers} showStartEnd mapControls
              focus={mapFocus}
              onCityClick={(pts) => { const v = (pts || []).find((x) => !isAnchor(x)) || (pts || [])[0]; if (v) openCity(v.id); }}
              selectedVisitId={selectedNodeId}
              hoveredVisitId={hoveredNodeId}
              selectedLegKey={selectedLegKey}
              hideRoute={isHotelPick}
              hotelPins={hotelPins}
              selectedHotelId={staySelectedId}
              hoveredHotelId={stayHoveredId}
              onHotelClick={(id) => { if (staySelectedId != null && String(staySelectedId) === String(id)) openHotelLink(id); else setStaySelectedId(id); }}
              onHotelHover={setStayHoveredId}
              colorScheme={typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT'} />
          </div>
          {/* Warnings: a round FAB (chat-dock sized) with a count badge; click → list. */}
          <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 10 /* design-token-exempt: локальный стек внутри карты редактора */, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, maxWidth: 'calc(100% - 32px)' }}>
            {showWarn && issues.length > 0 && (
              /* TRIP-343 объект 2 (канал 3): скин поверхности (--surface+рамка+радиус)
                 снят с инлайна на Card; тень поповера (--sh-3) остаётся инлайном (высота). */
              <Card radius="md" pad="none" className="scrollbar-thin" style={{ width: 'min(360px, calc(100vw - 32px))', maxHeight: '52vh', overflow: 'auto', boxShadow: 'var(--sh-3)', padding: 8 }}>
                <ConflictsPanel issues={issues} ctx={{ hotels: liveHotels, activities: liveActivities, transfers: liveTransfers, visits: draft.nodes }} onOpen={openConflict} defaultExpanded />
              </Card>
            )}
            <IconBtn
              size="fab"
              tone={issues.length ? 'warning' : 'success'}
              icon={issues.length ? 'warning' : 'check'}
              onClick={() => { if (issues.length) setShowWarn((v) => !v); }}
              ariaLabel={issues.length ? t('tse.warns_short', { n: warns }) : t('validation.panel_all_clear')}
              title={issues.length ? t('tse.warns_short', { n: warns }) : t('validation.panel_all_clear')}
            >
              {/* Счётчик — дочерним, реюзом `.badge--count` (прецедент — колокольчик):
                  позиция ко-селектором `.icon-btn > .badge--count`. */}
              {issues.length > 0 && (
                <Badge variant="count">{issues.length > 99 ? '99+' : issues.length}</Badge>
              )}
            </IconBtn>
          </div>
        </div>
      </div>
  );
}



function Conf({ n }) {
  const t = useT();
  if (!n) return null;
  return <Row as="span" inline gap="g1" className="te-warnbadge" title={t('tse.conflicts_n', { n })}><Icon name="warning" size={10} /> {n}</Row>;
}

// inline hotel / activity cells (design mockup HotelCell / ActCell)
function HotelCell({ hotel, warn, onClick }) {
  const t = useT();
  if (!hotel) return (
    <Btn variant="dashed" size="sm" icon="bed" iconRight="plus" onClick={onClick} title={t('hotel.add')} ariaLabel={t('hotel.add')} />
  );
  return (
    <Chip variant="tone" square icon="bed" className={warn ? 'is-warn' : ''} onClick={onClick} title={hotel.name}>
      {warn && <Icon name="warning" size={11} />}
    </Chip>
  );
}
function ActCell({ count, warn, onClick }) {
  const t = useT();
  if (!count) return (
    <Btn variant="dashed" size="sm" icon="ticket" iconRight="plus" onClick={onClick} title={t('budget.source_activity')} ariaLabel={t('budget.source_activity')} />
  );
  return (
    <Chip variant="tone" square icon="ticket" className={warn ? 'is-warn' : ''} onClick={onClick} title={count + ''}>
      <span className="num t-meta">{count}</span>
      {warn && <Icon name="warning" size={11} />}
    </Chip>
  );
}

/**
 * ⚠️ Тот же запечатанный набор, что у чужих компонентов: без аннотации TS выводит
 * тип из ДЕСТРУКТУРИЗАЦИИ и делает обязательным каждый проп без дефолта.
 *
 * Четыре `?` проверены УСТРОЙСТВОМ КОДА, а не намерением: у ветки `waypoint`
 * гостиницы нет по определению, она рисует ПУСТУЮ ячейку `.te-cell--hotel` и
 * `hotel`/`stayNum`/`hotelWarn`/`onHotel` не передаёт вовсе. Остальные уходят в
 * безусловно отрендеренные узлы и обязательны.
 *
 * @param {{ seg: any, stayNum?: any, cityConf: any, hotel?: any, hotelWarn?: any,
 *           acts?: any[], actWarn: any, onOpenCity: any, onHotel?: any, onAct: any,
 *           onNightsMinus: any, onNightsPlus: any, drag: any }} p
 */
function GridNode({ seg, stayNum, cityConf, hotel, hotelWarn, acts = [], actWarn, onOpenCity, onHotel, onAct, onNightsMinus, onNightsPlus, drag }) {
  const t = useT();
  const { lang } = useI18n();
  const stop = (e) => e.stopPropagation();
  // Drag handle: pointer-drag (lifts the row) + keyboard reorder (a11y). Click is
  // stopped so grabbing the grip never opens the city panel.
  const gripEl = (
    <span className="te-grip" role="button" tabIndex={0} aria-label={t('tse.move_up')}
      onClick={stop}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); drag.onMove(-1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); drag.onMove(1); }
      }}>
      <Icon name="drag" size={14} />
    </span>
  );
  if (seg.kind === 'waypoint') {
    return (
      <CityRow variant="editor" dragging={drag.dragging} pressing={drag.pressing} onArm={drag.onArm} onClick={onOpenCity}
        grip={gripEl}
        lead={<Tile as="span" className="te-row__node" style={{ '--hl-soft': 'transparent', '--hl-ink': 'var(--ev-transfer)', border: '1px dashed var(--ev-transfer)' }}><Icon name="arrowSwap" size={11} /></Tile>}
        name={seg.city_name}
        conf={<Conf n={cityConf} />}
        dates={<><span className="te-wptag">{t('tse.layover')}</span>{fmtD(seg.start_date, lang)}</>}>
        <NightsStepper value={0} onMinus={onNightsMinus} onPlus={onNightsPlus} minusDisabled />
        <div className="te-cell te-cell--hotel" />
        <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>
      </CityRow>
    );
  }
  return (
    <CityRow variant="editor" dragging={drag.dragging} pressing={drag.pressing} onArm={drag.onArm} onClick={onOpenCity}
      grip={gripEl}
      lead={<Tile as="span" className={'te-row__num' + (cityConf ? ' is-warn' : '')}>{stayNum}</Tile>}
      name={seg.city_name}
      conf={<Conf n={cityConf} />}
      dates={formatDateRange(seg.start_date, seg.end_date, (iso) => fmtD(iso, lang))}>
      <NightsStepper value={seg.nights} onMinus={onNightsMinus} onPlus={onNightsPlus} minusDisabled={(seg.nights || 0) <= 0} />
      <div className="te-cell te-cell--hotel" onClick={stop}><HotelCell hotel={hotel} warn={hotelWarn} onClick={onHotel} /></div>
      <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>
    </CityRow>
  );
}

// Transfer chip that STRADDLES the seam between two city rows (sits on the
// separator line, its surface bg covering it — it doesn't split the rows). A pill
// when the transfer exists, a dashed "+ переезд" when not. Click → transport panel
// (existing) or the "Развилка" pick panel (new). Same-city legs show nothing.
function SeamTransfer({ a, b, t, mismatch, disabled, onOpen }) {
  const tx = useT();
  const { lang } = useI18n();
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id) || (a.city_name && a.city_name === b.city_name);
  if (sameCity && !t) return null;
  const click = disabled ? undefined : onOpen; // a seam next to a pending city is inert
  if (!t) {
    return (
      <Row justify="j-center" className="te-seam">
        <Chip variant="placeholder" icon="plus" disabled={disabled} onClick={click} title={`${a.city_name} → ${b.city_name}`}>
          {tx('tse.add_transfer')}
        </Chip>
      </Row>
    );
  }
  const meta = transferKind(t.transport_type);
  return (
    <Row justify="j-center" className="te-seam">
      <Chip variant="tone" icon={mismatch ? 'warning' : meta.icon} className={mismatch ? 'is-warn' : ''} disabled={disabled} onClick={click} title={`${a.city_name} → ${b.city_name}`}>
        <span className="t-meta">{tx(meta.labelKey)}{mismatch ? tx('tse.mismatch_suffix') : ''}</span>
        {/* Тултип овернайта был МЁРТВ: `Icon` деструктурирует свои пропы без
            остатка, `title` до DOM не доезжал вовсе, а под ключ `tse.overnight_title`
            написаны переводы на en/es/ru и он больше нигде не используется.
            Носителем сделан span, а не проп `Icon`: у всех трёх веток `Icon`
            корень - тег svg, а тултип в SVG это ДОЧЕРНИЙ элемент title, не
            атрибут, то есть «пробросить title» в ДС - не одна строка и требует
            апрува.
            ⚠️ Угловые скобки тут писать НЕЛЬЗЯ: гард 2d читает НАПИСАНИЕ, включая
            комментарии, и пара `<svg>` … `<title>` с текстом между ними читается
            им как сырая JSX-строка - первая редакция этого абзаца роняла CI. */}
        {t.day_change && <span title={tx('tse.overnight_title')}><Icon name="moon" size={11} style={{ color: 'var(--brand)' }} /></span>}
        <span className="num muted t-meta">· {fmtD(t.start_datetime, lang)}</span>
      </Chip>
    </Row>
  );
}

// Start / Finish anchor row — flag (start) / check (finish) node, label + city,
// departure/arrival date below. Flat flex row in the itinerary table.
function GridEndpoint({ node, date, onRemove }) {
  const t = useT();
  const { lang } = useI18n();
  const isStart = node.kind === 'start';
  const accent = isStart ? 'var(--brand)' : 'var(--success-ink)';
  const soft = isStart ? 'var(--brand-soft)' : 'var(--success-soft)';
  return (
    <Card recessed radius="md" pad="none" className="row row--g6 te-end">
      <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name={isStart ? 'flag' : 'check'} size={13} /></Tile>
      <Grow className="te-citycell">
        <span className="te-endlabel" style={{ color: accent }}>{isStart ? t('ai_plan.start') : t('ai_plan.end')}</span>
        <Row gap="g3" className="te-cityline">
          <Trunc as="span" className="te-cityname">{node.city_name}</Trunc>
        </Row>
        <Row gap="g3" className="te-dts">
          {isStart ? t('tse.departure_word') : t('tse.arrival_word')} · {fmtD(date || node.start_date || node.end_date, lang)}
        </Row>
      </Grow>
      <button className="ts-step" style={{ width: 24, height: 24, color: 'var(--muted)', flexShrink: 0 }} onClick={onRemove} title={t('tse.remove')}><Icon name="close" size={13} /></button>
    </Card>
  );
}

function AddPointButton({ onOpen }) {
  const t = useT();
  return <Btn variant="soft" block onClick={onOpen} style={{ marginTop: 12 }}>
    <Icon name="plus" size={15} /> {t('tse.add_point_btn')}
  </Btn>;
}

const POINT_TYPES = [
  { id: 'transit', labelKey: 'event.city', icon: 'bed', subKey: 'tse.pt_transit_sub' },
  { id: 'waypoint', labelKey: 'tse.pt_waypoint', icon: 'arrowSwap', subKey: 'tse.pt_waypoint_sub' },
  { id: 'start', labelKey: 'ai_plan.start', icon: 'flag', subKey: 'tse.pt_start_sub' },
  { id: 'end', labelKey: 'ai_plan.end', icon: 'flag', subKey: 'tse.pt_end_sub' },
];
// In-place "add a point" panel (replaces the old modal). Lives in the editor's
// left column; picks a point type then searches a city.
function CityAddPanel({ onPick, onBack, hasStart, hasEnd }) {
  const t = useT();
  const [type, setType] = useState('transit');
  const disabledFor = (id) => (id === 'start' && hasStart) || (id === 'end' && hasEnd);
  const meta = POINT_TYPES.find((p) => p.id === type);
  // Канал тинта --hl* тут не заполняется: у панели добавления точки своего тона
  // нет, а дефолт канала в :root и есть бренд. Инлайн, писавший на корень ровно
  // эти два дефолта, снят в 04 PR3 — он не менял ничего.
  return (
    <div className="lp lp--wide">
      <div className="lp-h lp-h--ev">
        <IconBtn icon="back" tone="soft" round onClick={onBack} title={t('common.back')} ariaLabel={t('common.back')} />
        <Tile as="span" className="lp-ic" style={{ '--hl-soft': 'var(--brand)', '--hl-ink': '#fff' }}><Icon name="pin" size={17} /></Tile>
        <div className="lp-ti">
          <b>{t('tse.add_point')}</b>
          <span>{t('tse.add_point_hint')}</span>
        </div>
      </div>
      <div className="lp-b scrollbar-thin">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 7 }}>
          {POINT_TYPES.map((pt) => {
            const dis = disabledFor(pt.id), active = type === pt.id;
            /* TRIP-343 объект 2 (H): НЕ карточка — тайл-переключатель ТИПА точки
               (объект 5, сегмент/пикер). Тон меняется по выбору (brand-soft/surface),
               это контрол выбора, а не поверхность-карточка; остаётся инлайном с reason. */
            return <button key={pt.id} disabled={dis} onClick={() => setType(pt.id)} title={dis ? t('tse.already_set') : t(pt.subKey)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px', borderRadius: 'var(--r-sm)', cursor: dis ? 'not-allowed' : 'pointer', background: active ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (active ? 'var(--brand)' : 'var(--line)'), color: dis ? 'var(--muted-2)' : active ? 'var(--brand)' : 'var(--ink-2)', opacity: dis ? 0.5 : 1 }}>
              <Icon name={pt.icon} size={17} /><span className="t-meta">{t(pt.labelKey)}</span>
            </button>;
          })}
        </div>
        <div className="muted t-meta">{meta ? t(meta.subKey) : ''}</div>
        <CitySearch onSelect={(c) => onPick(c, type)} />
      </div>
      <div className="lp-f lp-f--single">
        <Btn variant="secondary" onClick={onBack}>{t('common.cancel')}</Btn>
      </div>
    </div>
  );
}

// (Conflicts and transfer rows now open in-place LEFT panels: EventSourcePanel
//  for view/edit/delete, EventEditDialog variant="panel" for transfer create.
//  The old view/add modals were removed in the panel redesign Ф3.)
