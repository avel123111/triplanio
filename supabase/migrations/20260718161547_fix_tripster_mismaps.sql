-- TRIP-236 (part 4b) — fix Tripster slug/id sitting on the WRONG geonameid.
--
-- The Tripster resolution (part 2) mis-mapped 6 slugs onto a different city (found
-- during the sp8 audit). Rule (Pavel): an adjacent settlement is acceptable only if
-- the intended city has no geonameid of its own; genuinely different cities must be
-- fixed. All 6 intended cities DO have their own geonameid → all fixed. Feed slug is
-- kept as tripster_slug (it is the experience.tripster.ru/experience/<slug>/ path).
--
-- Intended city (feed slug / tripster_id, verified by feed IATA) — correct geonameid:
--   Washington (402, WAS)  -> Washington D.C. 4140963   (was on Seattle 5809844)
--   Shizuoka   (1172, FSZ) -> Shizuoka        1851717   (was on Hamamatsu 1863289)
--   Asuan      (854, ASW)  -> Aswan           359792    (was on Kom Ombo 353802)
--   Mendoza    (1011, MDZ) -> Mendoza         3844421   (was on San Rafael 3836669)
--   Kotor      (264)       -> Kotor           3197538   (was on Dobrota 3201903)
--   Mtskheta   (221)       -> Mtskheta        612890    (not yet in cities; also sp8 722)
--
-- ddl-guard: allow-destructive — TRIP-236 part 4b. The DELETEs below remove cities
-- rows that exist ONLY because of the mis-map (no viator/getyourguide/sp8 data);
-- the correct cities are (re)mapped above. No FK references cities. Verified the 4
-- deleted geonameids are absent from the sp8 enrichment set.

-- 1) Put Tripster on the correct city. Upsert on geonameid (env-independent): the
--    intended rows exist on dev/prod via the Viator/GYG seed, but the earlier resolver
--    created the victim rows — not these — so an upsert (not a bare UPDATE) guarantees
--    the mapping lands even where the row is not pre-seeded. name_en only fills when
--    the row is newly inserted; existing name_en is left intact.
INSERT INTO public.cities (geonameid, name_en, tripster_slug, tripster_id) VALUES
(4140963, 'Washington', 'Washington', '402'),
(1851717, 'Shizuoka',   'Shizuoka',   '1172'),
(359792,  'Aswan',      'Asuan',      '854'),
(3844421, 'Mendoza',    'Mendoza',    '1011'),
(3197538, 'Kotor',      'Kotor',      '264')
ON CONFLICT (geonameid) WHERE geonameid IS NOT NULL
DO UPDATE SET tripster_slug = EXCLUDED.tripster_slug, tripster_id = EXCLUDED.tripster_id;

-- 2) Mtskheta (also carries Sputnik8 722/mtskheta — dropped from part 3 precisely
--    because its Tripster slug was on Gudauri; now given its own correct row).
INSERT INTO public.cities (geonameid, name_en, tripster_slug, tripster_id, sp8_id, sp8_slug)
VALUES (612890, 'Mtskheta', 'Mtskheta', '221', '722', 'mtskheta')
ON CONFLICT (geonameid) WHERE geonameid IS NOT NULL
DO UPDATE SET tripster_slug = EXCLUDED.tripster_slug, tripster_id = EXCLUDED.tripster_id,
              sp8_id = EXCLUDED.sp8_id, sp8_slug = EXCLUDED.sp8_slug;

-- 3) Legit victim rows keep their Viator data — only clear the wrong Tripster slug.
UPDATE public.cities SET tripster_slug=NULL, tripster_id=NULL
WHERE geonameid IN (5809844, 614410);  -- Seattle (viator 704), Gudauri (viator 50328)

-- 4) Victim rows that existed ONLY due to the mis-map (no other provider) → remove.
DELETE FROM public.cities
WHERE geonameid IN (1863289, 353802, 3836669, 3201903);  -- Hamamatsu, Kom Ombo, San Rafael, Dobrota
