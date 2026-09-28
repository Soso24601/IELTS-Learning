/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { 
  Award, 
  Flame, 
  Brain, 
  CheckCircle, 
  BookMarked, 
  TrendingUp,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { IELTSWord, WordProgress, DailyStats } from '../types';

import { localDateKey } from '../lib/study';

interface DashboardProps {
  vocabulary: IELTSWord[];
  progress: Record<string, WordProgress>;
  stats: DailyStats[];
  dailyGoal: number;
  streak: number;
  onNavigate: (tab: string) => void;
}

export default function Dashboard({ 
  vocabulary, 
  progress, 
  stats, 
  dailyGoal, 
  streak, 
  onNavigate 
}: DashboardProps) {
  // Compute progress numbers
  const totalWords = vocabulary.length;
  const progressList = vocabulary.flatMap(word => progress[word.id] ? [progress[word.id]] : []);
  
  const starredCount = useMemo(() => {
    return progressList.filter(p => p.starred).length;
  }, [progressList]);

  const learningStats = useMemo(() => {
    let unlearned = totalWords;
    let box1 = 0; // Box 1: learning / new
    let box2 = 0; // Box 2: familiarizing
    let box3 = 0; // Box 3: familiar
    let box4 = 0; // Box 4: strong memory
    let box5 = 0; // Box 5: mastered

    progressList.forEach(p => {
      if (p.timesReviewed === 0) return;
      unlearned--;
      if (p.box === 1) box1++;
      else if (p.box === 2) box2++;
      else if (p.box === 3) box3++;
      else if (p.box === 4) box4++;
      else if (p.box === 5) box5++;
    });

    const masteredCount = box5;
    const learningCount = box1 + box2 + box3 + box4;
    const progressPercent = totalWords > 0 ? Math.round(((masteredCount + learningCount * 0.5) / totalWords) * 100) : 0;

    return {
      unlearned,
      box1,
      box2,
      box3,
      box4,
      box5,
      masteredCount,
      learningCount,
      progressPercent
    };
  }, [progressList, totalWords]);

  // Today's stats
  const todayStr = localDateKey();
  const todayStats = useMemo(() => {
    const found = stats.find(s => s.date === todayStr);
    return found || { wordsReviewed: 0, wordsLearned: 0, minutesSpent: 0, correctAnswers: 0, totalAnswers: 0 };
  }, [stats, todayStr]);

  // Progress relative to daily goal
  const dailyGoalPercent = Math.min(100, Math.round((todayStats.wordsReviewed / dailyGoal) * 100));

  // Pie chart data for memory boxes
  const pieData = [
    { name: '未学习', value: learningStats.unlearned, color: '#E2E8F0' }, // Slate 200
    { name: '新手 (Box 1)', value: learningStats.box1, color: '#F87171' }, // Red 400
    { name: '初识 (Box 2)', value: learningStats.box2, color: '#FB923C' }, // Orange 400
    { name: '熟悉 (Box 3)', value: learningStats.box3, color: '#FBBF24' }, // Yellow 400
    { name: '牢记 (Box 4)', value: learningStats.box4, color: '#60A5FA' }, // Blue 400
    { name: '掌握 (Box 5)', value: learningStats.box5, color: '#34D399' }  // Emerald 400
  ].filter(d => d.value > 0);

  // Stats history for past 7 days bar chart
  const barData = useMemo(() => {
    // Generate past 7 days
    const list = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = localDateKey(d);
      const match = stats.find(s => s.date === dateStr);
      
      const dayName = d.toLocaleDateString('zh-CN', { weekday: 'short' });
      list.push({
        name: dayName,
        '复习单词': match ? match.wordsReviewed : 0,
        '新词学习': match ? match.wordsLearned : 0,
        '学习时长(分)': match ? match.minutesSpent : 0
      });
    }
    return list;
  }, [stats]);

  // Calculate words currently due for review
  const wordsDueCount = useMemo(() => {
    const now = new Date();
    return progressList.filter(p => {
      return p.timesReviewed > 0 && new Date(p.nextReviewDate) <= now;
    }).length;
  }, [progressList]);

  // Calculate IELTS category proficiency
  const categoryProficiency = useMemo(() => {
    const defaultStats = {
      reading: { total: 0, mastered: 0, learning: 0 },
      writing: { total: 0, mastered: 0, learning: 0 },
      speaking: { total: 0, mastered: 0, learning: 0 },
      listening: { total: 0, mastered: 0, learning: 0 }
    };

    vocabulary.forEach(w => {
      const cat = w.category || 'reading';
      if (!defaultStats[cat]) return;
      defaultStats[cat].total++;
      
      const p = progress[w.id];
      if (p && p.timesReviewed > 0) {
        if (p.box === 5) {
          defaultStats[cat].mastered++;
        } else {
          defaultStats[cat].learning++;
        }
      }
    });

    return defaultStats;
  }, [vocabulary, progress]);

  return (
    <div className="space-y-8 animate-fade-in" id="dashboard-view">
      {/* Welcome & Streak Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-radial from-stone-900 to-neutral-950 p-8 md:p-10 text-white shadow-xl border border-neutral-800">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 opacity-10">
          <Sparkles className="h-64 w-64 text-amber-400" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-neutral-800/80 px-3 py-1 text-xs font-mono font-medium tracking-wide text-amber-400 border border-neutral-700">
              <Sparkles className="h-3 w-3" /> PREPARING FOR IELTS BAND 7.5+
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-semibold tracking-tight">
              雅思词汇记背伴侣
            </h1>
            <p className="text-stone-400 max-w-xl text-sm leading-relaxed">
              这里是你的学术英语备考中心。我们采用<b>艾宾浩斯莱特纳(Leitner)记忆盒子算法</b>，结合 <b>Gemini AI 智能助记</b>，帮你把每一个生词转化为雅思写作和口语中的高分表达。
            </p>
          </div>
          
          <div className="flex items-center gap-4 bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800/80">
            <div className="bg-amber-500/15 p-3 rounded-xl border border-amber-500/20">
              <Flame className="h-8 w-8 text-amber-500 animate-pulse" />
            </div>
            <div>
              <div className="text-xs font-mono text-stone-500 uppercase tracking-widest">学习坚持</div>
              <div className="text-2xl font-serif font-bold text-white">{streak} 天连续</div>
            </div>
          </div>
        </div>

        {/* Action Quicklinks */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 pt-6 border-t border-stone-800">
          <button 
            id="btn-quick-learn"
            onClick={() => onNavigate('flashcards')}
            className="flex items-center justify-between p-4 bg-stone-900 hover:bg-stone-850 border border-stone-800 hover:border-amber-500/30 rounded-xl transition duration-250 group text-left"
          >
            <div>
              <div className="text-xs font-mono text-amber-400 mb-1">开始记忆</div>
              <div className="font-medium text-sm text-stone-100 flex items-center gap-1.5">
                莱特纳记忆闪卡 
                {wordsDueCount > 0 && (
                  <span className="bg-red-500/10 text-red-400 text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-red-500/20">
                    {wordsDueCount}个待复习
                  </span>
                )}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-amber-400 group-hover:translate-x-1 transition-all" />
          </button>

          <button 
            id="btn-quick-quiz"
            onClick={() => onNavigate('quizzes')}
            className="flex items-center justify-between p-4 bg-stone-900 hover:bg-stone-850 border border-stone-800 hover:border-sky-500/30 rounded-xl transition duration-250 group text-left"
          >
            <div>
              <div className="text-xs font-mono text-sky-400 mb-1">自测诊断</div>
              <div className="font-medium text-sm text-stone-100">听写、拼写与选择测试</div>
            </div>
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-sky-400 group-hover:translate-x-1 transition-all" />
          </button>

          <button 
            id="btn-quick-ai"
            onClick={() => onNavigate('ai-coach')}
            className="flex items-center justify-between p-4 bg-stone-900 hover:bg-stone-850 border border-stone-800 hover:border-emerald-500/30 rounded-xl transition duration-250 group text-left"
          >
            <div>
              <div className="text-xs font-mono text-emerald-400 mb-1">AI 强化</div>
              <div className="font-medium text-sm text-stone-100">生成作文语境及口语对话</div>
            </div>
            <ArrowRight className="h-4 w-4 text-stone-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
          </button>
        </div>
      </div>

      {/* Main Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" id="stats-summary-grid">
        <div className="bg-white rounded-2xl p-5 border border-stone-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-mono text-stone-400 uppercase tracking-widest">词汇量掌控</span>
            <div className="text-3xl font-serif font-semibold text-stone-900">
              {learningStats.box5} <span className="text-sm font-sans font-normal text-stone-400">/ {totalWords}</span>
            </div>
            <p className="text-xs text-stone-500">已完全掌握 (处于Box 5)</p>
          </div>
          <div className="h-12 w-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 border border-emerald-100">
            <CheckCircle className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-stone-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-mono text-stone-400 uppercase tracking-widest">正在学习中</span>
            <div className="text-3xl font-serif font-semibold text-stone-900">
              {learningStats.learningCount} <span className="text-sm font-sans font-normal text-stone-400">/ {totalWords}</span>
            </div>
            <p className="text-xs text-stone-500">记忆盒子 Box 1-4 循环中</p>
          </div>
          <div className="h-12 w-12 bg-sky-50 rounded-xl flex items-center justify-center text-sky-600 border border-sky-100">
            <Brain className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-stone-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-mono text-stone-400 uppercase tracking-widest">今日复习目标</span>
            <div className="text-3xl font-serif font-semibold text-stone-900">
              {todayStats.wordsReviewed} <span className="text-sm font-sans font-normal text-stone-400">/ {dailyGoal}</span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-stone-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
              <div 
                className="bg-amber-500 h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${dailyGoalPercent}%` }}
              ></div>
            </div>
          </div>
          <div className="h-12 w-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 border border-amber-100">
            <Award className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-stone-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-mono text-stone-400 uppercase tracking-widest">已加星标生词</span>
            <div className="text-3xl font-serif font-semibold text-stone-900">{starredCount}</div>
            <p className="text-xs text-stone-500">需要重点强化或AI解惑</p>
          </div>
          <div className="h-12 w-12 bg-pink-50 rounded-xl flex items-center justify-center text-pink-600 border border-pink-100">
            <BookMarked className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Graphs Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="dashboard-charts-row">
        {/* 7 Days Progress Chart */}
        <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="font-serif font-semibold text-stone-900 text-base">近 7 日学习统计</h3>
              <p className="text-xs text-stone-500">每日复习与新学词汇趋势</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-amber-500 inline-block"></span>
                <span>复习</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500 inline-block"></span>
                <span>新学</span>
              </div>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: '#78716c', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#78716c', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ background: '#1c1917', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                />
                <Bar dataKey="复习单词" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="新词学习" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Leitner Box Pie Chart Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-4">
          <div className="space-y-0.5">
            <h3 className="font-serif font-semibold text-stone-900 text-base">记忆盒子分布</h3>
            <p className="text-xs text-stone-500">根据莱特纳记忆系统的词汇熟练度</p>
          </div>

          {pieData.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-stone-400 text-sm space-y-2">
              <BookMarked className="h-8 w-8 text-stone-300" />
              <span>你还没有开始学习任何单词</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center">
              <div className="h-44 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={65}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ background: '#1c1917', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs font-mono text-stone-400">综合熟练度</span>
                  <span className="text-lg font-serif font-bold text-stone-850">
                    {learningStats.progressPercent}%
                  </span>
                </div>
              </div>

              {/* Legend Grid */}
              <div className="grid grid-cols-2 gap-2 w-full mt-4 text-xs font-sans">
                {pieData.map((item, index) => (
                  <div key={index} className="flex items-center gap-1.5 text-stone-600">
                    <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: item.color }}></span>
                    <span className="truncate">{item.name}: <b>{item.value}</b></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* IELTS Categories Progress */}
      <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-5" id="ielts-breakdown-row">
        <div className="space-y-0.5">
          <h3 className="font-serif font-semibold text-stone-900 text-base">雅思单科词汇掌握进度</h3>
          <p className="text-xs text-stone-500">分单科看已完全熟练掌握（达到 Box 5）和已开始记忆（Box 1-4）的占比</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Reading */}
          <div className="bg-stone-50/50 rounded-2xl p-5 border border-stone-200/60 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-serif font-bold text-stone-850 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                📖 阅读词汇书
              </span>
              <span className="text-xs font-mono text-stone-500">
                共 {categoryProficiency.reading.total} 词
              </span>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-stone-600">
                <span>掌握率</span>
                <span className="font-semibold text-stone-950">
                  {categoryProficiency.reading.total > 0 
                    ? Math.round((categoryProficiency.reading.mastered / categoryProficiency.reading.total) * 100) 
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${categoryProficiency.reading.total > 0 ? (categoryProficiency.reading.mastered / categoryProficiency.reading.total) * 100 : 0}%` }}
                ></div>
              </div>
            </div>

            <div className="flex justify-between text-[10px] font-mono text-stone-500">
              <span>已掌握: <b>{categoryProficiency.reading.mastered}</b></span>
              <span>记背中: <b>{categoryProficiency.reading.learning}</b></span>
            </div>
          </div>

          {/* Writing */}
          <div className="bg-stone-50/50 rounded-2xl p-5 border border-stone-200/60 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-serif font-bold text-stone-850 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                ✍️ 写作词汇书
              </span>
              <span className="text-xs font-mono text-stone-500">
                共 {categoryProficiency.writing.total} 词
              </span>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-stone-600">
                <span>掌握率</span>
                <span className="font-semibold text-stone-950">
                  {categoryProficiency.writing.total > 0 
                    ? Math.round((categoryProficiency.writing.mastered / categoryProficiency.writing.total) * 100) 
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${categoryProficiency.writing.total > 0 ? (categoryProficiency.writing.mastered / categoryProficiency.writing.total) * 100 : 0}%` }}
                ></div>
              </div>
            </div>

            <div className="flex justify-between text-[10px] font-mono text-stone-500">
              <span>已掌握: <b>{categoryProficiency.writing.mastered}</b></span>
              <span>记背中: <b>{categoryProficiency.writing.learning}</b></span>
            </div>
          </div>

          {/* Speaking */}
          <div className="bg-stone-50/50 rounded-2xl p-5 border border-stone-200/60 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-serif font-bold text-stone-850 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                🗣️ 口语表达词汇
              </span>
              <span className="text-xs font-mono text-stone-500">
                共 {categoryProficiency.speaking.total} 词
              </span>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-stone-600">
                <span>掌握率</span>
                <span className="font-semibold text-stone-950">
                  {categoryProficiency.speaking.total > 0 
                    ? Math.round((categoryProficiency.speaking.mastered / categoryProficiency.speaking.total) * 100) 
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${categoryProficiency.speaking.total > 0 ? (categoryProficiency.speaking.mastered / categoryProficiency.speaking.total) * 100 : 0}%` }}
                ></div>
              </div>
            </div>

            <div className="flex justify-between text-[10px] font-mono text-stone-500">
              <span>已掌握: <b>{categoryProficiency.speaking.mastered}</b></span>
              <span>记背中: <b>{categoryProficiency.speaking.learning}</b></span>
            </div>
          </div>

          {/* Listening */}
          <div className="bg-stone-50/50 rounded-2xl p-5 border border-stone-200/60 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-serif font-bold text-stone-850 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                🎧 听力与听写词汇
              </span>
              <span className="text-xs font-mono text-stone-500">
                共 {categoryProficiency.listening.total} 词
              </span>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-stone-600">
                <span>掌握率</span>
                <span className="font-semibold text-stone-950">
                  {categoryProficiency.listening.total > 0 
                    ? Math.round((categoryProficiency.listening.mastered / categoryProficiency.listening.total) * 100) 
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-amber-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${categoryProficiency.listening.total > 0 ? (categoryProficiency.listening.mastered / categoryProficiency.listening.total) * 100 : 0}%` }}
                ></div>
              </div>
            </div>

            <div className="flex justify-between text-[10px] font-mono text-stone-500">
              <span>已掌握: <b>{categoryProficiency.listening.mastered}</b></span>
              <span>记背中: <b>{categoryProficiency.listening.learning}</b></span>
            </div>
          </div>
        </div>
      </div>

      {/* IELTS Dynamic Study Advice Block */}
      <div className="bg-amber-50/50 rounded-3xl p-6 border border-amber-200/50 flex flex-col md:flex-row items-start gap-5" id="study-advice-box">
        <div className="bg-amber-100/80 p-3 rounded-2xl text-amber-700 border border-amber-200">
          <TrendingUp className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h4 className="font-serif font-semibold text-stone-850 text-sm flex items-center gap-1.5">
            <span>官方考官备考建议 (IELTS Examiner Insight)</span>
          </h4>
          <p className="text-stone-600 text-xs leading-relaxed">
            雅思考试（尤其是学术类 Writing Task 2 与 Speaking Part 3）并不单单考察你是否记住了单词，更考察你能否在<b>恰当的语境中自然输出</b>。请多使用应用内的 <b>“AI助记法”</b> 查看词根词缀，并利用 <b>“AI写作模拟”</b> 观察考官级段落中多单词的联立和递进逻辑。我们推荐每天学习 20 个新单词，并将 10 个错词加入口语跟读练习。
          </p>
        </div>
      </div>
    </div>
  );
}
