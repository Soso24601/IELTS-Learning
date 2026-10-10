export type TimedSubtitle = { id: string; start: number; end: number; text: string; translation?: string };

export function cleanMusicCue(text: string): string {
  const cleaned = text
    .replace(/\[\s*[^\]]*\bmusic\b[^\]]*\]|\(\s*[^)]*\bmusic\b[^)]*\)/gi, ' ')
    .replace(/\[\s*(?:♪+|♫+)\s*\]|\(\s*(?:♪+|♫+)\s*\)/g, ' ')
    // Exported transcripts may use >> as a speaker/cue marker.
    .replace(/\s*>{2,}\s*/g, ' ')
    .replace(/[♪♫]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:music|instrumental music|background music)$/i.test(cleaned) ? '' : cleaned;
}

/** Build one untranslated paragraph from caption rows, excluding translations and music cues. */
export function subtitlesToOriginalTranscript(subtitles: Array<Pick<TimedSubtitle, 'text'>>): string {
  return subtitles
    .map(subtitle => cleanMusicCue(subtitle.text.split(/\s+\|\s+/)[0] || ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  // Recover row boundaries when extensions flatten an HTML table into plain text.
  const flattened = value.replace(/\s+/g, ' ').trim();
  const explicitSecondTimes = [...flattened.matchAll(/(?:^|\s)(\d+(?:\.\d+)?\s*s)(?=\s|$)/gi)];
  const rowTimes = explicitSecondTimes.length >= 2
    ? explicitSecondTimes
    : [...flattened.matchAll(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?=\s|$)(?!\s*(?:a\.m\.|p\.m\.))/gi)];
  if (rowTimes.length >= 2 && /\b(?:time|subtitle)\b/i.test(flattened)) {
    const rows: string[] = [];
    for (let index = 0; index < rowTimes.length; index++) {
      const match = rowTimes[index];
      const seconds = parseTime(match[1]);
      const contentStart = (match.index || 0) + match[0].length;
      const contentEnd = index + 1 < rowTimes.length ? rowTimes[index + 1].index || flattened.length : flattened.length;
      let content = flattened.slice(contentStart, contentEnd).trim();
      content = content.replace(/^(?:time\s+subtitle\s+)?/i, '').replace(/^(?:machine translation\s*)/i, '');
      const chinese = content.search(/[\u3400-\u9fff]/);
      if (chinese >= 0) content = content.slice(0, chinese).trim();
      content = cleanMusicCue(content.replace(/\s*\|\s*.*$/, ''));
      if (seconds !== null && content && !/^(?:subtitle|time)$/i.test(content)) rows.push(`[${seconds}] ${content}`);
    }
    if (rows.length) return rows.map((line, index) => {
      const start = Number(line.match(/^\[([\d.]+)\]/)?.[1]);
      const next = Number(rows[index + 1]?.match(/^\[([\d.]+)\]/)?.[1]);
      return line.replace(/^\[([\d.]+)\]/, `[${start}-${Number.isFinite(next) && next > start ? next : start + 3}]`);
    }).join('\n');
  }

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
