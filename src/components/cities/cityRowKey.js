// @ts-check
/**
 * КЛЮЧ СТРОКИ ГАЗЕТТИРА — ОДИН НА ВСЕ ФАСАДЫ ГОРОДА.
 *
 * Строки всем фасадам (`CityPicker`, `CitySearch`) отдаёт одна и та же
 * `searchCities`, значит и опознаваться они обязаны одинаково. Правил было два:
 * один фасад брал `geonameid ?? external_city_id ?? city_name`, другой — те же
 * два поля без третьего звена. Расхождение инертное, но это ровно та форма, из
 * которой вырастает «два пикера, похожие на один».
 *
 * ⚠️ ТРЕТЬЕ ЗВЕНО ОСТАВЛЕНО КАК СТРАХОВКА, А НЕ КАК ОПИСАНИЕ ФАКТА, и прежняя
 * шапка врала, называя его нуждой: `mapGazCity` ВЫВОДИТ `external_city_id` из
 * `geonameid` (`external_city_id: g.geonameid != null ? String(g.geonameid) : null`),
 * то есть поля пусты только ВМЕСТЕ и «у части строк external_city_id пуст» быть
 * не может по построению. Звено стоит на случай, если строка приедет не из
 * газеттира: ключ `undefined` у React — это молча схлопнутый список.
 *
 * @param {{ geonameid?: any, external_city_id?: any, city_name?: any }} c
 */
export const cityRowKey = (c) => c?.geonameid ?? c?.external_city_id ?? c?.city_name;
