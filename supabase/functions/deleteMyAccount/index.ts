/**
 * deleteMyAccount
 *
 * POST — no body required.
 *
 * Deletes all data belonging to the authenticated user, then removes the auth account.
 *
 * Blocked if user has an active recurring subscription (pro_monthly / pro_yearly).
 * (They must cancel first before deleting the account.)
 *
 * Cascade order (owned trips first, then user-level records):
 *   For each owned trip:
 *     budget_expenses → budget_categories → trip_budgets
 *     hotel_stays → activities → transfers → trip_services
 *     city_visits
 *     chat_messages (for this trip)
 *     trip_telegram_integrations (for this trip)
 *     telegram_link_tokens (for this trip)
 *     trip_members
 *     trip itself
 *   Then:
 *     trip_members (memberships in other trips)
 *     trip_subscriptions
 *     telegram_link_tokens (remaining)
 *     trip_telegram_integrations (remaining)
 *     users row
 *     auth.users entry
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const userEmail = user.email!;
    const userId = user.id;

    // --- Block if active recurring subscription ---
    const { data: activeSubs } = await supabaseAdmin
      .from('trip_subscriptions')
      .select('id, type, status')
      .eq('user_email', userEmail)
      .in('type', ['pro_monthly', 'pro_yearly'])
      .eq('status', 'active');

    if (activeSubs && activeSubs.length > 0) {
      return Response.json(
        { error: 'Please cancel your active subscription before deleting your account.' },
        { status: 400, headers: corsHeaders },
      );
    }

    // --- Get all trips owned by this user ---
    const { data: ownedTrips } = await supabaseAdmin
      .from('trips')
      .select('id')
      .eq('created_by', userEmail);

    const tripIds = (ownedTrips ?? []).map((t) => t.id);

    // --- Delete child records for each owned trip ---
    for (const tripId of tripIds) {
      // Budget
      await supabaseAdmin.from('budget_expenses').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('budget_categories').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('trip_budgets').delete().eq('trip_id', tripId);

      // Itinerary items
      await supabaseAdmin.from('hotel_stays').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('activities').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('transfers').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('trip_services').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('city_visits').delete().eq('trip_id', tripId);

      // Chat & Telegram
      await supabaseAdmin.from('chat_messages').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('trip_telegram_integrations').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('telegram_link_tokens').delete().eq('trip_id', tripId);
      await supabaseAdmin.from('telegram_reminder_logs').delete().eq('trip_id', tripId);

      // Members
      await supabaseAdmin.from('trip_members').delete().eq('trip_id', tripId);

      // Trip itself
      await supabaseAdmin.from('trips').delete().eq('id', tripId);
    }

    // --- Delete user-level records ---
    // Memberships in other people's trips
    await supabaseAdmin.from('trip_members').delete().eq('user_email', userEmail);

    // Subscriptions
    await supabaseAdmin.from('trip_subscriptions').delete().eq('user_email', userEmail);

    // Remaining Telegram records (not tied to owned trips)
    await supabaseAdmin.from('telegram_link_tokens').delete().eq('user_email', userEmail);
    await supabaseAdmin.from('trip_telegram_integrations').delete().eq('user_email', userEmail);

    // Chat messages in other trips
    await supabaseAdmin.from('chat_messages').delete().eq('user_email', userEmail);

    // Users profile row
    await supabaseAdmin.from('users').delete().eq('id', userId);

    // Delete auth user (must be last)
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (e) {
    console.error('deleteMyAccount error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
