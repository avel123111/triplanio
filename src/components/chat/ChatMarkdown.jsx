import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { TRIPLANIO_MENTION_REGEX } from '@/lib/triplanio';

/**
 * Renders chat message text as GitHub-Flavored Markdown:
 *   **bold**, *italic*, ~~strikethrough~~, `inline code`, [links](url),
 *   autolinks (https://...), code blocks.
 *
 * Underline is intentionally NOT supported (not part of standard markdown).
 *
 * Single newlines (\n) are turned into <br/> via remark-breaks so the chat
 * behaves like Telegram/Slack rather than CommonMark (which collapses single
 * newlines into a space).
 *
 * Additionally highlights every "@Triplanio" mention as bold/primary-colored
 * inline span. Mentions are wrapped BEFORE markdown parsing by replacing them
 * with an ASCII sentinel ("XXTRIPLANIOMENTIONXX") that markdown does NOT
 * interpret, and then substituted back via a custom `text` renderer. ASCII
 * (instead of unicode private-use codepoints U+E000/U+E001) prevents Chrome
 * from rendering ".notdef" tofu boxes when a glyph happens to leak into the
 * DOM during streaming/markdown edge cases.
 */

const MENTION_SENTINEL = 'XXTRIPLANIOMENTIONXX';

function wrapMentions(text) {
  if (!text) return '';
  const re = new RegExp(TRIPLANIO_MENTION_REGEX.source, 'gi');
  // Keep the leading delimiter (start-of-string or whitespace) intact.
  return text.replace(re, (full, lead) => `${lead || ''}${MENTION_SENTINEL}`);
}

/** Recursively walks React children and replaces every occurrence of the
 *  sentinel inside string nodes with a styled @Triplanio span. Used because
 *  react-markdown v9 no longer routes leaf text through a custom `text`
 *  component — we have to post-process the rendered children tree of every
 *  block-level component (p, li, h*, blockquote, ...). */
function replaceSentinelInChildren(children, mentionClassName) {
  return React.Children.map(children, (child, idx) => {
    if (typeof child === 'string') {
      if (!child.includes(MENTION_SENTINEL)) return child;
      const parts = child.split(MENTION_SENTINEL);
      const out = [];
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) out.push(parts[i]);
        if (i < parts.length - 1) {
          out.push(
            <span key={`m-${idx}-${i}`} className={mentionClassName}>@Triplanio</span>,
          );
        }
      }
      return <React.Fragment key={`f-${idx}`}>{out}</React.Fragment>;
    }
    if (React.isValidElement(child) && child.props?.children != null) {
      return React.cloneElement(
        child,
        { key: child.key ?? `c-${idx}` },
        replaceSentinelInChildren(child.props.children, mentionClassName),
      );
    }
    return child;
  });
}

export default function ChatMarkdown({
  text,
  mentionClassName = 'font-bold text-primary',
  linkClassName = 'underline',
}) {
  const source = useMemo(() => wrapMentions(text || ''), [text]);

  // Compact components — chat bubbles are tight, paragraphs should not get
  // huge default margins. We also force links to open in a new tab.
  // Every block-level renderer post-processes its children to swap the
  // mention sentinel for a styled @Triplanio span (react-markdown v9 no
  // longer exposes a `text` component hook for leaf text nodes).
  const rep = (children) => replaceSentinelInChildren(children, mentionClassName);
  const components = useMemo(() => ({
    p: ({ children }) => <p className="m-0 break-words">{rep(children)}</p>,
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        {rep(children)}
      </a>
    ),
    code: ({ inline, children, className }) => (
      inline
        ? <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[0.85em] font-mono">{children}</code>
        : <pre className="my-1 p-2 rounded bg-black/10 dark:bg-white/10 overflow-x-auto"><code className={className}>{children}</code></pre>
    ),
    ul: ({ children }) => <ul className="list-disc ml-5 my-1 space-y-0.5">{rep(children)}</ul>,
    ol: ({ children }) => <ol className="list-decimal ml-5 my-1 space-y-0.5">{rep(children)}</ol>,
    li: ({ children }) => <li className="m-0">{rep(children)}</li>,
    h1: ({ children }) => <div className="font-semibold text-base mt-1 mb-0.5">{rep(children)}</div>,
    h2: ({ children }) => <div className="font-semibold text-base mt-1 mb-0.5">{rep(children)}</div>,
    h3: ({ children }) => <div className="font-semibold text-sm mt-1 mb-0.5">{rep(children)}</div>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-current/30 pl-2 my-1 opacity-80">{rep(children)}</blockquote>
    ),
    strong: ({ children }) => <strong>{rep(children)}</strong>,
    em: ({ children }) => <em>{rep(children)}</em>,
    del: ({ children }) => <del>{rep(children)}</del>,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [mentionClassName, linkClassName]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
}