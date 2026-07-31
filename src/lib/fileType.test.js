import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fileType,
  isAllowedUpload,
  uploadContentType,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_PARSER_EXTENSIONS,
  ALLOWED_UPLOAD_EXTENSIONS,
  UPLOAD_ACCEPT,
  IMAGE_ACCEPT,
} from './fileType.js';

const file = (name) => ({ name });

test('the formats a browser executes are refused', () => {
  // The whole point of the allow-list (TRIP-281): HTML and SVG are the only
  // stored formats a browser runs, so no upload surface may take them.
  for (const name of ['page.html', 'page.htm', 'logo.svg', 'x.xhtml', 'a.mhtml']) {
    assert.equal(isAllowedUpload(file(name)), false, name);
  }
});

test('what travellers actually attach is accepted', () => {
  for (const name of ['ticket.pdf', 'photo.JPG', 'scan.heic', 'visa.doc', 'prices.xls', 'list.csv']) {
    assert.equal(isAllowedUpload(file(name)), true, name);
  }
});

test('only the LAST extension decides', () => {
  // A double extension must not let an executable format in through the name.
  assert.equal(isAllowedUpload(file('invoice.pdf.html')), false);
  // The mirror case is harmless: the browser stores it as a PDF and never runs it.
  assert.equal(isAllowedUpload(file('invoice.html.pdf')), true);
});

test('a file we cannot classify is refused', () => {
  for (const name of ['README', '', '.pdf']) {
    assert.equal(isAllowedUpload(file(name)), false, JSON.stringify(name));
  }
  assert.equal(isAllowedUpload(null), false);
});

test('narrower surfaces take less than the document fields', () => {
  // The booking parser only ever OCRs a PDF or a photo; covers/avatars only images.
  assert.equal(isAllowedUpload(file('visa.doc'), ALLOWED_PARSER_EXTENSIONS), false);
  assert.equal(isAllowedUpload(file('ticket.pdf'), ALLOWED_PARSER_EXTENSIONS), true);
  assert.equal(isAllowedUpload(file('ticket.pdf'), ALLOWED_IMAGE_EXTENSIONS), false);
  assert.equal(isAllowedUpload(file('cover.webp'), ALLOWED_IMAGE_EXTENSIONS), true);
});

test('every accepted extension gets a real type badge', () => {
  // `fileType` drives the coloured badge; a format we accept but cannot label
  // would render as the generic one.
  for (const ext of ALLOWED_UPLOAD_EXTENSIONS) {
    assert.notEqual(fileType(`x.${ext}`), 'file', ext);
  }
});

// The enforcing gate is `allowed_mime_types` on the buckets, and it lives in SQL.
// Read the migration back rather than pin a copy here: an extension added to
// fileType.js without its type in the migration then fails the build instead of
// failing a real upload with a raw storage error (Codex review, TRIP-281).
// Resolved off this file, not the cwd. If migrations are ever squashed into a
// new baseline, both tests below fail loudly on the empty list — repoint the path
// at the baseline rather than pinning a copy of the types here.
const MIGRATION = '../../supabase/migrations/20260731172548_trip281_upload_format_limits.sql';
const BUCKET_MIME_TYPES = (readFileSync(new URL(MIGRATION, import.meta.url), 'utf8')
  .match(/'[a-z]+\/[a-z0-9.+-]+'/g) || []).map((s) => s.slice(1, -1));

test('every accepted extension is stored as a type the buckets allow', () => {
  assert.ok(BUCKET_MIME_TYPES.length, 'no MIME types found in the migration');
  for (const ext of ALLOWED_UPLOAD_EXTENSIONS) {
    const type = uploadContentType(file(`x.${ext}`));
    assert.ok(type, `no MIME type for .${ext}`);
    assert.ok(
      BUCKET_MIME_TYPES.includes(type),
      `.${ext} would be stored as ${type}, which the buckets reject`,
    );
  }
});

test('the stored type never depends on the uploader machine', () => {
  // A .csv arrives as text/plain where Excel isn't registered, a .pdf as
  // octet-stream where nothing claims it. We re-stamp from the extension, so
  // neither reaches the bucket.
  assert.equal(uploadContentType(file('itinerary.CSV')), 'text/csv');
  assert.equal(uploadContentType(file('ticket.pdf')), 'application/pdf');
  assert.equal(uploadContentType(file('photo.heic')), 'image/heic');
  assert.equal(uploadContentType(file('README')), null);
});

test('the buckets let in nothing a browser executes', () => {
  assert.ok(BUCKET_MIME_TYPES.length, 'no MIME types found in the migration');
  for (const type of BUCKET_MIME_TYPES) {
    assert.ok(!/html|svg/.test(type), type);
  }
});

test('the picker hints never offer SVG', () => {
  // `image/*` would have — it includes SVG, hence the explicit extension lists.
  for (const accept of [UPLOAD_ACCEPT, IMAGE_ACCEPT]) {
    assert.ok(!accept.includes('svg'), accept);
    assert.ok(!accept.includes('*'), accept);
  }
});
