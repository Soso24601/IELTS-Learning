import { cleanMusicCue } from '../../src/lib/subtitles';
import type { LLMClient } from './llm';
import type { ASRSubtitle } from './parallelAsr';

const BATCH_SIZE = 60;
const MAX_MERGED_CUES = 5;
const MAX_MERGE_GAP_SECONDS = 1.8;
const REFINEMENT_DEADLINE_MS = 2 * 60 * 1000;
const MODEL_CALL_TIMEOUT_MS = 45 * 1000;

type CueGroup = { startCue: number; endCue: number };

function parseGroups(raw: string): CueGroup[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.groups)) throw new Error('字幕整理模型没有返回有效分组。');
  return parsed.groups;
}

function validateGroups(groups: CueGroup[], cues: ASRSubtitle[]): void {
  let nextCue = 0;
  for (const group of groups) {
    if (!Number.isInteger(group.startCue) || !Number.isInteger(group.endCue)
      || group.startCue !== nextCue || group.endCue < group.startCue || group.endCue >= cues.length) {
      throw new Error('字幕整理分组有遗漏、重复或乱序。');
    }
    if (group.endCue - group.startCue + 1 > MAX_MERGED_CUES) {
      throw new Error('字幕整理分组过长。');
    }
    for (let i = group.startCue; i < group.endCue; i++) {
      if (cues[i + 1].start - cues[i].end > MAX_MERGE_GAP_SECONDS) {
        throw new Error('字幕整理跨越了过长的静音间隔。');
      }
    }
    nextCue = group.endCue + 1;
  }
  if (nextCue !== cues.length) throw new Error('字幕整理没有覆盖全部识别内容。');
}

function joinCueText(cues: ASRSubtitle[], startCue: number, endCue: number): string {
  return cues.slice(startCue, endCue + 1).map(cue => cue.text.trim()).filter(Boolean).join(' ')
    .replace(/\s+([,.;:!?])/g, '$1');
}

export function cleanAsrSubtitleCues(input: ASRSubtitle[]): ASRSubtitle[] {
  return input.flatMap(cue => {
    const text = cleanMusicCue(cue.text || '');
    return text ? [{ ...cue, text, translation: '' }] : [];
  }).sort((a, b) => a.start - b.start);
}

/**
 * Let the configured text model group adjacent ASR cues, while taking all text
 * and timestamps from the ASR output. Invalid/model-rewritten grouping can
 * never alter or silently drop recognized words.
 */
export async function refineAsrSubtitles(
  input: ASRSubtitle[],
  llm: LLMClient,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<ASRSubtitle[]> {
  const cues = cleanAsrSubtitleCues(input);
  if (!cues.length) return [];

  const batches: ASRSubtitle[][] = [];
  for (let offset = 0; offset < cues.length; offset += BATCH_SIZE) batches.push(cues.slice(offset, offset + BATCH_SIZE));
  const refined: ASRSubtitle[] = [];
  const deadline = Date.now() + REFINEMENT_DEADLINE_MS;
  for (const [batchIndex, batch] of batches.entries()) {
    if (Date.now() >= deadline) throw new Error('字幕整理超过 2 分钟，已保留百炼原始识别结果。');
    onProgress(batchIndex, batches.length);
    const prompt = `You organize automatic speech recognition subtitles for an English-learning video.
Group adjacent source cues into readable captions: keep short fragments with the sentence they belong to, but preserve a complete sentence as its own caption when it reads naturally. Do not group across a long pause. Every source cue must occur in exactly one group, in the original order. Never split a source cue.
Return only JSON in this format: {"groups":[{"startCue":0,"endCue":1}]}.
Indexes are zero-based and inclusive. Return a complete, gap-free partition of all cue indexes. Do not return or rewrite any subtitle text.
Source cues:
${JSON.stringify(batch.map((cue, index) => ({ index, start: cue.start, end: cue.end, text: cue.text })))}`;
    let timer: ReturnType<typeof setTimeout>;
    const response = await Promise.race([llm.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('字幕整理模型请求超时。')), Math.min(MODEL_CALL_TIMEOUT_MS, deadline - Date.now()));
    })]).finally(() => clearTimeout(timer));
    const groups = parseGroups(response.text || '');
    validateGroups(groups, batch);
    for (const [groupIndex, group] of groups.entries()) {
      const groupedCues = batch.slice(group.startCue, group.endCue + 1);
      refined.push({
        id: groupedCues[0].id || `asr-group-${batchIndex}-${groupIndex}`,
        start: groupedCues[0].start,
        end: groupedCues[groupedCues.length - 1].end,
        text: joinCueText(batch, group.startCue, group.endCue),
        translation: '',
      });
    }
    onProgress(batchIndex + 1, batches.length);
  }
  return refined;
}
