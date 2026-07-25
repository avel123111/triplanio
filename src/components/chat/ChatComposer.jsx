import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/design/icons';
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
 * Ref API: focus() and insertMention() — the lens's "Ask again" action seeds the
 * field from outside.
 *
 * Props:
 *   onSend(text)  send a non-empty message
 *   disabled      chat not ready / send in flight
 *   placeholder   field placeholder
 *   isThinking    show the "Triplanio печатает" pill above the field
 *   jump          optional node next to it ("new messages" pill in the lens)
 *   withHint      show the Enter / Shift+Enter pills (desktop lens only)
 *   maxHeight     auto-grow ceiling in px
 */
const ChatComposer = forwardRef(function ChatComposer(
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
  const insertMention = (handle = TRIPLANIO_BOT_NAME) => {
    setText((prev) => (/@(\w*)$/.test(prev)
      ? prev.replace(/@(\w*)$/, '@' + handle + ' ')
      : (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + '@' + handle + ' '));
    setShowMention(false);
    taRef.current?.focus();
  };

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    insertMention,
  }));

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
      <div className="chat-composer__in">
        {(isThinking || jump) && (
          <div className="chat-overline">
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
              className="chat-mention__row"
            >
              <TriplanioAvatar />
              <span style={{ flex: 1 }}>
                <b>{TRIPLANIO_BOT_NAME}</b>
                <span>{t('chat.mention_all_hint')}</span>
              </span>
            </button>
          </div>
        )}

        <div className="chat-composer__row">
          {/* Calling the assistant used to be discoverable only by typing "@". */}
          <button
            type="button"
            className="chat-at"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertMention()}
            title={t('chat.mention_all_hint')}
            aria-label={t('chat.mention')}
          >
            <Icon name="at" size={18} />
          </button>

          <div className="chat-composer__field">
            {/* Overlay (visible) sits BEHIND a transparent-text textarea: the
                overlay renders the text with @Triplanio tinted, the textarea
                shows only the caret. Both layers MUST keep identical metrics or
                the caret drifts — see memory/triplanio-chat-caret-drift. */}
            <div
              ref={ovRef}
              aria-hidden="true"
              className="chat-ov"
              dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
            />
            <textarea
              ref={taRef}
              className="chat-ta"
              placeholder={placeholder}
              value={text}
              rows={1}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                // Popup on a trailing @token at the start or after whitespace.
                setShowMention(/(^|\s)@(\w*)$/.test(v));
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              style={{ maxHeight }}
            />
          </div>

          <button
            type="button"
            className="chat-send"
            /* Don't let the button take focus: on phones that collapses the
               keyboard between messages. */
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
            disabled={disabled || !text.trim()}
            aria-label={t('chat.send')}
          >
            <Icon name="send" size={17} />
          </button>
        </div>

        {withHint && (
          /* Keys render as <kbd> pills; "Enter"/"Shift" are key names, not copy. */
          <div className="chat-composer__hint">
            <span><kbd>Enter</kbd> {t('chat.hint_send')}</span> {/* i18n-ignore: key name */}
            <span>·</span>
            <span><kbd>Shift</kbd>+<kbd>Enter</kbd> {t('chat.hint_newline')}</span> {/* i18n-ignore: key names */}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatComposer;
