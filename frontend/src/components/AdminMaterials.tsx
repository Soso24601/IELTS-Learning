import React, { useEffect, useState } from 'react';
import { apiDeleteSharedMaterial, apiGetAdminMaterials, apiImportSharedMaterials, apiSaveSharedFolders, apiSaveSharedMaterial, apiSnapshot } from '../lib/authApi';
import { subtitlesToOriginalTranscript } from '../lib/subtitles';
import { apiFetch } from '../lib/apiUrl';
import { inspectCaptionDraft, inspectVideoLink, subtitleFileToDraft } from '../lib/materialDraft';

type Caption = { id: string; start: number; end: number; text: string; translation?: string };
type Material = Record<string, any> & { id: string; name: string; url?: string; content?: string; videoSubtitles?: Caption[] };

const CATEGORIES = [
  { id: 'reading', label: '阅读' }, { id: 'writing', label: '写作' },
  { id: 'speaking', label: '口语' }, { id: 'listening', label: '听力' },
];
const FOLDERS = CATEGORIES.map(category => ({ id: `shared-${category.id}`, name: category.label, category: category.id, createdAt: '2026-01-01T00:00:00.000Z' }));

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
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [editingPublished, setEditingPublished] = useState(true);
  const [editingId, setEditingId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('listening');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [notice, setNotice] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const inspection = inspectCaptionDraft(captionText);
  const video = inspectVideoLink(url);
  const draftCaptions = inspection.captions;
  const original = content.trim() || subtitlesToOriginalTranscript(draftCaptions);
  const issues = [...inspection.errors, ...(video.error ? [video.error] : []), ...(mediaError ? [mediaError] : [])];
  const valid = Boolean(name.trim() && (url.trim() || original || draftCaptions.length) && !issues.length);

  const load = async () => {
    setLoading(true);
    try {
      const catalog = await apiGetAdminMaterials();
      setMaterials(catalog.materials as Material[]);
    } catch (error: any) {
      setNotice(error.message || '读取共享材料失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setEditingPublished(true); setEditingId(''); setName(''); setCategory('listening'); setUrl(''); setContent(''); setCaptionText(''); setPreviewing(false); setMediaError('');
  };

  const handleCaptionFile = async (file?: File) => {
    if (!file) return;
    setSaving(true);
    try {
      if (/\.(srt|vtt)$/i.test(file.name)) {
        const draft = subtitleFileToDraft(await file.text());
        const result = inspectCaptionDraft(draft);
        setCaptionText(draft);
        setContent('');
        setPreviewing(true);
        setNotice(`已读取 ${file.name}：${result.captions.length} 段字幕，请在预览中检查后发布。`);
        return;
      }
      const base64 = await readFileBase64(file);
      const response = await apiFetch('/api/materials/parse-subtitle-sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name, duration: 3600 }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.subtitles)) throw new Error(data.error || '字幕解析失败');
      setContent('');
      setCaptionText(data.subtitles.map((subtitle: Caption) => `[${subtitle.start}-${subtitle.end}] ${subtitle.text}${subtitle.translation ? ` | ${subtitle.translation}` : ''}`).join('\n'));
      setPreviewing(true);
      setNotice(`字幕已解析：${data.subtitles.length} 段。保存材料后，学习页即可同步播放。`);
    } catch (error: any) { setNotice(error.message || '字幕解析失败'); }
    finally { setSaving(false); }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { setNotice('请填写材料标题'); return; }
    if (!previewing) { setPreviewing(true); return; }
    if (!valid) { setNotice('请修正预览中的问题后再发布。'); return; }
    const parsedCaptions = draftCaptions;
    const material: Material = {
      id: editingId || `shared-${crypto.randomUUID()}`,
      name: name.trim(), isPublished: editingPublished, type: url.trim() ? 'video' : 'document', category,
      folderId: `shared-${category}`, url: url.trim() || undefined,
      content: original, notes: '', timestamp: new Date().toISOString(),
      sentences: original ? original.split(/(?<=[.!?])\s+/).filter(Boolean) : [],
      videoSubtitles: parsedCaptions,
    };
    setSaving(true);
    try {
      await apiSaveSharedFolders(FOLDERS);
      await apiSaveSharedMaterial(material);
      resetForm();
      await load();
      setNotice(`「${material.name}」已${editingPublished ? "发布" : "保存（保持下架）"}，包含 ${parsedCaptions.length} 段字幕。学习页刷新后即可查看。`);
    } catch (error: any) { setNotice(error.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const handleEdit = (material: Material) => {
    setEditingPublished(material.isPublished !== false);
    setEditingId(material.id); setName(material.name); setCategory(material.category || 'listening');
    setUrl(material.url || ''); setContent(material.content === subtitlesToOriginalTranscript(material.videoSubtitles || []) ? '' : material.content || '');
    setCaptionText((material.videoSubtitles || []).map(caption => `[${caption.start}-${caption.end}] ${caption.text}${caption.translation ? ` | ${caption.translation}` : ''}`).join('\n'));
    setPreviewing(false); setMediaError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const togglePublication = async (material: Material) => {
    setUpdatingId(material.id);
    try {
      const isPublished = material.isPublished === false;
      await apiSaveSharedMaterial({ ...material, isPublished });
      await load();
      setNotice(`「${material.name}」已${isPublished ? '上架，学习页刷新后可见' : '下架，学习页刷新后隐藏'}。`);
      if (editingId === material.id) setEditingPublished(isPublished);
    } catch (error: any) { setNotice(error.message || '更新发布状态失败'); }
    finally { setUpdatingId(''); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('删除后会从所有学习账号的共享材料列表中移除。确定删除？')) return;
    try { await apiDeleteSharedMaterial(id); if (editingId === id) resetForm(); await load(); setNotice('材料已删除。'); }
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
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
        <p className="text-xs font-mono uppercase tracking-widest text-amber-700">管理员工作台</p>
        <h1 className="mt-1 text-2xl font-serif font-bold text-stone-900">共享学习材料管理</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">在这里发布视频链接、英文原文和双语字幕。普通学习页面只读取已发布内容，不再提供材料上传或语音转写。</p>
        </div><div className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm"><strong className="text-2xl font-serif">{materials.filter(material => material.isPublished !== false).length}</strong><span className="ml-2 text-stone-500">份已发布材料</span></div>
      </header>

      {notice && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</p>}
      <form onSubmit={handleSave} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <fieldset disabled={saving} className="space-y-4">
        <h2 className="font-bold text-stone-900">{editingId ? '编辑材料' : '发布新材料'}</h2>
        <p className="text-xs text-stone-500">填写材料 → 导入字幕 → 预览检查 → 发布到学习页</p>
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
          <input value={url} onChange={event => { setUrl(event.target.value); setMediaError(''); }} className="w-full rounded-lg border border-stone-300 p-2 text-sm" placeholder="https://www.youtube.com/watch?v=..." />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">字幕文件
          <input type="file" accept=".xlsx,.xls,.csv,.srt,.vtt" disabled={saving} onChange={event => { void handleCaptionFile(event.target.files?.[0]); event.target.value = ''; }} className="block w-full rounded-lg border border-stone-300 p-2 text-xs" />
          <span className="block font-normal text-stone-400">支持带 Time、Subtitle 列的 Excel/CSV，以及 SRT、VTT。字幕和翻译会导入服务器，并保留时间轴。</span>
        </label>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">带时间轴字幕（格式：[0-4.5] English | 中文翻译）
          <textarea rows={8} value={captionText} onChange={event => { setCaptionText(event.target.value); }} className="w-full rounded-lg border border-stone-300 p-3 font-mono text-xs leading-relaxed" placeholder={'[0-5.2] Welcome back to my study vlog! | 欢迎回到我的学习VLOG！\n[5.2-12.0] Today we are analyzing IELTS collocations. | 今天我们正在分析雅思词伙搭配。'} />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-stone-600">纯英文原文（留空时随字幕自动生成，也可以填写自定义原文）
          <textarea rows={4} value={content} onChange={event => setContent(event.target.value)} className="w-full rounded-lg border border-stone-300 p-3 text-sm leading-relaxed" placeholder={subtitlesToOriginalTranscript(draftCaptions) || "完整英文原文……"} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button disabled={saving || (previewing && !valid)} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '正在处理…' : !previewing ? '预览并检查' : editingId ? (editingPublished ? '确认修改并发布' : '保存修改（保持下架）') : '确认发布到学习页'}</button>
          {editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">取消编辑</button>}
          <button type="button" onClick={() => void handleLegacyImport()} disabled={importing} className="ml-auto rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">{importing ? '迁移中…' : '迁移此账号旧材料'}</button>
        </div>

        {previewing && <section className="space-y-4 rounded-xl border border-stone-300 bg-stone-50 p-4" aria-label="材料发布预览">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-serif text-lg font-bold">发布预览 · {name || '未填写标题'}</h3><span className="text-xs text-stone-500">{draftCaptions.length} 段字幕 · {original.split(/\s+/).filter(Boolean).length} 个词</span></div>
          {!name.trim() && <p className="text-sm text-rose-700">请填写材料标题。</p>}
          {!url.trim() && !original && !draftCaptions.length && <p className="text-sm text-rose-700">请添加视频链接、字幕或英文原文。</p>}
          {!!issues.length && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><p className="font-semibold">以下问题需要修正：</p><ul className="mt-2 list-inside list-disc">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
          {inspection.removed > 0 && <p className="text-xs text-stone-500">已自动移除 {inspection.removed} 段音乐标注。</p>}
          {video.preview && (video.direct ? <video key={video.preview} controls src={video.preview} onError={() => setMediaError('视频无法加载，请检查链接是否公开可访问。')} className="aspect-video w-full rounded-lg bg-stone-900" /> : <iframe title="视频发布预览" src={video.preview} className="aspect-video w-full rounded-lg" allow="fullscreen" allowFullScreen />)}
          {url.trim() && !video.error && <p className="text-xs text-stone-500"><a href={url.trim()} target="_blank" rel="noopener noreferrer" className="underline">打开原视频检查</a> · 请确认可以播放，字幕对应同一个视频；网址格式检查通过不代表视频允许嵌入。</p>}
          {draftCaptions.length > 0 && <div className="max-h-72 space-y-2 overflow-auto">{draftCaptions.map(caption => <article key={caption.id} className="rounded-lg border border-stone-200 bg-white p-3"><p className="mb-1 font-mono text-xs text-amber-800">{caption.start}s — {caption.end}s</p><p className="text-sm">{caption.text}</p>{caption.translation && <p className="mt-1 text-xs text-stone-500">{caption.translation}</p>}</article>)}</div>}
          {original && <details><summary className="cursor-pointer text-sm font-semibold">查看完整英文原文</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{original}</p></details>}
          {valid && <p className="text-xs text-emerald-700">格式与时间轴检查通过。确认视频与字幕匹配后，点击“确认发布”。</p>}
        </section>}
        </fieldset>
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-bold text-stone-900">材料目录</h2><span className="text-xs text-stone-500">{materials.length} 份</span></div>
        <input aria-label="搜索材料" value={search} onChange={event => setSearch(event.target.value)} placeholder="按标题搜索材料" className="w-full rounded-xl border border-stone-300 bg-white p-3 text-sm" />
        {loading ? <p className="text-sm text-stone-500">正在读取…</p> : materials.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">共享目录还没有材料。可先迁移旧材料，或发布第一份视频字幕。</p> : materials.filter(material => material.name.toLowerCase().includes(search.toLowerCase())).map(material => (
          <article key={material.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <div className="min-w-0 w-full sm:flex-1"><h3 className="truncate font-semibold text-stone-900">{material.name}<span className="ml-2 text-xs font-normal text-stone-500">{material.isPublished === false ? "已下架" : "已发布"}</span></h3><p className="truncate text-xs text-stone-500">{material.url || '纯文本材料'} · {material.videoSubtitles?.length || 0} 段字幕</p></div>
            <div className="flex gap-2"><button disabled={!!updatingId || saving} onClick={() => void togglePublication(material)} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50">{updatingId === material.id ? "处理中…" : material.isPublished === false ? "上架" : "下架"}</button><button disabled={saving || !!updatingId} onClick={() => handleEdit(material)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold">编辑</button><button disabled={saving || !!updatingId} onClick={() => void handleDelete(material.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700">删除</button></div>
          </article>
        ))}
      </section>
    </div>
  );
}
