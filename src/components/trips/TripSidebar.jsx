import React from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { BrandSlot } from '@/components/AppHeader';
import { Avatar, Card, Sheet, Skeleton, UnreadBadge } from '@/design/index';
import { availableSections, isSectionAvailable, loadingSections } from '@/lib/tripMenu';
import { useTripAccess } from '@/components/trips/TripAccessContext';
import { clearsStep } from '@/lib/tripStep';
import { displayName } from '@/lib/displayName';
import { useUnreadChatCount } from '@/lib/chat';
import { useUnreadNotificationCount } from '@/lib/useNotifications';

// СОСТАВ МЕНЮ — один расчёт на обе оболочки. Рейл и телефонный шит рисуют его
// по-разному (колонка против плиток под палец), но отвечают на один вопрос: что
// в этом трипе доступно ЭТОЙ роли. Пока расчёт стоял в каждой оболочке своей
// копией, разъехаться они могли молча — правило видно только рядом, а копии
// живут в разных концах файла.
function useTripMenu({ tripId, trip, isPro, proResolved }) {
  // Ступень — из ЕДИНОГО канала права (`TripAccessProvider`), а не пропом сверху.
  // Пропом она шла через три слоя (TripView → TripShell → сюда) в обход того
  // самого контекста, который заведён, чтобы «пропов права больше не было»;
  // заодно это привязывало состав меню к списку участников, т.е. ко ВТОРОМУ
  // сетевому кругу. Теперь ступень приезжает с трипом, и меню собирается разом.
  const { step: myStep } = useTripAccess();
  return {
    // И аддон-гейт, и ролевой (наблюдатель видит Настройки, но не Участников —
    // TRIP-137) живут в реестре секций одним предикатом.
    lensItems: availableSections(trip, myStep, 'lens'),
    mgmtItems: availableSections(trip, myStep, 'manage'),
    canShare: clearsStep(myStep, 'participant'),
    // Апселл показывается только когда статус Pro РАЗРЕШЁН: иначе пункт моргает
    // на Pro-трипе, пока едет ответ.
    showUpgrade: proResolved && !isPro,
    // Считаем чат только когда линза чата доступна (TRIP-208 Ф2-2b): бейдж
    // рисуется под видимым пунктом, поэтому трип без чата держит ноль подписок
    // вместо живой, которая всё равно ничего не покажет.
    chatUnread: useUnreadChatCount(tripId, { enabled: isSectionAvailable('chat', trip, myStep) }),
  };
}

// Место под пункт, доступность которого ещё неизвестна (фаза загрузки).
//
// Подпись — ДВЕ плашки, а не одна, и это замер, а не вкус: `.app-side__label`
// переносится на две строки (line-clamp 2), поэтому живой пункт с длинной
// подписью — «Структура», «Участники» — занимает 56 px против 52 у однострочного
// (min-height рейла). Место в одну плашку было бы на 4 px ниже пункта, который
// его займёт, и «Настройки» под ним съезжали бы вниз ровно в тот момент, ради
// которого всё это делалось. Две строки по 12 + зазор дают те же 56.
// Остаточное: в локали, где подпись влезает в одну строку, место на 4 px выше
// будущего пункта. Полностью снять это можно, только меряя саму подпись —
// то есть отрисовав текст, которого мы ещё не имеем права показывать.
//
// Ширины плашек разные по индексу: ровный столбик читается как таблица, а не
// как «сейчас подгрузится».
function RailItemPending({ i }) {
  return (
    <div className="app-side__item">
      <Skeleton w={20} h={20} r={6} />
      <Skeleton w={30 + (i % 3) * 8} h={12} r={4} />
      <Skeleton w={20 + (i % 2) * 8} h={12} r={4} />
    </div>
  );
}

// Пункт рейла — иконка, под ней подпись. Одна оболочка на обе группы: состав,
// иконки и подписи приходят из реестра секций (`tripMenu.js`) без единого
// исключения, рейл их только рисует.
function RailItem({ icon, label, active = false, badge = 0, pro = false, onClick }) {
  return (
    <button
      className={'app-side__item' + (active ? ' active' : '') + (pro ? ' app-side__item--pro' : '')}
      onClick={onClick}
      // `title` — нативная подсказка вместо своего пузыря: длинные локали
      // («Planificación», «Presupuesto») в 70 px режутся, и полное имя обязано
      // где-то остаться. Ponytail: платформа вместо кода.
      title={label}
      aria-current={active ? 'page' : undefined}
      type="button"
    >
      <Icon name={icon} size={20} />
      <span className="app-side__label">{label}</span>
      <UnreadBadge count={badge} />
    </button>
  );
}

// Левое меню трипа — полновысотный рейл 70 px. Рисуется ОДИН раз оболочкой
// TripShell, все секции переключаются одним и тем же onNavigate.
//
// Первые --header-h рейла — бренд-слот: тот же компонент, что стоит первой
// ячейкой шапки на экранах вне трипа, поэтому знак при переходе не смещается.
// В рейле он в режиме `back` — по наведению становится стрелкой выхода, и
// круглой кнопки «назад» в шапке из-за этого больше нет (на телефоне рейла нет,
// там кнопка остаётся).
//
// Шит телефона (SidebarSheetBody ниже) собран отдельно и намеренно: у него своя
// раскладка под палец (плитки 3-в-ряд), подписи групп и карточка апгрейда, для
// которых на 70 px места нет. Общий у них ровно источник пунктов.
export default function TripSidebar({
  tripId, trip, lens, onNavigate, onShare, onBack, backTitle,
  isPro, proResolved = true, onProUpsell, loading = false,
}) {
  const { t } = useI18n();
  const { lensItems, mgmtItems, canShare, showUpgrade, chatUnread } =
    useTripMenu({ tripId, trip, isPro, proResolved });
  // На фазе загрузки состав берётся из реестра (`loadingSections`), а не из
  // отдельного скелетон-компонента: негейтованные секции известны без данных и
  // рисуются ЖИВЫМИ — по ним можно уйти в раздел, не дожидаясь ответа.
  const lensRows = loading ? loadingSections('lens') : lensItems;
  const mgmtRows = loading ? loadingSections('manage') : mgmtItems;
  // «Поделиться» и «Pro» — не секции реестра, а действия, и стоят в самом низу:
  // их появление ничего не сдвигает, поэтому места под них не держим.
  const showTail = !loading && (canShare || showUpgrade);
  const row = (item, i) => (item.pending ? <RailItemPending key={item.id} i={i} /> : (
    <RailItem
      key={item.id}
      icon={item.icon}
      label={t(item.labelKey)}
      active={lens === item.id}
      badge={item.id === 'chat' ? chatUnread : 0}
      onClick={() => onNavigate(item.id)}
    />
  ));
  return (
    <aside className="app-side">
      <BrandSlot onClick={onBack} title={backTitle} back />
      <nav className="app-side__nav">
        {/* TRIP-391 объект 1: .app-side__item — пункт НАВИГАЦИИ шелла (лензы), не кнопка-примитив. */}
        <div className="app-side__group">{lensRows.map(row)}</div>
        {(mgmtRows.length > 0 || showTail) && (
          /* Подпись группы на 70 px не живёт — её работу делает черта, которую
             рисует сама вторая группа. Класс подписи жив: он в телефонном шите. */
          <div className="app-side__group">
            {mgmtRows.map(row)}
            {showTail && canShare && onShare && (
              <RailItem icon="share" label={t('trip.share')} onClick={onShare} />
            )}
            {/* Апселл — ПУНКТ меню, а не баннер: тот же ряд, только в Pro-цвете,
                и стоит он в общем списке под «Поделиться». В подвале колонки его
                не видели: низ рейла — край экрана, туда не смотрят. */}
            {/* i18n-ignore — «Pro» имя тарифа, не переводится */}
            {showTail && showUpgrade && <RailItem icon="pro" label="Pro" pro onClick={onProUpsell} />}
          </div>
        )}
      </nav>
    </aside>
  );
}

// Phone sheet BODY (TRIP-235). Тот же состав пунктов, ролевой гейт и бейдж чата,
// что у рейла, включая апселл (он ряд меню, а не карточка), но разложено под
// палец: lenses in a 3-col grid of tiles with
// the open screen highlighted, management collapsed into one bordered container,
// and an account row (moved out of the bottom nav) at the foot.
function SidebarSheetBody({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true,
  onProUpsell, onShare, user, onAccount,
}) {
  const { t } = useI18n();
  const { lensItems, mgmtItems, canShare, showUpgrade, chatUnread } =
    useTripMenu({ tripId, trip, isPro, proResolved });
  // Плашка «Аккаунт» ведёт во «Входящие» — на ней бейдж непрочитанных inapp-
  // уведомлений (глобальный счётчик, не про этот трип). TRIP-354.
  const inappUnread = useUnreadNotificationCount();
  const accountName = displayName(user?.email, user?.full_name);

  // Ряды управления: секции группы 'manage' + «Поделиться».
  const manageRows = [
    ...mgmtItems.map((item) => ({ id: item.id, icon: item.icon, labelKey: item.labelKey, active: lens === item.id, onClick: () => onNavigate(item.id) })),
    ...(canShare && onShare ? [{ id: 'share', icon: 'share', labelKey: 'trip.share', onClick: onShare }] : []),
    // Апселл — такой же ряд меню, что и на десктопе, и ведёт в ту же модалку:
    // одно поведение — одна реализация, только оболочки разные.
    ...(showUpgrade ? [{ id: 'pro', icon: 'pro', label: 'Pro', pro: true, onClick: onProUpsell }] : []),   // i18n-ignore — имя тарифа
  ];

  return (
    <>
      <div className="tm-grid">
        {lensItems.map((item) => (
          <Card
            as="button"
            radius="md"
            key={item.id}
            className={'tm-cell' + (lens === item.id ? ' is-active' : '')}
            onClick={() => onNavigate(item.id)}
            ariaCurrent={lens === item.id ? 'page' : undefined}
          >
            <span className="tm-cell__ico"><Icon name={item.icon} size={18} /></span>
            <span className="tm-cell__lbl t-label">{t(item.labelKey)}</span>
            {item.id === 'chat' && <UnreadBadge count={chatUnread} />}
          </Card>
        ))}
      </div>
      {manageRows.length > 0 && (
        <>
          <div className="app-side__group-label tm-caption">{t('trip_menu.section_manage')}</div>
          <Card pad="none" radius="lg" className="tm-manage">
            {/* TRIP-391 объект 1 → объект 6: .tm-manage__row — РЯД меню управления, не кнопка-примитив. */}
            {manageRows.map((row) => (
              <button key={row.id} className={'tm-manage__row' + (row.active ? ' is-active' : '') + (row.pro ? ' app-side__item--pro' : '')} onClick={row.onClick} aria-current={row.active ? 'page' : undefined}>
                <span className="tm-manage__ico"><Icon name={row.icon} size={16} /></span>
                <span className="tm-manage__lbl t-label">{row.label || t(row.labelKey)}</span>
                <Icon name="chevron" size={16} className="tm-manage__chev" />
              </button>
            ))}
          </Card>
        </>
      )}
      {onAccount && (
        <Card as="button" radius="lg" className="tm-account" onClick={onAccount}>
          <Avatar name={accountName} photo={user?.avatar_url} seed={user?.id} size="sm" />
          <span className="tm-account__txt">
            <span className="tm-account__name t-label">{t('nav.account')}</span>
            <span className="tm-account__sub t-meta">{accountName}</span>
          </span>
          <UnreadBadge count={inappUnread} />
          <Icon name="chevron" size={16} className="tm-manage__chev" />
        </Card>
      )}
    </>
  );
}

// Phone variant: the touch-optimised menu (SidebarSheetBody) inside the canonical
// bottom-sheet (reuses <Sheet> — max-height, swipe-to-close, scrim, focus-trap).
// Ниже 640 рейл погашен в CSS, и меню целиком живёт здесь. The parent gates
// `open` on the phone breakpoint and closes it through the onNavigate / onShare
// / onAccount callbacks.
export function TripSidebarSheet({ open, onOpenChange, ...rest }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('trip.sections_title')}>
      <SidebarSheetBody {...rest} />
    </Sheet>
  );
}
