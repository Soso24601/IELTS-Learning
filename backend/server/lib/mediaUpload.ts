import path from 'node:path';

export const MEDIA_MAX_BYTES = 30 * 1024 * 1024;
export const MEDIA_PATH = /^\/api\/media\/[0-9a-f-]{36}\.(mp3|wav|m4a|mp4|webm|ogg)$/;

export function decodeMediaUpload(fileName: string, base64: string, type: string) {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const allowed = type === 'audio' ? ['mp3', 'wav', 'm4a', 'ogg'] : type === 'video' ? ['mp4', 'webm'] : [];
  if (!allowed.includes(extension)) throw new Error('请选择与材料类型一致的音频或视频文件');
  if (!base64 || base64.length > Math.ceil(MEDIA_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('文件无效或超过 30 MB');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) throw new Error('文件无效或超过 30 MB');
  const valid = extension === 'mp3' ? buffer.subarray(0, 3).toString() === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    : extension === 'wav' ? buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE'
    : extension === 'ogg' ? buffer.subarray(0, 4).toString() === 'OggS'
    : extension === 'webm' ? buffer.subarray(0, 4).toString('hex') === '1a45dfa3'
    : buffer.subarray(4, 8).toString() === 'ftyp';
  if (!valid) throw new Error('文件内容与扩展名不一致，请选择有效的媒体文件');
  return { extension, buffer };
}
