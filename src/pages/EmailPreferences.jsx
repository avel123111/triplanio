// @ts-check
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invokeFn } from '@/lib/invokeFn';
import { useT } from '@/lib/i18n/I18nContext';
import { Card, Toggle } from '@/design/index';
import { Btn } from '@/design/Btn';
import { Col, Row } from '@/design/Layout';
import { ListRow } from '@/design/ListRow';
import { Skeleton } from '@/design/Skeleton';
import { buildRows, changedTopics, hasChanges } from '@/lib/emailPrefs';

/* =============================================================================
   EmailPreferences — настройки почтовых рассылок (TRIP-512).

   Открывается ССЫЛКОЙ ИЗ ПИСЬМА и работает БЕЗ ВХОДА: человек читает почту с
   чужого устройства и пароля не помнит, а отписка обязана срабатывать всё
   равно — это требование почтовиков, а не удобство. Адресат приезжает в `?c=` —
   это id контакта Resend, он же и есть пропуск: id генерит Resend, и в нашем
   приложении он не появляется нигде, поэтому взять его можно только из своего
   письма.

   Экран НЕ в зоне сайта (`SiteZone`) намеренно: под `site.css` у голого `.btn`
   сайтовая база, и кнопка приехала бы из другой дизайн-системы — тот же замер,
   по которому вне зоны оставлен `PageNotFound` (App.jsx). Здесь app-ДС целиком.

   Состояние подписки хранит Resend; своей копии у нас нет и не заводится (см.
   `src/lib/emailPrefs.js`).
   ============================================================================= */

export default function EmailPreferences() {
  const t = useT();
  const [params] = useSearchParams();
  const contact = params.get('c') || '';

  const [rows, setRows] = useState(/** @type {any[]} */([]));
  const [initial, setInitial] = useState(/** @type {any[]} */([]));
  const [unsub, setUnsub] = useState(false);
  const [wasUnsub, setWasUnsub] = useState(false);
  const [phase, setPhase] = useState(contact ? 'loading' : 'invalid');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setPhase('loading');
    const { data, error, code } = await invokeFn('emailPrefs', { body: { c: contact, action: 'get' } });
    if (error || !data) {
      // «Ссылка битая» и «сеть отвалилась» — разные ответы человеку: во втором
      // случае помогает «Повторить», в первом не поможет никогда. `code` берём
      // у `invokeFn`: тело ответа читается РОВНО ОДИН РАЗ (Response), и свой
      // повторный разбор здесь получил бы уже вычерпанный поток, то есть
      // молча null вместо кода.
      setPhase(code === 'INVALID_LINK' ? 'invalid' : 'error');
      return;
    }
    const built = buildRows(data.topics);
    setRows(built);
    setInitial(built);
    setUnsub(!!data.unsubscribed);
    setWasUnsub(!!data.unsubscribed);
    setPhase('ready');
  }, [contact]);

  useEffect(() => { if (contact) load(); }, [contact, load]);

  const dirty = hasChanges(initial, rows, wasUnsub, unsub);

  // Переключатель не «оптимистичный»: состояние на экране меняется сразу, но
  // сохранение отдельной кнопкой — так человек видит, что именно он поменял,
  // прежде чем это уедет (и может передумать, не тронув сервер).
  const flip = (id, on) => {
    setSaved(false);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, on } : r)));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    const body = { c: contact, topics: changedTopics(initial, rows) };
    if (wasUnsub !== unsub) body.unsubscribed = unsub;
    const { error } = await invokeFn('emailPrefs', { body });
    setSaving(false);
    if (error) { setPhase('save_error'); return; }
    // Новая база сравнения — иначе кнопка осталась бы активной на сохранённом.
    setInitial(rows);
    setWasUnsub(unsub);
    setSaved(true);
    setPhase('ready');
  };

  if (phase === 'invalid') {
    return (
      <Col as="main" className="page-main">
        <h1 className="t-title">{t('email_prefs.invalid_title')}</h1>
        <p className="muted t-body">{t('email_prefs.invalid_body')}</p>
      </Col>
    );
  }

  // Пока грузимся — НИ ОДНОЙ переведённой строки на экране, только заглушки.
  // Причина не косметическая: словарь этого экрана не входит в шесть, которых
  // ждёт первый кадр (`zoneNamespaces.js`) — он приезжает следующим, фоном.
  // Заголовок, отрисованный в этот момент, был бы сырым ключом на кадр.
  if (phase === 'loading') {
    return (
      <Col as="main" className="page-main" gap="g7">
        <Col gap="g2"><Skeleton h={28} w="60%" /><Skeleton h={18} w="80%" /></Col>
        <Card>
          <Col>
            <Skeleton h={44} /><Skeleton h={44} /><Skeleton h={44} /><Skeleton h={44} />
          </Col>
        </Card>
      </Col>
    );
  }

  return (
    <Col as="main" className="page-main" gap="g7">
      <Col gap="g2">
        <h1 className="t-title">{t('email_prefs.title')}</h1>
        <p className="muted t-body">{t('email_prefs.subtitle')}</p>
      </Col>

      {phase === 'error' && (
        <Col gap="g4">
          <p className="t-body">{t('email_prefs.load_error')}</p>
          <Row><Btn variant="secondary" onClick={load}>{t('email_prefs.retry')}</Btn></Row>
        </Col>
      )}

      {(phase === 'ready' || phase === 'save_error') && (
        <>
          <Card>
            <Col gap="g2">
              {rows.map((r) => {
                // Топик, которого нет в локали (завели новый и ещё не
                // перевели), показывается под именем из ответа — см. `buildRows`.
                const label = r.i18nKey ? t(r.i18nKey) : r.name;
                return (
                  <ListRow
                    key={r.id}
                    title={label}
                    // Общий выключатель гасит частные: при нём письма не уходят
                    // независимо от топиков, и живой переключатель здесь врал бы.
                    trail={(
                      <Toggle
                        on={r.on}
                        locked={unsub}
                        busy={saving}
                        label={label}
                        onChange={(v) => flip(r.id, v)}
                      />
                    )}
                  />
                );
              })}
            </Col>
          </Card>

          <Card>
            <ListRow
              title={t('email_prefs.none_title')}
              sub={t('email_prefs.none_sub')}
              trail={<Toggle on={unsub} busy={saving} label={t('email_prefs.none_title')} onChange={(v) => { setSaved(false); setUnsub(v); }} />}
            />
          </Card>

          <Row gap="g4" wrap>
            <Btn variant="primary" disabled={!dirty} loading={saving} onClick={save}>
              {t('email_prefs.save')}
            </Btn>
            {saved && <span className="muted t-body">{t('email_prefs.saved')}</span>}
            {phase === 'save_error' && <span className="t-body">{t('email_prefs.save_error')}</span>}
          </Row>
        </>
      )}
    </Col>
  );
}
