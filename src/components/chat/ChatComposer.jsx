import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_MENTION_REGEX, TRIPLANIO_MENTION } from '@/lib/triplanio';
import TriplanioAvatar from './TriplanioAvatar.jsx';
import { cn } from '@/lib/utils';

const MAX_LEN = 4000;

// Shared classes for both the textarea AND the overlay div, so the overlay's
// geometry (line-height, font, padding, border) exactly matches the textarea
// and the highlighted "@Triplanio" sits pixel-perfect over the real text.
//
// font-medium is applied to BOTH layers — this keeps the textarea's caret
// glyph-for-glyph aligned with the visible overlay text (any weight mismatch
// between the two layers caused the caret to drift).
const FIELD_CLS =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-bold shadow-sm placeholder:text-muted-foreground placeholder:font-normal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none min-h-[40px] max-h-32 leading-relaxed whitespace-pre-wrap break-words';

/**
 * Bottom composer for the chat tab. Sends on Cmd/Ctrl+Enter or button click.
 *
 * Adds @-mention support for the Triplanio AI assistant:
 *   - Typing "@" (at start or after whitespace) opens a popup with "@Triplanio".
 *   - Every "@Triplanio" in the message is rendered bold/primary via an
 *     overlay div sitting BEHIND a textarea whose text is rendered transparent
 *     (only the caret stays visible). This way there's no double-rendering of
 *     glyphs and the overlay tracks the textarea perfectly.
 */
export default function ChatComposer({ onSend, disabled, sending, tripId, botAvatarUrl }) {
  const t = useT();
  const [text, setText] = useState('');
  const [showMention, setShowMention] = useState(false);
  // Position of the active "@" — we replace from this index up to caret when
  // the user picks the suggestion.
  const [mentionAnchor, setMentionAnchor] = useState(null);
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LEN && !sending && !disabled;

  // ----- mention popup detection -----
  function recomputeMentionState(value, caretPos) {
    if (caretPos == null || !value) {
      setShowMention(false);
      setMentionAnchor(null);
      return;
    }
    // Scan backward from caret. Stop on "@" — show popup; stop on whitespace —
    // no popup.
    let i = caretPos - 1;
    while (i >= 0) {
      const ch = value[i];
      if (ch === '@') break;
      if (/\s/.test(ch)) { i = -1; break; }
      i -= 1;
    }
    if (i < 0 || value[i] !== '@') {
      setShowMention(false);
      setMentionAnchor(null);
      return;
    }
    // "@" must be at start-of-text or right after whitespace.
    if (i > 0 && !/\s/.test(value[i - 1])) {
      setShowMention(false);
      setMentionAnchor(null);
      return;
    }
    const token = value.slice(i + 1, caretPos);
    if (token === '' || 'triplanio'.startsWith(token.toLowerCase())) {
      setMentionAnchor(i);
      setShowMention(true);
    } else {
      setShowMention(false);
      setMentionAnchor(null);
    }
  }

  function readCaret() {
    return textareaRef.current?.selectionStart ?? null;
  }

  function handleChange(e) {
    const value = e.target.value;
    setText(value);
    // Defer one tick so selectionStart reflects the new caret position.
    requestAnimationFrame(() => recomputeMentionState(value, readCaret()));
  }
  function handleKeyUp() {
    recomputeMentionState(text, readCaret());
  }
  function handleClick() {
    recomputeMentionState(text, readCaret());
  }
  function handleBlur() {
    setTimeout(() => setShowMention(false), 120);
  }

  function insertMention() {
    if (mentionAnchor == null) return;
    const before = text.slice(0, mentionAnchor);
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const after = text.slice(caret);
    const inserted = TRIPLANIO_MENTION + ' ';
    const next = before + inserted + after;
    setText(next);
    setShowMention(false);
    setMentionAnchor(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = (before + inserted).length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  const handleSend = async () => {
    if (!canSend) return;
    const value = trimmed.slice(0, MAX_LEN);
    setText('');
    setShowMention(false);
    try {
      await onSend(value);
    } catch {
      // Restore draft on transient errors.
      setText(value);
    }
  };

  const handleKeyDown = (e) => {
    if (showMention && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      insertMention();
      return;
    }
    if (showMention && e.key === 'Escape') {
      e.preventDefault();
      setShowMention(false);
      return;
    }
    // Enter sends; Shift+Enter inserts a newline (also Cmd/Ctrl+Enter still
    // works as a power-user shortcut).
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // Keep overlay scroll in sync with textarea scroll (when content overflows).
  useEffect(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return undefined;
    const sync = () => { ov.scrollTop = ta.scrollTop; ov.scrollLeft = ta.scrollLeft; };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, []);

  // Overlay content: same text, with @Triplanio wrapped in a styled span.
  const overlayNodes = useMemo(() => {
    if (!text) return null;
    const re = new RegExp(TRIPLANIO_MENTION_REGEX.source, 'gi');
    const out = [];
    let lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lead = m[1] || '';
      const start = m.index + lead.length;
      const end = start + '@Triplanio'.length;
      if (start > lastIndex) out.push(text.slice(lastIndex, start));
      // Both overlay AND textarea share the same `font-medium` weight (set on
      // FIELD_CLS) so the caret stays glyph-for-glyph aligned. We highlight
      // @Triplanio with the primary color only (no weight change) — making
      // the whole textarea font-medium already provides the "bold-ish" look
      // the user expects without introducing per-glyph width differences.
      out.push(
        <span key={start} style={{ color: 'var(--ai)' }}>{text.slice(start, end)}</span>
      );
      lastIndex = end;
    }
    if (lastIndex < text.length) out.push(text.slice(lastIndex));
    return out;
  }, [text]);

  return (
    <div className="border-t bg-card p-2 sm:p-3 relative">
      {showMention && (
        <div className="absolute bottom-[calc(100%-4px)] left-2 sm:left-3 z-20 mb-1 w-64 bg-popover border rounded-lg shadow-pop overflow-hidden">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); insertMention(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent text-left"
          >
            <TriplanioAvatar size="md" ring={false} tripId={tripId} avatarUrl={botAvatarUrl} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-primary">@Triplanio</div>
              <div className="text-xs text-muted-foreground truncate">
                {t('chat.mention_triplanio_hint')}
              </div>
            </div>
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          {/* Overlay sits BEHIND the textarea (same classes → identical box).
              Borders are transparent so only the textarea's border is visible. */}
          <div
            ref={overlayRef}
            aria-hidden
            className={cn(FIELD_CLS, 'absolute inset-0 pointer-events-none border-transparent overflow-hidden text-foreground')}
          >
            {overlayNodes}
            {/* Zero-width char keeps the last line height correct when text ends with \n */}
            {'\u200B'}
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyUp={handleKeyUp}
            onClick={handleClick}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
            disabled={disabled}
            className={cn(FIELD_CLS, 'relative bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground')}
          />
        </div>
        <Button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          size="icon"
          aria-label={t('chat.send')}
          className="shrink-0"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}