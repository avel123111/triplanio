// The ONE rule for RENDERING "@Triplanio" as a mention.
//
// It used to exist in three variants: a strict regex for highlighting a sent
// message, and a loose /@triplanio\b/i for the composer overlay and for deciding
// whether to call the assistant. They disagreed on the leading boundary, so
// "pavel@triplanio" fired the paid LLM call while showing no mention at all.
//
// Deciding whether to CALL the assistant is no longer here at all: that call is
// paid and the client must not make it, so it moved to the server as
// public.mentions_assistant (TRIP-296). What is left is presentation — the
// composer overlay and the message bubbles.
//
// Dependency-free on purpose (same convention as chat-merge.js) so `node --test`
// can exercise it. Env-bound bot identity lives in triplanio.js instead.

// Boundary = start/end of text, whitespace or common punctuation. "@TriplanioX"
// and "mail@triplanio" are therefore NOT mentions.
const EDGE = "[\\s.,!?;:()\\[\\]{}\"'<>]";
const MENTION_RE_SOURCE = `(^|${EDGE})@Triplanio(?=$|${EDGE})`;

// A fresh RegExp per call: a shared /g literal carries `lastIndex` between calls,
// so `.test()` on it returns alternating answers for the same input.
const re = (flags) => new RegExp(MENTION_RE_SOURCE, flags);

/** Replace every mention via `render(matchedText)`, keeping the leading char. */
export function replaceMentions(text, render) {
  return (text || '').replace(re('gi'), (full, lead) =>
    `${lead || ''}${render(full.slice((lead || '').length))}`);
}

/**
 * HTML for the composer's highlight overlay: escaped user input with the mention
 * tinted. Shared by the chat lens and the widget.
 *
 * The mention must look bold WITHOUT a font-weight change: a heavier weight
 * widens the glyph run, so the textarea (normal weight, and the thing that
 * actually drives the caret) and this overlay drift apart. -webkit-text-stroke
 * thickens the strokes while keeping advance width identical.
 */
export function highlightMentions(val) {
  const escaped = (val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return replaceMentions(escaped, (m) =>
    `<span style="color:var(--ai);-webkit-text-stroke:0.7px var(--ai)">${m}</span>`);
}
