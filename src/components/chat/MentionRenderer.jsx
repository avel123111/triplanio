import React from 'react';
import { TRIPLANIO_MENTION_REGEX } from '@/lib/triplanio';

/**
 * Renders a chat message text, highlighting every "@Triplanio" mention as
 * bold primary-colored inline span. Everything else is rendered as plain text
 * preserving whitespace (parent uses whitespace-pre-wrap).
 */
export default function MentionRenderer({ text, mentionClassName = 'font-bold text-primary' }) {
  if (!text) return null;

  // Build segments by walking through the regex matches.
  const segments = [];
  const re = new RegExp(TRIPLANIO_MENTION_REGEX.source, 'gi');
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const fullStart = match.index;
    const lead = match[1] || '';
    const mentionStart = fullStart + lead.length;
    const mentionEnd = mentionStart + '@Triplanio'.length;

    // Plain text up to (and including) the leading delimiter.
    if (mentionStart > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, mentionStart) });
    }
    segments.push({ type: 'mention', value: text.slice(mentionStart, mentionEnd) });
    lastIndex = mentionEnd;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return (
    <>
      {segments.map((s, i) =>
        s.type === 'mention' ? (
          <span key={i} className={mentionClassName}>{s.value}</span>
        ) : (
          <React.Fragment key={i}>{s.value}</React.Fragment>
        )
      )}
    </>
  );
}