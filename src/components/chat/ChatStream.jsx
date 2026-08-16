// @ts-check
import React, { memo } from 'react';
import { Avatar, Btn } from '@/design/index';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { getActiveLocale } from '@/lib/i18n/format';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { aiRunFailed } from '@/lib/chat';
import { classifyError } from '@/lib/errorText';
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
// (own messages get no name) and the timestamp closes it; the avatar belongs to
// the run as a whole, not to any one message in it.
function sameRun(a, b) {
  return !!a && !!b && a.user_id === b.user_id && isSameDay(a.created_at, b.created_at);
}

// A refused / failed assistant run explains itself in the reader's language: the
// edge writes a machine code on the row (`ai_error`, e.g. PRO_REQUIRED /
// RATE_LIMITED) and the copy comes from the ONE client error map — `classifyError`
// → `err.*` — exactly like every other refusal. No chat-local table anymore.

// ─── Msg ──────────────────────────────────────────────────────────────────────
// ONE message inside a run. The author's avatar is NOT here: it belongs to the
// run (see ChatStream), so it can stay sticky across the whole block.
function Msg({ who, isMe, text, time, grouped, lastOfRun, pending, failed, aiErrorText, onRetry, t }) {
  const bubbleMod = isMe ? 'chat-bubble--me' : 'chat-bubble--them';
  // One foot row, two reasons: the message never left (failed), or the ANSWER
  // never came (aiErrorText). Same markup, so both read as one pattern.
  const footText = failed ? t('chat.not_sent') : aiErrorText;

  return (
    <div className={'col col--a-start chat-msg' + (grouped ? ' chat-msg--grouped' : '')}>
      {!grouped && !isMe && (
        <div className="row row--a-baseline row--g3 chat-name">
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
      {footText ? (
        <div className="row row--g3 chat-msg__foot">
          <span className="chat-msg__err">
            <Icon name="warning" size={12} />
            {footText}
          </span>
          <Btn variant="link" onClick={onRetry}>{t('sys.retry')}</Btn>
        </div>
      ) : isMe && lastOfRun && (
        <div className="chat-time">{time}</div>
      )}
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

  // Walk by RUN, not by message: the avatar is drawn once per run and stays
  // sticky beside it, so the messages of one author have to share a wrapper.
  let i = 0;
  while (i < messages.length) {
    const first = messages[i];

    if (withDateDividers && !isSameDay(first.created_at, messages[i - 1]?.created_at)) {
      rows.push(<div key={'div-' + first.id} className="row row--g7 chat-daydiv"><span>{fmtDate(first.created_at)}</span></div>);
    }

    // The assistant answers as a document, not a bubble.
    if (first.user_id === TRIPLANIO_BOT_USER_ID) {
      rows.push(<ChatReply key={first.id} text={first.text || ''} time={fmtTime(first.created_at)} onAsk={onAsk} />);
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < messages.length && sameRun(first, messages[end])) end += 1;
    const run = messages.slice(i, end);
    const isMe = first.user_id === selfUser?.id;

    // Shared resolver: falls back to the row's user_full_name snapshot, so an
    // author who has LEFT the trip still shows their name.
    const author = resolveAuthor({
      userId: first.user_id,
      nameSnapshot: first.user_full_name,
      profiles,
      members,
      selfUser,
      deletedLabel: t('common.deleted_user'),
      botId: TRIPLANIO_BOT_USER_ID,
      botName: TRIPLANIO_BOT_NAME,
    });

    rows.push(
      <div key={'run-' + first.id} className={'row row--a-start row--g6 chat-run' + (isMe ? ' chat-run--me' : '')}>
        {!isMe && (
          <div className="chat-run__av">
            <Avatar name={author.name} photo={author.photo || ''} deleted={author.deleted} kind={author.kind} seed={author.seed} />
          </div>
        )}
        <div className="col col--g2 chat-run__col">
          {run.map((m, k) => (
            <Msg
              key={m.id}
              who={author.name}
              isMe={isMe}
              text={m.text || ''}
              time={fmtTime(m.created_at)}
              grouped={k > 0}
              lastOfRun={k === run.length - 1}
              pending={m.__pending}
              failed={m.__failed}
              aiErrorText={aiRunFailed(m) ? classifyError(t, m.ai_error).text : null}
              onRetry={onRetry ? () => onRetry(m) : undefined}
              t={t}
            />
          ))}
        </div>
      </div>,
    );
    i = end;
  }

  return rows;
}

export default memo(ChatStream);
