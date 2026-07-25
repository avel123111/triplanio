import React, { memo } from 'react';
import { Avatar, Btn } from '@/design/index';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { getActiveLocale } from '@/lib/i18n/format';
import { TRIPLANIO_BOT_USER_ID } from '@/lib/triplanio';
import { aiRunFailed } from '@/lib/chat';
import { resolveAuthor } from '@/lib/resolveAuthor';
import ChatMarkdown from './ChatMarkdown';
import ChatReply from './ChatReply';

/**
 * The message list — ONE implementation for the chat lens and the floating
 * widget. The widget used to carry its own copy of the bubble markup, its own
 * grouping arithmetic and its own time formatter (hardcoded to the 'ru' locale,
 * so en/es users saw Russian-formatted times), and it resolved author names with
 * a local helper instead of the shared resolver — which meant a member who had
 * left the trip showed up as "?" there but by name in the lens.
 *
 * The shells keep what genuinely differs: their own scroll container, empty
 * state and header.
 *
 * Props:
 *   messages          rows, oldest → newest
 *   selfUser          the viewer (identity + fallback name)
 *   profiles, members author resolution inputs
 *   withDateDividers  lens shows day separators; the widget's short list does not
 *   onRetry(msg)      re-send a failed row (lens only)
 *   onAsk()           seed the composer with a mention (lens only)
 */

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(getActiveLocale(), { day: 'numeric', month: 'long' }); }
  catch { return ''; }
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// A run = consecutive messages from one author on one day. The NAME row opens it
// and the avatar (or, for own messages, the timestamp) closes it.
function sameRun(a, b) {
  return !!a && !!b && a.user_id === b.user_id && isSameDay(a.created_at, b.created_at);
}

// A refused / failed assistant run explains itself in the reader's language: the
// edge function used to POST its refusal into the chat as a message from the bot
// (with its own ru/en/es table), i.e. it faked an assistant reply to clear a UI
// indicator. Now it writes a machine code on the row and the copy lives here.
const AI_ERROR_KEY = {
  PRO_REQUIRED: 'chat.ai_err_pro',
  RATE_LIMITED: 'chat.ai_err_rate',
};

// ─── Msg ──────────────────────────────────────────────────────────────────────
// Human messages only — the assistant renders through ChatReply.
function Msg({ who, isMe, text, time, grouped, lastOfRun, avatarUrl, isDeleted, pending, failed, aiErrorKey, onRetry, t }) {
  const bubbleMod = isMe ? 'chat-bubble--me' : 'chat-bubble--them';
  // One foot row, two reasons: the message never left (failed), or the ANSWER
  // never came (aiErrorKey). Same markup, so both read as one pattern.
  const footKey = failed ? 'chat.not_sent' : aiErrorKey;

  return (
    <div className={'chat-row' + (isMe ? ' chat-row--me' : '') + (grouped ? ' chat-row--grouped' : '')}>
      {!isMe && (
        <div className="chat-row__sp">
          {lastOfRun && <Avatar name={who} photo={avatarUrl || ''} deleted={isDeleted} />}
        </div>
      )}
      <div className="chat-col">
        {!grouped && !isMe && (
          <div className="chat-name">
            <b>{who}</b>
            <span className="tm">{time}</span>
          </div>
        )}
        <div className={'chat-bubble ' + bubbleMod + (pending ? ' chat-bubble--pending' : '')}>
          <ChatMarkdown
            text={text}
            /* Mention colour lives in CSS: it depends on the bubble AND the theme
               (in dark the own-bubble is light blue with dark text). */
            mentionStyle={null}
            mentionClassName="chat-men"
            linkClassName={isMe ? 'cm-a' : 'cm-a cm-a--brand'}
          />
        </div>
        {footKey ? (
          <div className="chat-row__foot">
            <span className="chat-row__err">
              <Icon name="warning" size={12} />
              {t(footKey)}
            </span>
            <Btn variant="ghost" size="sm" onClick={onRetry}>{t('sys.retry')}</Btn>
          </div>
        ) : isMe && lastOfRun && (
          <div className="chat-time">{time}</div>
        )}
      </div>
    </div>
  );
}

// ─── ChatStream ───────────────────────────────────────────────────────────────
// memo: the composer lives in the same shell, so a keystroke re-renders the
// parent. Without this every bubble would rebuild on every character typed —
// that was the original typing lag.
function ChatStream({ messages = [], selfUser, profiles, members, withDateDividers = false, onRetry, onAsk }) {
  const { t } = useI18n();
  const rows = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    if (withDateDividers && !isSameDay(m.created_at, prev?.created_at)) {
      rows.push(<div key={'div-' + m.id} className="chat-daydiv"><span>{fmtDate(m.created_at)}</span></div>);
    }

    // The assistant answers as a document, not a bubble.
    if (m.user_id === TRIPLANIO_BOT_USER_ID) {
      rows.push(<ChatReply key={m.id} text={m.text || ''} time={fmtTime(m.created_at)} onAsk={onAsk} />);
      continue;
    }

    // Shared resolver: falls back to the row's user_full_name snapshot, so an
    // author who has LEFT the trip still shows their name.
    const author = resolveAuthor({
      userId: m.user_id,
      nameSnapshot: m.user_full_name,
      profiles,
      members,
      selfUser,
      deletedLabel: t('common.deleted_user'),
    });

    rows.push(
      <Msg
        key={m.id}
        who={author.name}
        isMe={m.user_id === selfUser?.id}
        text={m.text || ''}
        time={fmtTime(m.created_at)}
        grouped={sameRun(prev, m)}
        lastOfRun={!sameRun(m, messages[i + 1])}
        avatarUrl={author.photo}
        isDeleted={author.deleted}
        pending={m.__pending}
        failed={m.__failed}
        aiErrorKey={aiRunFailed(m) ? (AI_ERROR_KEY[m.ai_error] || 'chat.ai_failed') : null}
        onRetry={onRetry ? () => onRetry(m) : undefined}
        t={t}
      />,
    );
  }

  return rows;
}

export default memo(ChatStream);
