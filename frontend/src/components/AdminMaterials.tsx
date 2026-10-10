import React, { useEffect, useState } from 'react';
import { apiDeleteSharedMaterial, apiGetMaterialCatalog, apiImportSharedMaterials, apiSaveSharedFolders, apiSaveSharedMaterial, apiSnapshot } from '../lib/authApi';
import { subtitlesToOriginalTranscript } from '../lib/subtitles';
import { apiFetch } from '../lib/apiUrl';

type Caption = { id: string; start: number; end: number; text: string; translation: string };
type Material = Record<string, any> & { id: string; name: string; url?: string; content?: string; videoSubtitles?: Caption[] };

const CATEGORIES = [
  { id: 'reading', label: '阅读' }, { id: 'writing', label: '写作' },
  { id: 'speaking', label: '口语' }, { id: 'listening', label: '听力' },
];
const FOLDERS = CATEGORIES.map(category => ({ id: `shared-${category.id}`, name: category.label, category: category.id, createdAt: '2026-01-01T00:00:00.000Z' }));

function timedRowsToSubtitles(text: string): Caption[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap((line, index) => {
    const match = line.match(/^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!match) return [];
    const [english, translation = ''] = match[3].split(/\s+\|\s+/, 2);
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!english?.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ id: `caption-${index}-${start}`, start, end, text: english.trim(), translation: translation.trim() }];
  });
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => typeof event.target?.result === 'string' ? resolve(event.target.result.split(',')[1] || '') : reject(new Error('读取字幕文件失败'));
    reader.onerror = () => reject(new Error('读取字幕文件失败'));
    reader.readAsDataURL(file);
  });
}

export default function AdminMaterials() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('listening');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const catalog = await apiGetMaterialCatalog();
      setMaterials(catalog.materials as Material[]);
      setNotice('');
    } catch (error: any) {
      setNotice(error.message || '读取共享材料失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setEditingId(''); setName(''); setCategory('listening'); setUrl(''); setContent(''); setCaptionText(''); setCaptions([]);
  };

  const handleCaptionFile = async (file?: File) => {
    if (!file) return;
    setSaving(true);
    try {
      const base64 = await readFileBase64(file);
      const response = await apiFetch('/api/materials/parse-subtitle-sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name, duration: 3600 }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.subtitles)) throw new Error(data.error || '字幕解析失败');
      setCaptions(data.subtitles);
      setContent(subtitlesToOriginalTranscript(data.subtitles));
      setCaptionText(data.subtitles.map((subtitle: Caption) => `[${subtitle.start}-${subtitle.end}] ${subtitle.text}${subtitle.translation ? ` | ${subtitle.translation}` : ''}`).join('\n'));
      setNotice(`字幕已解析：${data.subtitles.length} 段。保存材料后，学习页即可同步播放。`);
    } catch (error: any) { setNotice(error.message || '字幕解析失败'); }
    finally { setSaving(false); }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setNotice('请填写材料标题'); return; }
    const parsedCaptions = captions.length ? captions : timedRowsToSubtitles(captionText);
    const original = content.trim() || subtitlesToOriginalTranscript(parsedCaptions);
    const material: Material = {
      id: editingId || `shared-${crypto.randomUUID()}`,
      name: name.trim(), type: url.trim() ? 'video' : 'document', category,
      folderId: `shared-${category}`, url: url.trim() || undefined,
      content: original, notes: '', timestamp: new Date().toISOString(),
      sentences: original ? original.split(/(?<=[.!?])\s+/).filter(Boolean) : [],
      videoSubtitles: parsedCaptions,
    };
    setSaving(true);
    try {
      await apiSaveSharedFolders(FOLDERS);
      await apiSaveSharedMaterial(material);
      setNotice('材料已发布到共享目录。');
      resetForm();
      await load();
    } catch (error: any) { setNotice(error.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const handleEdit = (material: Material) => {
    setEditingId(material.id); setName(material.name); setCategory(material.category || 'listening');
    setUrl(material.url || ''); setContent(material.content || ''); setCaptions(material.videoSubtitles || []);
    setCaptionText((material.videoSubtitles || []).map(caption => `[${caption.start}-${caption.end}] ${caption.text}${caption.translation ? ` | ${caption.translation}` : ''}`).join('\n'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('删除后会从所有学习账号的共享材料列表中移除。确定删除？')) return;
    try { await apiDeleteSharedMaterial(id); await load(); }
    catch (error: any) { setNotice(error.message || '删除失败'); }
  };

  const handleLegacyImport = async () => {
    let legacyMaterials: Material[] = [];
    let legacyFolders: any[] = [];
    try {
      legacyMaterials = JSON.parse(localStorage.getItem('ielts_legacy_material_migration_backup') || localStorage.getItem('ielts_material_files') || '[]');
      legacyFolders = JSON.parse(localStorage.getItem('ielts_legacy_folder_migration_backup') || localStorage.getItem('ielts_material_folders') || '[]');
    } catch { setNotice('当前浏览器中的旧材料格式无法读取。'); return; }
    if (!legacyMaterials.length) {
      try {
        const snapshot = await apiSnapshot();
        legacyMaterials = JSON.parse(snapshot.data.ielts_material_files || '[]');
        legacyFolders = JSON.parse(snapshot.data.ielts_material_folders || '[]');
      } catch { /* Local legacy data remains the preferred source. */ }
    }
    const eligible = legacyMaterials.filter(material => material.type !== 'audio' && !String(material.url || '').startsWith('blob:'));
    if (!eligible.length) { setNotice('当前账号没有可迁移的网页、视频或文档材料；本地音频不能迁移为共享材料。'); return; }
    setImporting(true);
    try {
      const result = await apiImportSharedMaterials(eligible, legacyFolders);
      localStorage.removeItem('ielts_legacy_material_migration_backup');
      localStorage.removeItem('ielts_legacy_folder_migration_backup');
      await load();
      setNotice(`已迁移 ${result.imported} 份材料；跳过 ${result.skipped} 份本地音频或临时链接材料。`);
    } catch (error: any) { setNotice(error.message || '迁移旧材料失败'); }
    finally { setImporting(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-amber-700">管理员工作台</p>
        <h1 className="mt-1 text-2xl font-serif font-bold text-stone-900">共享学习材料管理</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">在这里发布视频链接、英文原文和双语字幕。普通学习页面只读取已发布内容，不再提供材料上传或语音转写。</p>
      </header>

      <form onSubmit={handleSave} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-stone-900">{editingId ? '编辑材料' : '发布新材料'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-stone-600">材料标题
            <input value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border border-stone-300 p-2 text-sm" placeholder="例如：Nanotechnology and Its Applications" />
          </label>
          <label className="space-y-1 text-xs font-semibold text-stone-600">学习分类
            <select value={category} onChange={event => setCategory(event.target.value)} className="w-full rounded-lg border border-stone-300 p-2 text-sm">
              {CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">视频链接（可留空，支持 YouTube 等可嵌入链接）
          <input value={url} onChange={event => setUrl(event.target.value)} className="w-full rounded-lg border border-stone-300 p-2 text-sm" placeholder="https://www.youtube.com/watch?v=..." />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">字幕表格
          <input type="file" accept=".xlsx,.xls,.csv" disabled={saving} onChange={event => { void handleCaptionFile(event.target.files?.[0]); event.target.value = ''; }} className="block w-full rounded-lg border border-stone-300 p-2 text-xs" />
          <span className="block font-normal text-stone-400">支持带 Time、Subtitle 列的 Excel/CSV。字幕和翻译会导入服务器，并保留时间轴。</span>
        </label>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">带时间轴字幕（格式：[0-4.5] English | 中文翻译）
          <textarea rows={8} value={captionText} onChange={event => { setCaptionText(event.target.value); setCaptions([]); }} className="w-full rounded-lg border border-stone-300 p-3 font-mono text-xs leading-relaxed" placeholder={'[0-5.2] Welcome back to my study vlog! | 欢迎回到我的学习VLOG！\n[5.2-12.0] Today we are analyzing IELTS collocations. | 今天我们正在分析雅思词伙搭配。'} />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">纯英文原文（字幕导入后自动生成，也可以直接粘贴）
          <textarea rows={4} value={content} onChange={event => setContent(event.target.value)} className="w-full rounded-lg border border-stone-300 p-3 text-sm leading-relaxed" placeholder="完整英文原文……" />
        </label>
        <div className="flex gap-2">
          <button disabled={saving} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '正在保存…' : editingId ? '保存修改并发布' : '发布到学习页'}</button>
          {editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">取消编辑</button>}
          <button type="button" onClick={() => void handleLegacyImport()} disabled={importing} className="ml-auto rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">{importing ? '迁移中…' : '迁移此账号旧材料'}</button>
        </div>
        {notice && <p role="status" className="text-xs text-stone-600">{notice}</p>}
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-bold text-stone-900">已发布材料</h2><span className="text-xs text-stone-500">{materials.length} 份</span></div>
        {loading ? <p className="text-sm text-stone-500">正在读取…</p> : materials.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">共享目录还没有材料。可先迁移旧材料，或发布第一份视频字幕。</p> : materials.map(material => (
          <article key={material.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <div className="min-w-0"><h3 className="truncate font-semibold text-stone-900">{material.name}</h3><p className="truncate text-xs text-stone-500">{material.url || '纯文本材料'} · {material.videoSubtitles?.length || 0} 段字幕</p></div>
            <div className="flex gap-2"><button onClick={() => handleEdit(material)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold">编辑</button><button onClick={() => void handleDelete(material.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700">删除</button></div>
          </article>
        ))}
      </section>
    </div>
  );
}
