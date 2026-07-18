-- TRIP-236 (part 4a) — add 15 sizable Russian cities missing from the cities
-- affiliate directory, and enrich them with Sputnik8 sp8_id / sp8_slug.
--
-- These cities are in the Sputnik8 feed but had no row in `cities` (they were not
-- covered by the Viator/GetYourGuide seed nor the Tripster feed — verified absent
-- from the Tripster webhook), so the sp8 UPDATE-only enrichment (part 3) skipped
-- them. Pavel asked to add these specific ones. Resolved to geonameid via the same
-- GeoNames procedure (exact asciiname / ru name, RU, population-first; each verified
-- 1:1). name_en = gazetteer asciiname; iata_code left NULL (no authoritative source
-- in the feeds/gazetteer for these). id is GENERATED ALWAYS AS IDENTITY → not supplied.
-- No Tripster data (absent from that feed).
--
-- Upsert on geonameid (env-independent): if a row already exists it just gains the
-- sp8 columns; otherwise it is inserted. (Verified absent on dev, but this keeps the
-- migration correct regardless of which provider seed ran first.)

INSERT INTO public.cities (geonameid, name_en, sp8_id, sp8_slug) VALUES
(538560, 'Kursk',          '514',  'kursk'),
(532288, 'Magnitogorsk',   '723',  'magnitogorsk'),
(2051523,'Bratsk',         '1726', 'bratsk'),
(1497543,'Nizhnevartovsk', '387',  'nizhnevartovsk'),
(496285, 'Severodvinsk',   '775',  'severodvinsk'),
(1498894,'Miass',          '728',  'miass'),
(518557, 'Novomoskovsk',   '1063', 'novomoskovsk'),
(476077, 'Velikiye Luki',  '847',  'velikiyeluki'),
(503977, 'Pushkino',       '557',  'pushkino'),
(471430, 'Votkinsk',       '804',  'votkinsk'),
(527191, 'Michurinsk',     '860',  'michurinsk'),
(1538634,'Ozersk',         '954',  'ozersk'),
(1492517,'Shadrinsk',      '1821', 'shadrinsk'),
(468082, 'Yelabuga',       '561',  'elabuga'),
(523426, 'Naro-Fominsk',   '1196', 'naro-fominsk')
ON CONFLICT (geonameid) WHERE geonameid IS NOT NULL
DO UPDATE SET sp8_id = EXCLUDED.sp8_id, sp8_slug = EXCLUDED.sp8_slug;
