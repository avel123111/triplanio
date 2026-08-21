import React, { useMemo, useState } from 'react';
import { sortVisits } from '@/lib/validation';
import { Card, Skeleton } from '@/design/index';
import RouteMapCard from '@/components/trips/RouteMapCard';
import RouteStripCard from '@/components/trips/RouteStripCard';
import TripStatRow from '@/components/trips/TripStatRow';
import BudgetSummaryCard from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard from '@/components/trips/MembersSummaryCard';
import ServicesCard from '@/components/trips/ServicesCard';
import { useTripAccess } from '@/components/trips/TripAccessContext';

// Скелетон Обзора — PURE, канон <Skeleton>, геометрия повторяет реальный layout
// командного центра (маршрут + статбар + бюджет + участники · карта-канвас).
// Один источник для обеих фаз загрузки (shell в TripView.LoadingBody и content).
export function OverviewSkeleton() {
  const bar = (w, h, r = 8, mt = 0) => (
    <Skeleton w={w} h={h} r={r} style={mt ? { marginTop: mt } : undefined} />
  );
  const dot = <Skeleton w={32} h={32} r="var(--r-sm)" style={{ flex: 'none' }} />;
  return (
    <div className="ovwrap" aria-busy="true">
      <div className="ov-col">
        <Card radius="lg" pad="none" className="ov-route">
          <div className="wdg-h">{dot}{bar('38%', 16, 6)}</div>
          <div className="wdg-b">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ov-stop">
                <Skeleton w={29} h={29} r="50%" />
                <div className="grow">{bar('50%', 13, 5)}{bar('70%', 11, 5, 6)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card radius="lg" pad="none" className="statbar">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="s" key={i}>
              <Skeleton w={34} h={34} r="var(--r-sm)" style={{ flex: 'none' }} />
              <div className="grow">{bar('55%', 22, 6)}{bar('80%', 10, 5, 7)}</div>
            </div>
          ))}
        </Card>
        <Card radius="lg" pad="none">
          <div className="wdg-h">{dot}{bar('45%', 16, 6)}</div>
          <div className="wdg-b">
            {bar('55%', 26, 'var(--r-sm)')}
            {bar('100%', 11, 'var(--r-pill)', 14)}
            {bar('100%', 14, 'var(--r-sm)', 12)}
            {bar('100%', 14, 'var(--r-sm)', 8)}
            {bar('100%', 14, 'var(--r-sm)', 8)}
          </div>
        </Card>
        <Card radius="lg" pad="none">
          <div className="wdg-h">{dot}{bar('45%', 16, 6)}</div>
          <div className="wdg-b">
            {[0, 1, 2].map((i) => (
              <div key={i} className="mrow">
                <Skeleton w={34} h={34} r="50%" style={{ flex: 'none' }} />
                <div className="fl1">{bar('60%', 13, 5)}{bar('40%', 11, 5, 6)}</div>
              </div>
            ))}
            {bar('100%', 42, 'var(--r-sm)', 14)}
          </div>
        </Card>
      </div>
      <div className="ov-col ov-col--map">
        <Card radius="lg" pad="none" raised className="ov-mapcard">
          <div className="wdg-h">{dot}{bar('38%', 16, 6)}</div>
          <Skeleton w="100%" h={280} r={0} />
        </Card>
      </div>
    </div>
  );
}

// Trip Overview — «КОМАНДНЫЙ ЦЕНТР» трипа (редизайн экранов, задача Pavel).
// Слева — содержание поездки одной колонкой: ЛЕНТА МАРШРУТА (остановки
// ring-маркерами + чипы переездов), стат-полоса, бюджет, участники, сервисы.
// Справа — КАРТА-КАНВАС на всю высоту (sticky): клик по остановке в ленте
// выделяет её пин и перелетает карту; клик по пину подсвечивает остановку в
// ленте. На мобиле карта возвращается верхней фикс-панелью, колонки — одной.
// Все виджеты — переиспользуемые карточки; линза только composes + wires nav.
export default function OverviewLens({
  trip,
  visits = [],
  transfers = [],
  budget,
  budgetExpenses = [],
  budgetCategories = [],
  members = [],
  memberProfiles = {},
  services = [],
  user,
  isLoading = false,
  contentLoading = false,
  active = true,
  budgetEnabled = false,
  onOpenMap,
  onOpenBudget,
  onOpenMembers,
  onAddService,
  onOpenService,
  onBudgetLocked,
  onOpenEdit = null,
}) {
  // Право управления (editor) — из единого контекста доступа (TRIP-274 Ф2.2),
  // раздаётся подкартам (бюджет/участники) как булев проп.
  const { canEdit: canManage } = useTripAccess();
  const orderedVisits = useMemo(() => sortVisits(visits), [visits]);
  // Выделенная остановка: единый стейт ленты и карты. Храним ЦЕЛИКОМ визит —
  // карте нужны и id (подсветка пина), и координаты (focus → flyTo).
  const [selStop, setSelStop] = useState(null);
  const selectStop = (v) => setSelStop((cur) => (cur?.id === v?.id ? null : v));

  if (isLoading) return <OverviewSkeleton />;

  return (
    <div className="ovwrap">
      <div className="ov-col">
        <div className="ov-anim">
          <RouteStripCard
            visits={visits}
            transfers={transfers}
            selectedId={selStop?.id || null}
            onStopClick={selectStop}
            onOpenEdit={onOpenEdit}
            canManage={canManage}
          />
        </div>
        <div className="ov-anim">
          <TripStatRow visits={visits} transfers={transfers} trip={trip} orderedVisits={orderedVisits} />
        </div>
        <div className="ov-anim">
          <BudgetSummaryCard
            trip={trip}
            budget={budget}
            budgetExpenses={budgetExpenses}
            budgetCategories={budgetCategories}
            canManage={canManage}
            budgetEnabled={budgetEnabled}
            isLoading={contentLoading}
            onOpen={onOpenBudget}
            onLocked={onBudgetLocked}
          />
        </div>
        <div className="ov-anim">
          <MembersSummaryCard
            trip={trip}
            members={members}
            profiles={memberProfiles}
            user={user}
            canManage={canManage}
            isLoading={contentLoading}
            onOpenMembers={onOpenMembers}
          />
        </div>
        <div className="ov-anim">
          <ServicesCard services={services} onAddService={onAddService} onOpenService={onOpenService} />
        </div>
      </div>

      <div className="ov-col ov-col--map">
        <div className="ov-anim">
          <RouteMapCard
            visits={visits}
            transfers={transfers}
            active={active}
            onOpen={onOpenMap}
            selectedVisitId={selStop?.id || null}
            // focus = МАССИВ точек [[lng,lat]] (контракт MapView: 1 точка → flyTo);
            // сравнение с null — координаты 0 на экваторе/меридиане легитимны.
            focus={selStop?.latitude != null && selStop?.longitude != null ? [[selStop.longitude, selStop.latitude]] : null}
            // onCityClick отдаёт ГРУППУ визитов точки (g.data — как у всех карт);
            // берём первый с id, как разворачивают остальные вызыватели.
            onCityClick={(pts) => { const v = (pts || []).find((p) => p?.id); if (v) selectStop(v); }}
          />
        </div>
      </div>
    </div>
  );
}
