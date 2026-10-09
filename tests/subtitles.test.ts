import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorSubtitleTimes, alignSubtitleBatches, cleanAlignedSubtitles, cleanMusicCue, normalizeTranscriptForImport, subtitleAtTime } from '../src/lib/subtitles';
import { cleanAsrSubtitleCues, refineAsrSubtitles } from '../server/lib/subtitleRefinement';
import { balanceSubtitleCueGroups, splitSubtitleSheetCues } from '../server/lib/subtitleSheetGrouping';

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
  assert.equal(cleanMusicCue('>> No, there is a breeze. >> Why? Like >> be careful >> Ready.'), 'No, there is a breeze. Why? Like be careful Ready.');
});

test('import normalization removes timestamped music rows without leaking their timestamps as transcript text', () => {
  const normalized = normalizeTranscriptForImport('9:57\t[music]\n10:16\tLet\'s start.\n10:22\t♪ music ♪\n10:30\tThis is the next line.');
  assert.equal(normalized, '[616-630] Let\'s start.\n[630-633] This is the next line.');
});

test('import normalization recovers flattened transcript table rows and drops machine translation', () => {
  const pasted = 'Living Alone vlog Time Subtitle Machine Translation 0s It\'s 5:59 and I\'m just waiting outside the shops for it to open. Tada! 7s How\'m I going to make the best baby ever under an hour [music] and be at work on 11s time. >> Three, two, one. Smile.';
  const normalized = normalizeTranscriptForImport(pasted);
  assert.match(normalized, /^\[0-7\] It\'s 5:59 and I\'m just waiting outside the shops for it to open\. Tada!/);
  assert.match(normalized, /\[7-11\] How\'m I going to make the best baby ever under an hour and be at work on/);
  assert.match(normalized, /\[11-14\] time\. >> Three, two, one\. Smile\./);
  assert.doesNotMatch(normalized, /Machine Translation|\[music\]/i);
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

test('spreadsheet cue balancing splits oversized captions and joins nearby tiny fragments', () => {
  const cues = [
    { time: 0, text: 'This is the first short part', translation: '' },
    { time: 1, text: 'of a sentence that continues', translation: '' },
    { time: 2, text: 'and now it ends.', translation: '' },
    { time: 3, text: 'Okay.', translation: '' },
    { time: 3.8, text: 'Okay.', translation: '' },
    { time: 5, text: 'Here is a completely separate sentence with several words.', translation: '' },
    { time: 28, text: 'A new thought begins after a long pause.', translation: '' },
  ];
  const groups = balanceSubtitleCueGroups([cues.map((_cue, index) => index)], cues);
  assert.deepEqual(groups.flat(), cues.map((_cue, index) => index));
  assert.ok(groups.some(group => group.includes(3) && group.includes(4) && group.includes(5)));
  assert.ok(groups.every(group => group.length === 1 || cues[group.at(-1)!].time - cues[group[0]].time <= 9));
  assert.equal(groups.at(-1)?.length, 1, 'long pauses must remain boundaries');
});

test('spreadsheet sentence splitting reconnects phrases that cross exported cue rows', () => {
  const source = [
    { time: 26, text: 'pull-up and two pressups. Then I engage in a trifecta of dental', translation: '引体向上和两个俯卧撑。然后我进行三项口腔' },
    { time: 33, text: 'hygiene. One, brush teeth. Two, floss. Three,', translation: '卫生护理。第一，刷牙。第二，使用牙线。第三，' },
    { time: 40, text: 'mouthwash. I boil the kettle, pour the milk in the mug, and sit down', translation: '漱口水。我烧开水，把牛奶倒进杯子里，然后坐下来' },
  ];
  const cues = splitSubtitleSheetCues(source);
  const groups = balanceSubtitleCueGroups([cues.map((_cue, index) => index)], cues);
  const captions = groups.map(group => group.map(index => cues[index].text).join(' '));
  assert.ok(captions.some(text => /trifecta of dental hygiene\./.test(text)));
  assert.ok(captions.some(text => /Three, mouthwash\./.test(text)));
  assert.equal(groups.flat().length, cues.length);
});
