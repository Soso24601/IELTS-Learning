import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
export type AudioPart = { path: string; start: number; end: number };
export type ASRSubtitle = { id: string; start: number; end: number; text: string; translation: string };
export type ASRResult = { transcript: string; subtitles: ASRSubtitle[] };

export async function splitAudio(file: string, directory: string, seconds = 600): Promise<AudioPart[]> {
  if (!Number.isFinite(seconds) || seconds < 1) throw new Error('音频分段长度无效。');
  const probe = await execute(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const duration = Number(JSON.parse(probe.stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 10800) throw new Error('音频时长必须在 0–3 小时之间。');
  // A single decode pass, mono lossless output, bounded CPU and disk-backed files.
  await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
    '-map', '0:a:0', '-vn', '-af', 'pan=mono|c0=c0', '-ac', '1', '-ar', '16000', '-c:a', 'flac', '-threads', '1',
    '-f', 'segment', '-segment_time', String(seconds), '-reset_timestamps', '1',
    '-segment_list', path.join(directory, 'segments.csv'), '-segment_list_type', 'csv',
    path.join(directory, 'part-%04d.flac')], { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 });
  const rows = (await readFile(path.join(directory, 'segments.csv'), 'utf8')).trim().split(/\r?\n/);
  const parts: AudioPart[] = [];
  for (const row of rows) {
    const match = row.match(/^"?(part-\d+\.flac)"?,([\d.]+),([\d.]+)$/);
    if (!match) throw new Error('音频分段列表无效。');
    const start = Number(match[2]), end = Number(match[3]);
    const previousEnd = parts.at(-1)?.end ?? 0;
    if (end <= start || Math.abs(start - previousEnd) > 0.05) throw new Error('音频分段存在缺口，已停止识别。');
    const part = { path: path.join(directory, match[1]), start, end };
    if (!(await stat(part.path)).size) throw new Error('音频分段为空，已停止识别。');
    parts.push(part);
  }
  if (!parts.length || Math.abs(parts.at(-1)!.end - duration) > 1) throw new Error('音频未完整切分，已停止识别。');
  return parts;
}

export async function parallelTranscribe(
  parts: AudioPart[],
  transcribe: (part: AudioPart, index: number) => Promise<ASRResult>,
  progress: (done: number, total: number) => void,
  concurrency = 3,
): Promise<ASRResult> {
  if (!parts.length || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('并行识别参数无效。');
  const results: ASRResult[] = new Array(parts.length);
  const failures: number[] = [];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, async () => {
    while (next < parts.length && failures.length === 0) {
      const index = next++;
      try { results[index] = await transcribe(parts[index], index); }
      catch { failures.push(index + 1); }
      done++;
      progress(done, parts.length);
    }
  }));
  // All workers have settled before callers release public URLs and temporary files.
  if (failures.length) throw new Error(`第 ${failures.sort((a, b) => a - b).join('、')} 段识别失败，未交付不完整字幕。请检查百炼任务后重试。`);
  const subtitles = results.flatMap((result, index) => result.subtitles.map((subtitle, i) => {
    const duration = parts[index].end - parts[index].start;
    if (!Number.isFinite(subtitle.start) || !Number.isFinite(subtitle.end) || subtitle.start < 0 || subtitle.end <= subtitle.start || subtitle.start >= duration || subtitle.end > duration + 1) throw new Error('识别返回的时间戳超出分段范围，未覆盖原字幕。');
    return { ...subtitle, id: `asr-part-${index}-${i}`, start: parts[index].start + subtitle.start, end: parts[index].start + Math.min(duration, subtitle.end) };
  })).sort((a, b) => a.start - b.start);
  return { transcript: results.map(result => result.transcript).join(' ').trim(), subtitles };
}
