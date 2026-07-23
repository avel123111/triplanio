import React, { useMemo } from 'react';
import { sortVisits } from '@/lib/validation';
import RouteMapCard from '@/components/trips/RouteMapCard';
import TripStatRow from '@/components/trips/TripStatRow';
import BudgetSummaryCard from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard from '@/components/trips/MembersSummaryCard';
import ServicesCard from '@/components/trips/ServicesCard';

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
  services = [],
  user,
  isLoading = false,
  contentLoading = false,
  active = true,
  canManage = false,
  budgetEnabled = false,
  onOpenMap,
  onOpenBudget,
  onOpenMembers,
  onAddService,
  onOpenService,
  onBudgetLocked,
}) {
  const orderedVisits = useMemo(() => sortVisits(visits), [visits]);

  if (isLoading) {
    const bar = (w, h, r = 8, mt = 0) => (
      <div className="ov-bar" style={{ width: w, height: h, borderRadius: r, marginTop: mt }} />
    );
    const dot = <span className="ov-bar" style={{ width: 32, height: 32, borderRadius: 11, flex: 'none' }} />;
    return (
      <div className="ovwrap" aria-busy="true">
        <div className="ov-col">
          {/* map card */}
          <div className="wdg ov-mapcard">
            <div className="wdg-h">{dot}{bar('38%', 16, 6)}</div>
            <div className="ov-bar" style={{ height: 280, borderRadius: 0 }} />
          </div>
          {/* stat bar */}
          <div className="statbar surface-panel">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="s" key={i}>
                <span className="ov-bar" style={{ width: 42, height: 42, borderRadius: 13, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>{bar('55%', 22, 6)}{bar('80%', 10, 5, 7)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="ov-col">
          {/* budget card */}
          <div className="wdg">
            <div className="wdg-h">{dot}{bar('45%', 16, 6)}</div>
            <div className="wdg-b">
              {bar('55%', 26, 8)}
              {bar('100%', 11, 999, 14)}
              {bar('100%', 14, 8, 12)}
              {bar('100%', 14, 8, 8)}
              {bar('100%', 14, 8, 8)}
            </div>
          </div>
          {/* members card */}
          <div className="wdg">
            <div className="wdg-h">{dot}{bar('45%', 16, 6)}</div>
            <div className="wdg-b">
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0' }}>
                  <span className="ov-bar" style={{ width: 34, height: 34, borderRadius: '50%', flex: 'none' }} />
                  <div style={{ flex: 1 }}>{bar('60%', 13, 5)}{bar('40%', 11, 5, 6)}</div>
                </div>
              ))}
              {bar('100%', 42, 12, 14)}
            </div>
          </div>
        </div>
      </div>
    );
  }

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
