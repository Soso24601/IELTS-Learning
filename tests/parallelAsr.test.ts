import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parallelTranscribe } from '../server/lib/parallelAsr';

test('parallel workers are bounded, merge in source order and restore video timestamps', async () => {
  let running = 0, peak = 0;
  const parts = Array.from({ length: 7 }, (_, i) => ({ path: `${i}.flac`, start: i * 600, end: (i + 1) * 600 }));
  const completed: number[] = [];
  const result = await parallelTranscribe(parts, async (_part, index) => {
    running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, index === 0 ? 30 : 2));
    running--;
    return { transcript: `Part ${index}`, subtitles: [{ id: 'same-id', text: `Part ${index}`, translation: '', start: 1, end: 2 }] };
  }, done => completed.push(done));
  assert.equal(peak, 3);
  assert.deepEqual(completed, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.transcript, 'Part 0 Part 1 Part 2 Part 3 Part 4 Part 5 Part 6');
  assert.deepEqual(result.subtitles.map(s => s.start), [1, 601, 1201, 1801, 2401, 3001, 3601]);
  assert.equal(new Set(result.subtitles.map(s => s.id)).size, 7);
});

test('a failed part never yields partial success and all workers settle before cleanup', async () => {
  let finished = 0;
  await assert.rejects(parallelTranscribe([{ path: 'a', start: 0, end: 5 }, { path: 'b', start: 5, end: 10 }], async (_part, index) => {
    if (index === 0) throw new Error('upstream failed');
    await new Promise(resolve => setTimeout(resolve, 15));
    finished++;
    return { transcript: '', subtitles: [] };
  }, () => {}), /第 1 段识别失败/);
  assert.equal(finished, 1);
});

test('silent chunks are allowed but timestamps outside the audio are rejected', async () => {
  const parts = [{ path: 'silent', start: 0, end: 5 }];
  assert.deepEqual(await parallelTranscribe(parts, async () => ({ transcript: '', subtitles: [] }), () => {}), { transcript: '', subtitles: [] });
  await assert.rejects(parallelTranscribe(parts, async () => ({ transcript: 'Bad', subtitles: [{ id: 'bad', start: 7, end: 8, text: 'Bad', translation: '' }] }), () => {}), /时间戳超出/);
});
