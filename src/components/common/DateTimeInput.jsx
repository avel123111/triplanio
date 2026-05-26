import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * Wrapper around <input type="datetime-local"> that reliably detects the
 * "user typed a date but no time" case.
 *
 * Why this is needed:
 *  - When a user types only a date into a native datetime-local input (e.g.
 *    "07/07/2026" without a time), the input shows that partial value but
 *    its `.value` property comes back as "" (the browser considers it
 *    invalid and refuses to expose the partial value).
 *  - So checking `form.value` is not enough — it looks identical to an empty
 *    field. We must also look at the DOM input's `validity.badInput`, which
 *    is true precisely in this partial-date case.
 *
 * Behavior:
 *  - Calls onChange(value) with the valid value, or "" when cleared/partial.
 *  - Calls onTimeMissingChange(isMissing) whenever the partial-date state
 *    flips, so the parent can disable Save and show an error.
 */
export default function DateTimeInput({
  value,
  onChange,
  onTimeMissingChange,
  className,
  ...rest
}) {
  const ref = useRef(null);
  const [missing, setMissing] = useState(false);

  // Re-check the native validity after every render — the input's value can
  // change without firing onChange (e.g. when the user is mid-typing) and the
  // browser updates `validity.badInput` on the DOM node directly.
  const recheck = () => {
    const el = ref.current;
    if (!el) return;
    const isMissing = !!el.validity?.badInput;
    setMissing(prev => {
      if (prev === isMissing) return prev;
      onTimeMissingChange?.(isMissing);
      return isMissing;
    });
  };

  useEffect(() => {
    recheck();
  });

  const handleChange = (e) => {
    onChange?.(e.target.value);
    // Defer to next tick so validity reflects the latest DOM state.
    setTimeout(recheck, 0);
  };

  return (
    <Input
      ref={ref}
      type="datetime-local"
      value={value || ''}
      onChange={handleChange}
      onInput={recheck}
      onBlur={recheck}
      className={className}
      {...rest}
    />
  );
}