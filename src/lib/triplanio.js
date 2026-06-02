// Constants for the Triplanio AI assistant - the only bot mentionable in the trip chat.
//
// MENTION: matches "@Triplanio" as a whole token (case-insensitive). We use a
// strict regex (no leading word-char, terminates at end / whitespace / common
// punctuation) so we don't accidentally highlight things like "@TriplanioX".
//
// BOT_EMAIL is the synthetic author email used when Triplanio writes into the
// chat. It does NOT correspond to a real Base44 user - we render the bot
// avatar/name based on this sentinel in ChatMessageBubble.

export const TRIPLANIO_BOT_EMAIL = 'info@triplanio.com';
// The bot's user_id (uuid) in public.users - per-environment, injected via env.
export const TRIPLANIO_BOT_USER_ID = import.meta.env.VITE_TRIPLANIO_BOT_USER_ID || '';
export const TRIPLANIO_BOT_NAME = 'Triplanio';
export const TRIPLANIO_MENTION = '@Triplanio';

// Matches @Triplanio at the start or after whitespace/punctuation, with no
// word character following. Used by the chat composer & bubble renderer.
export const TRIPLANIO_MENTION_REGEX = /(^|[\s.,!?;:()[\]{}"'<>])@Triplanio(?=$|[\s.,!?;:()[\]{}"'<>])/gi;

/** Returns true if the message text mentions Triplanio. */
export function mentionsTriplanio(text) {
  if (!text) return false;
  // Reset lastIndex because the regex is /g.
  TRIPLANIO_MENTION_REGEX.lastIndex = 0;
  return TRIPLANIO_MENTION_REGEX.test(text);
}

/** Returns true if the message STARTS with @Triplanio (used to trigger the webhook). */
export function startsWithTriplanioMention(text) {
  if (!text) return false;
  return /^@Triplanio(\b|$|[\s.,!?;:])/i.test(text.trim());
}