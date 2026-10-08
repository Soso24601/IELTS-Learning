export type TimedSubtitle = { id: string; start: number; end: number; text: string; translation?: string };

export function cleanMusicCue(text: string): string {
  const cleaned = text
    .replace(/\[\s*[^\]]*\bmusic\b[^\]]*\]|\(\s*[^)]*\bmusic\b[^)]*\)/gi, ' ')
    .replace(/\[\s*(?:♪+|♫+)\s*\]|\(\s*(?:♪+|♫+)\s*\)/g, ' ')
    .replace(/[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:music|instrumental music|background music)$/i.test(cleaned) ? '' : cleaned;
}

/** Clean model output while preserving the AI's sentence boundaries and timings. */
export function cleanAlignedSubtitles(subtitles: TimedSubtitle[]): TimedSubtitle[] {
  return subtitles.flatMap(subtitle => {
    const text = cleanMusicCue(subtitle.text);
    if (!text) return [];
    const translation = subtitle.translation ? cleanMusicCue(subtitle.translation) : subtitle.translation;
    return [{ ...subtitle, text, translation }];
  });
}

export function normalizeTranscriptForImport(value: string): string {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const normalized: string[] = [];
  const parseTime = (value: string): number | null => {
    const clean = value.trim();
    if (/^\d+(?:\.\d+)?\s*s$/i.test(clean)) return Number(clean.replace(/\s*s$/i, ''));
    const match = clean.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
    if (!match) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
  };

  for (const sourceLine of lines) {
    const columns = sourceLine.split('\t').map(column => column.trim()).filter(Boolean);
    const tabularTime = columns.length > 1 ? parseTime(columns[0]) : null;
    if (tabularTime !== null) {
      const english = cleanMusicCue(columns[1] || '');
      const translation = cleanMusicCue(columns[2] || '');
      if (english) normalized.push(`[${tabularTime}] ${english}${translation ? ` | ${translation}` : ''}`);
      continue;
    }

    const timestampPrefix = sourceLine.match(/^((?:(?:\d{1,2}:)?\d{1,2}:\d{2})(?:\.\d+)?|\d+(?:\.\d+)?\s*s)\s+(.+)$/i);
    if (timestampPrefix) {
      const seconds = parseTime(timestampPrefix[1]);
      const content = cleanMusicCue(timestampPrefix[2]);
      if (seconds !== null && content) normalized.push(`[${seconds}] ${content}`);
      continue;
    }

    const line = cleanMusicCue(sourceLine);
    if (line) normalized.push(line);
  }

  return normalized.map((line, index) => {
    const cue = line.match(/^\[([\d.]+)\](.*)$/);
    if (!cue) return line;
    const start = Number(cue[1]);
    const nextCue = normalized.slice(index + 1).map(next => next.match(/^\[([\d.]+)\]/)).find(Boolean);
    const nextStart = nextCue ? Number(nextCue[1]) : NaN;
    const end = Number.isFinite(nextStart) && nextStart > start ? nextStart : start + 3;
    return `[${start}-${end}]${cue[2]}`;
  }).join('\n');
}

export function subtitleAtTime(subtitles: TimedSubtitle[], time: number): string | null {
  return subtitles.find(s => time >= s.start && time < s.end)?.id ?? null;
}

// Model-generated text must cover the source words in order. Timing is derived
// from the source cues, never from the model's invented timestamps.
export function anchorSubtitleTimes(raw: string, output: TimedSubtitle[]): TimedSubtitle[] {
  const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim());
  const matches = lines.map(l => l.match(/^\[([\d.]+)-([\d.]+)\]\s*(.*)$/));
  if (!matches.every(Boolean)) return output;
  const source = matches.flatMap(m => {
    const start = Number(m![1]), end = Number(m![2]);
    const tokens = words(m![3].split('|')[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('原字幕时间轴无效，请先校正时间。');
    return tokens.map((word, i) => ({ word, start: start + (end - start) * i / tokens.length, end: start + (end - start) * (i + 1) / tokens.length }));
  });
  let offset = 0;
  const anchored = output.map(s => {
    const tokens = words(s.text);
    if (!tokens.length || tokens.some((word, i) => source[offset + i]?.word !== word)) throw new Error('AI 返回的原文有遗漏或改写，已保留原字幕，请重试。');
    const start = source[offset].start;
    offset += tokens.length;
    return { ...s, start, end: source[offset - 1].end };
  });
  if (offset !== source.length) throw new Error('AI 只处理了部分字幕，已保留原字幕，请重试。');
  return anchored;
}

export async function alignSubtitleBatches(raw: string, duration: number, progress: (done: number, total: number) => void): Promise<TimedSubtitle[]> {
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim());
  const chunks: string[] = [];
  for (const line of lines) {
    // Keep timestamped cues intact; split long plain text at whitespace.
    const parts = line.startsWith('[') ? [line] : line.match(/.{1,3500}(?:\s|$)|\S+/g) || [line];
    for (const part of parts) {
      if (part.length > 6000) throw new Error('单条字幕过长，请先按句换行后重试。');
      const last = chunks.length - 1;
      if (last >= 0 && chunks[last].length + part.length < 4000) chunks[last] += '\n' + part;
      else chunks.push(part);
    }
  }
  const timed = lines.every(l => /^\[[\d.]+-[\d.]+\]/.test(l));
  const totalLength = chunks.reduce((n, c) => n + c.length, 0);
  const result: TimedSubtitle[] = [];
  let offset = 0;
  for (const [index, chunk] of chunks.entries()) {
    progress(index, chunks.length);
    const chunkDuration = timed ? duration : duration * chunk.length / totalLength;
    const response = await fetch('/api/gemini/align-subtitles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ rawText: chunk, duration: chunkDuration }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error === 'LLM_NOT_CONFIGURED'
      ? '请先在账号与设置中配置文本 AI 模型。语音识别配置与文本分段配置是分开的。'
      : data.error || `AI 分段失败（HTTP ${response.status}）`);
    if (!Array.isArray(data.subtitles) || !data.subtitles.length || data.subtitles.some((s: any) => typeof s.text !== 'string' || !s.text.trim() || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start)) throw new Error('AI 返回了无效字幕，原字幕未修改。');
    const anchored = anchorSubtitleTimes(chunk, data.subtitles);
    result.push(...anchored.map((s, i) => ({ ...s, id: `aligned-${index}-${i}`, start: s.start + (timed ? 0 : offset), end: s.end + (timed ? 0 : offset) })));
    offset += chunkDuration;
    progress(index + 1, chunks.length);
  }
  return result;
}
