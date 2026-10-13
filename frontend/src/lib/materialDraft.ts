import { cleanMusicCue, TimedSubtitle } from './subtitles';

/** Convert standard SRT/WebVTT cues into the editable seconds-based format. */
export function subtitleFileToDraft(source: string): string {
  const seconds = (stamp: string) => stamp.replace(',', '.').split(':').reduce((sum, value) => sum * 60 + Number(value), 0);
  const rows = source.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) return [];
    const match = lines[index].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/);
    if (!match) throw new Error('字幕时间格式无效，请检查 SRT/VTT 文件。');
    const text = lines.slice(index + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    return [`[${seconds(match[1])}-${seconds(match[2])}] ${text}`];
  });
  if (!rows.length) throw new Error('文件中没有识别到时间轴字幕。');
  return rows.join('\n');
}

export function inspectCaptionDraft(source: string) {
  const captions: TimedSubtitle[] = [];
  const errors: string[] = [];
  let removed = 0;
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const match = line.trim().match(/^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!match) { errors.push(`第 ${index + 1} 行格式有误，请使用 [开始秒数-结束秒数] 英文 | 翻译`); return; }
    const start = Number(match[1]), end = Number(match[2]);
    const [rawText, translation = ''] = match[3].split(/\s+\|\s+/, 2);
    const text = cleanMusicCue(rawText);
    if (end <= start) { errors.push(`第 ${index + 1} 行结束时间必须晚于开始时间`); return; }
    if (!text) {
      if (rawText.trim()) removed++;
      else errors.push(`第 ${index + 1} 行缺少英文字幕`);
      return;
    }
    const previous = captions.at(-1);
    if (previous && start < previous.end) errors.push(`第 ${index + 1} 行时间与上一段重叠或顺序有误`);
    captions.push({ id: `caption-${index}-${start}`, start, end, text, translation: cleanMusicCue(translation) });
  });
  return { captions, errors, removed };
}

export function inspectVideoLink(value: string): { error: string; preview: string; direct: boolean } {
  if (!value.trim()) return { error: '', preview: '', direct: false };
  if (/^\/api\/media\/[0-9a-f-]{36}\.(mp4|webm)$/.test(value.trim())) return { error: '', preview: value.trim(), direct: true };
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    const host = url.hostname.toLowerCase();
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
      if (!id || !/^[\w-]{11}$/.test(id)) return { error: '请填写具体的 YouTube 视频链接', preview: '', direct: false };
      return { error: '', preview: `https://www.youtube.com/embed/${id}`, direct: false };
    }
    const direct = /\.(mp4|webm|ogg)(?:$)/i.test(url.pathname);
    return { error: '', preview: direct ? url.href : '', direct };
  } catch { return { error: '请填写完整的 http:// 或 https:// 视频链接', preview: '', direct: false }; }
}

export function inspectAudioLink(value: string): string {
  if (!value.trim()) return '';
  if (/^\/api\/media\/[0-9a-f-]{36}\.(mp3|wav|m4a|ogg)$/.test(value.trim())) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    if (/(^|\.)(youtube\.com|youtu\.be|bilibili\.com)$/.test(url.hostname)) return '音频需要可直接播放的文件链接，请选择音频文件或将类型改为视频';
    return '';
  } catch { return '请填写完整的音频文件链接，或上传音频文件'; }
}
