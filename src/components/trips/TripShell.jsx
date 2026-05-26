import React from 'react';
import TripSideMenu from './TripSideMenu';

/**
 * Layout wrapper for every screen reachable from the trip side-menu
 * (TripView, TripBudget, TripSettings, ...).
 *
 * Desktop (lg+): the side-menu is rendered as a `position: fixed` column on
 *   the left, pinned to the top of the viewport (does NOT scroll with the
 *   page content). The main area reserves space for it via lg:pl-60.
 * Mobile/tablet: the side-menu is hidden and opens as a Sheet from the
 *   burger button in AppHeader (TripMenuProvider is mounted in Layout).
 *
 * The parent <Layout/> detects /trip/ paths and removes its own max-width
 * container so this layout can span the full viewport.
 */
export default function TripShell({ trip, tripId, access, isFreeTrip = false, onUpgrade, children }) {
  // Render the side menu as soon as tripId is available — before trip data loads.
  // This way the nav is visible while skeleton screens are shown.
  return (
    <>
      <TripSideMenu trip={trip} tripId={tripId} access={access} isFreeTrip={isFreeTrip} onUpgrade={onUpgrade} />
      <main className="lg:pl-60">
        <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </div>
      </main>
    </>
  );
}