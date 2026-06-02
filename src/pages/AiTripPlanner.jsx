// DEPRECATED — the AI planner has been merged into the unified create-flow.
// The standalone screen is gone; `/plan-trip-ai` now renders the shared flow
// with the AI entry (see App.jsx → <ManualPlanner initialMethod="ai" />).
// This shim only remains for any stale import; safe to `git rm`.
import React from 'react';
import ManualPlanner from '@/pages/ManualPlanner';

export default function AiTripPlanner() {
  return <ManualPlanner initialMethod="ai" />;
}
