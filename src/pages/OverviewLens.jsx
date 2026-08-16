import React, { useMemo } from 'react';
import { sortVisits } from '@/lib/validation';
import { Card, Skeleton } from '@/design/index';
import RouteMapCard from '@/components/trips/RouteMapCard';
import TripStatRow from '@/components/trips/TripStatRow';
import BudgetSummaryCard from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard from '@/components/trips/MembersSummaryCard';
import ServicesCard from '@/components/trips/ServicesCard';
import { useTripAccess } from '@/components/trips/TripAccessContext';

// Скелетон Обзора — PURE, канон <Skeleton>, геометрия повторяет реальный layout
// (карта + статбар · бюджет + участники). Один источник для обеих фаз загрузки
// (shell в TripView.LoadingBody и content). TRIP-337 visual-fixes.
export function OverviewSkeleton() {
  const bar = (w, h, r = 8, mt = 0) => (
    <Skeleton w={w} h={h} r={r} style={mt ? { marginTop: mt } : undefined} />
  );
  const dot = <Skeleton w={32} h={32} r="var(--r-sm)" style={{ flex: 'none' }} />;
  return (
    <div className="ovwrap" aria-busy="true">
      <div className="ov-col">
        <Card radius="lg" pad="none" raised className="ov-mapcard">
          <div className="wdg-h">{dot}{bar('38%', 16, 6)}</div>
          <Skeleton w="100%" h={280} r={0} />
        </Card>
        <Card radius="lg" pad="none" className="statbar">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="s" key={i}>
              <Skeleton w={34} h={34} r="var(--r-sm)" style={{ flex: 'none' }} />
              <div className="grow">{bar('55%', 22, 6)}{bar('80%', 10, 5, 7)}</div>
            </div>
          ))}
        </Card>
      </div>
      <div className="ov-col">
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
    </div>
  );
}

// Trip Overview — the trip's main screen. Lives inside the TripView shell
// (header + hero + sidebar). Two columns that collapse to one on mobile:
//   left  → route-map preview + 5 trip stats
//   right → budget summary + members summary
// All four widgets are reusable cards; this lens only composes + wires nav.
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
}) {
  // Право управления (editor) — из единого контекста доступа (TRIP-274 Ф2.2),
  // раздаётся подкартам (бюджет/участники) как булев проп.
  const { canEdit: canManage } = useTripAccess();
  const orderedVisits = useMemo(() => sortVisits(visits), [visits]);

  if (isLoading) return <OverviewSkeleton />;

  return (
    <div className="ovwrap">
      <div className="ov-col">
        <div className="ov-anim">
          <RouteMapCard
            visits={visits}
            transfers={transfers}
            active={active}
            onOpen={onOpenMap}
          />
        </div>
        <div className="ov-anim">
          <TripStatRow visits={visits} transfers={transfers} trip={trip} orderedVisits={orderedVisits} />
        </div>
      </div>

      <div className="ov-col">
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
    </div>
  );
}
