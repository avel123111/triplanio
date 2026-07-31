import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileType,
  isAllowedUpload,
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

test('the picker hints never offer SVG', () => {
  // `image/*` would have — it includes SVG, hence the explicit extension lists.
  for (const accept of [UPLOAD_ACCEPT, IMAGE_ACCEPT]) {
    assert.ok(!accept.includes('svg'), accept);
    assert.ok(!accept.includes('*'), accept);
  }
});
