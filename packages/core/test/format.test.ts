import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentKind, formatText, linksIn, mentionPattern, plainText, validThumb } from '../src/index';

const flat = (t: string) => formatText(t).flatMap((l) => l.spans);

test('format: bold, italic, strike, code and nesting', () => {
  assert.deepEqual(flat('hi *there* you'), [{ text: 'hi ' }, { text: 'there', bold: true }, { text: ' you' }]);
  assert.deepEqual(flat('_a_'), [{ text: 'a', italic: true }]);
  assert.deepEqual(flat('~gone~!'), [{ text: 'gone', strike: true }, { text: '!' }]);
  assert.deepEqual(flat('run `npm *test*` now'), [{ text: 'run ' }, { text: 'npm *test*', code: true }, { text: ' now' }]);
  assert.deepEqual(flat('*_both_*'), [{ text: 'both', bold: true, italic: true }]);
});

test('format: markers inside words or next to spaces stay plain', () => {
  assert.deepEqual(flat('2*3*4'), [{ text: '2*3*4' }]);
  assert.deepEqual(flat('snake_case_name'), [{ text: 'snake_case_name' }]);
  assert.deepEqual(flat('a * b * c'), [{ text: 'a * b * c' }]);
});

test('format: lines, quotes, lists and ``` blocks', () => {
  const lines = formatText('> quoted\n- item\n2. second\n```x = *1*\ny```\nend');
  assert.equal(lines[0]!.quote, true);
  assert.equal(lines[1]!.bullet, '•');
  assert.equal(lines[2]!.bullet, '2.');
  assert.deepEqual(lines[3], { spans: [{ text: 'x = *1*', code: true }], mono: true });
  assert.deepEqual(lines[4], { spans: [{ text: 'y', code: true }], mono: true });
  assert.deepEqual(lines[5]!.spans, [{ text: 'end' }]);
  assert.equal(plainText('*hi* _there_'), 'hi there');
});

test('format: links and mentions are never formatted inside', () => {
  const spans = flat('see https://x.com/a_b_c and @Asha_K *now*');
  assert.deepEqual(spans.find((s) => s.link), { text: 'https://x.com/a_b_c', link: true });
  const m = formatText('hi @Asha_K_ *x*', mentionPattern(['@Asha_K_'])).flatMap((l) => l.spans);
  assert.deepEqual(m, [{ text: 'hi ' }, { text: '@Asha_K_', mention: true }, { text: ' ' }, { text: 'x', bold: true }]);
  assert.deepEqual(linksIn('a https://a.io/x, b http://b.io.'), ['https://a.io/x', 'http://b.io']);
});

test('attachments: videos have their own kind; thumbnails are checked', () => {
  assert.equal(attachmentKind('video/mp4', 'a.mp4'), 'video');
  assert.equal(attachmentKind('video/quicktime', 'a.mov'), 'video');
  assert.equal(attachmentKind('application/octet-stream', 'clip.MP4'), 'video');
  assert.equal(attachmentKind('audio/mp4', 'voice.m4a'), 'audio');
  assert.equal(validThumb('/9j/4AAQSkZJRg=='), true);
  assert.equal(validThumb('not base64!'), false);
  assert.equal(validThumb('A'.repeat(30_000)), false);
});
