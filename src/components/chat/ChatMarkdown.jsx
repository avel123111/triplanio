import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { replaceMentions } from '@/lib/mention';
import { normalizeExternalUrl } from '@/lib/booking-platforms';
import './ChatMarkdown.css';

/**
 * Renders chat message text as GitHub-Flavored Markdown.
 *
 * @Triplanio mentions are highlighted bold + var(--ai) color by default.
 * Callers can override via `mentionStyle` (e.g. white for isMine bubbles).
 */

const MENTION_SENTINEL = 'XXTRIPLANIOMENTIONXX';

function wrapMentions(text) {
  // Same rule that decides whether the assistant is called — see lib/mention.js.
  return replaceMentions(text, () => MENTION_SENTINEL);
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
  mentionStyle    = { color: 'var(--ai)', fontWeight: 700 /* design-token-exempt: inline mention emphasis */ },
  mentionClassName = '',
  linkClassName   = 'cm-a',
}) {
  const source = useMemo(() => wrapMentions(text || ''), [text]);

  const rep = (children) => replaceSentinelInChildren(children, mentionStyle, mentionClassName);

  // react-markdown has already dropped dangerous schemes, but it does NOT add a
  // missing one: "[x](google.com)" stays relative and navigates inside the app
  // (TRIP-230). Anything that already carries a scheme (mailto:, tel:, https:)
  // or is an in-page anchor is passed through untouched.
  const mdHref = (href) =>
    (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') ? href : normalizeExternalUrl(href));

  const components = useMemo(() => ({
    p:          ({ children }) => <p className="cm-p">{rep(children)}</p>,
    a:          ({ children, href }) => (
      <a href={mdHref(href)} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        {rep(children)}
      </a>
    ),
    code:       ({ inline, children, className }) => (
      inline
        ? <code className="cm-code">{children}</code>
        : <pre className="cm-pre"><code className={className}>{children}</code></pre>
    ),
    ul:         ({ children }) => <ul className="cm-ul">{rep(children)}</ul>,
    ol:         ({ children }) => <ol className="cm-ol">{rep(children)}</ol>,
    li:         ({ children }) => <li className="cm-li">{rep(children)}</li>,
    h1:         ({ children }) => <div className="cm-h">{rep(children)}</div>,
    h2:         ({ children }) => <div className="cm-h">{rep(children)}</div>,
    // h3/h4 share a level: the assistant writes its section headings as h4, which
    // previously fell through to a raw <h4> outside the typography canons.
    h3:         ({ children }) => <div className="cm-h3">{rep(children)}</div>,
    h4:         ({ children }) => <div className="cm-h3">{rep(children)}</div>,
    blockquote: ({ children }) => (
      <blockquote className="cm-quote">{rep(children)}</blockquote>
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
