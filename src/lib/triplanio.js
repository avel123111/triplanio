// Constants for the Triplanio AI assistant - the only bot mentionable in the trip chat.
//
// MENTION: matches "@Triplanio" as a whole token (case-insensitive). We use a
// strict regex (no leading word-char, terminates at end / whitespace / common
// punctuation) so we don't accidentally highlight things like "@TriplanioX".
//
// BOT_EMAIL is the synthetic author email used when Triplanio writes into the
// chat. It does NOT correspond to a real auth user - we render the bot
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

/**
 * HTML for the composer's highlight overlay: escaped user input with @triplanio
 * tinted. Shared by the chat lens and the widget — it used to be copy-pasted in
 * both, and the caret fix below only ever landed once per copy.
 *
 * The mention must look bold WITHOUT a font-weight change: a heavier weight
 * widens the glyph run, so the textarea (normal weight, and the thing that
 * actually drives the caret) and this overlay drift apart. -webkit-text-stroke
 * thickens the strokes while keeping advance width identical.
 */
export function highlightMentions(val) {
  return (val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
    .replace(/@triplanio\b/gi, '<span style="color:var(--ai);-webkit-text-stroke:0.7px var(--ai)">$&</span>');
}
