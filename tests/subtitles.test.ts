import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorSubtitleTimes, alignSubtitleBatches, cleanAlignedSubtitles, cleanMusicCue, normalizeTranscriptForImport, subtitleAtTime } from '../src/lib/subtitles';
import { cleanAsrSubtitleCues, refineAsrSubtitles } from '../server/lib/subtitleRefinement';

test('highlight follows media time after speed changes, seeks, and silent gaps', () => {
  const cues = [{ id: 'a', start: 1, end: 3, text: 'A' }, { id: 'b', start: 3, end: 5, text: 'B' }, { id: 'c', start: 8, end: 10, text: 'C' }];
  assert.deepEqual([0, 1, 3, 6, 9, 2, 10].map(t => subtitleAtTime(cues, t)), [null, 'a', 'b', null, 'c', 'a', null]);
});

test('AI subtitle cleanup removes music labels without merging sentence boundaries or changing times', () => {
  const result = cleanAlignedSubtitles([
    { id: 'a', start: 1, end: 4, text: 'Hello [music] there.', translation: '你好。' },
    { id: 'b', start: 4, end: 7, text: '[upbeat music]', translation: '' },
    { id: 'c', start: 7, end: 10, text: 'How are you?', translation: '你好吗？' },
  ]);
  assert.deepEqual(result, [
    { id: 'a', start: 1, end: 4, text: 'Hello there.', translation: '你好。' },
    { id: 'c', start: 7, end: 10, text: 'How are you?', translation: '你好吗？' },
  ]);
  assert.equal(cleanMusicCue('♪ background music ♪'), '');
});

test('import normalization removes timestamped music rows without leaking their timestamps as transcript text', () => {
  const normalized = normalizeTranscriptForImport('9:57\t[music]\n10:16\tLet\'s start.\n10:22\t♪ music ♪\n10:30\tThis is the next line.');
  assert.equal(normalized, '[616-630] Let\'s start.\n[630-633] This is the next line.');
});

test('ASR subtitle refinement groups adjacent cues using model indexes and preserves source text and times', async () => {
  let prompt = '';
  const llm: any = { models: { generateContent: async (params: any) => {
    prompt = params.contents;
    return { text: JSON.stringify({ groups: [{ startCue: 0, endCue: 1 }, { startCue: 2, endCue: 2 }] }) };
  } } };
  const result = await refineAsrSubtitles([
    { id: 'a', start: 0, end: 1, text: 'I wanted', translation: '' },
    { id: 'b', start: 1.1, end: 2.5, text: 'to go home.', translation: '' },
    { id: 'music', start: 3, end: 4, text: '[music]', translation: '' },
    { id: 'c', start: 5, end: 6, text: 'Goodbye!', translation: '' },
  ], llm);
  assert.match(prompt, /Do not return or rewrite any subtitle text/);
  assert.deepEqual(result.map(({ id, start, end, text }) => ({ id, start, end, text })), [
    { id: 'a', start: 0, end: 2.5, text: 'I wanted to go home.' },
    { id: 'c', start: 5, end: 6, text: 'Goodbye!' },
  ]);
});

test('ASR subtitle refinement rejects model groups that omit source cues', async () => {
  const llm: any = { models: { generateContent: async () => ({ text: '{"groups":[{"startCue":0,"endCue":0}]}' }) } };
  await assert.rejects(refineAsrSubtitles([
    { id: 'a', start: 0, end: 1, text: 'Hello.', translation: '' },
    { id: 'b', start: 1, end: 2, text: 'Goodbye.', translation: '' },
  ], llm), /覆盖全部识别内容/);
  assert.equal(cleanAsrSubtitleCues([{ id: 'music', start: 0, end: 1, text: '[music]', translation: '' }]).length, 0);
});

test('segmentation anchors to real source cues and rejects omissions or rewrites', () => {
  const raw = '[10-14] Hello world. Next sentence. | 翻译\n[20-22] Goodbye now. | 再见';
  const output = ['Hello world.', 'Next sentence.', 'Goodbye now.'].map((text, i) => ({ id: String(i), start: 0, end: 1, text }));
  assert.deepEqual(anchorSubtitleTimes(raw, output).map(s => [s.start, s.end]), [[10, 12], [12, 14], [20, 22]]);
  assert.throws(() => anchorSubtitleTimes(raw, output.slice(0, 2)), /部分字幕/);
  assert.throws(() => anchorSubtitleTimes(raw, [{ ...output[0], text: 'Invented words.' }]), /遗漏或改写/);
});

test('long transcripts are batched with absolute timestamps and actionable configuration errors', async () => {
  const original = globalThis.fetch;
  const lines = Array.from({ length: 200 }, (_, i) => `[${i * 4}-${i * 4 + 3}] This is sentence number ${i}. | 中文翻译`);
  let calls = 0;
  const progress: number[] = [];
  try {
    globalThis.fetch = async (_url, options) => {
      calls++;
      const { rawText } = JSON.parse(String(options?.body));
      assert.ok(rawText.length < 6000);
      return Response.json({ subtitles: rawText.split('\n').map((line: string) => ({ start: 0, end: 1, text: line.replace(/^\[[^\]]+\]\s*/, '').split('|')[0].trim() })) });
    };
    const result = await alignSubtitleBatches(lines.join('\n'), 800, done => progress.push(done));
    assert.ok(calls > 1);
    assert.equal(result.length, 200);
    assert.equal(result[199].start, 796);
    assert.equal(result[199].end, 799);
    assert.equal(new Set(result.map(s => s.id)).size, 200);
    assert.equal(progress.at(-1), calls);
    globalThis.fetch = async () => Response.json({ error: 'LLM_NOT_CONFIGURED' }, { status: 403 });
    await assert.rejects(alignSubtitleBatches(lines[0], 10, () => {}), /文本 AI 模型/);
  } finally { globalThis.fetch = original; }
});
