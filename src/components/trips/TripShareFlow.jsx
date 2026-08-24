import React, { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { withViralMarks } from '@/lib/viralLink';
import { invokeFn } from '@/lib/invokeFn';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { useIsPhone } from '@/hooks/use-mobile';
import { Badge, Btn, Col, Dialog, Input, ListRow, Row, Severity, Sheet, Tile } from '@/design/index';
import { Icon } from '@/design/icons';
import ShareCardDialog from './ShareCardDialog';

// Публичная ссылка трипа: токен просят один раз на открытие флоу (пока человек
// читает меню, ссылка уже готова — копирование остаётся в жесте клика), урл
// несёт виральные метки. Провал сбрасывает промис — следующее открытие ретраит.
function useShareLink(tripId, active) {
  const [state, setState] = useState({ url: '', error: false, loading: false });
  const promiseRef = useRef(null);
  const forTripRef = useRef(null);
  useEffect(() => {
    if (!active || !tripId) return;
    // Смена трипа БЕЗ ремаунта (роут /trip/:id не ремаунтит TripView: переход по
    // колокольчику/виджету чата/копии трипа) обязана сбросить закэшированный
    // токен — иначе в буфер уехала бы публичная ссылка ПРЕДЫДУЩЕГО трипа.
    if (forTripRef.current !== tripId) { promiseRef.current = null; forTripRef.current = tripId; }
    if (promiseRef.current) return;
    setState({ url: '', error: false, loading: true });
    const p = invokeFn('trip-share/share', { body: { tripId } })
      .then(({ data, error }) => {
        const token = data?.shareToken || data?.token;
        if (error || !token) throw error || new Error('no share token');
        // location.origin, not a constant: the campaign mark is stored per
        // host, so the link must point at the host it was copied from.
        return withViralMarks(`${window.location.origin}/public/trip/${tripId}?t=${token}`, 'public_link', tripId);
      });
    promiseRef.current = p;
    p.then(
      (url) => setState({ url, error: false, loading: false }),
      (e) => {
        console.error('ensureShareToken error:', e);
        promiseRef.current = null;
        setState({ url: '', error: true, loading: false });
      },
    );
  }, [active, tripId]);
  return { ...state, promise: () => promiseRef.current };
}

// Share-флоу трипа (share-UX эксперимент, замена монолитного ShareDialog):
//   меню «Ссылка / Карточка» → быстрое копирование ссылки (спиннер → тост,
//   без диалога) ИЛИ конструктор карточки (ShareCardDialog). Отдельный диалог
//   ссылки остаётся фолбэком — когда буфер недоступен (iOS вне жеста, http).
// Меню адаптивное тем же правилом, что ActionMenu: телефон — bottom-sheet со
// строками `.sheet-row--tile`, десктоп — компактный диалог со строками ListRow.
export default function TripShareFlow({ trip, open, onOpenChange, visits = [], transfers = [] }) {
  const { t } = useI18n();
  const isPhone = useIsPhone();
  const [view, setView] = useState('menu'); // 'menu' | 'link' (фолбэк) | 'card'
  const [copying, setCopying] = useState(false);
  const link = useShareLink(trip?.id, open);

  useEffect(() => { if (open) setView('menu'); }, [open]);
  const close = () => onOpenChange?.(false);
  // Закрытие любой оболочки флоу (шит / диалог ссылки / конструктор) закрывает
  // ВЕСЬ флоу: вида-«назад» здесь нет, меню открывается заново с нуля.
  const onDismiss = (o) => { if (!o) close(); };

  async function copyLink() {
    track('trip_share_link_copied', { trip_id: trip?.id });
    setCopying(true);
    try {
      const url = link.url || (await link.promise());
      // Провал токена оставляет promise=null → url пустой; писать «null» в буфер
      // и рапортовать успех нельзя — уходим в фолбэк-диалог с ошибкой.
      if (!url) throw new Error('no share link');
      await navigator.clipboard.writeText(url);
      successToast(t, 'link_copied');
      close();
    } catch {
      // Буфер не дался (или токен не приехал) — показываем ссылку человеку.
      setView('link');
    } finally {
      setCopying(false);
    }
  }

  function copyFromDialog() {
    if (!link.url) return;
    track('trip_share_link_copied', { trip_id: trip?.id });
    navigator.clipboard?.writeText(link.url)
      .then(() => successToast(t, 'link_copied'))
      // Буфер не дался и здесь — молчим без unhandled rejection: ссылка стоит
      // в инпуте рядом, руками выделить и скопировать можно всегда.
      .catch(() => {});
  }

  // Меню и фолбэк-диалог остаются СМОНТИРОВАННЫМИ с open-флагом (как канон
  // ActionMenu держит свой Sheet): vaul/Radix доигрывают анимацию закрытия,
  // ранний return размонтировал бы шит посреди slide-down. Конструктор,
  // наоборот, монтируется только открытым — он держит живую mapbox-карту.
  const menuOpen = open && view === 'menu';
  const linkSub = copying || link.loading ? t('share.generating') : t('trip.share_desc');
  return (
    <>
      {isPhone ? (
        <Sheet open={menuOpen} onOpenChange={onDismiss} title={t('share.dialog_title')}>
          <button type="button" className="sheet-row sheet-row--tile" disabled={copying} onClick={copyLink}>
            <Tile tone="brand" icon="link" />
            <span className="grow">{t('trip.copy_link')}</span>
            {copying ? <span className="spin spin--ring" /> : <Icon name="chev" size={18} />}
          </button>
          <button type="button" className="sheet-row sheet-row--tile" onClick={() => setView('card')}>
            <Tile tone="brand" icon="image" />
            <span className="grow">{t('share.card_title')}</span>
            <Badge variant="count">{t('share.card_new')}</Badge>
            <Icon name="chev" size={18} />
          </button>
        </Sheet>
      ) : (
        <Dialog title={t('share.dialog_title')} icon="share" size="sm" open={menuOpen} onOpenChange={onDismiss}>
          <Col gap="g3">
            <ListRow
              variant="raised"
              lead={<Tile tone="brand" icon="link" />}
              title={t('trip.copy_link')}
              sub={linkSub}
              trail={copying ? <span className="spin spin--ring" /> : <Icon name="chev" size={18} />}
              onClick={() => { if (!copying) copyLink(); }}
            />
            <ListRow
              variant="raised"
              lead={<Tile tone="brand" icon="image" />}
              title={<Row gap="g3" inline>{t('share.card_title')}<Badge variant="count">{t('share.card_new')}</Badge></Row>}
              sub={t('share.menu_card_hint')}
              trail={<Icon name="chev" size={18} />}
              onClick={() => setView('card')}
            />
          </Col>
        </Dialog>
      )}

      <Dialog title={t('trip.copy_link')} icon="link" size="sm" open={open && view === 'link'} onOpenChange={onDismiss}>
        <Col gap="g4">
          <div className="muted t-body">{t('trip.share_desc')}</div>
          <Row gap="g3">
            <Input
              readOnly
              className="grow--fit"
              value={link.loading ? '' : link.url}
              placeholder={link.loading ? t('share.generating') : ''}
              onClick={(e) => e.target.select()}
            />
            <Btn variant="primary" icon="check" loading={link.loading} disabled={!link.url} onClick={copyFromDialog}>
              {t('share.copy')}
            </Btn>
          </Row>
          {link.error && <Severity level="error">{t('trip.link_error')}</Severity>}
        </Col>
      </Dialog>

      {open && view === 'card' && (
        <ShareCardDialog trip={trip} visits={visits} transfers={transfers} open onOpenChange={onDismiss} />
      )}
    </>
  );
}
