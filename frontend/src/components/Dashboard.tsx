import { SceneArt, domainArt } from './Brand';
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
    <div className="page-welcome"><span>{uiText('今天，从一句话开始。')}</span><span>{uiText('已连续学习')} <b>{streak}</b> {uiText('天')}</span></div>
    <section aria-label={uiText("今日学习起点")} className="speaking-hero">
      <div className="speaking-hero-copy"><p className="ui-kicker">A LITTLE ENGLISH. EVERY DAY.</p><h1>{uiText('把想说的话，')}<br/>{uiText('说出来。')}</h1><p className="hero-description">{uiText('从真实场景开始，积累今天用得上的英语。')}</p>
        <button id="btn-start-scene" disabled={loading || !!error} onClick={featured ? open : () => onNavigate('materials')} className="ui-button ui-button-primary hero-cta">{loading ? uiText('正在读取材料…') : featured ? recent ? uiText('继续学习') : uiText('打开这份材料') : uiText('浏览生活场景')}<ArrowUpRight size={20}/></button>
        <div className="hero-current"><span>{recent ? uiText('接着上次') : uiText('今日起点')}</span><h2>{uiText(featured?.scene?.primary) || uiText('先找到你想聊的生活场景')}</h2>{featured && <p>{featured.name}</p>}</div>
        {!!error && <div role="alert" className="hero-error"><span>{uiText(error)}</span><button onClick={() => setReload(value => value + 1)}>{uiText('重新读取')}</button></div>}
      </div><div className="speaking-hero-art"><SceneArt eager/><span>YOUR VOICE MATTERS</span></div>
    </section>
    <section aria-label={uiText("场景学习入口")}>
      <div className="section-heading"><div><p className="ui-kicker">LIFE, IN YOUR WORDS</p><h2 className="ui-section-title">{uiText('今天，想聊点什么？')}</h2></div><button onClick={() => onNavigate('materials')} className="ui-button ui-button-text">{uiText('浏览全部场景')}<ArrowUpRight size={17}/></button></div>
      <div className="scene-card-grid">{displayedDomains.map((domain, index) => {
        const example = domain.materials[0]?.scene?.domain === domain.name ? domain.materials[0].scene.primary : domain.scenes[0];
        return <button key={domain.name} onClick={() => browse(domain.name)} className={`ui-scene-card scene-color-${index} group text-left`}><div className="scene-card-top"><span>0{index + 1}</span><ArrowUpRight size={20}/></div><SceneArt kind={domainArt(domain.name)}/><h3>{uiText(domain.name)}</h3><p className="scene-example">{uiText(example)}</p><p className="ui-scene-count">{loading ? uiText('正在读取…') : domain.materials.length ? uiText(`${domain.materials.length} 份可学材料`) : uiText('材料待更新')}</p></button>;
      })}</div>
    </section>
    <section className="learning-bottom-grid"><div className="learning-steps"><p className="ui-kicker">MAKE IT YOURS</p><h2 className="ui-section-title">{uiText('听懂一句，再用出一句。')}</h2><div>{[{icon:Headphones,title:'理解原句',description:'结合音视频与字幕，听懂真实表达。'},{icon:BookOpen,title:'留下表达',description:'划词查询，收藏值得积累的用法。'},{icon:MessageCircle,title:'自己说一说',description:'换成自己的经历，试着复述。'}].map((step,index)=><div className="learning-step" key={step.title}><span>0{index+1}</span><step.icon size={20}/><div><strong>{uiText(step.title)}</strong><p>{uiText(step.description)}</p></div></div>)}</div></div>
      <div className="learning-collection"><p className="ui-kicker">A LITTLE, EVERY DAY</p><h2 className="ui-section-title">{uiText('让积累，慢慢发生。')}</h2><button onClick={() => onNavigate('wordlist')}><span><strong>{uiText('我的积累')}</strong><small>{uiText(`已收集 ${collected} 条词汇`)}</small></span><ArrowUpRight size={22}/></button><button id="btn-quick-learn" onClick={() => onNavigate('flashcards')}><span><strong>{due ? uiText(`${due} 条词汇，到了复习时间`) : uiText('温习已经积累的词汇')}</strong><small>{uiText('今日已复习')} {reviewed} / {goal}</small></span><RotateCcw size={22}/></button></div>
    </section>
    <section className="study-record"><button aria-expanded={showStats} onClick={() => setShowStats(value => !value)}>{uiText('学习记录与工具')}<ChevronRight size={18} className={showStats ? 'rotate-90' : ''}/></button>{showStats && <div className="record-content"><div className="record-grid">{[['今日学习',`${Math.round(today?.minutesSpent || 0)} 分钟`],['今日复习',`${reviewed} 条`],['词汇总量',`${vocabulary.length} 条`],['已复习词汇',`${vocabulary.filter(word=>progress[word.id]?.timesReviewed>0).length} 条`]].map(([label,value])=><div key={label}><p>{uiText(label)}</p><strong>{uiText(value)}</strong></div>)}</div><div className="flex gap-6 mt-6"><button id="btn-quick-quiz" onClick={()=>onNavigate('quizzes')} className="underline">{uiText('词汇自测')}</button><button id="btn-quick-ai" onClick={()=>onNavigate('ai-coach')} className="underline">{uiText('AI 学习辅导')}</button></div></div>}</section>
  </div>;
}
