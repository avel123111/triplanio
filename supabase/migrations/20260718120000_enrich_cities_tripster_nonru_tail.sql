-- TRIP-236: enrich the non-RU tail Tripster cities that the agreement-gated
-- resolver (20260718000610 + 20260718002437) deliberately skipped.
--
-- Those ~51 cities were dropped because the feed's `en` is often a native
-- exonym (Venezia/Oskemen/Patras) or the feed's IATA points at a neighbouring
-- town — so the "≥2 signals must agree" rule found no safe majority and left
-- them on the tpx.lt fallback link. This migration adds back the 28 that are
-- LARGE and single-signal but resolve UNAMBIGUOUSLY, each verified by hand
-- against the prod GeoNames gazetteer (IATA→own-airport city, or exact
-- asciiname, or trigram≥0.5 on the sole large candidate). The remaining ~23
-- are genuine islands/regions (Crete, Corsica, Gran Canaria, Santorini,
-- Samui…), micro-villages, or ambiguous/disputed places — they stay on the
-- fallback link on purpose.
--
-- geonameid → (name_en, iata, slug, tripster_id), all hand-verified:
--   Venice=3164603 (feed en "Venezia" → Verona trap, IATA VCE is correct),
--   Naha DROPPED — its geonameid 1856035 is already taken by slug "Okinawa".
--
-- Deterministic literals only (no fuzzy resolver) so dev == prod exactly.
-- One logical change = one file (rules #5, #12). No schema change → no CI
-- destructive/caps guard applies (CTE only, no CREATE TABLE / ADD COLUMN).

WITH v(geonameid, name_en, iata, slug, tid) AS (VALUES
 (1254163, 'Trivandrum', 'TRV', 'Trivandrum', '1030'),
 (1520316, 'Oskemen', 'UKK', 'Oskemen', '1188'),
 (1527534, 'Osh', 'OSS', 'Osh', '837'),
 (1528512, 'Cholpon-Ata', NULL, 'Cholpon_Ata', '839'),
 (1655559, 'Luangprabang', 'LPQ', 'Luangprabang', '926'),
 (1848354, 'Yokohama-shi', 'YOK', 'Yokohama', '123'),
 (2028462, 'Ulan-Bator', 'ULN', 'Ulan_Bator', '886'),
 (2511230, 'San Sebastian de La Gomera', 'GMZ', 'San_Sebastian_De_La_Gomera', '1181'),
 (2512989, 'Palma de Mallorca', 'PMI', 'Palma_de_Mallorca', '367'),
 (2524622, 'Giardini-Naxos', NULL, 'Giardini_Naxos', '677'),
 (255683, 'Patras', 'GPA', 'Patry', '1139'),
 (261601, 'Kalambaka', NULL, 'Kalambaka', '1189'),
 (292913, 'Al Ain', 'AAN', 'Al_Ain', '1261'),
 (2953504, 'Baden-Baden', 'ZCC', 'Baden-Baden', '545'),
 (2968748, 'Villefranche-sur-Saône', NULL, 'Villefranche-sur-Saone', '300'),
 (2978640, 'Saint-Malo', NULL, 'Saint_Malo', '623'),
 (301238, 'Side', NULL, 'Side', '453'),
 (3038354, 'Aix-en-Provence', NULL, 'Aix_en_Provence', '477'),
 (3104499, 'Vitoria-Gasteiz', 'VIT', 'Vitoria_Gasteiz', '371'),
 (3164603, 'Venezia', 'VCE', 'Venice', '24'),
 (3167777, 'San Remo', NULL, 'San_Remo', '436'),
 (3168070, 'San Marino', 'SM', 'San_Marino', '634'),
 (3455036, 'Paraty', 'JPY', 'Paraty', '1283'),
 (349340, 'Sharm El Sheikh', 'SSH', 'Sharm_El_Sheikh', '770'),
 (352733, 'Mersa Matruh', 'MUH', 'Mersa_Matruh', '1159'),
 (5128581, 'New York', 'NYC', 'New_York', '44'),
 (6534232, 'Lamezia', 'SUF', 'Lamezia', '1266'),
 (7304197, 'Muine', 'PHH', 'Muine', '496')
)
-- Existing rows (18): fill only the Tripster fields, never clobber a set slug.
, upd AS (
  UPDATE public.cities c
     SET tripster_slug = v.slug,
         tripster_id   = v.tid,
         updated_at    = now()
    FROM v
   WHERE c.geonameid = v.geonameid
     AND c.tripster_slug IS NULL
  RETURNING c.geonameid
)
-- New rows (10): insert the full affiliate row.
INSERT INTO public.cities (geonameid, name_en, iata_code, tripster_slug, tripster_id)
SELECT v.geonameid, v.name_en, v.iata, v.slug, v.tid
  FROM v
 WHERE NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.geonameid = v.geonameid);
