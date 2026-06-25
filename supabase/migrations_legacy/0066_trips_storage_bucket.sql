-- Single private bucket `trips` holding every trip-scoped file (trip docs,
-- event/service attachments, AI uploads, covers) under the flat key
-- `<tripId>/<uid>-<file>`. Replaces the legacy split `documents` (private) +
-- `trip-covers` (public) buckets.
--
-- Config + RLS mirror the legacy `documents` bucket: private, 50 MB limit, no
-- mime restriction; authenticated-only insert/select/delete (role `public`
-- gated by auth.uid()). No UPDATE policy (keys are unique, uploads never
-- upsert-update). Covers are served via long-lived signed URLs, so anonymous
-- public-trip pages still load them — signed access is validated by token and
-- bypasses RLS.
--
-- Deployed manually to BOTH projects (prod tizscxrpuopobgcxbekf + dev
-- nydhzevdizkfaxdlikgc).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trips', 'trips', false, 52428800, null)
on conflict (id) do nothing;

drop policy if exists "trips_select" on storage.objects;
create policy "trips_select" on storage.objects
  for select to public
  using (bucket_id = 'trips' and auth.uid() is not null);

drop policy if exists "trips_insert" on storage.objects;
create policy "trips_insert" on storage.objects
  for insert to public
  with check (bucket_id = 'trips' and auth.uid() is not null);

drop policy if exists "trips_delete" on storage.objects;
create policy "trips_delete" on storage.objects
  for delete to public
  using (bucket_id = 'trips' and auth.uid() is not null);
