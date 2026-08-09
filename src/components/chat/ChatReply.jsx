import React, { useLayoutEffect, useRef, useState } from 'react';
import { Btn } from '@/design/index';
import { Icon } from '@/design/icons';
import { useT } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import TriplanioAvatar from './TriplanioAvatar';
import ChatMarkdown from './ChatMarkdown';

/**
 * ChatReply — the assistant's answer rendered as a document, not a bubble.
 *
 * Shared by the chat lens and the floating widget so the two never drift (the
 * widget just renders it in a narrower column).
 *
 * Props:
 *   text   raw markdown as stored in chat_messages.text
 *   time   preformatted timestamp
 *   onAsk  optional — seeds the composer with an @Triplanio mention
 */

// Clamp height for a long answer. Answers routinely run 40-80 lines; this keeps
// one on screen without pushing the rest of the conversation out of view.
const CLAMP_H = 264;

export default function ChatReply({ text, time, onAsk }) {
  const t = useT();
  const textRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [copied, setCopied] = useState(false);

  // scrollHeight reports the FULL content height even while max-height clips it,
  // so this stays stable across expand/collapse and needs no measure-then-unclamp
  // dance.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el) setOverflows(el.scrollHeight > CLAMP_H);
  }, [text]);

  const clamped = overflows && !expanded;

  // Copy the raw markdown — what the assistant actually wrote, so pasting it
  // into a note or a message keeps the headings and lists.
  // The second `?.` matters: without the clipboard API (http context, old
  // WebView) the first one yields undefined and `.then` on it THROWS, so the
  // "unavailable" branch never ran and the click handler blew up instead.
  const copy = () => {
    navigator.clipboard?.writeText(text || '')?.then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => { /* clipboard unavailable */ });
  };

  return (
    <div className="col col--g4 chat-reply">
      {/* The avatar's sticky travel is bounded by THIS row, which ends with the
          answer itself — the actions below are deliberately outside it, so the
          avatar comes to rest at the bottom of the message and not at the bottom
          of the "Copy / Ask again" buttons. */}
      <div className="row row--g6">
        <div className="chat-run__av">
          <TriplanioAvatar />
        </div>
        <div className="col col--g4 grow--fit">
          <div className="row row--g4 chat-reply__who">
            <b>{TRIPLANIO_BOT_NAME}</b>
            <span className="chat-reply__tag">{t('chat.assistant_tag')}</span>
            <span className="tm">{time}</span>
          </div>

          <div className={'chat-reply__card' + (clamped ? ' is-clamped' : '')}>
            {/* CLAMP_H is the single source: it both measures the overflow and
                clips the text. The CSS only owns `overflow: hidden`. */}
            <div ref={textRef} className="chat-reply__text" style={clamped ? { maxHeight: CLAMP_H } : undefined}>
              <ChatMarkdown text={text} linkClassName="cm-a cm-a--brand" />
            </div>
            {overflows && (
              <button type="button" className="chat-reply__more" onClick={() => setExpanded((v) => !v)}>
                <span>{expanded ? t('chat.reply_less') : t('chat.reply_more')}</span>
                <Icon name="chev" size={13} style={{ transform: expanded ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="row row--g1 row--wrap chat-reply__acts">
        <Btn variant="ghost" icon={copied ? 'check' : 'copy'} onClick={copy}>
          {copied ? t('common.copied') : t('common.copy')}
        </Btn>
        {onAsk && (
          <Btn variant="ghost" icon="chat" onClick={onAsk}>{t('chat.reply_ask')}</Btn>
        )}
      </div>
    </div>
  );
}
