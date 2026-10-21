import { uiText, useLanguage } from "../lib/language";
import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Headphones, MessageCircle, RotateCcw, ChevronRight } from 'lucide-react';
import { IELTSWord, WordProgress, DailyStats, StudyMaterial } from '../types';
import { apiGetMaterialCatalog } from '../lib/authApi';
import { SCENE_DOMAINS, matchesScene } from '../lib/sceneCatalog';
import { catalogType, formatDuration, materialDuration, MATERIAL_TYPES } from '../lib/materialCatalog';
import { localDateKey } from '../lib/study';

interface DashboardProps {
  vocabulary: IELTSWord[];
  progress: Record<string, WordProgress>;
  stats: DailyStats[];
  dailyGoal: number;
  streak: number;
  onNavigate: (tab: string) => void;
  onOpenMaterial?: (id: string) => void;
  onBrowseScene?: (domain: string, scene?: string) => void;
}

export default function Dashboard({ vocabulary, progress, stats, dailyGoal, streak, onNavigate, onOpenMaterial, onBrowseScene }: DashboardProps) {
  useLanguage();
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [showStats, setShowStats] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    apiGetMaterialCatalog().then(catalog => {
      if (active) setMaterials(catalog.materials.filter(material => material.isPublished !== false) as StudyMaterial[]);
    }).catch(reason => { if (active) setError(reason.message || '暂时无法读取材料'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  let recentIds: string[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem('ielts_recent_material_ids') || '[]');
    if (Array.isArray(stored)) recentIds = stored.filter(id => typeof id === 'string');
  } catch { /* A malformed recent list must not prevent learning. */ }
  const recent = recentIds.flatMap(id => materials.find(material => material.id === id) || [])[0];
  const featured = recent || materials.find(material => material.scene) || materials[0];
  const domains = SCENE_DOMAINS.map(domain => ({
    ...domain, materials: materials.filter(material => matchesScene(material.scene, domain.name)),
  }));
  const available = domains.filter(domain => domain.materials.length);
  const displayedDomains = (available.length ? available : domains).slice(0, 4);
  const open = () => featured && (onOpenMaterial ? onOpenMaterial(featured.id) : onNavigate('materials'));
  const browse = (domain: string, scene?: string) => onBrowseScene ? onBrowseScene(domain, scene) : onNavigate('materials');
  const due = vocabulary.filter(word => progress[word.id]?.timesReviewed > 0 && new Date(progress[word.id].nextReviewDate) <= new Date()).length;
  const collected = vocabulary.filter(word => word.custom || word.sourceMaterialId).length;
  const today = stats.find(item => item.date === localDateKey());
  const reviewed = today?.wordsReviewed || 0;
  const goal = Math.max(1, dailyGoal);

  return <div id="dashboard-view" className="ui-page-stack">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="ui-kicker">FROM LIFE TO SPEAKING</p><h1 className="ui-page-title mt-3">{uiText("把生活里的英语，变成自己的表达。")}</h1><p className="ui-description mt-3">{uiText("从一个熟悉的场景开始，听懂、积累，再试着说出来。")}</p></div>
      <span className="text-xs text-stone-500">{uiText("已连续学习")} {streak} {uiText("天")}</span>
    </header>

    <section aria-label={uiText("今日学习起点")} className="ui-hero grid overflow-hidden lg:grid-cols-[1.55fr_1fr]">
      <div className="ui-hero-main relative text-[#faf7ef]">
        <p className="ui-kicker flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />{recent ? uiText('接着上次，继续积累') : uiText('今天，从一份材料开始')}</p>
        <p className="ui-hero-domain ui-hero-meta mt-8">{featured?.scene ? uiText(featured.scene.domain) : uiText('真实材料 · 场景表达')}</p>
        <h2 className="ui-hero-title mt-3 max-w-xl">{uiText(featured?.scene?.primary) || uiText('先找到你想聊的生活场景')}</h2>
        <p className="mt-4 max-w-lg text-sm leading-7 text-[#d1d5c7]">{featured ? featured.name : uiText('日常饮食、亲友相处、出行经历……把材料中的一句好表达，带回自己的生活。')}</p>
        {featured && <p className="ui-hero-meta mt-4">{uiText(MATERIAL_TYPES.find(item => item.id === catalogType(featured))?.label)}{materialDuration(featured) > 0 && ` · ${formatDuration(materialDuration(featured))}`}{!!featured.scene?.practice.length && ` · ${featured.scene.practice.map(uiText).join(' / ')}`}</p>}
        <button id="btn-start-scene" disabled={loading || !!error} onClick={featured ? open : () => onNavigate('materials')} className="ui-button ui-button-primary mt-8">{loading ? uiText('正在读取材料…') : featured ? recent ? uiText('继续学习') : uiText('打开这份材料') : uiText('浏览生活场景')}<ArrowRight className="h-4 w-4" /></button>
        {!!error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-amber-200"><span>{uiText(error)}</span><button onClick={() => setReload(value => value + 1)} className="underline">{uiText("重新读取")}</button></div>}
      </div>
      <div className="ui-learning-route flex flex-col justify-center">
        <p className="ui-route-eyebrow ui-kicker">{uiText("本次学习，可以这样开始")}</p>
        <div className="ui-route-steps mt-5 space-y-5">{[
          { icon: Headphones, title: '理解原句', description: '观看、收听或阅读材料，结合字幕理解原句。' },
          { icon: BookOpen, title: '留下表达', description: '划选词汇查询，保存值得积累的用法。' },
          { icon: MessageCircle, title: '自己说一说', description: '换成你的人物、地点和感受，试着自行复述。' },
        ].map((step, index) => <div key={step.title} className="ui-route-step"><span className="ui-route-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full"><step.icon className="h-4 w-4" /></span><div><p className="ui-route-title"><span className="mr-2 font-mono text-[10px] text-amber-800">0{index + 1}</span>{uiText(step.title)}</p><p className="ui-route-description mt-1">{uiText(step.description)}</p></div></div>)}</div>
      </div>
    </section>

    <section aria-label={uiText("场景学习入口")}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="ui-section-title">{uiText("今天，想聊点什么？")}</h2><p className="mt-2 text-xs text-stone-500">{uiText("从真实经历找表达，为日常交流与雅思口语积累素材。")}</p></div><button onClick={() => onNavigate('materials')} className="ui-button ui-button-text">{uiText("浏览全部场景")}<ArrowUpRight className="h-3.5 w-3.5" /></button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{displayedDomains.map((domain, index) => {
        const example = domain.materials[0]?.scene?.domain === domain.name ? domain.materials[0].scene.primary : domain.scenes[0];
        return <button key={domain.name} onClick={() => browse(domain.name)} className="ui-scene-card group text-left">
          <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-amber-800">SCENE / 0{index + 1}</span><ChevronRight className="h-4 w-4 text-stone-400 transition group-hover:translate-x-1" /></div>
          <h3 className="mt-6 font-serif text-lg font-bold text-stone-900">{uiText(domain.name)}</h3><p className="mt-2 min-h-10 text-xs leading-5 text-stone-500">{uiText(example)}</p><p className="ui-scene-count mt-5 pt-1">{loading ? uiText('正在读取…') : domain.materials.length ? uiText(`${domain.materials.length} 份可学材料`) : uiText('材料待更新')}</p>
        </button>;
      })}</div>
    </section>

    <section aria-label={uiText("积累与复习")} className="grid gap-4 sm:grid-cols-2">
      <button onClick={() => onNavigate('wordlist')} className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-[#f0eee6] p-5 text-left"><div><p className="text-sm font-semibold text-stone-900">{uiText("我的积累")}</p><p className="mt-2 text-xs leading-6 text-stone-500">{collected ? uiText(`已收集 ${collected} 条词汇，回到来源再看一次用法。`) : uiText('学习时划词收藏，在这里回看词义与来源。')}</p></div><BookOpen className="h-5 w-5 shrink-0 text-stone-500" /></button>
      <button id="btn-quick-learn" onClick={() => onNavigate('flashcards')} className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 text-left"><div><p className="text-sm font-semibold text-stone-900">{due ? uiText(`${due} 条词汇，到了复习时间`) : uiText('温习已经积累的词汇')}</p><p className="mt-2 text-xs leading-6 text-stone-500">{uiText("今日已复习")} {reviewed} / {goal} {uiText("条 · 按自己的节奏继续。")}</p></div><RotateCcw className="h-5 w-5 shrink-0 text-amber-800" /></button>
    </section>

    <section className="border-t border-stone-200 pt-4"><button aria-expanded={showStats} onClick={() => setShowStats(value => !value)} className="flex w-full items-center justify-between text-xs text-stone-500">{uiText("学习记录与工具")}<ChevronRight className={`h-4 w-4 transition ${showStats ? 'rotate-90' : ''}`} /></button>
      {showStats && <div className="mt-5 space-y-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ['今日学习', `${Math.round(today?.minutesSpent || 0)} 分钟`], ['今日复习', `${reviewed} 条`], ['词汇总量', `${vocabulary.length} 条`], ['已复习词汇', `${vocabulary.filter(word => progress[word.id]?.timesReviewed > 0).length} 条`],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-stone-200 bg-white p-4"><p className="text-xs text-stone-500">{uiText(label)}</p><p className="mt-2 font-serif text-xl text-stone-900">{uiText(value)}</p></div>)}</div><div className="flex flex-wrap gap-4"><button id="btn-quick-quiz" onClick={() => onNavigate('quizzes')} className="text-xs font-semibold text-stone-600 underline">{uiText("词汇自测")}</button><button id="btn-quick-ai" onClick={() => onNavigate('ai-coach')} className="text-xs font-semibold text-stone-600 underline">{uiText("AI 学习辅导")}</button></div></div>}
    </section>
  </div>;
}
