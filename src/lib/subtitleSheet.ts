export type SubtitleSheetRow = { time: number; text: string; translation: string };
export type ImportedSubtitle = { id: string; start: number; end: number; text: string; translation: string };

function parseTime(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (/^\d+(?:\.\d+)?\s*s$/i.test(text)) return Number(text.replace(/\s*s$/i, ''));
  const match = text.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (match) return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

function cleanCue(value: unknown): string {
  return String(value ?? '')
    .replace(/\[\s*[^\]]*\bmusic\b[^\]]*\]|\(\s*[^)]*\bmusic\b[^)]*\)/gi, ' ')
    .replace(/[（(]\s*音乐\s*[）)]|\[\s*音乐\s*\]/g, ' ')
    .replace(/\s*>{2,}\s*/g, ' ')
    .replace(/[♪♫]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length || 0;
}

export function parseSubtitleSheetRows(matrix: unknown[][]): ImportedSubtitle[] {
  if (!matrix.length) throw new Error('表格中没有数据。');
  const headers = (matrix[0] || []).map(value => String(value ?? '').trim().toLowerCase());
  const findColumn = (pattern: RegExp, fallback: number) => {
    const index = headers.findIndex(header => pattern.test(header));
    return index < 0 ? fallback : index;
  };
  const timeColumn = findColumn(/^(time|时间|timestamp|时间戳)$/, 0);
  const textColumn = findColumn(/^(subtitle|字幕|text|原文|英文|english)$/, 1);
  const translationColumn = findColumn(/^(machine translation|translation|翻译|中文|译文)$/, 2);
  const hasHeader = headers.some(header => /^(time|时间|timestamp|时间戳)$/.test(header));
  const rows = (hasHeader ? matrix.slice(1) : matrix)
    .map(row => ({
      time: parseTime(row?.[timeColumn]),
      text: cleanCue(row?.[textColumn]),
      translation: cleanCue(row?.[translationColumn]),
    }))
    .filter((row): row is SubtitleSheetRow => row.time !== null && !!row.text && !/^(?:music|instrumental music)$/i.test(row.text))
    .sort((a, b) => a.time - b.time);

  if (!rows.length) throw new Error('没有识别到字幕行。请确认表格有 Time、Subtitle 列，或前 3 列依次为时间、英文字幕、翻译。');

  const groups: SubtitleSheetRow[][] = [];
  let group: SubtitleSheetRow[] = [];
  for (const row of rows) {
    const previous = group[group.length - 1];
    const currentWords = group.reduce((count, cue) => count + wordCount(cue.text), 0);
    const gap = previous ? row.time - previous.time : 0;
    const sentenceEnded = previous && /[.!?]["'”’)]*$/.test(previous.text.trim()) && currentWords >= 5;
    const exceedsSize = group.length > 0 && (currentWords + wordCount(row.text) > 18 || row.time - group[0].time > 9 || gap > 8);
    if (group.length && (sentenceEnded || exceedsSize)) {
      groups.push(group);
      group = [];
    }
    group.push(row);
  }
  if (group.length) groups.push(group);

  return groups.map((items, index) => {
    const first = items[0];
    const last = items[items.length - 1];
    const next = rows[rows.indexOf(last) + 1];
    const gap = next ? next.time - last.time : 4;
    const end = Math.max(first.time + 0.1, Math.min(first.time + 11, last.time + Math.max(1.2, Math.min(4, gap * 0.75)), next?.time ?? Infinity));
    return {
      id: `sheet-local-${Date.now()}-${index}`,
      start: first.time,
      end,
      text: items.map(item => item.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'),
      translation: items.map(item => item.translation).filter(Boolean).join(''),
    };
  });
}
