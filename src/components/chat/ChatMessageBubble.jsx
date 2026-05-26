import React from 'react';
import { DateTime } from 'luxon';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import UserAvatar from '@/components/UserAvatar';
import TriplanioAvatar from './TriplanioAvatar.jsx';
import ChatMarkdown from './ChatMarkdown';
import { TRIPLANIO_BOT_EMAIL, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';

/**
 * Single chat message bubble. Right-aligned + brand color for own messages,
 * left-aligned + card color for others. Incoming messages show the author's
 * avatar bottom-aligned with the bubble; the avatar is hidden for consecutive
 * messages from the same author (a spacer keeps bubbles aligned).
 *
 * Special-case: messages authored by the Triplanio AI bot
 * (user_email === TRIPLANIO_BOT_EMAIL) show the blue robot avatar and the
 * fixed display name "Triplanio".
 *
 * @Triplanio mentions in the message text are rendered bold/primary by
 * MentionRenderer.
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
  const time = DateTime.fromISO(message.created_date)
    .setLocale(locale)
    .toFormat('HH:mm');

  const isBot = message.user_email === TRIPLANIO_BOT_EMAIL;
  const displayName = isBot
    ? TRIPLANIO_BOT_NAME
    : (authorName || message.user_full_name || message.user_email || '');

  return (
    <div className={`flex gap-2 items-end ${isMine ? 'justify-end' : 'justify-start'}`}>
      {/* Avatar for incoming messages — bottom-aligned with the bubble.
          For consecutive messages we reserve the same width with a spacer so
          bubbles align nicely. */}
      {!isMine && (
        showAuthor ? (
          isBot ? (
            <TriplanioAvatar size="sm" ring={false} tripId={tripId} avatarUrl={botAvatarUrl} className="shrink-0 mb-5" />
          ) : (
            <UserAvatar
              name={displayName}
              email={message.user_email}
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
          <div className={`text-xs font-medium mb-0.5 px-1 truncate max-w-full ${isBot ? 'text-primary' : 'text-muted-foreground'}`}>
            {displayName}
          </div>
        )}
        <div
          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${
            isMine
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-card text-card-foreground border border-border rounded-bl-md'
          } ${message.__pending ? 'opacity-70' : ''}`}
        >
          {/* In own (primary-blue) bubbles the mention must read on top of the
              blue fill — render it white/bold. Elsewhere keep primary color. */}
          <ChatMarkdown
            text={message.text}
            mentionClassName={isMine ? 'font-bold text-primary-foreground' : 'font-bold text-primary'}
            linkClassName={isMine ? 'underline text-primary-foreground' : 'underline text-primary'}
          />
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 px-1">
          {time}
        </div>
      </div>
    </div>
  );
}