import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanAlignedSubtitles, cleanMusicCue, normalizeTranscriptForImport, subtitlesToOriginalTranscript, subtitleAtTime } from '../frontend/src/lib/subtitles';
import { balanceSubtitleCueGroups, splitSubtitleSheetCues } from '../backend/server/lib/subtitleSheetGrouping';
import { parseSubtitleSheetRows } from '../frontend/src/lib/subtitleSheet';
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

test('spreadsheet subtitles produce one clean original paragraph without translations or music cues', () => {
  assert.equal(subtitlesToOriginalTranscript([
    { text: 'It\'s 5:59 and I\'m waiting [music]' },
    { text: '[upbeat music]' },
    { text: '>> outside the shops. | 在商店外面。' },
    { text: 'Ready.' },
  ]), "It's 5:59 and I'm waiting outside the shops. Ready.");
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
  assert.match(normalized, /\[11-14\] time\. Three, two, one\. Smile\./);
  assert.doesNotMatch(normalized, /Machine Translation|\[music\]/i);
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

test('browser spreadsheet fallback preserves source time and translation while cleaning music cues', () => {
  const subtitles = parseSubtitleSheetRows([
    ['Time', 'Subtitle', 'Machine Translation'],
    ['0s', "It's five in the morning [music] and I'm waiting outside.", '现在是早上五点，我在外面等。'],
    ['7s', '>> The shop is about to open.', '商店马上要开门。'],
    ['20s', '[music]', '[音乐]'],
  ]);
  assert.equal(subtitles.length, 2);
  assert.equal(subtitles[0].start, 0);
  assert.equal(subtitles[0].text, "It's five in the morning and I'm waiting outside.");
  assert.equal(subtitles[1].text, 'The shop is about to open.');
  assert.equal(subtitles.map(subtitle => subtitle.translation).join(''), '现在是早上五点，我在外面等。商店马上要开门。');
});
