import React from 'react';
import { DateTime } from 'luxon';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import UserAvatar from '@/components/UserAvatar';
import TriplanioAvatar from './TriplanioAvatar.jsx';
import ChatMarkdown from './ChatMarkdown';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';

/**
 * Single chat message bubble. Right-aligned + brand color for own messages,
 * left-aligned + ai-soft for bot messages, left-aligned + wash for others.
 *
 * Incoming messages show the author's avatar bottom-aligned with the bubble;
 * the avatar is hidden for consecutive messages from the same author.
 */
export default function ChatMessageBubble({
  message,
  isMine,
  showAuthor,
  authorName,
  authorAvatarUrl,
  tripId,
  botAvatarUrl,
}) {
  const { locale } = useI18nFormat();
  const rawTs = message.created_at || message.created_date;
  const time  = rawTs
    ? DateTime.fromISO(rawTs).setLocale(locale).toFormat('HH:mm')
    : '';

  const isBot     = message.user_id === TRIPLANIO_BOT_USER_ID;
  const displayNm = isBot
    ? TRIPLANIO_BOT_NAME
    : (authorName || message.user_full_name || '');

  // Bubble styles
  const bubbleCls = isMine
    ? 'rounded-2xl rounded-br-[4px]'
    : 'rounded-2xl rounded-bl-[4px]';
  const bubbleStyle = isMine
    ? { background: 'var(--brand)', color: '#fff' }
    : isBot
      ? { background: 'var(--ai-soft)', color: 'var(--ink)', border: '1px solid var(--ai-soft-12)' }
      : { background: 'var(--wash)', color: 'var(--ink)', border: '1px solid var(--line-2)' };

  const mentionStyle = isMine
    ? { color: 'rgba(255,255,255,0.9)', fontWeight: 700 }
    : { color: 'var(--ai)', fontWeight: 700 };

  const linkClassName = isMine ? 'underline opacity-80' : 'underline text-primary';

  return (
    <div className={`flex gap-2 items-end ${isMine ? 'justify-end' : 'justify-start'}`}>
      {!isMine && (
        showAuthor ? (
          isBot ? (
            <TriplanioAvatar size="sm" ring={false} tripId={tripId} avatarUrl={botAvatarUrl} className="shrink-0 mb-5" />
          ) : (
            <UserAvatar
              name={displayNm}
              avatarUrl={authorAvatarUrl}
              size="sm"
              ring={false}
              className="shrink-0 mb-5"
            />
          )
        ) : (
          <div className="w-7 shrink-0" aria-hidden />
        )
      )}
      <div className={`max-w-[80%] sm:max-w-[70%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isMine && showAuthor && (
          <div className={`text-xs font-medium mb-0.5 px-1 truncate max-w-full`} style={{ color: isBot ? 'var(--ai)' : 'var(--muted-foreground)' }}>
            {displayNm}
          </div>
        )}
        <div
          className={`px-3 py-2 text-sm leading-relaxed break-words ${bubbleCls} ${message.__pending ? 'opacity-70' : ''}`}
          style={bubbleStyle}
        >
          <ChatMarkdown
            text={message.text}
            mentionStyle={mentionStyle}
            linkClassName={linkClassName}
          />
        </div>
        <div className="text-[10px] mt-0.5 px-1" style={{ color: 'var(--muted)' }}>
          {time}
        </div>
      </div>
    </div>
  );
}
