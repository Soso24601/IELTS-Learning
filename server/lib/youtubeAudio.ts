import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** Only canonical public YouTube video URLs may reach the downloader. */
export function youtubeVideoId(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('请填写完整的 YouTube 视频链接。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('请填写有效的 YouTube 视频链接。');
  }
  const host = url.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('链接不是有效的 YouTube 视频，请复制单个视频的分享链接。');
  return id;
}

export function youtubeDownloadError(error: any): Error {
  const text = String(error?.stderr || error?.message || '');
  if (error?.code === 'ENOENT') return new Error('服务器尚未安装音轨提取工具，请部署最新 Docker 版本。');
  if (/sign in|bot|po token|403|429|private|unavailable|age.restricted/i.test(text)) {
    return new Error('YouTube 限制了服务器获取这个视频的音轨。可在当前视频的字幕面板上传对应音频，原视频链接会保留；无需改成音频材料。');
  }
  if (error?.killed || error?.code === 'ABORT_ERR' || /timed out|timeout/i.test(text)) {
    return new Error('获取 YouTube 音轨超时，请稍后重试或上传对应音频。');
  }
  return new Error('无法获取 YouTube 音轨。请确认视频公开且能播放，或在当前视频中上传对应音频。');
}

export async function downloadYoutubeAudio(id: string, directory: string): Promise<{ path: string; mimeType: string }> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('视频编号不合法。');
  const executable = process.env.YT_DLP_PATH || 'yt-dlp';
  const common = ['--ignore-config', '--no-playlist', '--js-runtimes', 'node', '--socket-timeout', '20', '--retries', '1', '--quiet', '--no-warnings', '-f', 'bestaudio'];
  const url = `https://www.youtube.com/watch?v=${id}`;
  let info: any;
  try {
    const result = await execFileAsync(executable, [...common, '--skip-download', '--dump-single-json', '--', url], { timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    info = JSON.parse(result.stdout);
  } catch (error) { throw youtubeDownloadError(error); }
  if (info.is_live || info.live_status === 'is_live') throw new Error('暂不支持正在直播的视频，请在直播结束后识别。');
  if (!Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 3 * 3600) throw new Error('请使用时长不超过 3 小时的普通视频。');
  if ((info.filesize || info.filesize_approx || 0) > MAX_AUDIO_BYTES) throw new Error('音轨超过 200 MB，请上传需要学习的音频片段。');
  let output: string;
  let sizeExceeded = false;
  let watching = false;
  let monitor: ReturnType<typeof setInterval> | undefined;
  try {
    const download = execFileAsync(executable, [...common, '--no-progress', '--max-filesize', String(MAX_AUDIO_BYTES), '--print', 'after_move:filepath', '-o', path.join(directory, 'audio.%(ext)s'), '--', url], { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 });
    // Some streams omit Content-Length, so also bound bytes actually written.
    monitor = setInterval(async () => {
      if (watching) return;
      watching = true;
      try {
        const sizes = await Promise.all((await readdir(directory)).map(async name => (await stat(path.join(directory, name))).size));
        if (sizes.reduce((sum, size) => sum + size, 0) > MAX_AUDIO_BYTES) {
          sizeExceeded = true;
          download.child.kill('SIGKILL');
        }
      } catch { /* A partial file may be renamed while being inspected. */ }
      finally { watching = false; }
    }, 500);
    const result = await download;
    output = result.stdout.trim().split('\n').pop() || '';
  } catch (error) {
    if (sizeExceeded) throw new Error('音轨超过 200 MB，请上传较短的音频片段。');
    throw youtubeDownloadError(error);
  } finally { if (monitor) clearInterval(monitor); }
  if (!output || path.dirname(path.resolve(output)) !== path.resolve(directory)) throw new Error('未能获得音频文件，可能超过 200 MB 限制。');
  const details = await stat(output);
  if (!details.size || details.size > MAX_AUDIO_BYTES) throw new Error('音轨为空或超过 200 MB，请上传较短的音频片段。');
  const mimeTypes: Record<string, string> = { '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };
  const mimeType = mimeTypes[path.extname(output)];
  if (!mimeType) throw new Error('音轨格式暂不支持，请上传 MP3、M4A 或 WebM 文件。');
  return { path: output, mimeType };
}
