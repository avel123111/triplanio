import React from 'react';
import { Icon } from '@/design/icons';
import { fileType } from '@/lib/fileType';

/**
 * The colour-coded format badge that leads every document row — red for PDF,
 * blue for Word, green for Excel, purple for a picture, grey for anything else.
 *
 * The ONE implementation behind it. It labels the same jsonb `documents[]` entry
 * on every surface that shows one (documents lens, document field, event read
 * view), so an attachment carries the same badge wherever it appears and a colour
 * change lands in one place (TRIP-275, TRIP-281).
 *
 * `name` may be absent — `fileType` falls back to the generic badge rather than
 * throwing, because the row must render even without a label.
 */
export default function FileTypeBadge({ name }) {
  return (
    <span className={`dl-ftag dl-ftag--${fileType(name)}`}>
      <Icon name="file" size={15} />
    </span>
  );
}
