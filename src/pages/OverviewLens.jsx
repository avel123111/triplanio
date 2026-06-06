import React, { useMemo } from 'react';
import { sortVisits } from '@/lib/validation';
import RouteMapCard from '@/components/trips/RouteMapCard';
import TripStatRow from '@/components/trips/TripStatRow';
import BudgetSummaryCard from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard from '@/components/trips/MembersSummaryCard';

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
  user,
  isLoading = false,
  active = true,
  canManage = false,
  budgetEnabled = false,
  onOpenMap,
  onOpenBudget,
  onOpenMembers,
  onBudgetLocked,
}) {
  const orderedVisits = useMemo(() => sortVisits(visits), [visits]);

  if (isLoading) {
    return (
      <div className="ovwrap" aria-busy="true">
        <div className="ov-col">
          <div className="wdg ov-mapcard ov-skel" style={{ height: 332 }} />
          <div className="ov-skel" style={{ height: 96, borderRadius: 16 }} />
        </div>
        <div className="ov-col">
          <div className="wdg ov-skel" style={{ height: 220 }} />
          <div className="wdg ov-skel" style={{ height: 240 }} />
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
            onOpenMembers={onOpenMembers}
          />
        </div>
      </div>
    </div>
  );
}
