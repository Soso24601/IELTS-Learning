import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { youtubeVideoId, youtubeDownloadError, downloadYoutubeAudio } from '../server/lib/youtubeAudio';

test('YouTube links support watch, share, embed and shorts while rejecting hostile hosts', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=h2ou2A_-8JU&list=ignored',
    'https://youtu.be/h2ou2A_-8JU?t=15',
    'https://www.youtube.com/embed/h2ou2A_-8JU',
    'https://www.youtube-nocookie.com/embed/h2ou2A_-8JU',
    'https://m.youtube.com/shorts/h2ou2A_-8JU',
  ]) assert.equal(youtubeVideoId(url), 'h2ou2A_-8JU');
  for (const url of [
    'https://youtube.com.evil.test/watch?v=h2ou2A_-8JU',
    'http://127.0.0.1/watch?v=h2ou2A_-8JU',
    'https://youtube.com@evil.test/watch?v=h2ou2A_-8JU',
    'https://youtube.com:8443/watch?v=h2ou2A_-8JU',
    'file:///tmp/video', 'https://www.youtube.com/playlist?list=123',
    'https://www.youtube.com/watch?v=abc;cat',
  ]) assert.throws(() => youtubeVideoId(url));
});

test('provider failures are actionable and do not expose signed media URLs', () => {
  const error = youtubeDownloadError({ stderr: 'HTTP 403 https://example.com/audio?secret=do-not-display' });
  assert.match(error.message, /YouTube.*限制/);
  assert.match(error.message, /原视频链接会保留/);
  assert.doesNotMatch(error.message, /secret|example.com/);
  assert.match(youtubeDownloadError({ code: 'ENOENT' }).message, /安装/);
  assert.match(youtubeDownloadError({ killed: true }).message, /超时/);
});

test('downloader rejects live or oversized input before downloading and validates downloaded file location', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ielts-downloader-test-'));
  const original = process.env.YT_DLP_PATH;
  const fake = path.join(directory, 'fake-downloader');
  process.env.YT_DLP_PATH = fake;
  async function stub(info: object, downloadCode: string) {
    await writeFile(fake, `#!${process.execPath}\nif(process.argv.includes('--dump-single-json')) console.log(${JSON.stringify(JSON.stringify(info))}); else {${downloadCode}}`, { mode: 0o700 });
  }
  try {
    await stub({ duration: 50, is_live: true }, 'throw new Error("download must not run");');
    await assert.rejects(downloadYoutubeAudio('h2ou2A_-8JU', directory), /直播/);
    await stub({ duration: 50, filesize: 300 * 1024 * 1024 }, 'throw new Error("download must not run");');
    await assert.rejects(downloadYoutubeAudio('h2ou2A_-8JU', directory), /200 MB/);
    await stub({ duration: 50 }, 'console.log("/tmp/outside-file.webm");');
    await assert.rejects(downloadYoutubeAudio('h2ou2A_-8JU', directory), /未能获得/);
    const target = path.join(directory, 'audio.webm');
    await stub({ duration: 50 }, `require('node:fs').writeFileSync(${JSON.stringify(target)}, Buffer.from([26,69,223,163])); console.log(${JSON.stringify(target)});`);
    assert.deepEqual(await downloadYoutubeAudio('h2ou2A_-8JU', directory), { path: target, mimeType: 'audio/webm' });
  } finally {
    if (original === undefined) delete process.env.YT_DLP_PATH; else process.env.YT_DLP_PATH = original;
    await rm(directory, { recursive: true, force: true });
  }
});
