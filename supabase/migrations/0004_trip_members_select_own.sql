-- Allow a user to SELECT their own membership rows even while pending/declined.
-- The existing trip_members_select policy only covers ACTIVE participants
-- (is_trip_participant), so a pending invitee could not read their own invite
-- row — which hid the Accept/Decline buttons in the Inbox / notifications bell.
drop policy if exists trip_members_select_own on public.trip_members;
create policy trip_members_select_own on public.trip_members
for select using (user_id = auth.uid());
