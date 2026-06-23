-- 0062_trip_documents_author_snapshot
--
-- Add a denormalized author-name snapshot to trip_documents, mirroring
-- chat_messages.user_full_name.
--
-- Why: a trip's content outlives its authors. When a member leaves, their
-- trip_members row is hard-deleted (removeTripMember), so the live author
-- resolver (resolveProfiles / get_trip_participant_profiles — scoped to ACTIVE
-- participants) no longer returns them. Without a snapshot, documents uploaded
-- by a now-departed member render as "?" with a blank avatar. The frontend
-- (src/lib/resolveAuthor.js) reads created_by_name as the fallback, so the
-- name persists (and the Avatar shows gradient initials) after the author
-- leaves. Chat already had this via chat_messages.user_full_name; this brings
-- documents to the same cheap mechanism.
--
-- Backfill is intentionally NOT attempted: created_by_name is best-effort and
-- only needs to exist for rows written from now on. Existing rows keep
-- resolving via the live profile / membership snapshot while the author is
-- still in the trip, and degrade gracefully otherwise.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — safe to run repeatedly on dev + prod.

alter table public.trip_documents
  add column if not exists created_by_name text;
