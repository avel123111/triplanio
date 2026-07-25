// Constants for the Triplanio AI assistant - the only bot mentionable in the trip chat.

// The bot's user_id (uuid) in public.users - per-environment, injected via env.
export const TRIPLANIO_BOT_USER_ID = import.meta.env.VITE_TRIPLANIO_BOT_USER_ID || '';
export const TRIPLANIO_BOT_NAME = 'Triplanio';

// Matches @Triplanio at the start or after whitespace/punctuation, with no word
// character following, so "@TriplanioX" is not treated as a mention. Used by the
// bubble renderer (ChatMarkdown) to HIGHLIGHT the mention.
export const TRIPLANIO_MENTION_REGEX = /(^|[\s.,!?;:()[\]{}"'<>])@Triplanio(?=$|[\s.,!?;:()[\]{}"'<>])/gi;

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
