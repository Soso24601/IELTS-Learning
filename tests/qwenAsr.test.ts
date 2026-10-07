import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcribeQwenFile } from '../server/lib/qwenAsr';

test('Qwen file transcription submits correct model, polls and converts milliseconds', async t => {
  t.mock.method(globalThis, 'setTimeout', ((fn: () => void) => { queueMicrotask(fn); return 1; }) as any);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL, options?: RequestInit) => {
    requests++;
    if (requests === 1) {
      assert.equal(url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription');
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, 'qwen3-asr-flash-filetrans');
      assert.equal(body.input.file_url, 'https://example.test/part.flac');
      assert.deepEqual(body.parameters.channel_id, [0]);
      return Response.json({ output: { task_id: 'test-task' } });
    }
    if (requests === 2) return Response.json({ output: { task_status: 'SUCCEEDED', result: { transcription_url: 'https://test.oss-cn-beijing.aliyuncs.com/result' } } });
    assert.equal(options?.redirect, 'error');
    return Response.json({ transcripts: [{ text: 'Hello.', sentences: [{ begin_time: 1500, end_time: 2500, text: 'Hello.' }] }] });
  });
  const result = await transcribeQwenFile('https://example.test/part.flac', { region: 'beijing', apiKey: 'test' });
  assert.equal(requests, 3);
  assert.equal(result.transcript, 'Hello.');
  assert.equal(result.subtitles[0].start, 1.5);
  assert.equal(result.subtitles[0].end, 2.5);
});

test('expired parallel deadline never submits another paid task', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not submit'); });
  await assert.rejects(transcribeQwenFile('https://example.test/part', { region: 'beijing', apiKey: 'test' }, Date.now() - 1), /未继续提交/);
  assert.equal(fetch.mock.callCount(), 0);
});
