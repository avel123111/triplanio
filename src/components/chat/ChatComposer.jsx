// @ts-check
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { IconBtn } from '@/design/index';
import { InputGroup } from '@/design/Input';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { highlightMentions } from '@/lib/mention';
import TriplanioAvatar from './TriplanioAvatar';

/**
 * The message composer — ONE implementation for the chat lens and the floating
 * widget. Both used to carry their own copy of the mention popover, the "@"
 * button, the overlay/textarea pair, the auto-grow effect and applyMention, so a
 * fix (the caret drift, the dead "@" button) had to be made twice or it silently
 * only landed on one surface.
 *
 * Owns its own text: the shell only receives finished messages via onSend.
 *
 * Ref API: insertMention() — the "Ask again" action of an assistant answer seeds
 * the field from outside, on both surfaces.
 *
 * Props:
 *   onSend(text)  send a non-empty message
 *   disabled      chat not ready / send in flight
 *   placeholder   field placeholder
 *   isThinking    show the "Triplanio печатает" pill above the field
 *   jump          optional node next to it ("new messages" pill in the lens)
 *   withHint      show the Shift+Enter / Enter pills (desktop lens only)
 *   maxHeight     auto-grow ceiling in px
 */
// ⚠️ Аннотация стоит НА ПАРАМЕТРЕ: у `forwardRef` функция - это АРГУМЕНТ.
// Без неё TS выводит тип из деструктуризации и запечатывает набор ДО
// `RefAttributes`, то есть у вызывающего под `// @ts-check` краснеет КАЖДЫЙ
// проп (`onSend does not exist`) - долг, невидимый при `checkJs:false` и
// вскрывшийся ровно в тот момент, когда прагму поставили в `ChatWidget`.
const ChatComposer = forwardRef(
  /**
   * @param {{
   *   onSend: (text: string, retryOf?: any) => any,
   *   disabled?: boolean,
   *   placeholder?: string,
   *   isThinking?: boolean,
   *   jump?: any,
   *   withHint?: boolean,
   *   maxHeight?: number,
   * }} p
   */
  function ChatComposer(
    { onSend, disabled = false, placeholder, isThinking = false, jump = null, withHint = false, maxHeight = 132 },
    ref,
  ) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [showMention, setShowMention] = useState(false);
  const taRef = useRef(null);
  const ovRef = useRef(null);

  // Complete a trailing @token ("@", "@tri") into the full handle. When there is
  // NO trailing token — the "@" button on an empty field — INSERT the mention:
  // a bare .replace() silently no-ops there, which left the button doing nothing.
  const insertMention = () => {
    const mention = '@' + TRIPLANIO_BOT_NAME + ' ';
    setText((prev) => (/@(\w*)$/.test(prev)
      ? prev.replace(/@(\w*)$/, mention)
      : (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + mention));
    setShowMention(false);
    taRef.current?.focus();
  };

  useImperativeHandle(ref, () => ({ insertMention }));

  const send = () => {
    const content = text.trim();
    if (!content || disabled) return;
    setText('');
    setShowMention(false);
    // Keep the field focused so the mobile keyboard stays up for the next
    // message instead of collapsing after every send.
    taRef.current?.focus();
    onSend(content);
  };

  // Auto-grow to the ceiling, then scroll.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    // The placeholder can no longer make this grow: `.chat-ta:placeholder-shown`
    // keeps the hint on one line, so `scrollHeight` on an empty field is one row.
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [text, maxHeight]);

  // Keep the highlight overlay's scroll offset in lockstep with the textarea.
  useEffect(() => {
    const ta = taRef.current;
    const ov = ovRef.current;
    if (!ta || !ov) return undefined;
    const sync = () => { ov.scrollTop = ta.scrollTop; };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, []);

  return (
    <div className="chat-composer">
      <div className="col col--g4 chat-composer__in">
        {(isThinking || jump) && (
          <div className="row row--g4 chat-overline">
            {isThinking && (
              <div className="chat-thinking">
                <TriplanioAvatar size="xs" />
                <span>{t('chat.typing')}</span>
                <span className="ai-dots"><span /><span /><span /></span>
              </div>
            )}
            {jump}
          </div>
        )}
        {showMention && (
          <div className="chat-mention">
            <div className="chat-mention__lbl">{t('chat.mention')}</div>
            {/* Only @Triplanio is actionable - members aren't mentionable, so the
                popup lists just the assistant. */}
            <button
              onMouseDown={(e) => { e.preventDefault(); insertMention(); }}
              className="row chat-mention__row"
            >
              <TriplanioAvatar />
              <span className="grow">
                <b>{TRIPLANIO_BOT_NAME}</b>
                <span>{t('chat.mention_all_hint')}</span>
              </span>
            </button>
          </div>
        )}

        {/* Композер - это и есть `InputGroup`: рамка, фон и фокус-кольцо вокруг
            поля и двух кнопок, читающихся как одно поле. Свой скин он объявлял
            заново (TRIP-333 §5); за классом осталась только его дельта -
            выравнивание по низу (поле растёт вверх), свои отступы и
            «плавающая» тень дока. Радиус тоже общий с полями: приподнятость
            дока несёт тень, а не форма угла. Оверлей меншенов не тронут. */}
        <InputGroup className="chat-composer__row">
          {/* Calling the assistant used to be discoverable only by typing "@". */}
          <IconBtn
            icon="at"
            tone="ai"
            className="chat-at"
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertMention}
            title={t('chat.mention_all_hint')}
            ariaLabel={t('chat.mention')}
          />

          <div className="chat-composer__field">
            {/* Overlay (visible) sits BEHIND a transparent-text textarea: the
                overlay renders the text with @Triplanio tinted, the textarea
                shows only the caret. Both layers MUST keep identical metrics or
                the caret drifts — see memory/triplanio-chat-caret-drift. */}
            {/* The hint is drawn HERE, not by the textarea's own placeholder.
                A native placeholder is laid out by the field, so a long hint
                wrapped on a narrow screen and — since the auto-grow measures
                `scrollHeight` — opened the input to two rows before a single
                character was typed. A <div> can be truncated properly: one line
                with a real ellipsis, at any width, in any language. The textarea
                keeps the same text as its `aria-label`, which is a better label
                than a placeholder anyway. */}
            {text ? (
              <div
                ref={ovRef}
                aria-hidden="true"
                className="chat-ov"
                dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
              />
            ) : (
              <div ref={ovRef} aria-hidden="true" className="chat-ov">
                <span className="chat-ov__ph">{placeholder}</span>
              </div>
            )}
            <textarea
              ref={taRef}
              className="chat-ta"
              aria-label={placeholder}
              /* No autocomplete/inputmode tricks here: `autocomplete="off"` was
                 tried against iOS's password/card row above the keyboard and
                 changed nothing — that bar is system UI, drawn for ordinary text
                 fields whatever the field says. Only a native shell can remove
                 it (WKWebView's inputAccessoryView). */
              value={text}
              rows={1}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                // Popup on a trailing @token at the start or after whitespace.
                setShowMention(/(^|\s)@(\w*)$/.test(v));
              }}
              /* Shift+Enter sends, plain Enter breaks the line — ONE rule on
                 desktop and on a phone. A virtual keyboard's Enter is
                 indistinguishable from a physical one (same `key`, same
                 `keyCode`), so "Enter sends, but only on desktop" would have to
                 branch on the input device. On a phone the send button is the
                 way out, and `enterKeyHint` labels that key as a line break
                 instead of "Go" — the keyboard must not promise an action the
                 field won't do. */
              onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send(); } }}
              enterKeyHint="enter"
              style={{ maxHeight }}
            />
          </div>

          <IconBtn
            icon="send"
            tone="solid"
            className="chat-send"
            /* Don't let the button take focus: on phones that collapses the
               keyboard between messages. */
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
            disabled={disabled || !text.trim()}
            ariaLabel={t('chat.send')}
          />
        </InputGroup>

        {withHint && (
          /* Keys render as <kbd> pills; "Enter"/"Shift" are key names, not copy. */
          <div className="row row--g4 chat-composer__hint">
            <span><kbd>Shift</kbd>+<kbd>Enter</kbd> {t('chat.hint_send')}</span> {/* i18n-ignore: key names */}
            <span>·</span>
            <span><kbd>Enter</kbd> {t('chat.hint_newline')}</span> {/* i18n-ignore: key name */}
          </div>
        )}
      </div>
    </div>
  );
  },
);

export default ChatComposer;
