// @ts-check
/*
 * TRIP-349 — объявление изменений для гарда 2p (визуальный дифф CSS).
 *
 * Маркеры лежат ЗДЕСЬ, а не в app.css, намеренно: внутри CSS они попадают под
 * собственное гашение комментариев гарда, и многострочный блок с {@media …} он
 * начинает разбирать как правила — получил 20 ложных ключей и единицу «.css»,
 * вытащенную из слова app.css. Гард читает маркеры из ДОБАВЛЕННЫХ строк диффа,
 * поэтому файл значения не имеет.
 *
 * Почему их так много: правила редактора жили в теге <style> ВНУТРИ рендера
 * этого компонента, а 2p читает только .css — поэтому перенос выглядит для него
 * массовым появлением и сносом объявлений.
 *
 * Бланкетного маркера у 2p нет намеренно, и это правильно: один общий пропустил
 * бы вместе с переносом любую правку общего класса.
 *
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} background — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} box-shadow — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} max-width — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} transform — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .app-side {@media (max-width: 880px)} transition — меню редактора перестало быть своей копией и поехало на общее .trip-shell
 * visual-diff-exempt: .is-open {@media (max-width: 880px)} opacity — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .is-open {@media (max-width: 880px)} pointer-events — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .is-open {@media (max-width: 880px)} transform — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .lp margin — артефакт одного победителя на ключ: .flow-editcol и .ts-leftbox в DOM не пересекаются
 * visual-diff-exempt: .te-panefade animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .te-panefade {@media (prefers-reduced-motion: reduce)} animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-col-right {@media (max-width: 1080px)} height — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-drawer display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} background — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} bottom — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} box-shadow — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} inset — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} left — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} max-width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} opacity — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} pointer-events — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} position — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} top — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} transform — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} transition — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer {@media (max-width: 880px)} z-index — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} background — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} inset — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} opacity — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} position — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-drawer__scrim {@media (max-width: 880px)} transition — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-fab transition — FAB схлопнут на <IconBtn size="fab">, приватный .ts-fab снят; облик нажатия несёт примитив
 * visual-diff-exempt: .ts-fab:active transform — FAB схлопнут на <IconBtn size="fab">, scale-press снят намеренно (у примитива filter brightness)
 * visual-diff-exempt: .ts-fab:active {@media (prefers-reduced-motion: reduce)} transform — FAB схлопнут на <IconBtn size="fab">, приватный .ts-fab снят
 * visual-diff-exempt: .ts-fab:hover transform — FAB схлопнут на <IconBtn size="fab">, scale-press снят намеренно (у примитива filter brightness)
 * visual-diff-exempt: .ts-fab:hover {@media (prefers-reduced-motion: reduce)} transform — FAB схлопнут на <IconBtn size="fab">, приватный .ts-fab снят
 * visual-diff-exempt: .ts-grid display — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid gap — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid grid-template-columns — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid height — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid min-height — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid min-width — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid overflow — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 1080px)} grid-auto-rows — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 1080px)} grid-template-columns — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 1080px)} overflow-y — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} background — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} border — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} box-shadow — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} column-gap — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} display — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} grid-template-columns — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} margin — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-grid {@media (max-width: 760px)} padding — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-in font-family — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in font-size — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in font-weight — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in letter-spacing — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-in line-height — мёртвый класс, правило снято по требованию гарда 2n
 * visual-diff-exempt: .ts-leftbox background — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox display — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox flex — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox flex-direction — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox margin — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox min-height — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox min-width — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox overflow — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftbox {@media (max-width: 1080px)} margin — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftscroll margin — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-leftscroll {@media (max-width: 1080px)} overflow — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-map {@media (max-width: 1080px)} left — новая раскладка секции: колонка скроллит себя вместо документного скролла
 * visual-diff-exempt: .ts-pdrawer animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer background — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer border — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer border-radius — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer border-right — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer box-shadow — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer display — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer flex — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer flex-direction — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer inset — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer min-height — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer position — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer z-index — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-pdrawer {@media (prefers-reduced-motion: reduce)} animation — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} background — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} border — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} box-shadow — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} column-gap — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} grid-template-columns — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} margin — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 760px)} padding — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} background — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} bottom — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} box-shadow — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} inset — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} left — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} max-width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} opacity — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} pointer-events — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} position — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} top — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} transform — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} transition — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-screen {@media (max-width: 880px)} z-index — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol flex — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol height — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol min-height — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol min-width — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol position — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-sidecol {@media (max-width: 880px)} display — вторая оболочка редактора снесена, off-canvas держит .trip-shell
 * visual-diff-exempt: .ts-step:active {@media (prefers-reduced-motion: reduce)} transform — правило перенесено из тега style внутри рендера в app.css, значения не менялись
 * visual-diff-exempt: from {@keyframes tePaneIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes tePaneIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tePaneIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tePaneIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes tsDrawerIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes tsDrawerIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tsDrawerIn} opacity — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: to {@keyframes tsDrawerIn} transform — кейфрейм перенесён из тега style внутри рендера в app.css
 * visual-diff-exempt: from {@keyframes teAddIn} opacity — новый кейфрейм анимации открытия десктоп-композера добавления города
 * visual-diff-exempt: from {@keyframes teAddIn} transform — новый кейфрейм анимации открытия десктоп-композера добавления города
 * visual-diff-exempt: to {@keyframes teAddIn} opacity — новый кейфрейм анимации открытия десктоп-композера добавления города
 * visual-diff-exempt: to {@keyframes teAddIn} transform — новый кейфрейм анимации открытия десктоп-композера добавления города
 *
 * Шаги кейфреймов — тоже единицы 2p (имя анимации ЧАСТЬ ключа: from/to
 * повторяются у 19 анимаций, и без имени один маркер гасил бы чужую).
 *
 * Пол 2o: классы +4 при СНЕСЁННЫХ .ts-screen/.ts-sidecol/.ts-drawer/
 * .ts-drawer__scrim. Прироста имён нет — это те же правила, что жили в теге
 * style внутри рендера, где аудит их не видел; переехав в app.css, они стали
 * видимыми. Инлайны при этом −9, пространств имён 0.
 * floor-exempt: classes +4 — правила переехали из тега style внутри рендера в app.css, новых имён не заведено (апрув Pavel: перенос согласован в разборе TRIP-349)
 * floor-exempt: triage +4 — те же четыре класса, семья ts и так на разборе (апрув Pavel)
 * * Перенос скоупа мобильной компактной таблицы: .ts-screen (снесённая оболочка)
 * -> .ts-grid, живой класс и тоже только редакторский, значения те же.
 * visual-diff-move: .ts-screen .te-row -> ts-grid
 * visual-diff-move: .ts-screen .te-cell--act -> ts-grid
 *
 * ── TRIP-337 (батч из 8 UI-фиксов) — намеренный дрейф, апрув Pavel. Маркеры 2p
 *    лежат тут, а не в app.css: медиа-маркер `.tile {@media …}` в CSS-комментарии
 *    гард разбирает как правило (см. шапку выше).
 * visual-diff-exempt: .seg button font — `font: inherit` снят, кегль из канона .t-label
 * visual-diff-exempt: .seg button font-size — сегмент снят с .t-meta на канон .t-label (кегль label 13px)
 * visual-diff-exempt: .seg button font-weight — то же, вес label 600
 * visual-diff-exempt: .seg button font-variant-numeric — то же (label без tabular-nums)
 * visual-diff-exempt: .fpill--tone:hover background — ховер плашки переезда возвращён тинтом канала (мой непрозрачный surface убил дефолтный ховер)
 * visual-diff-exempt: .trips-toolbar .seg--filter button font-family — экранный патч снят, типографика на канон .seg button/.t-label
 * visual-diff-exempt: .trips-toolbar .seg--filter button font-size — то же
 * visual-diff-exempt: .trips-toolbar .seg--filter button font-weight — то же
 * visual-diff-exempt: .trips-toolbar .seg--filter button letter-spacing — то же
 * visual-diff-exempt: .trips-toolbar .seg--filter button line-height — то же
 * visual-diff-exempt: .te-cityname font-family — название города Subheading→Label
 * visual-diff-exempt: .te-cityname font-size — то же
 * visual-diff-exempt: .te-cityname line-height — то же
 * visual-diff-exempt: .te-endlabel font-size — СТАРТ/ФИНИШ Micro→Tiny Caps
 * visual-diff-exempt: .te-wptag background — класс снят, тег «ПЕРЕСАДКА» на DS <Badge size="tiny">
 * visual-diff-exempt: .te-wptag border-radius — то же
 * visual-diff-exempt: .te-wptag flex — то же
 * visual-diff-exempt: .te-wptag font-family — то же
 * visual-diff-exempt: .te-wptag font-size — то же
 * visual-diff-exempt: .te-wptag font-weight — то же
 * visual-diff-exempt: .te-wptag letter-spacing — то же
 * visual-diff-exempt: .te-wptag line-height — то же
 * visual-diff-exempt: .te-wptag padding — то же
 * visual-diff-exempt: .te-wptag text-transform — то же
 * visual-diff-exempt: .te-wptag white-space — то же
 * visual-diff-exempt: .badge background — тон бейджа «ПЕРЕСАДКА» = ev-transfer (scoped .te-dts .badge)
 * visual-diff-exempt: .badge color — то же
 * visual-diff-exempt: .te-dts background — то же (атрибуция правила .te-dts .badge)
 * visual-diff-exempt: .te-dts color — то же
 * visual-diff-exempt: .fpill--square border-radius — чип отеля/активности в ячейке r-sm→r-btn
 * visual-diff-exempt: .te-cell--act border-radius — то же (scoped-правило радиуса)
 * visual-diff-exempt: .te-cell--hotel border-radius — то же
 * visual-diff-exempt: .fpill--tone background — плашка наличия переезда: непрозрачный surface вместо тинта
 * visual-diff-exempt: .te-seam background — то же (scoped surface плашки переезда)
 * visual-diff-exempt: .te-seam border-color — плашка переезда: цветная рамка --hl
 * visual-diff-exempt: .te-seam color — плашка переезда: цветной текст --hl-ink
 * visual-diff-exempt: .tile {@media (hover: hover) and (pointer: fine)} color — иконка плейсхолдера красится в тон ховера --a
 * visual-diff-exempt: .pop-flush border-radius — контейнер search/select (города/адреса/язык/валюта) на радиус поля --r-btn (10); был --r-card (24) от базы .pop
 * visual-diff-exempt: .menu border-radius — канон action-меню на --r-btn (10, попап аккаунта и все меню); был --r-md (16)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { rpcSetCityNights, rpcSetTripStartDate, rpcAddCity, rpcRemoveCity, rpcReorderCities, refetchTrip } from '@/lib/tripEdit';
import { withRecompute, reconcileCityChain, pruneCityContent } from '@/lib/trip-data';
import { errorText } from '@/lib/errorText';
import { layoutDates } from '@/lib/tripDates';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { useIsPhone } from '@/hooks/use-mobile';
import { DRAWER_EXIT_MS } from '@/hooks/usePresence';
import { useRouteDnD } from '@/lib/useRouteDnD';
import CityRow from '@/components/trip/CityRow';
import NightsStepper from '@/components/trip/NightsStepper';
import { sortVisits, validateTrip, primaryIssues } from '@/lib/validation';
import { uniqueCityCount, localizeVisits } from '@/lib/trip-cities';
import { formatTripRange, formatDateRange } from '@/lib/trip-dates';
import { tripDuration } from '@/lib/trip-stats';
import { Icon } from '../design/icons';
import { Badge, Btn, IconBtn, Chip, Card, MapShell, Tile, PageHead, Tooltip, Sheet, useToast } from '../design/index';
import { Row, Col, Trunc, Grow } from '../design/Layout';
import CitySearch from '@/components/cities/CitySearch';
import CountryFlag from '@/components/common/CountryFlag';
import { tzFromCoords } from '@/lib/timezone';
import { useTheme } from '@/lib/ThemeContext';
import LpSheet from '@/components/ui/LpSheet';
import MapView from '@/components/views/MapView';
import EventSourcePanel from '@/components/common/EventSourcePanel';
import CityPanel from '@/components/common/CityPanel';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import AddBookingPanel from '@/components/bookings/AddBookingPanel';
import { useT, useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { useStay22Bundle } from '@/lib/stay22';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { useTripAccess } from '@/components/trips/TripAccessContext';
import TripStartControl from '@/components/trip/TripStartControl';
import { transferKind } from '@/lib/transport';

// =====================================================================
// TRIP STRUCTURE EDITOR - "Сетка" (grid) design from the trip-structure-*
// prototype, wired to the real id-based model (city_visits + position),
// validateTrip conflicts (unified engine), live id-based RPC writes
// (add_city / remove_city / reorder_cities / set_city_nights). Live Google map.
// =====================================================================
// Заглушка для гашения побочного эффекта у уходящего слоя стопки (см. рендер
// panelOverlay): стабильная ссылка на модуле, чтобы клон уходящего узла не
// пересоздавал колбэк каждый кадр.
const NOOP = () => {};
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const fmtD = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d MMM') : '-'; };
// Calendar-day helpers. nights/gap are counted by DATE (not by the raw timestamp),
// so a checkout stored at 23:59 isn't rounded up to an extra night. This is what
// makes recompute idempotent on load: re-deriving dates from (nights, gap)
// reproduces exactly what's stored, so editor = timeline = DB.
const dayOf = (iso) => { const d = toDT(iso); return d ? d.startOf('day') : null; };
const dayWord = (n, t) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';
// A city added in the editor but not yet persisted carries a 'tmp-…' id (no real uuid
// until add_city inserts it). A LIVE transfer write to such a city fails the
// uuid type, so transfer creation is gated until the new city is persisted.
const isTmpId = (id) => String(id || '').startsWith('tmp-');

// Canonical date-chain layout (start = prevEnd + gap; end = start + nights) now
// lives in lib/tripDates.layoutDates, shared with ManualPlanner and mirroring the
// server recompute_trip. Used here only as optimistic reorder layout.
const recompute = layoutDates;

// Adjacency-driven gap, mirroring server recompute_trip [R1]: a city's gap is the
// day_span of the transfer between it and the PREVIOUS node — not any transfer that
// merely points at this city. A baked gap goes stale after a reorder (the transfer is
// no longer adjacent) and would drift vs the server, so it must be re-derived on every
// (re)layout. ManualPlanner passes no transfers → all gap 0. The first non-anchor's
// gap applies too (0043): a multi-day start->first leg counts, anchored at departure.
function applyAdjacencyGaps(nodes, transfers = []) {
  let prevId = null;
  return nodes.map((n) => {
    // The finish anchor needs its incoming-leg gap so layoutDates can push the finish
    // +1 on an overnight last->finish leg (mirror server recompute_trip end branch).
    // The start anchor is the base — no incoming gap applies to it.
    if (isAnchor(n)) {
      const tr = (n.kind === 'end' && prevId) ? (transfers || []).find((t) => t.from_city_visit_id === prevId && t.to_city_visit_id === n.id) : null;
      const next = n.kind === 'end' ? { ...n, gap: tr?.day_span ?? 0 } : n;
      prevId = n.id;
      return next;
    }
    const tr = prevId ? (transfers || []).find((t) => t.from_city_visit_id === prevId && t.to_city_visit_id === n.id) : null;
    const next = { ...n, gap: tr?.day_span ?? 0 };
    prevId = n.id;
    return next;
  });
}

function buildDraft(shell, transfers = [], lang) {
  const visits = localizeVisits(sortVisits(shell?.cityVisits || []), lang);
  // nights = stored date span. gap (days between the previous checkout and this
  // check-in) is the INCOMING transfer's day_span: a multi-day (or overnight) leg means
  // this city starts N days after the previous one. No incoming transfer → gap 0 (flush).
  // Source of truth = transfers.day_span; the stored city dates are the baked-in result.
  // gap is adjacency-driven (mirror server recompute_trip [R1]): only the transfer
  // between it and the PREVIOUS node counts, NOT one that merely points at this city
  // (which would survive a reorder and drift vs the server). The first non-anchor's gap
  // applies too (mirror 0043): a start->first leg is the adjacency from the `start` anchor.
  const trBetween = (a, b) => (transfers || []).find((t) => t.from_city_visit_id === a && t.to_city_visit_id === b);
  let prevId = null;
  const nodes = visits.map((v, i) => {
    const base = { ...v, position: Number.isFinite(v.position) ? v.position : i };
    if (isAnchor(v)) { prevId = v.id; return { ...base, nights: null, gap: null }; }
    const sd = dayOf(v.start_date), ed = dayOf(v.end_date);
    const isWp = v.kind === 'waypoint';
    const nights = isWp ? null : Math.max(0, (sd && ed ? Math.round(ed.diff(sd, 'days').days) : 1));
    const tr = prevId ? trBetween(prevId, v.id) : null;
    const gap = tr?.day_span ?? 0;
    prevId = v.id;
    return { ...base, nights, gap };
  });
  // Draft holds ONLY structure (nodes + removed cities + a FIXED trip start date).
  // Bookings are read LIVE from `content` (edits/adds via real dialogs → DB → refetch).
  // Trip base = the START anchor's own start_date — the single source of truth the
  // server writes via recompute_trip / set_trip_start_date. Mirrors the server's
  // _trip_anchor_date (which now prioritizes the same value). We must NOT derive it
  // from the start→first-leg transfer's departure datetime: recompute never updates
  // that datetime, so after a start-date shift it stays stale and the selector +
  // start-row would snap back to the old day while the cities show the new one
  // (TRIP-209). Fallback: first city's start.
  const firstTransit = nodes.find((n) => !isAnchor(n));
  const startAnchor = visits.find((v) => v.kind === 'start');
  const startDate = startAnchor?.start_date || firstTransit?.start_date || null;
  return { nodes, startDate };
}

// Compact month-grid date picker for the trip-start control. Tokens/icons from
// the design system; no new shared component. Picks an absolute start date which
// the caller turns into a delta shift (shiftStart) of the whole itinerary.
// Секция «Структура» — содержимое, а не экран. До TRIP-349 это был отдельный
// роут со СВОЕЙ оболочкой (шапка, два инстанса меню, свой drawer, свои запросы
// и гейты), дублировавшей оболочку экранов трипа. Теперь оболочку держит
// TripShell, а сюда приезжает уже загруженное и уже отгейченное:
//   shell   — тот же ответ TRIP_SHELL_KEY, что у TripView (trip + cityVisits)
//   content — тот же ответ TRIP_CONTENT_KEY (hotels/activities/transfers/members)
// Роль сюда НЕ передаётся: право на редактор проверяет реестр секций
// (canAccess: clearsStep(step,'editor')), а resolveSection подменяет недоступную секцию
// дефолтной — то есть по прямому адресу `?lens=edit` наблюдатель просто не
// попадёт. Своего ролевого гарда здесь нет намеренно, второй такой проверки
// быть не должно.
export default function EditLens({ tripId, shell, content, openCityId, onCityOpened, embedded = false, onClose }) {
  const t = useT();
  const { lang } = useI18n();
  const { fmtMoney } = useI18nFormat();
  const qc = useQueryClient();
  const { toast } = useToast();
  // ★ ПРАВО ЧИТАЕТСЯ ОДИН РАЗ И ЗДЕСЬ (TRIP-459). Секция «Маршрут» открыта ВСЕМ —
  // ступени у неё в реестре больше нет, — поэтому решать, что показывать, обязан
  // экран. Ступень приезжает готовой из ответа read-двери через
  // `TripAccessProvider`; своего вывода права тут нет и быть не может (гард 2z).
  //
  // ★ ВНИЗ ЕДЕТ НЕ ПРАВО, А СОСТОЯНИЕ КОНТРОЛА (`readOnly`), и это не вкусовщина.
  // `NightsStepper`, `TripStartControl` и `useRouteDnD` ШАРЯТСЯ с флоу создания
  // трипа (`ManualPlanner`), где `TripAccessProvider` не стоит вовсе: начни они
  // читать контекст сами — получили бы fail-closed `canEdit:false` и молча
  // сломали бы создание трипа. Контекст читают только те, кто живёт исключительно
  // внутри трипа (`CityPanel`, `EventSourcePanel`, панели броней).
  //
  // Пол безопасности от этого не зависит: все пять RPC маршрута гейтует сервер
  // (`_shared/resources/tripRoute.ts`, `requires:['editor']`). Здесь — честный UI,
  // а не защита, поэтому обработчики записи НЕ обвешаны копиями проверки: до них
  // просто не дотянуться, раз аффорданс не отрисован. Пять `if (!canEdit) return`
  // были бы пятью копиями правила, которые расходятся молча.
  const { canEdit } = useTripAccess();
  const [draft, setDraft] = useState(null);
  // Left-column panel FSM (replaces the old view/add modals). null = the city
  // list; otherwise the left pane swaps in-place to a panel:
  //   { type:'event', kind, id, warning }    - view/edit/delete a booking (EventSourcePanel)
  //   { type:'createTransfer', fromVisit, toVisit } - create a transfer (EventEditDialog panel variant)
  // СТОПКА панелей вместо одного слота: панели независимы и открываются ДРУГ
  // ПОВЕРХ ДРУГА (город → отель ложится сверху → «назад» возвращает к городу),
  // вместо прежней замены-с-рывком. Вся логика ниже работает над ВЕРШИНОЙ
  // (`leftPanel`), поэтому производится один раз здесь и больше нигде не меняется.
  const [stack, setStack] = useState(/** @type {any[]} */ ([]));
  const leftPanel = stack.length ? stack[stack.length - 1] : null;
  const openBase = (p) => setStack([p]);              // из списка/карты — новый верх, стопка сбрасывается
  const pushPanel = (p) => setStack((s) => [...s, p]); // изнутри панели — лечь ПОВЕРХ (drill-in)
  const replaceTop = (p) => setStack((s) => (s.length ? [...s.slice(0, -1), p] : [p])); // смена режима того же объекта
  const closeAll = () => setStack([]);
  // Снять слой ПО ИДЕНТИЧНОСТИ: только если он всё ещё верхний. Это возвращает
  // идемпотентность старого `setLeftPanel(null)` — некоторые панели зовут onClose
  // ДВАЖДЫ за одно закрытие (напр. удаление трансфера: успех мутации + повторный
  // запрос исчезнувшей сущности через onError). Голый «снять верхнюю» на второй
  // зов снял бы ещё и город под ним (закрывал весь стек). Сравнение по ссылке:
  // второй зов держит уже снятый объект, вершина другая → no-op.
  const popIfTop = (panel) => setStack((s) => (s.length && s[s.length - 1] === panel ? s.slice(0, -1) : s));
  // Закрытие «текущей» панели = снять ЕЁ (захваченную на этом рендере вершину),
  // а не «что там сейчас сверху» — иначе повторный зов сносит соседний слой.
  const closeLeftPanel = () => popIfTop(leftPanel);
  // Внешний запрос «открой этот город» (клик по городу в календаре → «Маршрут»).
  // Одноразово: ставим ту же панель города, что и `openCity`, и гасим запрос у
  // родителя, чтобы повторные ре-рендеры её не переоткрывали. Панель отрисуется,
  // когда доедет `draft` (до него экран — скелетон), состояние переживёт ожидание.
  useEffect(() => {
    if (!openCityId) return;
    openBase({ type: 'city', id: openCityId });
    onCityOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCityId]);
  // Встроенный режим (`embedded`): EditLens смонтирован в ящике поверх другого
  // экрана (календарь) и рисует ТОЛЬКО панель. Когда панель ЗАКРЫВАЮТ
  // (onBack → leftPanel=null), гасим ящик хоста. Ключевое: гасим ТОЛЬКО если
  // панель уже была открыта (ref), иначе первый кадр (leftPanel ещё null до
  // эффекта-открывашки) закрыл бы ящик в тот же тик — «клик ничего не делает».
  const embeddedOpenedRef = useRef(false);
  useEffect(() => {
    if (!embedded) return;
    if (leftPanel) embeddedOpenedRef.current = true;
    else if (embeddedOpenedRef.current) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, leftPanel]);
  // ≤640px: the editor panel opens as a bottom sheet (same Radix sheet + swipe
  // mechanism as the modals), matching the .lp-sheet CSS breakpoint.
  const isSheet = useIsPhone();
  // ★ ТЕМА КАРТЫ — ИЗ КОНТЕКСТА, А НЕ ЧТЕНИЕМ DOM В РЕНДЕРЕ. Здесь стояло
  // `document.documentElement.dataset.theme`: атрибут читается один раз при
  // рендере и НИ НА ЧТО НЕ ПОДПИСАН, поэтому карта узнавала о смене темы только
  // если экран перерисовывался по какой-то посторонней причине — «с большой
  // задержкой, а иногда никогда». `isDark`, а не `theme`: последний бывает
  // `system`, и сравнение с 'dark' даёт светлую карту на тёмной ОС.
  const { isDark: isDarkTheme } = useTheme();
  // ★ ЖИЛЬЁ И АКТИВНОСТИ — ТОЛЬКО ТАМ, ГДЕ ЕСТЬ КОЛОНКИ. На телефоне виджет
  // уезжает в шит шириной с экран: шесть колонок туда не помещаются, имена
  // городов усекаются до «Петропа…», а даты переносятся на вторую строку. До
  // эпика этих плиток в мобильной раскладке не было вовсе — и это было верно.
  // Не РЕНДЕРИМ, а не прячем стилем: скрытая ячейка всё равно занимала бы свою
  // колонку, и сетка осталась бы шестиколоночной.
  const showCols = !isSheet;
  // Виджет редактора: свёрнут ли он (десктоп) и на каком детенте стоит шит
  // (телефон). Оба — состояние ЭКРАНА, а не шелла: шелл раскладывает, экран
  // помнит. Стартовый детент — средний: карта видна, список читается.
  const [collapsed, setCollapsed] = useState(false);
  const [detent, setDetent] = useState(1);
  // A11y: when an in-place left panel opens, move focus into it (its back button
  // if present) so keyboard/SR users land in the new context; Esc closes it.
  // Верхний слой монтируется в ТОМ ЖЕ кадре (стопка рисует вершину напрямую),
  // поэтому зависимость — идентичность вершины (`leftPanel`).
  const leftPaneRef = useRef(null);
  useEffect(() => {
    if (!leftPanel || !leftPaneRef.current) return;
    const el = leftPaneRef.current.querySelector('button, [tabindex]') || leftPaneRef.current;
    requestAnimationFrame(() => el?.focus?.({ preventScroll: true }));
  }, [leftPanel]);
  // Кроссфейд стопки БЕЗ ремонта узла. Уходящий слой рендерится под СВОИМ ключом
  // (тем же, что был у верхней панели), поэтому React сохраняет ЕГО DOM-узел, а не
  // размонтирует и монтирует заново — иначе тяжёлая панель (EventSourcePanel даже
  // перезапрашивает данные) пересобиралась бы посреди анимации и дёргала кадры.
  // `closingLayers` — снятые слои, доигрывающие уход; их состав считается ПОЗЖЕ,
  // у самой раскладки (там есть `leftPanelEl`), а таймер снятия живёт тут.
  const [closingLayers, setClosingLayers] = useState(/** @type {{key:string, el:any}[]} */ ([]));
  const lastTopRef = useRef(/** @type {{key:string|null, el:any}} */ ({ key: null, el: null }));
  const closeTimers = useRef(/** @type {Map<string, any>} */ (new Map()));
  useEffect(() => {
    closingLayers.forEach((l) => {
      if (closeTimers.current.has(l.key)) return;
      closeTimers.current.set(l.key, setTimeout(() => {
        closeTimers.current.delete(l.key);
        setClosingLayers((cur) => cur.filter((x) => x.key !== l.key));
      }, DRAWER_EXIT_MS));
    });
  }, [closingLayers]);
  useEffect(() => () => { closeTimers.current.forEach((h) => clearTimeout(h)); closeTimers.current.clear(); }, []);
  const confirm = useConfirm(); // city delete → shared confirm (sheet on mobile)
  const [previewTransfer, setPreviewTransfer] = useState(null); // synthetic leg drawn on the map while creating a transfer
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // itinerary row hovered → highlight its map marker
  // Двухшаговый клик по маркеру (как в планировщике): первый клик ФИКСИРУЕТ город
  // на карте (бейдж + CTA-шеврон), панель и зум — только по CTA. Отдельный стейт,
  // а не leftPanel: выбор на карте живёт ДО открытия панели. openCity его гасит.
  const [mapPickId, setMapPickId] = useState(null);
  // Drag / FLIP / keyboard reorder live in the shared useRouteDnD hook (also used by
  // the trip-creation flow). It's instantiated below — once `ordered`, `isAnchor`
  // and the commit callback are in scope — and its returns are destructured there.
  // Живая модель: каждое изменение пишется сразу (ни драфта, ни лока, ни
  // «сохранить»), поэтому уход из секции — это просто размонтирование.
  // Optimistic local patch only; the server owns the authoritative state (refetched
  // after each action via runAction/closePanelAndSync). No undo/dirty/reset.
  const editDraft = (updater) => setDraft((d) => (d ? updater(d) : d));
  // Live edit: the optimistic local patch already ran. Persist via RPC, then reconcile
  // with the authoritative server state — but ONLY if this is still the latest action.
  // A monotonic seq drops stale reconciles so rapid edits don't snap the UI back to an
  // intermediate server state (no jitter). Per-action RPCs are also coalesced/debounced
  // by their callers (e.g. the nights stepper) so the server receives only the final value.
  const seqRef = useRef(0);
  // The E-write lifecycle (seq-guard + ordered barriers) lives in the seam as
  // withRecompute; this only declares the editor's phases. Since TRIP-435 the five
  // route RPCs RETURN the recomputed city_visits chain, so the authoritative
  // reconciliation comes FROM THE RESPONSE — the `refetch` phase is dropped (ONE
  // round-trip, not RPC + confirm-refetch).
  //   reconcile(chain): fold the returned chain into the shell cache (real ids +
  //     server dates → the added city un-mutes) and fire the success toast on this same
  //     RPC land. onOk is a best-effort side effect (removeCity prunes its content +
  //     sweeps files) — throws are swallowed by the seam.
  //   okKey: a success toast for the discrete actions; the frequent ones stay silent.
  /**
   * @param {() => Promise<any>} rpcFn
   * @param {{ onOk?: () => void, okKey?: string }} [opts]
   */
  const runAction = (rpcFn, { onOk, okKey } = {}) => withRecompute(seqRef, {
    run: rpcFn,
    // Toast fires on the RPC RESPONSE (reconcile) — the moment the muted card un-mutes /
    // the authoritative dates land — NOT at T0. For an ADD, "done" is when the real id
    // arrives (the card stops being pending), so the confirmation must ride the response,
    // not the optimistic placement — else the toast claims success while the card is still
    // a grey tmp- row. reconcile also folds the returned chain into the shell cache; no
    // `refetch` phase — the chain IS the authoritative reconciliation (TRIP-435).
    reconcile: (chain) => { reconcileCityChain(qc, tripId, chain); onOk?.(); if (okKey) successToast(t, okKey); },
    // Rebuild the draft from the now-authoritative cache on the next render.
    commit: () => { setDraft(null); },
    // RPC failed → drop the optimistic patch by rebuilding from the last good cache
    // state (only if a newer action hasn't already taken ownership — the seam gates it).
    rollback: () => setDraft(null),
    // Honest refusal: a generic `code` → localized line (never raw server prose,
    // TRIP-378); a client-side throw without a code falls back to the generic copy.
    onError: (e) => toast({ description: e && 'code' in e ? errorText(t, e.code) : t('tse.err_save'), variant: 'destructive' }),
  });
  // Any panel that may have WRITTEN transfers/bookings (create/event) closes through
  // here. The write ALREADY reconciled the caches from its own response (the seam's
  // returnChain: city chain → shell dates, transfers set → content), so the draft can
  // be rebuilt from the now-current caches AT ONCE.
  //
  // The draft is a state SNAPSHOT, not a live cache view: reconcile updates the query
  // cache, but the rendered dates come from `draft.nodes` and don't move until
  // `setDraft(null)` triggers a rebuild. Doing that only in `commit` gated the rebuild
  // behind the AWAITED confirm-refetch (withRecompute: reconcile → await refetch →
  // commit) — THAT was the 1-2s lag where a saved transfer/layover's city dates
  // updated a beat late even though the cache was already correct. Rebuild in
  // `reconcile` (fires before the await) so the visible dates snap in immediately; the
  // refetch stays a background confirm, and `commit` re-rebuilds only if it brought
  // something newer (skipped by the seq-guard when a concurrent runAction has taken over).
  // Фоновая досверка данных после закрытия панели — вынесена, чтобы её могли
  // разделить «назад на одну» (closePanelAndSync) и «сбросить всё» (клик по карте).
  const syncAfterPanel = () => withRecompute(seqRef, {
    reconcile: () => setDraft(null),
    refetch: () => refetchTrip(qc, tripId),
    commit: () => setDraft(null),
  });
  const closePanelAndSync = () => { closeLeftPanel(); return syncAfterPanel(); };
  // Coalesced/debounced server commit for the nights stepper (one RPC after the burst).
  const nightsCommit = useRef(new Map());   // cityId -> timeout handle
  const nightsTarget = useRef(new Map());   // cityId -> latest target nights (sync source of truth)
  const startCommit = useRef(null);         // debounce handle for trip start shift
  const startTarget = useRef(null);         // latest target trip start ISO (sync source of truth)

  // ДОСЫЛКА ОТЛОЖЕННОГО ПРИ УХОДЕ. Оба дебаунса ждут 350 мс после последнего
  // клика, и до TRIP-349 у них не было ни cleanup, ни досылки: тап по степперу
  // ночей и уход в эти 350 мс — и RPC не улетал НИКОГДА. Локальная правка при
  // этом уже отрисована, поэтому потеря выглядит как «сервер молча откатил».
  //
  // Раньше, чтобы нарваться, надо было успеть сменить РОУТ; теперь уход — это
  // один тап по пункту меню, то есть попасть в окно стало заметно проще. Шлём
  // из cleanup напрямую, а не через runAction: компонент уже размонтирован,
  // seq-guard и рефетч ему ни к чему, а показать тост уже негде.
  //
  // Зависимостей нет намеренно: эффект обязан сработать РОВНО один раз, на
  // размонтировании, и прочитать refs в их последнем состоянии.
  // ...и ОБЯЗАТЕЛЬНО перезапрашиваем трип после досылки. Обычный путь делает это
  // через runAction; здесь его нет, а TripView остаётся смонтированным со своим
  // кэшем — то есть без рефетча Хронология нарисует СТАРЫЕ даты, а возврат в
  // «Структуру» пересоберёт драфт из того же протухшего кэша, и правка исчезнет
  // с экрана, оставшись в БД. Это ровно тот симптом «сервер молча откатил»,
  // ради которого досылка и писалась, — без рефетча она лечит половину.
  useEffect(() => () => {
    const pending = [];
    const nights = nightsCommit.current;
    for (const [id, handle] of nights) {
      clearTimeout(handle);
      const finalN = nightsTarget.current.get(id);
      if (finalN != null) pending.push(rpcSetCityNights(tripId, id, finalN));
    }
    nights.clear();
    nightsTarget.current.clear();
    if (startCommit.current) {
      clearTimeout(startCommit.current);
      startCommit.current = null;
      const finalBase = startTarget.current;
      startTarget.current = null;
      if (finalBase) pending.push(rpcSetTripStartDate(tripId, toDT(finalBase).toISODate()));
    }
    if (!pending.length) return;
    // Рефетч ПОСЛЕ того, как RPC доехали: пущенный сразу, он успел бы вернуть
    // ещё дореформенное состояние и записать в кэш именно его — то есть сам
    // стал бы причиной того отката, который лечит. allSettled, а не all:
    // упавшая RPC не должна отменять перезапрос остальных.
    // qc жив после размонтирования (это клиент приложения, а не наш стейт).
    //
    // Здесь ОСОЗНАННО рефетч, а не реконсиляция из ответа (TRIP-435): в отличие от
    // runAction, тут оседает НЕСКОЛЬКО RPC разом (ночи по нескольким городам + старт),
    // и каждая вернула бы цепочку по состоянию СВОЕЙ транзакции — записать в кэш
    // последнюю по времени значило бы рискнуть затереть чужую правку. Один
    // авторитетный перечит после allSettled читает итоговое состояние без гонки.
    // Компонент размонтирован, путь не на критичной задержке — цена рефетча не важна.
    Promise.allSettled(pending).then(() => refetchTrip(qc, tripId, { content: false })).catch(() => {});
  }, [tripId, qc]);

  // Запросов тут больше НЕТ: shell и content приезжают пропами от TripView.
  // Свои useQuery были не «второй загрузкой» (ключи и include те же, кэш общий),
  // а вторым набором ГЕЙТОВ рядом с первым - и разъехаться они могли молча, что
  // для экрана записи опаснее лишнего запроса.

  // Драфт строится СИНХРОННО в рендере (не эффектом), как только есть обе
  // половины: они уже в кэше у родителя, поэтому секция рисуется первым же
  // кадром, без скелетона.
  if (draft === null && shell && content) {
    setDraft(buildDraft(shell, content.transfers, lang));
  }

  const trip = shell?.trip;
  // Bookings are read LIVE from content. A removed city + its bookings are deleted
  // server-side immediately (remove_city cascade) and gone on the next refetch.
  const liveHotels = useMemo(() => (content?.hotels || []), [content]);
  const liveActivities = useMemo(() => (content?.activities || []), [content]);
  const liveTransfers = useMemo(() => (content?.transfers || []), [content]);
  // While creating a transfer, draw a synthetic leg on the map (shaped by the
  // picked transport type) so the route appears instantly, before saving.
  const mapTransfers = useMemo(() => {
    if (!previewTransfer) return liveTransfers;
    const others = liveTransfers.filter((t) => !(t.from_city_visit_id === previewTransfer.from_city_visit_id && t.to_city_visit_id === previewTransfer.to_city_visit_id));
    return [...others, previewTransfer];
  }, [liveTransfers, previewTransfer]);
  useEffect(() => { if (!(leftPanel?.type === 'create' && leftPanel.kind === 'transfer')) setPreviewTransfer(null); }, [leftPanel]);

  // ── Hotel-pick map badges (TRIP-140) ───────────────────────────────────────
  // While the hotel "fork" panel is open the map swaps the trip route for live
  // Stay22 badges. The SINGLE query + paging + committed filters + hovered/selected
  // live HERE (the common ancestor of MapView and the panel) so one pool feeds both
  // the list (now presentational) and the map badges. Desktop-only by design — the
  // editor map is hidden on phones via CSS.
  const hotelPickVisit = leftPanel?.type === 'pick' && leftPanel.kind === 'hotel' ? leftPanel.visit : null;
  const isHotelPick = !!hotelPickVisit;
  const stayCurrency = trip?.details?.main_currency || 'EUR';
  // TRIP-141/195: whole-city hotel pool + list state, packaged as the stay22
  // bundle by the shared useStay22Bundle hook (same hook the timeline's add-
  // booking drawer uses). Feeds the list (client pagination) here AND the map
  // pins below (editor only — timeline has no map).
  const { bundle: stay22Bundle, query: stayQuery, selectedId: staySelectedId, hoveredId: stayHoveredId, setSelectedId: setStaySelectedId, setHoveredId: setStayHoveredId, openHotelLink } = useStay22Bundle({
    visit: hotelPickVisit, currency: stayCurrency, lang, enabled: isHotelPick, tripId,
  });
  // Map pins: only stays that carry coordinates, with a compact price label (the
  // badge is tiny — long amounts like 252 400 ₽ are shortened to "252K"). While the
  // pool shows a PREVIOUS city (isPlaceholderData, keepPreviousData), emit no pins
  // so the camera doesn't fit to the old city while the new one loads.
  const hotelPins = useMemo(() => {
    if (!isHotelPick || stayQuery.isPlaceholderData) return isHotelPick ? [] : null;
    const list = stayQuery.data?.hotels || [];
    const cur = stayQuery.data?.meta?.currency || stayCurrency;
    return list
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => ({
        id: h.id, name: h.name, lat: h.lat, lng: h.lng,
        supplierLogo: h.supplierLogo,
        priceLabel: h.price != null ? fmtMoney(h.price, h.currency || cur, { compact: true }) : null,
      }));
  }, [isHotelPick, stayQuery.data, stayQuery.isPlaceholderData, stayCurrency, fmtMoney]);
  // Unified engine: validateTrip emits codes; primaryIssues collapses to <=1 per
  // entity (anti-pile). Adapt to the shape this screen already consumes
  // (resolved message + cityId/hotelId/activityId/transferId aliases + 'warn' level).
  const issues = useMemo(() => {
    if (!draft) return [];
    const raw = primaryIssues(validateTrip({ visits: draft.nodes, hotels: liveHotels, activities: liveActivities, transfers: liveTransfers }));
    return raw.map((i) => ({
      // All validation issues are advisory in the editor: nothing blocks Save.
      // Engine-level severity is collapsed to 'warn' so errors never gate saving
      // and the whole list renders as (orange) warnings.
      level: 'warn',
      code: i.code,
      message: t(`validation.${i.code}`, i.values),
      // raw refs for describeIssue/ConflictsPanel:
      entityKind: i.entityKind,
      entityId: i.entityId,
      values: i.values,
      // aliases consumed by cityConflicts / transferMismatch / openEvent:
      cityId: i.entityKind === 'city' ? i.entityId : undefined,
      hotelId: i.entityKind === 'hotel' ? i.entityId : undefined,
      activityId: i.entityKind === 'activity' ? i.entityId : undefined,
      transferId: i.entityKind === 'transfer' ? i.entityId : undefined,
      fromId: i.fromId,
      toId: i.toId,
    }));
  }, [draft, liveHotels, liveActivities, liveTransfers, t]);

  // ---- structural edits ----
  // Trip start (d.startDate) is FIXED until shiftStart changes it. recompute chains
  // nodes from that date preserving each node's nights+gap, so editing one node only
  // moves the nodes after it; the start and earlier nodes never move. The reorder
  // commit (commitOrder, below) applies this same recompute before persisting.
  // Live-persist a new chain order (drag/keyboard reorder). tmp cities aren't in the
  // DB yet so skip until they're real (their add already refetches). One
  // reorder_cities → server recompute → refetch.
  const persistOrder = (ids) => { if (ids.some(isTmpId)) return; runAction(() => rpcReorderCities(tripId, ids)); };
  // Shared drag/FLIP/keyboard reorder engine. `commitOrder` reproduces the prior
  // inline behavior EXACTLY: optimistic client recompute (adjacency gaps + date
  // chain from the fixed trip start) then live-persist the new chain order. Anchors
  // (start/end) stay pinned via the module-level `isAnchor`.
  const dndOrdered = draft ? sortVisits(draft.nodes) : [];
  const commitOrder = (ids) => {
    editDraft((d) => {
      if (!d) return d;
      const byId = new Map(d.nodes.map((n) => [n.id, n]));
      const nextNodes = ids.map((id) => byId.get(id)).filter(Boolean);
      return { ...d, nodes: recompute(applyAdjacencyGaps(nextNodes, liveTransfers), d.startDate) };
    });
    persistOrder(ids);
  };
  const { draggingId, overGap, pressingId, displayNodes, setRowRef, armDrag, moveNodeById, justDraggedRef } =
    useRouteDnD({ ordered: dndOrdered, isAnchor, onCommitOrder: commitOrder });
  // Nights 0..60. Hitting 0 turns a city into a waypoint (a 0-night transit
  // stop); raising a waypoint above 0 turns it back into a transit city.
  const nudgeNights = (id, delta) => {
    const node = draft.nodes.find((n) => n.id === id);
    if (!node || isAnchor(node)) return;
    // synchronous target survives rapid clicks before re-render; clamp 0..60
    const base = nightsTarget.current.has(id)
      ? nightsTarget.current.get(id)
      : (node.kind === 'waypoint' ? 0 : (node.nights || 0));
    const next = Math.max(0, Math.min(60, base + delta));
    if (next === base) return;
    nightsTarget.current.set(id, next);
    // Full optimism: set the touched city's nights/kind, then re-lay the WHOLE chain
    // downstream with the SAME engine reorder uses (recompute = server-mirror
    // layoutDates) so the cities AFTER it shift instantly — no waiting for the server
    // refetch to un-jank them. The refetch still confirms authoritatively, invisibly.
    editDraft((d) => {
      const nodes = d.nodes.map((n) => (
        n.id !== id ? n
          : next === 0 ? { ...n, kind: 'waypoint', nights: 0 }
                       : { ...n, kind: 'transit', nights: next }
      ));
      return { ...d, nodes: recompute(applyAdjacencyGaps(nodes, liveTransfers), d.startDate) };
    });
    if (String(id).startsWith('tmp-')) return;
    // debounce: send ONE set_city_nights with the FINAL value ~350ms after the last click
    const timers = nightsCommit.current;
    if (timers.has(id)) clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const finalN = nightsTarget.current.get(id);
      nightsTarget.current.delete(id);
      runAction(() => rpcSetCityNights(tripId, id, finalN));
    }, 350));
  };
  const shiftStart = (delta) => {
    const cur = startTarget.current ?? draft?.startDate;
    const base = cur ? toDT(cur).plus({ days: delta }).toISO() : null;
    if (!base) return;
    // Toast fires in the SAME synchronous tick as the date shift (T0) — together with the
    // change, not ~350ms later at the debounce and not ~2s later on the RPC response. The
    // shift is EXACT (pure +N days, no recompute engine) and can't diverge from the server,
    // and nothing is left pending (unlike an ADD, whose grey tmp- card must wait for its
    // id), so an immediate success toast is honest. Guard on `!startCommit.current` so a
    // burst of rapid stepping shows ONE toast (leading edge), not one per click.
    if (!startCommit.current) successToast(t, 'start_date_updated');
    startTarget.current = base;
    // partial optimism: shift ALL dates by the same delta (exact, no recompute engine)
    editDraft((d) => ({ ...d, startDate: base, nodes: d.nodes.map((n) => ({
      ...n,
      start_date: n.start_date ? toDT(n.start_date).plus({ days: delta }).toISODate() : n.start_date,
      end_date: n.end_date ? toDT(n.end_date).plus({ days: delta }).toISODate() : n.end_date,
    })) }));
    // debounce: send ONE set_trip_start_date with the FINAL value ~350ms after last click.
    // runAction persists SILENTLY (no okKey — the toast already fired at T0); on failure its
    // onError toast + rollback revert the optimistic shift.
    if (startCommit.current) clearTimeout(startCommit.current);
    startCommit.current = setTimeout(() => {
      startCommit.current = null;
      const finalBase = startTarget.current;
      startTarget.current = null;
      runAction(() => rpcSetTripStartDate(tripId, toDT(finalBase).toISODate()));
    }, 350);
  };
  // Remove a city — PESSIMISTIC (async-confirm). The cityview stays open, the confirm
  // button spins (ConfirmProvider `busy`) while remove_city runs, and only THEN does the
  // recomputed chain reconcile the new route from the response, the cascade get mirrored
  // into the caches, the toast fire and the panel close. Unlike the optimistic route edits
  // the row does NOT vanish at T0: a delete has a confirm dialog, so the dialog IS the
  // in-flight surface (spinner), the same primitive bookings/members use. On failure the
  // error toast shows, nothing is removed and the panel stays open.
  const removeCity = async (id) => {
    const n = draft.nodes.find((x) => x.id === id);
    if (!n) return;
    // A tmp- city (its add is still in flight) was never persisted — drop it locally, with
    // no server round-trip, no confirm, no spinner. Re-lay the chain so the gap closes.
    if (isTmpId(id)) {
      editDraft((d) => ({ ...d, nodes: recompute(applyAdjacencyGaps(d.nodes.filter((x) => x.id !== id), liveTransfers), d.startDate) }));
      closeLeftPanel();
      return;
    }
    // remove_city cascade-deletes this city's hotels/activities/transfers server-side, but
    // SQL can't reach Storage. Collect the SAME cascade set's document paths up front and
    // sweep them on success (removeTripFiles), else files orphan until the trip is deleted
    // (TRIP-137). Cascade set: hotels/activities by city_visit_id + transfers touching the
    // city on either end.
    const orphanPaths = [
      ...liveHotels.filter((h) => h.city_visit_id === id),
      ...liveActivities.filter((a) => a.city_visit_id === id),
      ...liveTransfers.filter((tr) => tr.from_city_visit_id === id || tr.to_city_visit_id === id),
    ].flatMap((e) => collectDocPaths(e.documents));
    let removed = false;
    await confirm({
      title: t('tse.delete_city_q', { city: n.city_name }),
      description: t('tse.delete_city_desc'),
      confirmLabel: t('tse.delete_city'),
      variant: 'destructive',
      // Async confirm: the dialog holds the spinner until this settles. Reconcile the new
      // route FROM THE RESPONSE (reconcileCityChain) + mirror the server cascade into the
      // content cache (pruneCityContent) + sweep files, then rebuild the draft and toast.
      onConfirm: async () => {
        try {
          const chain = await rpcRemoveCity(tripId, id);
          reconcileCityChain(qc, tripId, chain);
          pruneCityContent(qc, tripId, id);
          removeTripFiles(orphanPaths);
          setDraft(null);
          successToast(t, 'city_removed');
          removed = true;
        } catch (e) {
          toast({ description: e && 'code' in e ? errorText(t, e.code) : t('tse.err_save'), variant: 'destructive' });
        }
      },
    });
    if (removed) closeLeftPanel();
  };
  const addCity = (city, kind = 'transit') => {
    if ((kind === 'start' && draft.nodes.some((n) => n.kind === 'start')) || (kind === 'end' && draft.nodes.some((n) => n.kind === 'end'))) {
      toast({ description: kind === 'start' ? t('tse.start_already_set') : t('tse.end_already_set'), variant: 'warning' });
      return;
    }
    // Full optimism: build the tmp node with its nights, splice it into place, then
    // re-lay the chain (recompute = server-mirror). It lands in its final slot WITH
    // correct dates immediately — no null-date node sorting to the front and snapping
    // back. Stays muted (tmp- id) until add_city → recompute_trip returns the chain,
    // which runAction reconciles FROM THE RESPONSE (real row: id + dates), no refetch.
    const provNights = kind === 'transit' ? 2 : null;
    const node = {
      id: 'tmp-' + Math.random().toString(36).slice(2), kind,
      city_name: city.city_name, country_code: city.country_code || null,
      geonameid: city.geonameid ?? null, name_i18n: city.name_i18n || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || 'UTC', external_city_id: city.external_city_id || null,
      nights: provNights, gap: 0, start_date: null, end_date: null,
    };
    let insertIdx = null;
    editDraft((d) => {
      const arr = d.nodes.slice();
      if (kind === 'start') { arr.unshift(node); insertIdx = 0; }
      else if (kind === 'end') { arr.push(node); insertIdx = null; }
      else { const endIdx = arr.findIndex((n) => n.kind === 'end'); insertIdx = endIdx === -1 ? null : endIdx; arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node); }
      return { ...d, nodes: recompute(applyAdjacencyGaps(arr, liveTransfers), d.startDate) };
    });
    runAction(() => rpcAddCity(tripId, {
      kind,
      geonameid: city.geonameid ?? null, name_i18n: city.name_i18n || null,
      city_name_en: city.city_name_en || null,
      country_code: city.country_code || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || null, external_city_id: city.external_city_id || null,
    }, insertIdx), { okKey: 'city_added' });
  };
  // Commit a city picked in the inline adder (below the route list). The adder
  // owns its own open/pick/type state and collapses itself, so there's no panel
  // to close here — just enrich with the timezone and hand off to addCity.
  const addPickedCity = (c, kind) => {
    const tz = tzFromCoords(c.latitude, c.longitude);
    addCity({ ...c, timezone: tz }, kind);
  };

  // ---- transfer dialogs (REAL app dialogs → write to DB → refetch) ----
  const openTransferRow = (a, b, tr) => {
    if (tr) {
      // Hierarchy guarantees ≤1 issue per transfer → show that real message.
      const issue = issues.find((i) => i.transferId === tr.id);
      openBase({ type: 'event', kind: 'transfer', id: tr.id, warning: issue?.message || null });
      return;
    }
    if (isTmpId(a?.id) || isTmpId(b?.id)) return; // pending city → seam is muted; silent safety net
    openBase({ type: 'pick', kind: 'transfer', fromVisit: a, toVisit: b });
  };

  // Ни шапки, ни гейтов, ни ролевого гарда тут больше нет:
  //   шапку и меню держит TripShell (раньше это была вторая, своя копия);
   //   гейты shell/content отработал TripView до того, как отрисовать секцию;
  //   право на редактор проверил реестр секций (canAccess: clearsStep(step,'editor')), и
  //   он же не пускает сюда по прямому адресу - resolveSection подменит
  //   недоступную секцию дефолтной.
  // Осталась ОДНА собственная проверка: без content драфт не построить.
  if (!draft) return null;

  const ordered = sortVisits(draft.nodes);
  const seq = ordered.filter((n) => !isAnchor(n));          // cities + waypoints, in order
  const cityCount = uniqueCityCount(draft.nodes);
  const dateRange = formatTripRange(draft.nodes, '-');
  const endDate = seq[seq.length - 1]?.end_date;
  // Trip length via the ONE shared helper (tripDuration().days = nights+1 =
  // calendar days), the same source the trip header / Overview / public trip use.
  // Was an inline nights count rendered with the day-word — off by one from them.
  const tripDays = tripDuration(null, draft.nodes).days;
  const cityConflicts = (id) => issues.filter((i) => i.cityId === id).length;
  const transferFor = (aId, bId) => liveTransfers.find((t) => t.from_city_visit_id === aId && t.to_city_visit_id === bId);
  // A transfer row is flagged (orange "не совпадает") when it has ANY conflict -   // date mismatch (D2), non-adjacent (D5) or dangling (D6).
  const transferMismatch = (t) => !!t && issues.some((i) => i.transferId === t.id);
  // booking lookups for the inline list cells + city panel
  const hotelFor = (id) => liveHotels.find((h) => h.city_visit_id === id);
  // Multiple hotels per city are allowed (parity with activities); the city
  // panel lists them all, while the compact grid cell still shows the first.
  const hotelsFor = (id) => liveHotels.filter((h) => h.city_visit_id === id);
  const actsFor = (id) => liveActivities.filter((a) => a.city_visit_id === id);
  const hotelWarnId = (hid) => !!hid && issues.some((i) => i.hotelId === hid);
  const actWarnId = (aid) => !!aid && issues.some((i) => i.activityId === aid);
  const arrivalFor = (id) => liveTransfers.find((t) => t.to_city_visit_id === id);
  const departureFor = (id) => liveTransfers.find((t) => t.from_city_visit_id === id);
  // Anchor dates: start = trip start (first city's start); finish = last city's
  // end, +N days by the final leg's day_span — mirrors server recompute_trip's gap rule.
  const endNode = ordered.find((n) => n.kind === 'end') || null;
  const finishTransfer = endNode ? arrivalFor(endNode.id) : null;
  const finishSpan = finishTransfer?.day_span ?? 0;
  const finishDate = endDate && finishSpan
    ? (toDT(endDate)?.plus({ days: finishSpan })?.toISODate() || endDate)
    : endDate;
  // panel navigation
  // Дескрипторы панелей — форма одна, а МЕСТО (новый верх/поверх) решает вызывающий:
  // из списка/карты — `openBase` (верхний уровень), изнутри города — `pushPanel`
  // (drill-in, ляжет поверх города).
  const eventDesc = (kind, id) => ({ type: 'event', kind, id, warning: (issues.find((i) => i[`${kind}Id`] === id)?.message) || null });
  // hotel/transfer/activity have partner offers → show the PickPanel ("Развилка")
  // first; others go straight to the form.
  const bookingDesc = (kind, node) => (kind === 'hotel' || kind === 'activity' ? { type: 'pick', kind, visit: node } : { type: 'create', kind, visit: node });
  // Открытие города = панель + зум (mapFocus течёт от leftPanel). Гасим выбор на
  // карте: панель его вытесняет (зовётся и из CTA бейджа, и из списка маршрута).
  const openCity = (id) => { if (justDraggedRef.current) { justDraggedRef.current = false; return; } setMapPickId(null); openBase({ type: 'city', id }); };
  const openEvent = (kind, id) => openBase(eventDesc(kind, id));
  // A hotel/activity can only attach to a city with a real uuid — block while the
  // city is still pending (tmp- id, add_city in flight) so the write can't hit an FK.
  const createBooking = (kind, node) => { if (isTmpId(node?.id)) return; openBase(bookingDesc(kind, node)); };
  // Drill-версии: открыть ПОВЕРХ текущей панели (город → отель/бронь).
  const drillEvent = (kind, id) => pushPanel(eventDesc(kind, id));
  const drillBooking = (kind, node) => { if (isTmpId(node?.id)) return; pushPanel(bookingDesc(kind, node)); };
  // Stay numbering (only nights-cities are numbered).
  const stayNumById = {};
  { let sc = 0; ordered.forEach((n) => { if (n.kind === 'transit') stayNumById[n.id] = ++sc; }); }
  // Live preview order, FLIP reorder, keyboard move, pointer-drag arm/move/end and
  // justDraggedRef are all provided by the shared useRouteDnD hook instantiated
  // above (destructured: displayNodes, draggingId, overGap, setRowRef, armDrag,
  // moveNodeById, justDraggedRef). The hook's commit path is `commitOrder`.
  // Transfers whose from/to cities are NOT adjacent in the route (or dangle on a
  // removed city) — shown in the "out of plan" tray instead of a connector.
  const adjPairs = new Set();
  for (let k = 0; k < ordered.length - 1; k++) adjPairs.add(`${ordered[k].id}>${ordered[k + 1].id}`);
  const outOfPlanTransfers = liveTransfers.filter((tr) => !adjPairs.has(`${tr.from_city_visit_id}>${tr.to_city_visit_id}`));
  const nodeName = (id) => draft.nodes.find((n) => n.id === id)?.city_name || '?';

  // Left-column panel (in-place, replaces the old modals). null → city list.
  // Adding a city no longer opens a panel — it happens inline in the route list
  // (<CityAdder> below the rows). The only panels left here are object panels
  // (event / pick / create / city), all of which open in the full-height drawer.
  let leftPanelEl = null;
  if (leftPanel?.type === 'event') {
    leftPanelEl = (
      /* ★ ПРАВО ИЗ КОНТЕКСТА, А НЕ ЛИТЕРАЛ. Здесь стояло `canEdit` без значения,
         то есть жёсткое `true`: пока в секцию пускали только editor, это было
         безвредно и потому невидимо. С открытием «Маршрута» всем (TRIP-459)
         литерал нарисовал бы наблюдателю «Изменить/Удалить» в панели брони —
         сервер бы отказал, а UI обещал. Тот же шов, что у глобального ящика
         событий в TripView. */
      <EventSourcePanel
        tripId={tripId}
        kind={leftPanel.kind} id={leftPanel.id} warning={leftPanel.warning}
        autoEdit={leftPanel.autoEdit} canEdit={canEdit} onClose={closePanelAndSync}
      />
    );
  } else if (leftPanel?.type === 'pick' || leftPanel?.type === 'create') {
    // TRIP-176: hotel / activity / transfer open the unified AddBookingPanel
    // (fork + manual form merged behind a tab). Services (esim/car/insurance)
    // keep the standalone fork → manual navigation.
    const isMergedKind = leftPanel.kind === 'hotel' || leftPanel.kind === 'activity' || leftPanel.kind === 'transfer';
    if (isMergedKind) {
      leftPanelEl = (
        <AddBookingPanel
          kind={leftPanel.kind} tripId={tripId} trip={trip}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          stay22={stay22Bundle}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          initialTab={leftPanel.type === 'create' ? 'manual' : 'find'}
          onPreviewTransfer={setPreviewTransfer}
          onClose={() => { setPreviewTransfer(null); closePanelAndSync(); }}
        />
      );
    } else if (leftPanel.type === 'pick') {
      leftPanelEl = (
        <ForkPartnerModal
          open variant="panel" type={leftPanel.kind} tripId={tripId} trip={trip}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          stay22={stay22Bundle}
          onManual={() => replaceTop({ type: 'create', kind: leftPanel.kind, visit: leftPanel.visit, fromVisit: leftPanel.fromVisit, toVisit: leftPanel.toVisit })}
          onOpenChange={(o) => { if (!o) closeLeftPanel(); }}
        />
      );
    } else {
      leftPanelEl = (
        <EventEditDialog
          open variant="panel" kind={leftPanel.kind} tripId={tripId}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          onPreviewTransfer={setPreviewTransfer}
          onOpenChange={(o) => { if (!o) { setPreviewTransfer(null); closePanelAndSync(); } }}
        />
      );
    }
  } else if (leftPanel?.type === 'city') {
    const node = ordered.find((n) => n.id === leftPanel.id);
    if (!node) { leftPanelEl = null; }
    else {
      const idx = ordered.indexOf(node);
      const prev = ordered.slice(0, idx).reverse().find((n) => !isAnchor(n) || n.kind === 'start');
      const next = ordered.slice(idx + 1).find((n) => !isAnchor(n) || n.kind === 'end');
      leftPanelEl = (
        <CityPanel
          node={node} cityNo={stayNumById[node.id]}
          hotels={hotelsFor(node.id)} acts={actsFor(node.id)}
          arrival={arrivalFor(node.id)} departure={departureFor(node.id)}
          arrivalWarn={transferMismatch(arrivalFor(node.id))} departureWarn={transferMismatch(departureFor(node.id))}
          prevCity={prev?.city_name} nextCity={next?.city_name}
          isHotelWarn={(h) => hotelWarnId(h?.id)} isActWarn={(a) => actWarnId(a.id)}
          onBack={closeLeftPanel}
          onRemove={() => removeCity(node.id)}
          onNightsMinus={() => nudgeNights(node.id, -1)} onNightsPlus={() => nudgeNights(node.id, 1)}
          onOpenHotel={(id) => drillEvent('hotel', id)} onAddHotel={() => drillBooking('hotel', node)}
          onOpenActivity={(id) => drillEvent('activity', id)} onAddActivity={() => drillBooking('activity', node)}
          onOpenTransfer={(tr) => drillEvent('transfer', tr.id)}
          onAddArrival={() => { if (!prev) return; if (isTmpId(prev.id) || isTmpId(node.id)) return; pushPanel({ type: 'pick', kind: 'transfer', fromVisit: prev, toVisit: node }); }}
          onAddDeparture={() => { if (!next) return; if (isTmpId(node.id) || isTmpId(next.id)) return; pushPanel({ type: 'pick', kind: 'transfer', fromVisit: node, toVisit: next }); }}
        />
      );
    }
  }

  // Map camera focus following the open panel: city/hotel/activity → that city;
  // transfer → both cities. Falsy → whole-route auto-fit stays in charge.
  const coordOf = (n) => (n && n.latitude != null && n.longitude != null ? [n.longitude, n.latitude] : null);
  const byId = (id) => draft.nodes.find((n) => n.id === id);
  let mapFocus = null;
  if (leftPanel?.type === 'city') {
    const p = coordOf(byId(leftPanel.id)); if (p) mapFocus = [p];
  } else if (leftPanel?.type === 'event') {
    if (leftPanel.kind === 'transfer') {
      const tr = liveTransfers.find((x) => x.id === leftPanel.id);
      if (tr) mapFocus = [coordOf(byId(tr.from_city_visit_id)), coordOf(byId(tr.to_city_visit_id))].filter(Boolean);
    } else {
      const e = (leftPanel.kind === 'hotel' ? liveHotels : liveActivities).find((x) => x.id === leftPanel.id);
      const p = e && coordOf(byId(e.city_visit_id)); if (p) mapFocus = [p];
    }
  } else if (leftPanel?.type === 'create' || leftPanel?.type === 'pick') {
    if (leftPanel.kind === 'transfer') mapFocus = [coordOf(leftPanel.fromVisit), coordOf(leftPanel.toVisit)].filter(Boolean);
    else { const p = coordOf(leftPanel.visit); if (p) mapFocus = [p]; }
  }
  if (mapFocus && mapFocus.length === 0) mapFocus = null;
  // Which city node the open panel belongs to → its map marker shows the selected
  // state (single-city panels only; a transfer panel highlights no single city).
  let selectedNodeId = null;
  if (leftPanel?.type === 'city') {
    selectedNodeId = leftPanel.id;
  } else if (leftPanel?.type === 'event' && leftPanel.kind !== 'transfer') {
    const e = (leftPanel.kind === 'hotel' ? liveHotels : liveActivities).find((x) => x.id === leftPanel.id);
    selectedNodeId = e?.city_visit_id ?? null;
  } else if ((leftPanel?.type === 'create' || leftPanel?.type === 'pick') && leftPanel.kind !== 'transfer') {
    selectedNodeId = leftPanel.visit?.id ?? null;
  }
  // When a transfer panel is open, that leg shows the "selected route" state on
  // the map. We pass only the leg's id pair; MapView resolves geometry + kind
  // from the live transfers (which include the in-progress previewTransfer), so
  // the highlight is a single arc that updates as transport is added/changed.
  let selectedLegKey = null;
  if (leftPanel?.type === 'event' && leftPanel.kind === 'transfer') {
    const tr = liveTransfers.find((x) => x.id === leftPanel.id);
    if (tr) selectedLegKey = `${tr.from_city_visit_id}__${tr.to_city_visit_id}`;
  } else if ((leftPanel?.type === 'create' || leftPanel?.type === 'pick') && leftPanel.kind === 'transfer') {
    if (leftPanel.fromVisit?.id && leftPanel.toVisit?.id) {
      selectedLegKey = `${leftPanel.fromVisit.id}__${leftPanel.toVisit.id}`;
    }
  }
  // Key the left pane on its identity so React remounts it on panel change →
  // the .te-panefade entry animation replays.
  const panelKey = leftPanel ? `${leftPanel.type}:${leftPanel.id || leftPanel.kind || ''}` : 'list';
  // TRIP-161: каждая боковая панель объекта открывается ящиком во всю высоту
  // виджета (рельс маршрута остаётся под ним, карта продолжает кликаться —
  // скрима нет). Добавление города больше не панель, а инлайн-композер в самом
  // списке (<CityAdder>), поэтому исключать его тут уже не из чего.
  //
  // Брейкпоинта 1081 здесь больше нет. Он делил десктоп на «ящик» и «панель
  // вместо колонки» — то есть был третьей раскладкой у экрана, у которого их и
  // так две. Теперь их ровно две, и границу проводит шелл: десктоп — виджет,
  // телефон — шит.
  const isDrawerPanel = !!leftPanel;
  const useDrawer = !isSheet && isDrawerPanel && !!leftPanelEl;
  const onPanelEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLeftPanel(); } };
  // Обнаружение смены верхней панели — СИНХРОННО в рендере (не в эффекте): иначе
  // между «старый ключ убрали» и «вернули уходящим» был бы кадр без узла = ремонт,
  // а он-то и сбрасывал бы анимацию/перезапрашивал тяжёлую панель. Поэтому здесь
  // именно рендер-фаза, а не useLayoutEffect.
  //   • `lastTopRef` — КЭШ последнего показанного узла (пишется в рендере, как
  //     `reframeRef.current = onReframe` в useMapInsets): нужен, чтобы на смене
  //     ключа заморозить ПРЕДЫДУЩИЙ узел, недоступный после смены.
  //   • `setClosingLayers` в рендере — санкционированный «подстрой состояние под
  //     изменившийся ключ»: тот же компонент, условие `key !== ...` гасит петлю,
  //     `.some()` делает добавление идемпотентным (сходится и под StrictMode).
  // `cityadd`/шит — не оверлей, ключ null.
  const overlayKey = useDrawer ? panelKey : null;
  if (overlayKey !== lastTopRef.current.key) {
    const from = lastTopRef.current;
    if (from.key != null && from.el != null && !closingLayers.some((l) => l.key === from.key)) {
      setClosingLayers((cur) => [...cur, { key: from.key, el: from.el }]);
    }
    lastTopRef.current = { key: overlayKey, el: useDrawer ? leftPanelEl : null };
  } else {
    lastTopRef.current.el = useDrawer ? leftPanelEl : null;
  }

  // ПЛАШКА ГОРОДА НА КАРТЕ — та же, что в линзе карты: следует за наведением, а
  // без него за выбранным городом. Ховер работает В ОБЕ СТОРОНЫ: ряд списка
  // подсвечивает маркер (`hoveredVisitId`), маркер подсвечивает ряд
  // (`onCityHover` → тот же `hoveredNodeId`). Раньше связь была односторонней:
  // с карты в список ничего не приходило.
  // Приоритет бейджа: наведение → зафиксированный клик по карте → открытая панель.
  const badgeId = hoveredNodeId || mapPickId || selectedNodeId;
  const badgeNode = draft.nodes.find((n) => n.id === badgeId) || null;
  // CTA показываем ТОЛЬКО когда бейдж — это зафиксированный на карте выбор (ещё не
  // открытый). Наведение на другой город уводит бейдж на него → CTA гаснет; на сам
  // выбранный — badgeId === mapPickId, CTA держится (без мигания при ховере пина).
  const showBadgeCta = !!mapPickId && badgeId === mapPickId;
  const cityBadge = badgeNode?.latitude != null ? {
    lng: badgeNode.longitude,
    lat: badgeNode.latitude,
    countryCode: badgeNode.country_code,
    name: badgeNode.city_name,
    dates: formatDateRange(badgeNode.start_date, badgeNode.end_date, (iso) => fmtD(iso, lang)),
    // Кнопка «открыть» есть у ЛЮБОГО бейджа редактора (по умолчанию свёрнута) —
    // раскрывает её `ctaOn`. Поэтому фиксация города НЕ пересоздаёт попап (нет
    // мигания), а меняет только состояние кнопки. `onAction` целится в город
    // бейджа (при раскрытой кнопке это и есть mapPickId).
    actionLabel: t('common.open'),
    onAction: () => openCity(badgeId),
    ctaOn: showBadgeCta,
  } : null;

  // Trip-start control — lives in the "Маршрут" panel header. The stepper shifts
  // the whole itinerary by ±1 day; tapping the date opens a calendar to jump to
  // any start (translated into a single delta shift, reusing shiftStart).
  const pickStart = (iso) => {
    if (!iso || !draft?.startDate) return;
    const delta = Math.round(toDT(iso).startOf('day').diff(toDT(draft.startDate).startOf('day'), 'days').days);
    if (delta !== 0) shiftStart(delta);
  };
  // Shared trip-start control (one element with the planner). The editor steps
  // by ±1 day via shiftStart and jumps via pickStart (delta → shiftStart).
  const startDateControl = draft ? (
    <TripStartControl date={draft.startDate} readOnly={!canEdit} onStep={(d) => shiftStart(d)} onPickDate={pickStart} label={t('ai_plan.start')} popoverAlign="end" />
  ) : null;

  // Trip actions (Share / Settings / Members) all live in the left trip menu
  // (TripSidebar drawer); Copy trip moved into the Settings lens. The editor
  // header carries no duplicate buttons.

  // Секция отдаёт ТОЛЬКО своё содержимое. Оболочка (`.trip-shell` -> шапка ->
  // меню -> `.trip-content` -> скроллящееся тело) приезжает от TripShell, а
  // секция объявлена flush - тело без паддинга и без своего скролла, потому что
  // скроллит она сама, внутри колонок.
  //
  // Раньше здесь стояла ВТОРАЯ оболочка: `.ts-screen` с раскладкой инлайном
  // (`height: 100vh` вместо `100dvh` у трип-экранов), своя шапка, СВОЙ
  // выезжающий `.ts-drawer` и ДВА инстанса TripSidebar - для рельса и для
  // ящика. Телефонного шита меню у неё не было вовсе, поэтому на ≤640 меню
  // редактора вело себя не так, как на всех остальных экранах трипа.
  // ★ РАСКЛАДКА — ОБЩИЙ <MapShell>, ТОТ ЖЕ, ЧТО У ПЛАНИРОВЩИКА И ЛИНЗЫ КАРТЫ.
  // До этого редактор был ТРЕТЬЕЙ рукописной копией «карта + панель»: своя сетка
  // `.ts-grid`, свой брейкпоинт 1080, своя коробка карты с отступом 14px — и своё
  // представление о том, где карта заканчивается. На телефоне карты не было
  // ВОВСЕ (её прятал CSS), то есть редактор маршрута работал без карты маршрута.
  //
  // Теперь: карта во всю свободную площадь, редактор — плавающий виджет слева со
  // сворачиванием, на телефоне тот же виджет уезжает в шит с тремя детентами.
  const routeHead = (
    <PageHead
      /* Воздух снизу даёт слот шапки шелла — модификатор снимает собственный
         отступ примитива, иначе они складываются. */
      className="pagehead--flush"
      /* Ключ ОДИН на весь экран — `trip.sidebar_route` (TRIP-459). Здесь стоял
         `planner.step_cities`: подпись ШАГА ВИЗАРДА создания трипа, взятая в
         экран трипа за одинаковое значение («Маршрут»). Значение совпадает, а
         предметы разные, и правка копирайта в визарде молча переименовала бы
         секцию трипа. Визард свой ключ сохраняет. */
      title={t('trip.sidebar_route')}
      subtitle={[
        tripDays > 0 ? `${tripDays} ${dayWord(tripDays, t)}` : null,
        cityCount > 0 ? `${cityCount} ${cityCount === 1 ? t('trip.cities_count_one') : t('trip.cities_count_many')}` : null,
        dateRange && dateRange !== '-' ? dateRange : null,
      ].filter(Boolean).join(' · ') || undefined}
      actions={startDateControl}
    />
  );

  // Тело виджета: список маршрута ЛИБО панель, подменяющая его («добавить
  // город»). Ключ на обёртке перезапускает анимацию появления при смене.
  const routeBody = (
    <div key={useDrawer ? 'list' : panelKey} ref={useDrawer ? null : leftPaneRef} tabIndex={-1}
      onKeyDown={(leftPanel && !useDrawer) ? onPanelEsc : undefined} className="te-panefade">
      {(!isSheet && !useDrawer && leftPanelEl) || (
        <>
          {/* Шапка колонок. Сетку она НЕ объявляет — берёт ту же `--te-cols`, что
              и ряд: две копии шаблона разъехались бы на первой же правке. Первый
              заголовок сам встаёт в третью колонку, поэтому пустых ячеек под грип
              и узел здесь нет.
              На телефоне колонок нет — значит нет и шапки: не скрыта, а НЕ
              отрисована (см. `showCols`). */}
          {showCols && (
          <div className="te-thead">
            <Trunc as="span" className="te-th">{t('tse.col_destination')}</Trunc>
            <Trunc as="span" className="te-th te-th--c">{t('tse.col_nights')}</Trunc>
            <Trunc as="span" className="te-th te-th--c">{t('tse.col_stay')}</Trunc>
            <Trunc as="span" className="te-th te-th--c">{t('tse.col_activity')}</Trunc>
          </div>
          )}
          <div className={'te-table' + (draggingId != null ? ' is-dragging' : '')}>
            {displayNodes.map((n) => {
              const next = displayNodes[displayNodes.indexOf(n) + 1];
              const tr = next ? transferFor(n.id, next.id) : null;
              const pending = isTmpId(n.id);       // city awaiting its real uuid (add_city in flight) → muted, non-editable
              const dragging = draggingId === n.id;
              const dragProps = {
                dragging,
                pressing: pressingId === n.id,
                onArm: (e) => armDrag(e, n.id),
                onMove: (dir) => moveNodeById(n.id, dir),
              };
              let body;
              if (isAnchor(n)) {
                body = <GridEndpoint node={n} date={n.kind === 'start' ? draft.startDate : finishDate} onRemove={canEdit ? () => removeCity(n.id) : null} />;
              } else if (n.kind === 'waypoint') {
                const aa = actsFor(n.id);
                body = <GridNode showCols={showCols} readOnly={!canEdit} seg={n} cityConf={cityConflicts(n.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onAct={() => (aa.length ? openCity(n.id) : createBooking('activity', n))}
                  onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                  drag={dragProps} />;
              } else {
                const h = hotelFor(n.id); const aa = actsFor(n.id);
                body = <GridNode showCols={showCols} readOnly={!canEdit} seg={n} stayNum={stayNumById[n.id]} cityConf={cityConflicts(n.id)}
                  hotel={h} hotelWarn={hotelWarnId(h?.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onHotel={() => (h ? openEvent('hotel', h.id) : createBooking('hotel', n))}
                  onAct={() => (aa.length ? openCity(n.id) : createBooking('activity', n))}
                  onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                  drag={dragProps} />;
              }
              return (
                <div className={'te-seamwrap' + (pending ? ' is-pending' : '')} key={n.id} ref={setRowRef(n.id)}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId((p) => (p === n.id ? null : p))}>
                  {body}
                  {/* Transfer chip straddles the seam to the next city. Stays
                      mounted during drag but melts away via CSS (.is-dragging),
                      then eases back on drop — adjacency is in flux mid-drag.
                      A seam touching a pending (tmp) city on either side is muted
                      (the incoming seam lives in the PREVIOUS row, so pass it
                      explicitly — CSS from this wrap can't reach it). */}
                  {next && (
                    <SeamTransfer a={n} b={next} t={tr} mismatch={transferMismatch(tr)} disabled={pending || isTmpId(next.id)} onOpen={() => openTransferRow(n, next, tr)} />
                  )}
                </div>
              );
            })}
          </div>

          {draggingId != null && ordered[ordered.length - 1]?.kind !== 'end' && (
            /* TRIP-343 объект 2 (H): НЕ карточка — drop-плейсхолдер DnD (add-аффорданс).
               Не surface-инлайн (фона нет). Рамка динамически подсвечивается brand при
               наведении перетаскивания (overGap) — это состояние dragover по ДАННЫМ, а у
               .card--add канона dragover нет (решение D «только существующий канон»),
               поэтому остаётся инлайном. */
            <div className="t-meta" style={{ marginTop: 8, height: 36, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-sm)', border: '1px dashed ' + (overGap === ordered.length ? 'var(--brand)' : 'var(--line)'), color: overGap === ordered.length ? 'var(--brand)' : 'var(--muted)', transition: 'color .15s var(--ease-out), border-color .15s var(--ease-out)' }}>
              {t('tse.move_to_end')}
            </div>
          )}
          {/* Добавление города — запись, и оно живёт ЗДЕСЬ, прямо в конце списка
              маршрута: сначала выбираешь город, потом тип, потом подтверждаешь
              кнопкой. Наблюдателю композера нет вовсе (это единственный вход в
              добавление). На телефоне композер открывается канон-шитом <Sheet>
              (клавиатуру держит платформа), на десктопе — инлайн в виджете. */}
          {canEdit && (
            <CityAdder
              onAdd={addPickedCity}
              hasStart={ordered.some((n) => n.kind === 'start')}
              hasEnd={ordered.some((n) => n.kind === 'end')}
            />
          )}
          {outOfPlanTransfers.length > 0 && (
            /* TRIP-343 объект 2 (канал 3): утоплённая поверхность (--wash+рамка+радиус)
               снята с инлайна на <Card recessed>; остался раскладочный инлайн. */
            <Card recessed radius="md" pad="none" style={{ marginTop: 14, padding: '11px 13px' }}>
              <div className="eyebrow" style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="warning" size={12} style={{ color: 'var(--warning)' }} /> {t('tse.transfers_out_of_plan')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {outOfPlanTransfers.map((tr) => (
                  <Chip key={tr.id} icon="warning" onClick={() => openEvent('transfer', tr.id)}>
                    {nodeName(tr.from_city_visit_id)} → {nodeName(tr.to_city_visit_id)}
                  </Chip>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );

  // Встроенный режим: рендерим ТОЛЬКО панель (город/бронь/переезд) как есть — её
  // `.lp` заполняет ящик хоста (EventDrawerHost), который сам даёт хром, фокус и
  // Esc. Без карты и рельса маршрута; вся машинерия панели — та же.
  if (embedded) return leftPanelEl || null;

  return (
    <MapShell
      map={(view) => (
            <MapView view={view} visits={draft.nodes} transfers={mapTransfers} showStartEnd mapControls={['projection', 'theme', 'se']} initialProjection="globe"
              /* Карта — основная поверхность экрана, а не картинка в тексте: гейта
                 «двумя пальцами» тут быть не должно (как в планировщике и линзе). */
              cooperativeGestures={false}
              focus={mapFocus}
              /* Двухшаговый клик (как в планировщике): маркер ФИКСИРУЕТ город
                 (бейдж + CTA), а зум/панель — уже по CTA (см. cityBadge.onAction).
                 Повторный клик по тому же снимает выбор. */
              onCityClick={(pts) => { const v = (pts || []).find((x) => !isAnchor(x)) || (pts || [])[0]; if (v) setMapPickId((cur) => (cur === v.id ? null : v.id)); }}
              /* Клик по ПУСТОЙ карте снимает выбор на карте и открытую панель — как
                 в планировщике. Пины гасят свой клик сами. В hotel-pick не трогаем:
                 там картой владеет оверлей отелей (его бейджи всплывают до 'click'). */
              onMapClick={() => { if (isHotelPick) return; setMapPickId(null); if (leftPanel) { closeAll(); syncAfterPanel(); } }}
              selectedVisitId={mapPickId || selectedNodeId}
              hoveredVisitId={hoveredNodeId}
              cityBadge={cityBadge}
              onCityHover={(pts) => setHoveredNodeId(pts ? ((pts || []).find((x) => !isAnchor(x)) || pts[0])?.id ?? null : null)}
              selectedLegKey={selectedLegKey}
              hideRoute={isHotelPick}
              hotelPins={hotelPins}
              selectedHotelId={staySelectedId}
              hoveredHotelId={stayHoveredId}
              onHotelClick={(id) => { if (staySelectedId != null && String(staySelectedId) === String(id)) openHotelLink(id); else setStaySelectedId(id); }}
              onHotelHover={setStayHoveredId}
              colorScheme={isDarkTheme ? 'DARK' : 'LIGHT'} />
      )}
      panelHeader={routeHead}
      panel={routeBody}
      panelLabel={t('trip.sidebar_route')}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      /* Виджет редактора — это МАРШРУТ, и подсказка обязана называть его, а не
         «панель»: общий текст примитива на трёх разных экранах означал бы три
         разных предмета под одним именем. */
      collapseLabel={t('tse.route_hide')}
      expandLabel={t('tse.route_show')}
      detent={detent}
      onDetentChange={setDetent}
      /* Камере — ЛОГИЧЕСКИЙ факт открытости (сразу), а не присутствие рендера:
         `panelOverlay` живёт лишние ~240 мс на анимации ухода, и отступ бы менялся
         с этой задержкой, обрывая летящий focus (см. MapShell `overlayActive`). */
      overlayActive={useDrawer}
      panelOverlay={(useDrawer || closingLayers.length) ? (
        /* Стопка панелей. Уходящие слои (`closingLayers`) рендерятся под СВОИМИ
           ключами — теми же, что были у верхней панели, — поэтому React СОХРАНЯЕТ
           их DOM-узлы (не ремонтит) и уход играет на уже смонтированном узле:
           плавно, без пересборки тяжёлой панели. Текущая вершина — последней в
           массиве (в DOM ниже) → лежит ПОВЕРХ уходящих: новая наезжает, старая
           уезжает под ней. Все слои абсолютом заполняют коробку
           (`.mapshell__overlay > .ts-pdrawer`). Ключ уходящего = ключ текущей
           исключаются друг из друга (фильтр), чтобы не столкнуться при
           переоткрытии панели во время её ухода. */
        [
          ...closingLayers.filter((l) => l.key !== overlayKey).map((l) => ({ k: l.key, el: l.el, closing: true, top: false })),
          useDrawer && { k: panelKey, el: leftPanelEl, closing: false, top: true },
        ].filter(Boolean).map((L) => (
          <div
            key={L.k}
            ref={L.top ? leftPaneRef : undefined}
            tabIndex={L.top ? -1 : undefined}
            onKeyDown={L.top ? onPanelEsc : undefined}
            className="ts-pdrawer"
            data-closing={L.closing || undefined}
            aria-hidden={L.closing || undefined}
          >
            {/* У уходящего слоя гасим побочный эффект, дотягивающийся до карты:
                превью-нога переезда мигнула бы на время ухода. */}
            {L.closing ? React.cloneElement(L.el, { onPreviewTransfer: NOOP }) : L.el}
          </div>
        ))
      ) : null}
    >
      {/* ★ ВИДЖЕТА ПРОБЛЕМ ЗДЕСЬ БОЛЬШЕ НЕТ (решение Pavel). Круглый FAB со
          счётчиком и выпадающий `<ConflictsPanel>` сняты целиком — визуал
          проблем на этом экране рисуется заново отдельной задачей.
          ДВИЖОК ОСТАЛСЯ НА МЕСТЕ И ЖИВОЙ: `issues` считается как считался и
          продолжает кормить метки в рядах (`cityConflicts`, `hotelWarnId`,
          `actWarnId`, `transferMismatch`) и текст проблемы, который приезжает в
          открытую панель объекта (`openEvent`). Снят ровно один
          потребитель — этот. Сам `ConflictsPanel` в `ValidationUI` НЕ удалён:
          он и есть то, что новый визуал будет переиспользовать.
          ★ Виджет был СОБРАН ИЗ ДС (Card + IconBtn + Badge + ConflictsPanel), и
          его снятие роняет долю ДС — метрику, которая ходит только вверх. Это не
          деградация языка, а удаление узла целиком: с ним ушли и его сырые
          обёртки. Апрув Pavel — постановка «убрать виджет проблем, визуал новый
          будет позже».
          floor-exempt: dsshare +4 — снят виджет проблем целиком (узлов ДС стало меньше вместе с самим узлом), апрув Pavel

          Вместе с виджетом ушёл и его класс `.ts-warnfab` со всеми правилами —
          осиротевшее правило удалять обязательно (гард 2n). Объявляю каждое
          снятое объявление: у 2p ключ = единица + свойство, а не «файл», поэтому
          маркеры и живут рядом с ПРИЧИНОЙ, а не в CSS, где их предмета больше нет.
          visual-diff-exempt: .ts-warnfab position — класс снят вместе с виджетом проблем
          visual-diff-exempt: .ts-warnfab right — то же
          visual-diff-exempt: .ts-warnfab bottom — то же
          visual-diff-exempt: .ts-warnfab z-index — то же
          visual-diff-exempt: .ts-warnfab display — то же
          visual-diff-exempt: .ts-warnfab flex-direction — то же
          visual-diff-exempt: .ts-warnfab align-items — то же
          visual-diff-exempt: .ts-warnfab gap — то же
          visual-diff-exempt: .ts-warnfab max-width — то же
          visual-diff-exempt: .ts-warnfab transition — то же */}
      {/* Телефон: панель открывается тем же общим шитом, что и глобальный
          EventDrawerHost (родной свайп, безопасная перестановка под клавиатуру,
          закрытие по фону / свайпу вниз / Back). */}
      {isSheet && leftPanelEl && (
        <LpSheet open onClose={closeLeftPanel} title={t('trip.sidebar_route')}>
          {leftPanelEl}
        </LpSheet>
      )}
    </MapShell>
  );

}



function Conf({ n }) {
  const t = useT();
  if (!n) return null;
  return (
    <Tooltip content={t('tse.conflicts_n', { n })}>
      <Row as="span" inline gap="g1" className="te-warnbadge"><Icon name="warning" size={10} /> {n}</Row>
    </Tooltip>
  );
}

// inline hotel / activity cells (design mockup HotelCell / ActCell)
function HotelCell({ hotel, warn, onClick }) {
  const t = useT();
  if (!hotel) return (
    <Tooltip content={t('hotel.add')}>
      <Btn variant="dashed" size="sm" icon="bed" iconRight="plus" onClick={onClick} ariaLabel={t('hotel.add')} />
    </Tooltip>
  );
  return (
    <Tooltip content={hotel.name}>
      <Chip variant="tone" square icon="bed" className={warn ? 'is-warn' : ''} onClick={onClick}>
        {warn && <Icon name="warning" size={11} />}
      </Chip>
    </Tooltip>
  );
}
function ActCell({ count, warn, onClick }) {
  const t = useT();
  if (!count) return (
    <Tooltip content={t('budget.source_activity')}>
      <Btn variant="dashed" size="sm" icon="ticket" iconRight="plus" onClick={onClick} ariaLabel={t('budget.source_activity')} />
    </Tooltip>
  );
  return (
    <Tooltip content={t('budget.source_activity')}>
      <Chip variant="tone" square icon="ticket" className={warn ? 'is-warn' : ''} onClick={onClick}>
        <span className="num t-meta">{count}</span>
        {warn && <Icon name="warning" size={11} />}
      </Chip>
    </Tooltip>
  );
}

/**
 * ⚠️ Тот же запечатанный набор, что у чужих компонентов: без аннотации TS выводит
 * тип из ДЕСТРУКТУРИЗАЦИИ и делает обязательным каждый проп без дефолта.
 *
 * Четыре `?` проверены УСТРОЙСТВОМ КОДА, а не намерением: у ветки `waypoint`
 * гостиницы нет по определению, она рисует ПУСТУЮ ячейку `.te-cell--hotel` и
 * `hotel`/`stayNum`/`hotelWarn`/`onHotel` не передаёт вовсе. Остальные уходят в
 * безусловно отрендеренные узлы и обязательны.
 *
 * `readOnly` — ряд наблюдателя (TRIP-459): без грипа и со степпером-значением.
 * `drag` при этом остаётся ОБЯЗАТЕЛЬНЫМ: ряд гасит его сам (`rowDrag`), а не
 * ждёт, что вызыватель не передаст. Право знает ОДНО место — экран, — и ряд
 * получает от него ровно факт «править нельзя», а не отсутствие пропа: `drag`
 * без `readOnly` означал бы, что состояние ряда выводится из того, забыли ли
 * его прокинуть.
 *
 * @param {{ showCols?: boolean, readOnly?: boolean, seg: any, stayNum?: any, cityConf: any,
 *           hotel?: any, hotelWarn?: any, acts?: any[], actWarn: any, onOpenCity: any,
 *           onHotel?: any, onAct: any, onNightsMinus: any, onNightsPlus: any, drag: any }} p
 */
function GridNode({ showCols = true, readOnly = false, seg, stayNum, cityConf, hotel, hotelWarn, acts = [], actWarn, onOpenCity, onHotel, onAct, onNightsMinus, onNightsPlus, drag }) {
  const t = useT();
  const { lang } = useI18n();
  const stop = (e) => e.stopPropagation();
  // Наблюдателю перестановка недоступна — ряд отдаётся БЕЗ ручек (TRIP-459).
  // Гасить их нечем: `.te-grip` несёт `cursor: grab` и невидимую зону нажатия
  // 44×44 (`::after`), то есть выключенный грип продолжал бы обещать хват и
  // съедать тапы по ряду.
  const rowDrag = readOnly ? null : drag;
  // Грип занимает ПЕРВУЮ колонку сетки (`--te-cols: 16px 28px …`), поэтому
  // снять его насовсем нельзя: номер города переехал бы в 16px и вся строка
  // разъехалась бы с шапкой колонок. Место держит пустая ячейка — тем же
  // приёмом, каким ниже держится колонка жилья у пересадки.
  const gripEl = rowDrag ? (
    // Drag handle: pointer-drag (lifts the row) + keyboard reorder (a11y). Click is
    // stopped so grabbing the grip never opens the city panel.
    <span className="te-grip" role="button" tabIndex={0} aria-label={t('tse.move_up')}
      onClick={stop}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); rowDrag.onMove(-1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); rowDrag.onMove(1); }
      }}>
      <Icon name="drag" size={14} />
    </span>
  ) : <span aria-hidden="true" />;
  if (seg.kind === 'waypoint') {
    return (
      <CityRow variant="editor" dragging={rowDrag?.dragging} pressing={rowDrag?.pressing} onArm={rowDrag?.onArm} onClick={onOpenCity}
        grip={gripEl}
        lead={<Tile as="span" className="te-row__node" style={{ '--hl-soft': 'transparent', '--hl-ink': 'var(--ev-transfer)', border: '1px dashed var(--ev-transfer)' }}><Icon name="arrowSwap" size={11} /></Tile>}
        name={seg.city_name}
        conf={<Conf n={cityConf} />}
        dates={<><Badge size="tiny">{t('tse.layover')}</Badge>{fmtD(seg.start_date, lang)}</>}>
        {/* Ночи — ТАКАЯ ЖЕ ячейка ряда, как жильё и активности: выравнивание в
            колонке объявляет `.te-cell`, а не содержимое. Пока ночи стояли в
            сетке голым контролом, колонка держалась на том, что «− 3н +» её
            заполняет собой. Класс уходит на ТРИГГЕР тултипа — он и есть элемент
            сетки; отдельная обёртка была бы узлом, который ничего не держит. */}
        <NightsStepper className="te-cell" value={0} readOnly={readOnly} onMinus={onNightsMinus} onPlus={onNightsPlus} minusDisabled variant="bare" />
        {/* У пересадки жилья нет — но колонка есть: пустая ячейка держит сетку,
            иначе активности уехали бы в колонку жилья и разъехались с шапкой. */}
        {showCols && <div className="te-cell te-cell--hotel" />}
        {showCols && <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>}
      </CityRow>
    );
  }
  return (
    <CityRow variant="editor" dragging={rowDrag?.dragging} pressing={rowDrag?.pressing} onArm={rowDrag?.onArm} onClick={onOpenCity}
      grip={gripEl}
      lead={<Tile as="span" className={'te-row__num' + (cityConf ? ' is-warn' : '')}>{stayNum}</Tile>}
      name={seg.city_name}
      conf={<Conf n={cityConf} />}
      dates={formatDateRange(seg.start_date, seg.end_date, (iso) => fmtD(iso, lang))}>
      <NightsStepper className="te-cell" value={seg.nights} readOnly={readOnly} onMinus={onNightsMinus} onPlus={onNightsPlus} minusDisabled={(seg.nights || 0) <= 0} variant="bare" />
      {showCols && <div className="te-cell te-cell--hotel" onClick={stop}><HotelCell hotel={hotel} warn={hotelWarn} onClick={onHotel} /></div>}
      {showCols && <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>}
    </CityRow>
  );
}

// Transfer chip that STRADDLES the seam between two city rows (sits on the
// separator line, its surface bg covering it — it doesn't split the rows). A pill
// when the transfer exists, a dashed "+ переезд" when not. Click → transport panel
// (existing) or the "Развилка" pick panel (new). Same-city legs show nothing.
function SeamTransfer({ a, b, t, mismatch, disabled, onOpen }) {
  const tx = useT();
  const { lang } = useI18n();
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id) || (a.city_name && a.city_name === b.city_name);
  if (sameCity && !t) return null;
  const click = disabled ? undefined : onOpen; // a seam next to a pending city is inert
  if (!t) {
    return (
      <Row justify="j-center" className="te-seam">
        <Tooltip content={`${a.city_name} → ${b.city_name}`}>
          <Chip variant="placeholder" icon="plus" disabled={disabled} onClick={click}>
            <span className="t-meta">{tx('tse.add_transfer')}</span>
          </Chip>
        </Tooltip>
      </Row>
    );
  }
  const meta = transferKind(t.transport_type);
  const span = t.day_span ?? 0;
  return (
    <Row justify="j-center" className="te-seam">
      {/* ★ ТУЛТИПЫ ЗДЕСЬ — СОСЕДИ, А НЕ МАТРЁШКА. Вложенный `<Tooltip>` внутри
          `<Tooltip>` показывает ОБА пузыря разом: наведение на внутренний
          элемент не выводит указатель из внешнего, тот остаётся раскрытым, и
          подсказки накладываются друг на друга почти в одной точке. Поэтому
          внешняя подсказка (маршрут переезда) висит на ПОДПИСИ, а не на всём
          чипе — тогда у ночёвки своя, и они не пересекаются. */}
      <Chip variant="tone" icon={mismatch ? 'warning' : meta.icon} className={mismatch ? 'is-warn' : ''} disabled={disabled} onClick={click}>
        <Tooltip content={`${a.city_name} → ${b.city_name}`}>
          <span className="t-meta">{tx(meta.labelKey)}{mismatch ? tx('tse.mismatch_suffix') : ''}</span>
        </Tooltip>
        {/* Тултип овернайта был МЁРТВ: `Icon` деструктурирует свои пропы без
            остатка, `title` до DOM не доезжал вовсе, а под ключ `tse.overnight_title`
            не было строки ни в одной локали.
            ⚠️ Угловые скобки тут писать НЕЛЬЗЯ: гард 2d читает НАПИСАНИЕ, включая
            комментарии, и пара `svg` … `title` с текстом между ними читается
            им как сырая JSX-строка - первая редакция этого абзаца роняла CI. */}
        {span > 0 && (
          <Tooltip content={tx('tse.overnight_title', { count: span })}>
            <Icon name="moon" size={11} style={{ color: 'var(--brand)' }} />
          </Tooltip>
        )}
        <span className="num muted t-meta">· {fmtD(t.start_datetime, lang)}</span>
      </Chip>
    </Row>
  );
}

// Start / Finish anchor row — flag (start) / check (finish) node, label + city,
// departure/arrival date below. Flat flex row in the itinerary table.
function GridEndpoint({ node, date, onRemove }) {
  const t = useT();
  const { lang } = useI18n();
  const isStart = node.kind === 'start';
  const accent = isStart ? 'var(--brand)' : 'var(--success-ink)';
  const soft = isStart ? 'var(--brand-soft)' : 'var(--success-soft)';
  return (
    <Card recessed radius="md" pad="none" className="row row--g6 te-end">
      <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name={isStart ? 'flag' : 'check'} size={13} /></Tile>
      <Grow className="te-citycell">
        <span className="te-endlabel" style={{ color: accent }}>{isStart ? t('ai_plan.start') : t('ai_plan.end')}</span>
        <Row gap="g3" className="te-cityline">
          <Trunc as="span" className="te-cityname">{node.city_name}</Trunc>
        </Row>
        <Row gap="g3" className="te-dts">
          {isStart ? t('tse.departure_word') : t('tse.arrival_word')} · {fmtD(date || node.start_date || node.end_date, lang)}
        </Row>
      </Grow>
      {/* Удаление якоря — запись, наблюдателю его нет вовсе (TRIP-459). Ряд
          якоря раскладывает flex, не сетка, поэтому место держать не нужно. */}
      {onRemove && <button className="ts-step" style={{ width: 24, height: 24, color: 'var(--muted)', flexShrink: 0 }} onClick={onRemove} title={t('tse.remove')}><Icon name="close" size={13} /></button>}
    </Card>
  );
}

const POINT_TYPES = [
  { id: 'transit', labelKey: 'event.city', icon: 'bed', subKey: 'tse.pt_transit_sub' },
  { id: 'waypoint', labelKey: 'tse.pt_waypoint', icon: 'arrowSwap', subKey: 'tse.pt_waypoint_sub' },
  { id: 'start', labelKey: 'ai_plan.start', icon: 'flag', subKey: 'tse.pt_start_sub' },
  { id: 'end', labelKey: 'ai_plan.end', icon: 'flag', subKey: 'tse.pt_end_sub' },
];

// Inline "add a city" composer — lives at the END of the route list. Collapsed
// it's one soft button; opened it walks the deliberate order the old instant-add
// flow lacked: 1) pick a CITY (a dropdown pick fills the slot, it does NOT add
// yet), 2) pick its TYPE (revealed after a city is chosen), 3) confirm with a
// dedicated button. It owns its whole flow; the parent only gets the final
// (city, kind) via onAdd once the user confirms.
//
// ★ ГДЕ ЖИВЁТ ПОЛЕ ВВОДА — ПО ОБЩЕЙ ЛОГИКЕ АППА, А НЕ СВОЕЙ.
//   Десктоп: инлайн в теле виджета (клавиатуры нет — проблем нет).
//   Телефон: канон-нижний-шит <Sheet> — тот же примитив, что несёт поле поиска
//   у <SearchSelect>. Клавиатуру держит платформа: мета-вьюпорт
//   `interactive-widget=resizes-content` + `repositionInputs={false}` у шита, —
//   поле само встаёт над клавиатурой. Инлайн-инпута в теле PeekSheet тут больше
//   нет: он открывал клавиатуру ТАМ, где инпутов ни у кого нет, из-за чего его
//   приходилось подпирать скроллом по visualViewport, а нижний нав, спрятанный
//   клавиатурой, ронял `--nav-dock-h` в 0 (фикс — в MobileBottomNav).
function CityAdder({ onAdd, hasStart, hasEnd }) {
  const t = useT();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState(null);
  const [kind, setKind] = useState('transit');
  const rootRef = useRef(null); // десктоп-композер целиком
  const footRef = useRef(null); // футер с кнопками — последний элемент композера
  const close = () => { setOpen(false); setCity(null); setKind('transit'); };
  const disabledFor = (id) => (id === 'start' && hasStart) || (id === 'end' && hasEnd);
  const submit = () => { if (city) { onAdd(city, kind); close(); } };
  const meta = POINT_TYPES.find((p) => p.id === kind);

  // Докрутка тем же приёмом scrollIntoView, что и по всему аппу (ValidationUI,
  // CoverPicker, …) — в ЛЮБОМ скролл-контейнере (тело виджета на десктопе / тело
  // <Sheet> на телефоне), без платформенных веток и вычислений вьюпорта:
  //   • выбран город → появились плитки + кнопки: докручиваем К ФУТЕРУ (он
  //     последний), так в кадр попадают и плитки, и кнопки «Добавить/Отмена» —
  //     на ОБЕИХ платформах;
  //   • только открыли, города ещё нет: на десктопе — к самому композеру; на
  //     телефоне открытие ведёт <Sheet>/платформа, скролл не трогаем.
  // Небольшая задержка — дать разметке (появление плиток, закрытие клавиатуры)
  // осесть перед замером.
  useEffect(() => {
    if (!open) return;
    const target = city ? footRef.current : (isPhone ? null : rootRef.current);
    if (!target) return;
    const id = setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    return () => clearTimeout(id);
  }, [open, city, isPhone]);

  // Общие шаги композера (город → тип → подтверждение) — без своей шапки: на
  // десктопе шапку рисует карточка ниже, на телефоне её даёт сам <Sheet>.
  const steps = (
    <>
      {/* Шаг 1 — город. Выбор из выпадашки заполняет слот (флаг+имя+«Изменить»),
          не добавляя сразу; это открывает шаг типа ниже. autoFocus только на
          десктопе — на телефоне клавиатуру поднимает vaul по тапу в поле. */}
      {!city ? (
        <CitySearch onSelect={setCity} autoFocus={!isPhone} />
      ) : (
        <Row gap="g3" className="te-add-city">
          <CountryFlag code={city.country_code} />
          <Trunc as="span" className="te-add-cityname">{city.city_name}</Trunc>
          <Btn variant="quiet" size="sm" icon="edit" onClick={() => setCity(null)}>{t('tse.pt_change')}</Btn>
        </Row>
      )}

      {/* Шаг 2 — тип (появляется после выбора города). aria-pressed несёт выбор
          в AT; тон активной плитки — из .te-add-type[aria-pressed="true"]. */}
      {city && (
        <Col gap="g2">
          <span className="eyebrow">{t('tse.pt_type_label')}</span>
          <div className="te-add-grid" role="group" aria-label={t('tse.pt_type_label')}>
            {POINT_TYPES.map((pt) => {
              const dis = disabledFor(pt.id);
              return (
                <button key={pt.id} type="button" className="te-add-type"
                  aria-pressed={kind === pt.id} disabled={dis || undefined}
                  title={dis ? t('tse.already_set') : t(pt.subKey)}
                  onClick={() => setKind(pt.id)}>
                  <Icon name={pt.icon} size={17} />
                  <span className="t-label">{t(pt.labelKey)}</span>
                </button>
              );
            })}
          </div>
          <span className="t-meta muted">{meta ? t(meta.subKey) : ''}</span>
        </Col>
      )}

      {/* Шаг 3 — осознанное подтверждение, которого не было у мгновенного add. */}
      <Row gap="g3" justify="j-between" className="te-add-ft" ref={footRef}>
        <Btn variant="secondary" onClick={close}>{t('common.cancel')}</Btn>
        <Btn variant="primary" disabled={!city} onClick={submit}>
          <Icon name="plus" size={15} /> {t('common.add')}
        </Btn>
      </Row>
    </>
  );

  const trigger = (
    <Btn variant="soft" block className="te-add-open" onClick={() => setOpen(true)}>
      <Icon name="plus" size={15} /> {t('tse.add_point_btn')}
    </Btn>
  );

  // Телефон: кнопка в списке + композер в КАНОН-шите <Sheet> — ровно то, что
  // делает <SearchSelect> (поле поиска в шите). Нижний шит + `interactive-widget=
  // resizes-content` держат поле над клавиатурой платформой, без своего скролла.
  if (isPhone) {
    return (
      <>
        {trigger}
        {/* Полную высоту шит берёт САМ, увидев поле у себя в поддереве
            (`useHostsTextInput`) — вызывателю объявлять нечего. Поле здесь
            ПЕРВОЕ в составе (шаг 1: город → тип → подтверждение), поэтому
            полная высота сама ставит его под шапку. */}
        <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }} title={t('tse.add_point')}>
          <div className="te-add">
            <span className="t-meta muted">{t('tse.add_point_hint')}</span>
            {steps}
          </div>
        </Sheet>
      </>
    );
  }
  // Десктоп: инлайн в виджете со своей шапкой и лёгкой анимацией появления.
  if (!open) return trigger;
  return (
    <div ref={rootRef} className="te-addwrap">
      <Card recessed radius="md" pad="none" className="te-add">
        <Row justify="j-between" align="a-start">
          <Col gap="g1">
            <b>{t('tse.add_point')}</b>
            <span className="t-meta muted">{t('tse.add_point_hint')}</span>
          </Col>
          <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
        </Row>
        {steps}
      </Card>
    </div>
  );
}

// (Conflicts and transfer rows now open in-place LEFT panels: EventSourcePanel
//  for view/edit/delete, EventEditDialog variant="panel" for transfer create.
//  The old view/add modals were removed in the panel redesign Ф3.)
