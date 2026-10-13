import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectCaptionDraft, inspectVideoLink, subtitleFileToDraft } from '../frontend/src/lib/materialDraft';

test('draft inspection reports bad rows and overlaps without silently publishing partial subtitles', () => {
  const result = inspectCaptionDraft('[0-2] >> Hello [music]. | 你好\nbroken row\n[1-4] Next sentence.\n[4-5] [music]\n[6-6] Invalid.');
  assert.equal(result.errors.length, 3);
  assert.equal(result.removed, 1);
  assert.equal(result.captions.length, 2);
  assert.equal(result.captions[0].text, 'Hello.');
});

test('SRT and WebVTT retain source timings and report missing cues', () => {
  assert.equal(subtitleFileToDraft('1\n00:01:02,500 --> 00:01:05,000\nHello\nworld.\n\n2\n00:01:06,000 --> 00:01:07,000\n[music]'), '[62.5-65] Hello world.\n[66-67] [music]');
  assert.equal(subtitleFileToDraft('WEBVTT\n\n00:02.000 --> 00:04.500 align:start\n<v Speaker>Hello.</v>'), '[2-4.5] Hello.');
  assert.throws(() => subtitleFileToDraft('No subtitles'), /没有识别/);
});

test('video validation accepts public URLs and builds YouTube or direct-video previews', () => {
  assert.ok(inspectVideoLink('blob:temporary').error);
  assert.ok(inspectVideoLink('https://youtube.com/').error);
  assert.equal(inspectVideoLink('https://youtu.be/dQw4w9WgXcQ').preview, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(inspectVideoLink('https://example.com/video.mp4?token=123').direct, true);
});
