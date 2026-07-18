-- TRIP-236: enrich the Tripster tail — cities the earlier resolvers skipped.
--   * non-RU tail: agreement-gated resolver (20260718000610 + 20260718002437)
--   * RU tail: seed (20260717221105) covered 260/276; 16 were held back.
--
-- WHY they were on the tpx.lt fallback link, not a slug:
--   non-RU (51 skipped) — the feed `en` is often a native exonym
--   (Venezia/Oskemen/Patras) or the feed IATA points at a neighbouring town,
--   so the "≥2 signals must agree" rule found no safe majority.
--   RU (16 skipped) — the seed dropped the exonym mis-map traps
--   (Ростов Великий vs Ростов-на-Дону, Болхов→Волхов, Балахна→Novaya Balakhna)
--   plus places absent from the GeoNames cities500 snapshot.
--
-- This migration adds back the ones that resolve UNAMBIGUOUSLY, each verified
-- by hand against the prod GeoNames gazetteer (IATA→own-airport city, exact
-- asciiname, trigram on the sole candidate, or coordinate match):
--   28 non-RU + 10 RU = 38 cities.
--   NB the RU set includes real, sizeable cities the seed left out —
--   Rostov-on-Don (1.1M), Komsomolsk-na-Amure (276k), Gus-Khrustalny (63k),
--   Pereslavl-Zalessky (40k) — not just small towns.
--
-- Still on the fallback ON PURPOSE:
--   non-RU (~23): islands/regions (Crete, Corsica, Gran Canaria, Santorini,
--   Samui…), micro-villages, ambiguous/disputed places.
--   RU (6): Teberda, Dombay, Innopolis, Maksimikha, Kizhi, Olkhon — genuinely
--   absent from the GeoNames cities500 snapshot (resorts/new town/island-museum);
--   adding them needs a gazetteer extension, out of scope here.
--
-- Hand-verified notes:
--   Venice=3164603 (feed en "Venezia" → Verona trap; IATA VCE is correct).
--   Rostov=501183 is Rostov Veliky (the ancient one), NOT Rostov-on-Don=501175.
--   Bolkhov=575364 (Oryol obl.), NOT Volkhov. Both Rostov geonameids are free.
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
 (7304197, 'Muine', 'PHH', 'Muine', '496'),
 -- RU tail (10), all new inserts:
 (466215,  'Yuryev-Polsky', NULL, 'Yuryev-Polsky', '566'),
 (501175,  'Rostov-na-Donu', 'ROV', 'Rostov-on-Don', '161'),
 (501183,  'Rostov', NULL, 'Rostov', '377'),
 (511359,  'Pereslavl-Zalessky', NULL, 'Pereslavl_Zalessky', '393'),
 (535243,  'Likino-Dulyovo', NULL, 'Likino_Dulyovo', '974'),
 (541224,  'Solovetsky Islands', 'CSH', 'Solovetsky_Islands', '989'),
 (557775,  'Gus-Khrustalny', NULL, 'Gus_Khrustalny', '804'),
 (575364,  'Bolkhov', NULL, 'Bolkhov', '773'),
 (2021851, 'Komsomolsk-na-Amure', 'KXK', 'Komsomolsk_na_Amure', '758'),
 -- Balakhna: GeoNames labels the PPL at Balakhna's exact coords (56.49N,43.60E,
 -- pop 63083) "Novaya Balakhna" — coordinate-verified as the town itself.
 (579514,  'Balakhna', NULL, 'Balakhna', '1028')
)
-- Existing rows (18 non-RU): fill only the Tripster fields, never clobber a set slug.
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
-- New rows (10 non-RU + 9 RU = 19): insert the full affiliate row.
INSERT INTO public.cities (geonameid, name_en, iata_code, tripster_slug, tripster_id)
SELECT v.geonameid, v.name_en, v.iata, v.slug, v.tid
  FROM v
 WHERE NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.geonameid = v.geonameid);
