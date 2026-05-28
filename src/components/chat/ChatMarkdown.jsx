import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { TRIPLANIO_MENTION_REGEX } from '@/lib/triplanio';

/**
 * Renders chat message text as GitHub-Flavored Markdown.
 *
 * @Triplanio mentions are highlighted bold + var(--ai) color by default.
 * Callers can override via `mentionStyle` (e.g. white for isMine bubbles).
 */

const MENTION_SENTINEL = 'XXTRIPLANIOMENTIONXX';

function wrapMentions(text) {
  if (!text) return '';
  const re = new RegExp(TRIPLANIO_MENTION_REGEX.source, 'gi');
  return text.replace(re, (full, lead) => `${lead || ''}${MENTION_SENTINEL}`);
}

function replaceSentinelInChildren(children, mentionStyle, mentionClassName) {
  return React.Children.map(children, (child, idx) => {
    if (typeof child === 'string') {
      if (!child.includes(MENTION_SENTINEL)) return child;
      const parts = child.split(MENTION_SENTINEL);
      const out = [];
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) out.push(parts[i]);
        if (i < parts.length - 1) {
          out.push(
            <span
              key={`m-${idx}-${i}`}
              className={mentionClassName}
              style={mentionStyle}
            >@Triplanio</span>,
          );
        }
      }
      return <React.Fragment key={`f-${idx}`}>{out}</React.Fragment>;
    }
    if (React.isValidElement(child) && child.props?.children != null) {
      return React.cloneElement(
        child,
        { key: child.key ?? `c-${idx}` },
        replaceSentinelInChildren(child.props.children, mentionStyle, mentionClassName),
      );
    }
    return child;
  });
}

export default function ChatMarkdown({
  text,
  mentionStyle    = { color: 'var(--ai)', fontWeight: 700 },
  mentionClassName = '',
  linkClassName   = 'underline',
}) {
  const source = useMemo(() => wrapMentions(text || ''), [text]);

  const rep = (children) => replaceSentinelInChildren(children, mentionStyle, mentionClassName);

  const components = useMemo(() => ({
    p:          ({ children }) => <p className="m-0 break-words">{rep(children)}</p>,
    a:          ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        {rep(children)}
      </a>
    ),
    code:       ({ inline, children, className }) => (
      inline
        ? <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[0.85em] font-mono">{children}</code>
        : <pre className="my-1 p-2 rounded bg-black/10 dark:bg-white/10 overflow-x-auto"><code className={className}>{children}</code></pre>
    ),
    ul:         ({ children }) => <ul className="list-disc ml-5 my-1 space-y-0.5">{rep(children)}</ul>,
    ol:         ({ children }) => <ol className="list-decimal ml-5 my-1 space-y-0.5">{rep(children)}</ol>,
    li:         ({ children }) => <li className="m-0">{rep(children)}</li>,
    h1:         ({ children }) => <div className="font-semibold text-base mt-1 mb-0.5">{rep(children)}</div>,
    h2:         ({ children }) => <div className="font-semibold text-base mt-1 mb-0.5">{rep(children)}</div>,
    h3:         ({ children }) => <div className="font-semibold text-sm mt-1 mb-0.5">{rep(children)}</div>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-current/30 pl-2 my-1 opacity-80">{rep(children)}</blockquote>
    ),
    strong: ({ children }) => <strong>{rep(children)}</strong>,
    em:     ({ children }) => <em>{rep(children)}</em>,
    del:    ({ children }) => <del>{rep(children)}</del>,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [mentionStyle, mentionClassName, linkClassName]);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
      {source}
    </ReactMarkdown>
  );
}
