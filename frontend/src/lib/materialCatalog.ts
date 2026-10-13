export type CatalogType = 'video' | 'audio' | 'document';
export const MATERIAL_TYPES = [
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
  { id: 'document', label: '文章' },
] as const;

export const MATERIAL_TOPICS = ['日常生活', '校园', '教育', '科技', '环境', '健康', '职场', '商业与经济', '旅行', '文化与艺术', '社会', '历史', '体育'];

export function catalogTopics(materials: { tags?: unknown }[]): string[] {
  const existing = [...new Set(materials.flatMap(material => materialTags(material.tags)))];
  return [...MATERIAL_TOPICS.filter(topic => existing.includes(topic)), ...existing.filter(topic => !MATERIAL_TOPICS.includes(topic)).sort((a, b) => a.localeCompare(b, 'zh-CN'))];
}

/** Old web links are videos only when they identify a supported video source. */
export function catalogType(material: { type?: string; url?: string }): CatalogType {
  if (material.type === 'audio' || material.type === 'video') return material.type;
  if (material.type === 'link' && material.url) {
    try {
      const url = new URL(material.url);
      if (/(^|\.)(youtube\.com|youtu\.be|bilibili\.com|ted\.com)$/.test(url.hostname) || /\.(mp4|webm|ogg)$/i.test(url.pathname)) return 'video';
      if (/\.(mp3|m4a|wav|aac|flac)$/i.test(url.pathname)) return 'audio';
    } catch { /* Unknown legacy links belong to articles. */ }
  }
  return 'document';
}

export function materialTags(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，;；]/) : [];
  return [...new Set(entries.map(tag => String(tag).trim().slice(0, 30)).filter(Boolean))].slice(0, 12);
}

export function materialDuration(material: { duration?: number; videoSubtitles?: { end: number }[] }): number {
  if (Number.isFinite(material.duration) && material.duration! > 0) return material.duration!;
  return (material.videoSubtitles || []).reduce((duration, cue) => Number.isFinite(cue.end) ? Math.max(duration, cue.end) : duration, 0);
}

export function filterCatalog<T extends { type?: string; url?: string; name: string; tags?: string[] }>(materials: T[], type: CatalogType | 'all', query = '', topic = ''): T[] {
  const search = query.trim().toLowerCase();
  return materials.filter(material => {
    const tags = materialTags(material.tags);
    return (type === 'all' || catalogType(material) === type) && (!topic || tags.includes(topic)) && (!search || [material.name, ...tags].join(' ').toLowerCase().includes(search));
  });
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
