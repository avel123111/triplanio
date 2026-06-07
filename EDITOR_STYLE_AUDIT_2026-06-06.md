# EDITOR_STYLE_AUDIT — Планирование / Редактор маршрута vs Lumo

**Дата:** 2026-06-06
**Экран:** `/trip/:id/edit` → `src/pages/TripStructureEdit.jsx`
**Источник истины (дизайн):** `DESIGN_SYSTEM_LUMO_2026-06-06.html`

## Сравниваемые файлы

| Слой | Код | Дизайн (Lumo) |
|---|---|---|
| Левый список маршрута | `src/pages/TripStructureEdit.jsx` (`GridNode`, `GridEndpoint`, `SeamTransfer`, `HotelCell`, `ActCell`, `AddPointButton`) + `.te-*` / `.ts-step` в `src/design/app.css:1159–1271` | Markup C4 (HTML 1145–1206): `.edl2` / `.edl2-row` / `.node` / `.edl-step` / `.edl-hotel` / `.edl-act` / `.ph-act` / `.edl2-seam .pill`; CSS `448–504`, `748–769` |
| Плашки городов | `GridNode` / `GridEndpoint` / `.te-row__node` / `.te-row__num` / `.te-wptag` / `.te-endlabel` | `.edl-node--start/--end/--wp`, `.edl-lbl`, `.wptag` (CSS `438`, `494–498`) |
| Панель города | `src/components/common/CityPanel.jsx` + `.lp-*` / `.bookrow` / `.gadd` / `.stepper` (CSS `1278–1363`) | C5 «Город · широкая · просмотр» |
| Панели события (view) | `src/components/common/EventSourcePanel.jsx` → `EventPanels.jsx` (`PanelShell`, `EventPanelBody`) | C5 hotel/transfer/activity/car view |
| Панели события (edit / fork / warning) | `EventEditDialog.jsx` (`variant="panel"`), `ForkPartnerModal`, `te-fix-note` | C5 edit (`.aiblk`/`.field`/`.input`/`.upload`/`.txmodes`), fork (`.lpartner`/`.txmodes`), warning (`.lp-warn`) |

**Главный структурный вывод:** редактор маршрута в коде построен как **табличная сетка** (`.te-table` / `.te-row` — CSS-grid из 6 колонок `16px 24px 1fr 96px 120px 60px`), тогда как Lumo C4 — это **карточный таймлайн** `.edl2` (flex-карточки со спайн-линией слева, без колонок «ночей/отеля/активности» как отдельных столбцов с шапкой). Это P0-расхождение каркаса. Панели города и view-события — почти 1:1 порты Lumo; edit/fork-панели события — легаси-вёрстка (не Lumo `.lp-*`).

---

## (A) Список маршрута (route editor)

| Элемент | Дизайн (ожидается) | Код (сейчас) | Разница / что поправить |
|---|---|---|---|
| Контейнер списка | `.edl2` — flex-колонка, `gap:9px`, `max-width:600px`, спайн `::before` слева `left:28px` (CSS 748–749) | `.te-table` — CSS-grid строки + спайн `::before` `left:45px top:24px bottom:24px` (app.css 1228–1230) | Каркас другой: дизайн — карточный flex со спайном при `28px`; код — табличный grid, спайн при `45px`. **P0**: разная парадигма. Минимум — выровнять положение спайна (28 vs 45). |
| Шапка колонок | НЕТ в Lumo C4 (карточки без табличной шапки `Куда/Ночей/Ночлег/Активности`) | `.te-thead` + `.te-th` (6 колонок, app.css 1159–1161; JSX 864–869) | **P0/лишний элемент**: табличная шапка отсутствует в дизайне. В Lumo ночи — степпер в самой карточке, отель/активность — иконки справа без столбцов. |
| Строка города | `.edl2-row`: `padding:12px 14px`, `border-radius:15px`, `border:1px var(--line)`, `box-shadow:var(--sh-1)`, `gap:13px`, hover → `sh-2`+`line-hover` (CSS 750–751) | `.te-table .te-row`: `border-radius:16px`, `border:1px var(--line)`, `bg surface`, `box-shadow:sh-1`, `padding:15px 6px`, `column-gap:12px` (app.css 1164, 1233); hover → `sh-2`+`line-hover` | Близко. **P1**: радиус 16 vs 15; padding `15px 6px` (grid) vs `12px 14px`; gap 12 vs 13. Фон/тень/бордер OK. |
| Узел-номер города | `.edl2-row .node` 28×28, `radius:9px`, `bg var(--primary-soft)`, `color var(--primary)`, `font-display 600 13px` (CSS 752) | `.te-row__num` **22×22**, `border-radius:50%` (круг!), `bg var(--brand-soft-12)`, `color var(--brand)`, `font-display 700 var(--fs-meta=12.5)` (app.css 1175) | **P0/P1**: дизайн — скруглённый квадрат 28×28 r9 на `primary-soft`; код — **круг** 22×22 на `brand-soft-12`. Форма (круг vs r9-квадрат), размер (22 vs 28), фон (soft-12 vs soft), вес (700 vs 600) расходятся. |
| Степпер ночей | `.edl-step` пилюля `bg var(--surface-2)`, кнопки 26×26 круглые `color primary`, `.n` `min-width:46px 800 12.5px` (CSS 441–443) | `.te-stepper` пилюля `bg surface-2`, `.te-step` 26×26 круг `color primary`, `.te-nights` `min-width:30px 700 var(--fs-meta)` (app.css 1195–1201) | **P1/P2**: близко. `.n` ширина 46 vs 30; вес 800 vs 700; код добавляет суффикс «ноч.» текстом, в Lumo `.n` = «2 ноч.» одним span. Кнопки/фон совпадают. |
| Иконка-кнопка отеля | `.edl-hotel` 36×34, `radius:12px`, `bg var(--ev-hotel-soft)`, `border:1.5px transparent`, hover→border `ev-hotel`, svg 16, варнинг-бейдж `::after` (CSS 444–447) | `.te-hotelicon` 36×34, `radius:12px`, `bg var(--ev-hotel-soft)`, `border:1.5px transparent`, hover→`ev-hotel` (app.css 1215–1217) | **OK** по габаритам/цвету. **P2**: в коде НЕТ варнинг-бейджа `::after` (красная «!» точка в углу) — вместо неё инлайн-иконка warning рядом (JSX 1058). |
| Плашка «добавить отель» (пусто) | `.ph-hotel` 36×34, `radius:12px`, `border:1.5px dashed var(--line-strong)`, `color muted-2`, hover→`ev-hotel` (CSS 481–482) | `.te-cellbtn--ghost` — `height:34px`, `radius:12px`, `border:1.5px dashed line-strong`, `color muted-2`, **`opacity:0` пока не hover строки** (app.css 1205–1214) | **P1**: дизайн-плашка всегда видима (на наведении меняет цвет), код прячет её до hover строки (`opacity:0`). Размер: дизайн фикс 36×34, код — `height:34` + `padding 0 11px` (шире из-за «+»-иконки). |
| Иконка-кнопка активности | `.edl-act` `height:34 min-width:34 padding:0 11px`, `radius:12`, `bg ev-activity-soft`, `color ev-activity-ink`, `13px 800`, svg 15 (CSS 448) | `.te-actchip` `height:34 min-width:34 padding:0 11px`, `radius:12`, `bg ev-activity-soft`, `color ev-activity-ink`, `13px 800` (app.css 1218) | **OK** (точный порт). |
| Сидлайн-переезд (есть) | `.edl2-seam .pill`: `padding:7px 14px`, `radius:pill`, `bg var(--ev-transfer-soft)`, `border:1.5px (ev-transfer 40%)`, `color ev-transfer-ink`, `12px 800`, **`box-shadow:sh-2`**, hover→`scale(1.02)`+`sh-3` (CSS 760–763) | `.te-seam__pill`: `padding:4px 11px`, `radius:999`, `bg ev-transfer-soft`, `border:1px (ev-transfer 42%)`, `box-shadow:var(--shadow-soft=sh-1)`, hover→border+`shadow-card` (app.css 1246–1248); текст `600 var(--fs-micro=11)` инлайн (JSX 1164) | **P1**: padding `4px 11px` vs `7px 14px` (плашка ниже); border 1px vs 1.5px; тень `sh-1` vs `sh-2`; вес текста 600 vs 800; размер 11 vs 12. Цвета совпадают. |
| Сидлайн-переезд (добавить) | `.edl2-seam .pill.pill--add`: dashed, `color muted-2`, `border line-strong`, `bg transparent`, `box-shadow:sh-1`, hover→`ev-transfer-ink`+`ev-transfer-soft` (CSS 766–769) | `.te-seam__pill--add`: `bg var(--surface)`(не transparent), `border:1px dashed line`, `color muted`, `11px 600`, `box-shadow:none` (app.css 1250–1251) | **P1/P2**: дизайн `bg transparent` + `border line-strong` + лёгкая тень; код `bg surface` + `border line` + без тени. Hover-цель совпадает. |
| Позиционирование сидлайна | `.edl2-seam` центрирован, `margin:-15px 0`, наезжает на стык карточек (CSS 760) | `.te-seam` `position:absolute; left:36px; bottom:0; transform:translateY(50%)` — привязан к левому краю, не центр (app.css 1241) | **P1**: дизайн центрирует пилюлю переезда между карточками; код прижимает к спайну слева. |
| Кнопка «+ Добавить точку» | В Lumo нет отдельной — добавление инлайновое (`.edl-ghost` пилюля dashed) | `AddPointButton` (JSX 1198): full-width, `padding:12px`, `radius:12`, `bg brand-soft`, `border brand-soft-12`, `color brand`, `15px 600` | **P2/доп.элемент**: полноширинная кнопка вместо ghost-пилюли. Цвет на токенах — приемлемо. |
| Спайн-линия | `.edl2::before` `left:28px width:2px bg var(--line)` (CSS 749) | `.te-table::before` `left:45px width:2px bg var(--line) opacity:.65`, при drag → `line-hover` (app.css 1229–1230) | **P2**: позиция 45 vs 28, прозрачность .65 (дизайн — без). |

---

## (B) Плашки городов (start / end / waypoint)

| Элемент | Дизайн (ожидается) | Код (сейчас) | Разница / что поправить |
|---|---|---|---|
| Узел START | `.edl-node--start` 30×30, `radius:11px`, `bg var(--primary-soft)`, `color var(--primary)`, иконка-флаг 13px (CSS 438+494); `.edl2-row .node.start` 28×28 r9 `primary-soft` (CSS 755) | `GridEndpoint` `.te-row__node` **22×22, `border-radius:50%`** (круг), `bg var(--brand-soft)`, иконка flag 12 (app.css 1235; JSX 1183) | **P0/P1**: код — круг 22×22; дизайн — квадрат r9–r11 28–30×30. Размер/форма расходятся. Фон `brand-soft`≈`primary-soft` OK. |
| Узел END | `.edl-node--end` `bg var(--surface-2)`, `color var(--ink-2)`, check 13px (CSS 495); вариант `.node.end` `bg var(--success-soft) color var(--success-ink)` (CSS 755) | `.te-row__node` круг 22×22, `bg var(--wash)`, `color var(--ink-2)`, check 12 (JSX 1179, 1183) | **P1**: дизайн допускает success-зелёный для финиша (C4 `.node.end`), код — нейтральный `wash`/`ink-2`. Форма круг vs квадрат (см. выше). |
| Узел WAYPOINT | `.edl-node--wp` `bg transparent`, `border:1.5px dashed var(--ev-transfer)`, `color ev-transfer`, icon 11 (CSS 496); `.node.wp` 28×28 r9 (CSS 755) | `.te-row__node` inline: `bg transparent`, `border:1.5px dashed var(--ev-transfer)`, `color ev-transfer`, icon `arrowSwap` 11 — **но 22×22 круг** (JSX 1099) | **P1**: цвет/бордер/иконка совпадают; форма круг 22×22 vs квадрат r9 28×28. |
| Лейбл «Начало/Конец» | `.edl-lbl` `10px 800 uppercase letter-spacing:.07em` (CSS 497) | `.te-endlabel` `var(--fs-micro=11px) 700 uppercase letter-spacing:.08em` (app.css 1236) | **P2**: размер 11 vs 10; вес 700 vs 800; tracking .08 vs .07. |
| Тег «Пересадка» | `.wptag` `11px 800 color ev-transfer-ink, bg ev-transfer-soft, padding:4px 10px, radius:pill` (CSS 498); либо `.edl2-cty .wptag` `9.5px 800 uppercase, padding:2px 7px` (CSS 758) | `.te-wptag` `var(--fs-micro=11px) 700, color ev-transfer (не -ink), bg ev-transfer-soft, padding:2px 6px, radius:999, uppercase letter-spacing:.04em` (app.css 1237) | **P1/P2**: цвет `ev-transfer` vs `ev-transfer-ink` (менее контрастно); вес 700 vs 800; padding `2px 6px` vs `4px 10px`; код всегда uppercase. |
| Название города | `.edl-city` `font-display 600 16px var(--ink)` (CSS 440); `.edl2-cty b` `font-display 600 16px` (CSS 756) | `.te-cityname` `font-display **800** var(--fs-strong=15px), letter-spacing:-.01em`, hover→`color brand` (app.css 1167) | **P1**: вес 800 vs 600; размер 15 vs 16. Семейство OK. Hover-подсветка названия — доп. поведение (приемлемо). |
| Даты под городом | `.edl2-cty .dts` `font-mono 11px muted 600` (CSS 757) | inline `.num.muted var(--fs-micro=11px)` (JSX 1128) — `.num` = mono | **OK** (mono/11/muted). |
| Бейдж конфликта | В C4 город-варнинг = `.node.warn` (фон-узла `warning-soft`), без отдельного бейджа | `Conf`/`.te-warnbadge` `inline-flex, color warning-ink, var(--fs-micro), 700` + `.te-row__num.is-warn` (app.css 1176–1177) | **P2/доп.элемент**: код добавляет числовой бейдж конфликтов — в дизайне его нет (только окраска узла). Узел-варнинг (`warning-soft`) совпадает. |

---

## (C) Левая панель — Город (CityPanel)

CityPanel — **близкий порт Lumo** «Город · широкая · просмотр». Каркас `.lpanel--wide` / `.lp-hero` / `.lp-b` / `.lp-f` совпадает.

| Элемент | Дизайн (ожидается) | Код (сейчас) | Разница / что поправить |
|---|---|---|---|
| Hero | `.lp-hero` wide `height:122px`, `.hg` градиент `linear-gradient(135deg,#6FB2FF,#8A6BF0)`, `.ov` overlay-grad-soft, `.ht b` `font-display 600 18px #fff`, `.ht span` `11.5px rgba(#fff .88) 700` (CSS 631 + inline 122) | `.lp-hero height:122` + `CityPhoto` (реальное фото города) + `overlay-grad` (не -soft), `.ht b/span` те же токены (app.css 1281–1286; JSX 97–106) | **P2**: дизайн — синтетический градиент `#6FB2FF→#8A6BF0`; код — фото города + overlay-grad (более тёмный, чем -soft). Типографика `.ht` совпадает. |
| Кнопка «назад» в hero | `.lp-h .back` 28×28 r9 `bg secondary` (в hero-варианте дизайн не показывает back явно) | `.lp-hero .lp-back` 28×28 r9, `bg color-mix(ink 38%)`, `color #fff`, абсолютно `top/left:10` (app.css 1293–1297) | **OK** (адекватная адаптация под фото-hero). |
| Степпер ночей | `.lp-stepper` space-between + `.stepper` пилюля `surface-2`, кнопки 30×30 круг `primary`, `.n` `min-width:48 800 13px` (CSS 632, 331–334) | `.lp-stepper` + `.stepper` `30×30`, `.n min-width:48 800 13px` (app.css 1327–1333) | **OK** (точный порт). |
| Секц. лейбл | `.seclabel` + `.sl2` `11px 800 uppercase letter-spacing:.05em` (CSS 646–647) | `.seclabel`+`.sl2` идентично (app.css 1303–1304) | **OK**. |
| Кнопка addmini | `.addmini` 24×24 r8 `bg secondary color ink-2`, hover→accent (CSS 648) | `.addmini` 24×24 r8 `bg secondary color ink-2` (app.css 1305–1306) | **OK**. |
| Booking-row | `.bookrow` `padding:11px 13px radius:13 bg surface border line sh-1`; `.bi` 38×38 r11; `.bt b 14px 800`; `.bt span font-mono 11.5 muted`; `.chev` 16 (CSS 650–654) | Идентично (app.css 1308–1315; JSX BookRow) | **OK**. **P2**: warning-вариант `.bookrow.is-warn` (border + tinted `.bi`) в Lumo есть (CSS 655), в app.css порту его НЕТ — код вместо этого красит фон иконки через JS (`warn?warning-soft`) и ставит инлайн-иконку. |
| Ghost-add | `.gadd` dashed + `.gi` 38×38 dashed placeholder + `.gt b 13.5 800 muted` (CSS 657–660) | `.gadd` + `.gi` 38×38 dashed + `.gt` (app.css 1317–1325) | **OK** (порт). |
| Футер | `.lp-f` `padding:11px 15 border-top line-2 bg wash, justify-end` (CSS 621) | `.lp-f` идентично (app.css 1301); кнопки `Btn ghost/primary` | **OK**. |

---

## (D) Левая панель — Отель (view)

View-тело отеля (`HotelBody` в EventPanels.jsx) — порт Lumo. Header — `.lp-h` (не hero), что соответствует Lumo «Отель · просмотр».

| Элемент | Дизайн (ожидается) | Код (сейчас) | Разница / что поправить |
|---|---|---|---|
| Header панели | `.lp-h` `padding:14px 15`, `.back` 28×28 r9 secondary, `.ic` 36×36 r12 (фон ev-hotel-soft), `.ti b font-display 600 16px` (CSS 611–615) | `PanelShell`: `.lp-h` + `.lp-back` 28×28 + `.lp-ic` 36×36 r12 + `.ti b` (app.css 1288–1297; JSX 49–56) | **OK** (порт; класс `.lp-ic` вместо `.ic` — эквивалент). |
| Metastrip-чипы | `.metastrip .ch` `12.5px 800 color ink-2 bg secondary padding:6px 11 radius:pill`, `.ch--p` brand-soft (CSS 642–644) | `.metastrip .ch` идентично + `.ch--p` (app.css 1335–1336, 1356) | **OK**. |
| Адрес | `.addr` `padding:11px 13 radius:12 bg surface-3 border line`, svg 16 muted-2 (CSS 645) | `.addr` идентично (app.css 1357–1359) | **OK**. |
| KV-сетка | `.kvgrid` 2 кол `gap:11px 16`; `.kv .k 10.5px 800 uppercase`; `.kv .v 13.5 700`, `.v.mono font-mono` (CSS 638–641) | `.kvgrid` + `.kv .k/.v` идентично (app.css 1341–1343) | **OK**. |
| Документы | `.docrow` `padding:9px 11 radius:11 bg surface-3 border line`; `.di` 30×30 r8 `bg danger-soft color danger-ink`; `b 13 700`; `span font-mono 11` (CSS 672) | `.docrow` + `.di` идентично (app.css 1360–1363; JSX DocsList) | **OK**. **P2**: справа Lumo показывает размер файла (`span 240 КБ`); код ставит `external`-иконку вместо размера. |
| Заметки | `.notes` блок `13px ink-2 padding:11px 13 radius:12 bg surface-3 border line` (CSS 673) | `Notes` — НЕ использует класс `.notes`: инлайн `fs-base ink-2 line-height:1.55`, **без фона/бордера/паддинга** (EventPanels 121–127) | **P1**: заметки в дизайне — карточка на `surface-3` с рамкой; в коде — голый текст без контейнера. Класс `.notes` в app.css вообще отсутствует. |
| Футер | `.lp-f` + `.btn--danger`/`.btn--primary` `.btn--sm` (CSS 621, 246, 251) | `.lp-f` + `Btn danger/primary` | **OK**, но **P2**: `.btn--sm` в Lumo `padding:9px 15 font:13`, в коде `padding:6px 10 font:var(--fs-meta=12.5)` (app.css 516) — кнопки мельче дизайна. |

---

## (E) Левая панель — Переезд (view / edit / fork)

| Элемент | Дизайн (ожидается) | Код (сейчас) | Разница / что поправить |
|---|---|---|---|
| Route-блок | `.route` grid `1fr auto 1fr padding:16 bg surface-3 border line radius:14`; `.rt font-display 20 600`; `.rc 13 800`; `.ra 11 muted`; `.rd font-mono 11 muted` (CSS 662–665) | `.route` + `.rt/.rc/.ra/.rd` идентично (app.css 1344–1349; JSX TransferBody) | **OK**. |
| Серединка маршрута | `.rmid` стрелка + `svg 22` + **`.dur` (длительность «2ч 10м»)** под иконкой (CSS 664) | `.rmid` есть в CSS (app.css 1350–1351) но в JSX рендерится **только иконка `size 20`, без `.dur`** (EventPanels 186–188) | **P1**: пропущена подпись длительности под иконкой переезда; svg 20 vs 22. |
| Сегменты (пересадки) | `.segs`/`.seg` строки: `bg ev-transfer-soft border (ev-transfer 22%) radius:12`, `.sn` 22×22 r7, `b 13 800`, `span font-mono 11` (CSS 674) | **Отсутствует**: класс `.segs/.seg` не объявлен в app.css; `TransferBody` (view) НЕ рендерит секцию «Пересадки · N сегментов». | **P1/пропущенный элемент**: в view-панели переезда нет блока сегментов, который есть в Lumo C5. |
| Edit-форма (поля) | `.field`+`.input/.select/.textarea` `14.5px 500 bg surface-3 border:1.5px line-strong radius` ; focus→`primary` + ring 4px; `.field label 13 800` (CSS 297–315) | `EventEditDialog variant="panel"` — НЕ Lumo `.lp-*`. Свой header: 4px-полоса + `bg meta.soft padding:16px 22`, иконка **40×40 r10**, back-кнопка 32×32 r9. Поля: `.input` `9px 11 radius:r-sm border:1px line bg surface 14px`, focus ring 3px; `.field label var(--fs-meta=12.5) 500` (app.css 559–576; EventEditDialog 982–1016) | **P0/P1**: edit-панель построена легаси-вёрсткой, не `.lpanel/.lp-h/.lp-b/.lp-f`. Иконка 40×40 r10 vs Lumo `.lp-h .ic` 36×36 r12. Инпут: border 1px line vs 1.5px line-strong; фон surface vs surface-3; размер 14 vs 14.5; вес — vs 500; ring 3px brand-soft vs 4px primary-ring. Лейбл 12.5/500 vs 13/800. |
| AI-блок | `.aiblk` `border:1.5px ai-soft-2 radius:14 bg ai-gradient-soft padding:13`; `.ai-ic` 30×30 r10 ai-gradient; `.at b 13.5 800 ai-ink` (CSS 667–670) | `EventAiBlock` — собственный компонент; класс `.aiblk` в app.css **отсутствует**. Стиль AI-блока не сверялся с Lumo-токенами здесь. | **P1/непокрыто**: `.aiblk` Lumo не портирован; нужно отдельно сверить `EventAiBlock`. |
| Upload-зона | `.upload` `dashed line-strong, bg surface-3, padding:16, center`, svg 20 muted-2, hover→primary (CSS 675–676) | `DocumentsField` — свой компонент; класс `.upload` в app.css **отсутствует**. | **P1/непокрыто**: `.upload` не портирован; сверить `DocumentsField`. |
| Fork (развилка) | `.lpartner` `padding:11px 13 radius:13 border line`, `.pl` 32×32 r9 (цвет бренда партнёра), `b 13.5 800`, `.ch` 16 muted-2; + `.txmodes`/`.txmode` 40×40 r13 `bg ev-transfer-soft` (CSS 626–629, 489–491) | `ForkPartnerModal variant="panel"` — классы `.lpartner`/`.txmode`/`.txmodes` в app.css **отсутствуют**; вёрстка форка собственная. | **P1/непокрыто**: партнёрские строки и плитки-видов-транспорта не сверены с Lumo (классы не портированы). |
| Warning-состояние | `.lp-warn` `padding:12 radius:13 bg warning-soft`, svg 18 warning-ink, `b 13 800`, `span 12 muted` (CSS 630) | EventSourcePanel рисует инлайн `.te-fix-note` `padding:9px 11 radius:10 bg warning-soft border (warning 32%)`, svg 15 (EventSourcePanel 132–137) | **P1**: используется собственный `.te-fix-note` вместо Lumo `.lp-warn`. Хотя `.lp-warn` объявлен в app.css (1353–1355) и применяется в CityPanel-сценарии — здесь не задействован. Размеры/иконка мельче (15 vs 18, padding 9/11 vs 12). |

---

## (F) Левая панель — Активность / Аренда авто

| Элемент | Дизайн (ожидается) | Код (сейчас) | Разница / что поправить |
|---|---|---|---|
| Activity view | C5: `.lp-h` (ic ev-activity-soft) + metastrip + addr + kvgrid + docs + notes | `ActivityBody` — те же `.metastrip/.addr/.kvgrid/.docrow` + `Notes` (EventPanels 211–236) | **OK** по каркасу; те же оговорки, что в (D): `.notes` без контейнера (**P1**); размер файла в docrow заменён иконкой (**P2**). |
| Car view | C5: `.lp-h` (ic ev-car-soft) + 2× kvgrid (получение/возврат, стоимость/бронь) + docs | `ServiceBody` — `.kvgrid` секции + docs (EventPanels 239–261); иконка kind=`car`, accent `var(--ev-car)` (ACCENT 18) | **OK**. Токен `--ev-car` совпадает с Lumo. |
| Activity «отсутствует» (двойной ghost) | C5: `.gadd` (ручное) + `.gadd[--a:ai]` (предложить ИИ) + `.aiblk` | CityPanel «нет активностей» → один `.gadd` (ru: `tse.no_activities`); ИИ-ghost и `.aiblk` в панели города не рендерятся (CityPanel 155–156) | **P2/упрощение**: в Lumo пустое состояние активностей даёт две ghost-кнопки (ручная + ИИ) и AI-блок; код — одну. |
| Цвет иконки activity | `--ev-activity` `#E0568F` / ink `#BC2F6A` | `ACCENT.activity = var(--ev-activity)`, soft `var(--ev-activity-soft)` | **OK** (на токенах). |

---

## (G) Сквозное (шрифты, токены, радиусы, тени, hover)

| Аспект | Дизайн (Lumo) | Код | Разница |
|---|---|---|---|
| Шрифты | `--font-display:Rubik`, `--font-ui:Nunito` (CSS 76–77) | `--font-display:"Rubik"`, `--font-ui:"Nunito"` (app.css 130–131) | **OK** (совпадают). |
| Цветовые токены событий | `--ev-hotel/-transfer/-activity/-car/-deadline` + soft/ink (CSS 26–43) | Идентичные значения (app.css ~) | **OK**. Код почти везде на токенах; редкие инлайн-хексы `PALETTE` (TripStructureEdit 37) — только для цвета маркеров на карте, не UI. |
| Радиусы | `--r-card:24 --r-md:16 --r-btn:14 --r-sm:11 --r-pill:999` (CSS 71) | Идентично (app.css 116) | **OK**. **P1**: но узлы города в коде `border-radius:50%` (круг), тогда как Lumo использует `r9–r11` квадраты (см. A/B). |
| Тени | `--sh-1/-2/-3` (CSS 72–74) | Идентичные + алиасы `--shadow-soft/card/pop` = sh-1/2/3 (app.css 123–128) | **OK**. **P2**: сидлайн-пилюля переезда использует `sh-1` (через `shadow-soft`), дизайн — `sh-2`. |
| Типошкала | Lumo задаёт размеры точечно (14.5/13/12.5/11/16 …) | Код вводит токены `--fs-micro:11 --fs-meta:12.5 --fs-base:14 --fs-strong:15 --fs-h4:16` (app.css 144–148) | **P1**: токенизация хороша, но значения не всегда = дизайну: например название города `--fs-strong=15` vs Lumo 16; `.btn--sm` 12.5 vs 13; инпут 14 vs 14.5. |
| Hover-состояния | карточки → `translateY(-2/-3) + sh-2`; пилюли → `scale(1.02)+sh-3`; ghost → border+tint | `.te-row:hover` → `sh-2`+`line-hover` (без translate); `.bookrow:hover` → `translateY(-2)+sh-2` (есть); `.te-seam__pill:hover` → border+`shadow-card` (без scale) | **P2**: ряд строк маршрута без подъёма (дизайн добавляет лёгкий lift на карточках `.edl2-row` через `.reveal`/hover-bg); пилюля без `scale`. |
| Инпут-стиль | `bg surface-3, border:1.5px line-strong, 14.5/500`, focus ring 4px `primary-ring` (CSS 302–305) | `bg surface, border:1px line, 14px`, focus ring 3px `brand-soft` (app.css 563–575) | **P1**: системно мягче дизайна (фон/толщина бордера/размер/ring). Затрагивает все edit-панели. |
| Кнопка `.btn--sm` | `padding:9px 15; font:13` (CSS 251) | `padding:6px 10; font:var(--fs-meta=12.5)` (app.css 516) | **P1**: кнопки в футерах панелей мельче дизайна. |
| Каркас экрана (50/50) | Lumo screens — список + карта; карта со скруглением/инсетом | `ts-grid` `minmax(0,1fr) minmax(0,1fr)`, `.ts-map inset:14 radius:16 border line` (TripStructureEdit 843, 943) | **OK** (соответствует ожиданию 50/50 + скруглённая карта). |

---

## Сводка приоритетов

### P0 — каркас / форма / цвет (явные расхождения)
1. **Список маршрута — другой каркас.** Код: табличный CSS-grid `.te-table/.te-row` с шапкой колонок `.te-thead` (Куда/Ночей/Ночлег/Активности). Lumo C4: карточный таймлайн `.edl2/.edl2-row` без табличной шапки, с инлайновыми степпером/иконками. (A)
2. **Узлы городов — круги вместо скруглённых квадратов.** Код `.te-row__num`/`.te-row__node` = `border-radius:50%`, 22×22. Lumo `.edl-node*` = r9–r11, 28–30×30. Затрагивает start/end/waypoint/номер. (A, B)
3. **Edit-панель события не на Lumo-каркасе.** `EventEditDialog variant="panel"` использует легаси-вёрстку (4px-полоса + `meta.soft`-header, иконка 40×40 r10, Tailwind-классы), а не `.lpanel/.lp-h/.lp-b/.lp-f`. (E)

### P1 — размеры / радиусы / пропущенные элементы
- Узел-номер: 22×22 brand-soft-12 700 vs 28×28 primary-soft 600. (A)
- Строка маршрута: радиус 16 vs 15, padding/gap. (A)
- Сидлайн-переезд: padding `4px 11` vs `7px 14`, border 1px vs 1.5px, тень sh-1 vs sh-2, текст 600/11 vs 800/12, прижат влево вместо центра. (A)
- Плашка «добавить отель/активность» скрыта до hover (`opacity:0`) vs всегда видима в Lumo. (A)
- `.wptag`: цвет `ev-transfer` vs `ev-transfer-ink`, padding `2px 6` vs `4px 10`, вес 700 vs 800. (B)
- Название города: вес 800/15 vs 600/16. (B)
- Заметки (`.notes`): голый текст без surface-3-контейнера; класс `.notes` не портирован. (D, F)
- Переезд view: пропущен `.dur` под иконкой + пропущен блок сегментов `.segs/.seg`. (E)
- Не портированы Lumo-классы `.aiblk`, `.upload`, `.lpartner`, `.txmode/.txmodes` — edit/fork панели сверяются отдельно. (E)
- Warning-блок: `.te-fix-note` вместо Lumo `.lp-warn` (мельче, другой паддинг). (E)
- Инпуты системно мягче (surface/1px/14 vs surface-3/1.5px line-strong/14.5 + ring 3 vs 4). (G)
- `.btn--sm` мельче (6/10/12.5 vs 9/15/13). (G)
- Типошкала: ряд значений ≠ дизайну (fs-strong 15 vs 16 и т.п.). (G)

### P2 — мелочи
- Варнинг-бейдж отеля `::after` (красная «!») заменён инлайн-иконкой. (A)
- Числовой бейдж конфликтов `.te-warnbadge` — доп.элемент, в Lumo нет (только окраска узла). (B)
- Лейбл endpoint: 11/700/.08em vs 10/800/.07em. (B)
- Hero города: фото+overlay-grad vs синтетический градиент `#6FB2FF→#8A6BF0`. (C)
- `.bookrow.is-warn` не портирован (фон иконки красится через JS). (C)
- docrow: размер файла заменён `external`-иконкой. (D, F)
- Пустое состояние активностей: один ghost vs два ghost + aiblk в Lumo. (F)
- Спайн-линия: позиция 45 vs 28, opacity .65. (A)
- Hover: строки маршрута без lift, пилюли без scale. (G)

---

**Итог:** панель города и view-панели событий (`CityPanel`, `EventPanels.jsx`) — почти эталонный порт Lumo (P2-косметика). Основной долг — (1) сам список маршрута построен как таблица, а не карточный `.edl2`-таймлайн; (2) узлы городов — круги вместо r9-квадратов; (3) edit/fork-панели событий не переведены на `.lpanel`-каркас и Lumo-классы `.aiblk/.upload/.lpartner/.txmode`.

---

# Проход 2 — повторная сверка + дополнение (2026-06-06)

## Повторная сверка A–G

Спот-чек таблиц A–G против фактического кода — **подтверждено, расхождения актуальны**:

- `.te-row__num` / `.te-row__node` = `border-radius:50%`, 22×22 (app.css 1175) — круги, не r9-квадраты. ✔ P0/P1.
- `.te-table::before` спайн `left:45px; top/bottom:24px; opacity:.65` (app.css 1229) vs Lumo `left:28px`. ✔
- `.te-seam__pill` `padding:4px 11px; border:1px; box-shadow:var(--shadow-soft)=sh-1` (app.css 1246) vs Lumo `7px 14 / 1.5px / sh-2`. ✔
- `.te-cityname` `font-display 800 var(--fs-strong)` (app.css 1167) vs Lumo `600/16`. ✔
- `.te-wptag` цвет `--ev-transfer` (не `-ink`), `2px 6 / 700` (app.css 1237). ✔
- `Notes` рендерится голым текстом `var(--fs-base)/ink-2/line-height:1.55` без контейнера (EventPanels.jsx 121–127); класс `.notes` (Lumo: surface-3-карточка) в app.css **отсутствует**. ✔
- Классы `.aiblk / .upload / .lpartner / .txmode / .segs / .notes` в `src/design/app.css` **не объявлены** (grep — 0 совпадений). ✔
- Каркас экрана: `ts-grid 1fr/1fr` + `.ts-map inset:14 radius:16 border` (TripStructureEdit 843, 943) — соответствует 50/50 + скруглённая отлепленная карта. ✔ (это layout, не стиль элементов — на (A)–(F) не влияет.)

**Токены:** значения `--ai / --ai-soft / --ai-soft-2 / --ai-ink / --ai-gradient / --ai-gradient-soft` в коде (app.css 78–87, dark 196–204) **идентичны** Lumo (CSS 36–38, 96–98). Расхождения ниже — не в значениях токенов, а в реализации (Tailwind/shadcn/lucide-островки + единичные off-token хардкоды).

---

## (H) Левая панель — AI-блок распознавания брони (`EventAiBlock.jsx`)

Lumo-эталон: `.aiblk` `border:1.5px var(--ai-soft-2); radius:14; bg var(--ai-gradient-soft); padding:13`; `.ah` flex gap9; `.ai-ic` 30×30 r10 `var(--ai-gradient)` svg16 #fff; `.at b` 13.5/800 `var(--ai-ink)`; `.at span` 11.5/600 muted; `.ab` margin-top10 flex gap8. (CSS 667–670)

| Элемент | Дизайн (Lumo) | Код (сейчас) | Разница |
|---|---|---|---|
| Каркас | `.aiblk` единый класс | Tailwind + inline-style, классы `.aiblk/.ah/.ai-ic/.at` **не используются** | **P0-структурно**: легаси-островок вместо Lumo-класса. |
| Контейнер | `border:1.5px ai-soft-2; radius:14; bg ai-gradient-soft; padding:13` | `rounded-xl border` (radius12, border 1px), `borderColor var(--ai-soft-12)`, padding 18/16/12 (плавает по состояниям) | **P1**: радиус 12 vs 14, бордер 1px vs 1.5px, паддинг непостоянный. |
| Фон | чистый `var(--ai-gradient-soft)` (сине-фиол-розовый) | `linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05–.06) 100%)` — **подмешан амбер `#F0A45A`** | **P1/баг-токен**: оранжевый хардкод (остаток старой амбер-AI-темы) в фиолетовом AI-блоке. |
| Иконка | `.ai-ic` 30×30 **r10** `ai-gradient` | `AiIcon` 32×32 **r8** (idle/available/parsed) и **40×40 r10** (parsing) `var(--ai-grad)` | **P1**: размер 32/40 vs 30, радиус 8 vs 10. |
| Заголовок | `.at b` 13.5/**800** `var(--ai-ink)` | `Title` `text-sm font-semibold` (14/600), цвет дефолтный ink (не ai-ink) | **P1**: вес 600 vs 800, размер 14 vs 13.5, цвет ink vs ai-ink. |
| Pro-бейдж | бейдж на токенах (`--pro`/золото или `.badge--ai`) | `bg-amber-100 text-amber-800` — **Tailwind-хардкод амбер** | **P1/off-token**: вне дизайн-системы. |
| Иконки | app `Icon` (sparkle и т.п.) | **lucide-react** (Sparkles, Upload, Lock, Loader2, X, FileText, Image, Edit3, RefreshCw, ChevronUp) | **P2**: другой icon-сет. |
| Кнопки | `.btn--ai` / `Btn` | shadcn `Button` + `bg-gradient-to-r from-primary via-chart-1 to-chart-3` | **P1**: shadcn + Tailwind chart-токены вместо `.btn--ai`. |
| Состояние «parsed» | (успех на токенах) | bg `rgba(31,138,91,.10)` хардкод, borderColor `--success` | **P2/off-token**: rgba-хардкод вместо `--success-soft`. |
| Файл-строки | (в Lumo — docrow-подобные) | Tailwind `rounded-lg border bg-background`, иконка 28×28 `--ai-soft`/`--ai` | **P2**. |

**Вывод (H):** виджет корректно воспроизводит 6 состояний прототипа (locked/available/idle/uploaded/parsing/parsed), но реализован как **Tailwind+shadcn+lucide-островок**, не на `.aiblk`; затесались off-token хардкоды (амбер `#F0A45A`, `amber-100/800`, success-rgba).

---

## (I) Документы / зона загрузки (`DocumentsField.jsx`)

Lumo-эталон: `.upload` колонка-центр, gap5, padding16, radius13, `border:1.5px dashed var(--line-strong)`, `bg var(--surface-3)`, svg20 muted-2, hover→`border var(--primary)` + `bg var(--primary-soft)`, `b 12.5/700 ink-2`, `span 11/600 muted` (CSS 675–676). Список файлов = `.docrow` (padding 9/11, radius11, surface-3, border line; `.di` 30×30 r8 danger-soft/ink; `b 13/700`; `span` mono 11 = размер файла) (CSS 672).

| Элемент | Дизайн (Lumo) | Код (сейчас) | Разница |
|---|---|---|---|
| Обёртка секции | контейнер даёт панель | `section.rounded-xl border bg-card p-4` (есть `bare`-режим без неё) | **P2**: лишний `bg-card`-контейнер вне `bare`. |
| Зона дропа | `.upload` radius13, `1.5px dashed line-strong`, `bg surface-3`, hover `primary` + `bg primary-soft` | `rounded-lg border-2 border-dashed border-border hover:border-primary/60 p-4` — radius8, бордер `border`, **без `bg surface-3`**, hover без смены фона | **P1**: радиус 8 vs 13, цвет бордера `border` vs `line-strong`, нет фона surface-3, hover без `primary-soft`. |
| Текст зоны | `b 12.5/700 ink-2` + `span 11/muted` | `text-sm text-muted-foreground` (один уровень) | **P2**. |
| Иконки | одна svg 20 muted-2 | lucide Paperclip/Upload/Plus/X/Loader2 | **P2**. |
| Список файлов | `.docrow` + `.di` 30×30 r8 danger-soft + размер файла (mono 11) | `<li>` `px-2 py-1.5 rounded-md hover:bg-secondary/60`, Paperclip 14, ссылка `text-primary`, **без `.di`, без размера файла** | **P1**: не `.docrow`; нет цветной иконки-плитки и размера файла. |

**Вывод (I):** dropzone концептуально ≈ `.upload`, но Tailwind-вёрстка (`bg-card`/`border-border`/radius8); файловые строки не портированы на `.docrow`.

---

## (J) Форк «добавить вручную / партнёр» (`ForkPartnerModal.jsx`)

Lumo-эталон: `.lpartner` строка (gap11, padding 11/13, radius13, border line, hover→`primary`+sh-1+lift), `.pl` 32×32 r9 цвет-бренда #fff 800/12, `b` 13.5/**800**, `.ch` 16 muted-2 (CSS 626–629). Виды транспорта: `.txmodes` flex gap9 + `.txmode` 40×40 r13 `ev-transfer-soft/ink`, hover `ev-transfer`+lift, svg18 (CSS 489–491).

| Элемент | Дизайн (Lumo) | Код (сейчас) | Разница |
|---|---|---|---|
| Каркас | список `.lpartner` (+ при выборе транспорта `.txmodes`) | собственный `.fork-grid` 2 кол `1fr / 1.4fr` (ручное \| партнёры) + `.fork-partner-card` | **P0/структурно**: иная парадигма (двухколоночная вилка), не Lumo-список. |
| Panel-вариант | `.lpanel/.lp-h/.lp-b/.lp-f` | `.te-panel/.te-back/.te-panel__icon/.te-panel__title/.te-panel__foot` (легаси editor-классы) | **P0/P1**: не на `.lpanel`-каркасе. |
| Карточка партнёра | `.lpartner` + `.pl` 32×32 r9 (бренд-инициал), `b` 13.5/**800**, `.ch` 16 | logo 38×38 r9 (single 56 r12), label 13.5/**600**, ExternalLink 16/14, **без `.pl`-бейджа** | **P1**: вес 600 vs 800; logo-плитка вместо цветного инициала; габариты. |
| Ручная карточка | (в Lumo нет отдельной — действие в списке) | 42×42 r11 `meta.color`, `box-shadow:0 0 0 3px colorSoft`, заголовок `fs-strong`/600 | **P2/доп.элемент**. |
| Плитки видов транспорта | `.txmode` 40×40 r13 ev-transfer-soft | **отсутствуют** | **P1/пропущено**: выбор транспорта плитками не реализован в форке. |
| Иконки/кнопки | app `Icon` / `.btn--*` | lucide (ExternalLink, Bed, Plane, Car, Wifi, ShieldCheck, Info, ArrowLeft) + shadcn `Button`/`Dialog` | **P2**. |
| Off-token | — | esim `colorSoft rgba(31,138,91,.10)` хардкод | **P2**. |

**Вывод (J):** форк — самостоятельная двухколоночная вилка на lucide/shadcn; panel-вариант на легаси `.te-panel` (не `.lpanel`); `.lpartner`/`.txmode` не задействованы.

---

## Дополнение к сводке приоритетов (проход 2)

**Повышение из «непокрыто» (P1) в подтверждённые расхождения:**

- **(H)** AI-блок: Tailwind/shadcn/lucide-островок вместо `.aiblk`; off-token хардкоды (амбер `#F0A45A`, `amber-100/800`, success-rgba) — **P0-структурно + P1-цвет**. Срочно убрать амбер-подмес (визуальный баг в фиолетовом AI-блоке).
- **(I)** `DocumentsField`: dropzone не на `.upload` (radius/фон/бордер/hover), файлы не на `.docrow` — **P1**.
- **(J)** `ForkPartnerModal`: иная парадигма + legacy `.te-panel`-каркас + отсутствуют `.txmode`-плитки — **P0-структурно (panel) / P1**.

**Самый дешёвый быстрый выигрыш (low-risk, без смены каркаса):** убрать амбер `rgba(240,164,90,…)` и `bg-amber-100/text-amber-800` из `EventAiBlock` → перевести на чистый `--ai-gradient-soft` + токен-бейдж; это убирает явный цветовой баг и не трогает логику.
