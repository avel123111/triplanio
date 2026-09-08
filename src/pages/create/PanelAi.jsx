// @ts-check
import React, { useEffect, useRef } from 'react';
import { Avatar, Card, Chip } from '../../design/index';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { useT } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';

// =====================================================================
// AI ENTRY PANEL — the CONVERSATION (transcript only). The composer is pinned by
// ManualPlanner as a separate <ChatComposer> bar below this scroller. Sides mirror
// the trip chat (Pavel): the BOT is left (avatar + tinted card), the USER is right
// (own bubble only — no avatar, no name, exactly like the sender's own message in
// the trip chat). Vertical rhythm comes from the chat's own per-message margins
// (.chat-reply / .chat-run), NOT a wrapping gap — a wrapping gap stacked on top of
// them read as double spacing.
//   props: aiMessages[], onGenerate(promptText) — direct props, like its sibling
//   flow panels (FlowProgress / StepHome), not a ctx bag.
//
// ★ ЛЕНТА — ТОЛЬКО РАЗГОВОР (TRIP-535). Черновик маршрута отсюда ушёл: он не
// сообщение и не его продолжение, а результат шага, и живёт своей поверхностью
// (`DraftItinerary` во второй колонке шелла или во вкладке шапки панели).
// Строк «что сделал / не смог» под текстом нет: бот сам говорит, что сделал, а
// отказ применятора уходит в телеметрию вызывателя (бот про валидатор не знает,
// «не смог» под его «сделал» — противоречие).
// =====================================================================

// Assistant turn — LEFT: avatar + name + tinted card. Same shell/skin as the trip
// chat's ChatReply.
function BotMessage({ children }) {
  return (
    <div className="chat-reply">
      <div className="row row--g6">
        <div className="chat-run__av"><Avatar kind="ai" /></div>
        <div className="col col--g4 grow--fit">
          <div className="row row--g4 chat-reply__who"><b>{TRIPLANIO_BOT_NAME}</b></div>
          <Card radius="md" className="chat-reply__card">{children}</Card>
        </div>
      </div>
    </div>
  );
}

// User turn — RIGHT: the trip chat's own-message SHELL (chat-run--me /
// chat-run__col / chat-bubble--me). In the trip chat the sender's own message has
// NO avatar and NO name (`{!isMe && avatar}`, `{!isMe && name}`), so neither is
// drawn here either — just the bubble, right-aligned by `.chat-run--me`. The body
// is a plain pre-wrap span, NOT the chat's ChatMarkdown: a user's typed prompt is
// literal text, so `*`/`_`/`` ` `` must stay as typed, not turn into formatting.
function UserMessage({ text }) {
  return (
    <div className="row row--a-start row--g6 chat-run chat-run--me">
      <div className="col col--g2 chat-run__col">
        <div className="chat-bubble chat-bubble--me"><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>
      </div>
    </div>
  );
}

export default function PanelAi({ aiMessages = [], onGenerate }) {
  const t = useT();

  // Auto-scroll the transcript to the newest message (the panel body is the scroller).
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [aiMessages.length]);

  // Quick-start chips only on the opening turn (nothing sent yet); tapping one sends
  // it straight to the bot. They sit UNDER the welcome message, indented by an
  // avatar-width spacer so they line up with the message body (not the panel edge);
  // `.pl-ai-chips` binds their font to the Meta canon.
  const showChips = aiMessages.length <= 1;

  // Лента — просто содержимое тела виджета: скроллит его ТЕЛО, а композер стоит
  // в слоте действий шелла (снаружи скролла), поэтому расти и прижимать здесь
  // больше нечему.
  return (
    <div>
      {aiMessages.map((m) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text} />;
        if (m.kind === 'welcome') return <BotMessage key={m.id}><span className="t-support" style={{ whiteSpace: 'pre-wrap' }}>{t('ai_plan.status_waiting')}</span></BotMessage>;
        if (m.kind === 'error') return <BotMessage key={m.id}><span className="t-support">{t('ai_plan.error_plan_title')}</span></BotMessage>;
        return (
          <BotMessage key={m.id}>
            {m.text ? <div className="chat-reply__text"><ChatMarkdown text={m.text} linkClassName="cm-a cm-a--brand" /></div> : null}
          </BotMessage>
        );
      })}

      {showChips && (
        <div className="row row--g6 pl-ai-chips">
          <div className="chat-run__av" aria-hidden="true" />
          <div className="row row--wrap row--g4 grow--fit">
            {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
              <Chip key={p} onClick={() => onGenerate(p)}>{p}</Chip>
            ))}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
