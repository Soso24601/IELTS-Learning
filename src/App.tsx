/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, 
  Brain, 
  Award, 
  Flame, 
  Sparkles, 
  Menu, 
  X,
  FileText,
  Bookmark,
  TrendingUp,
  Settings,
  KeyRound,
  HelpCircle,
  FolderSync
} from 'lucide-react';
import { presetVocabulary } from './data/vocabulary';
import { IELTSWord, WordProgress, DailyStats, AISessionHistory, WordCategory } from './types';
import { activeElapsed, localDateKey } from './lib/study';
import { PublicUser } from './lib/authApi';

// Importing sub-components
import Dashboard from './components/Dashboard';
import WordList from './components/WordList';
import MaterialsLibrary from './components/MaterialsLibrary';
import Flashcards from './components/Flashcards';
import QuizEngine from './components/QuizEngine';
import AIAssistant from './components/AIAssistant';
import AccountModal from './components/AccountModal';

interface AppProps {
  user: PublicUser;
  onLogout: () => void;
  onUserChanged: (u: PublicUser) => void;
}

export default function App({ user, onLogout, onUserChanged }: AppProps) {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [vocabulary, setVocabulary] = useState<IELTSWord[]>([]);
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [stats, setStats] = useState<DailyStats[]>([]);
  const [dailyGoal, setDailyGoal] = useState<number>(15);
  const [streak, setStreak] = useState<number>(0);
  const [aiHistory, setAiHistory] = useState<AISessionHistory[]>([]);
  const [activeWordForAI, setActiveWordForAI] = useState<IELTSWord | null>(null);
  const [tracedMaterialId, setTracedMaterialId] = useState<string | null>(null);
  const [tracedWord, setTracedWord] = useState<string | null>(null);
  
  // Mobile menu control
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 1. Initialize data from LocalStorage or presets on startup
  useEffect(() => {
    // A. Load vocabulary (preset + custom additions + user-edited fields like userNotes)
    const storedCustom = localStorage.getItem('ielts_custom_vocab');
    let customWords: IELTSWord[] = [];
    if (storedCustom) {
      try {
        customWords = JSON.parse(storedCustom).map((w: any) => ({ ...w, custom: true }));
      } catch (e) {
        console.error('Failed to parse custom vocab list', e);
      }
    }

    const storedEdits = localStorage.getItem('ielts_vocab_edits');
    let vocabEdits: Record<string, Partial<IELTSWord>> = {};
    if (storedEdits) {
      try {
        vocabEdits = JSON.parse(storedEdits);
      } catch (e) {
        console.error('Failed to parse vocab edits', e);
      }
    }

    const storedDeleted = localStorage.getItem('ielts_deleted_vocab_ids');
    let deletedIds: string[] = [];
    if (storedDeleted) {
      try {
        deletedIds = JSON.parse(storedDeleted);
      } catch (e) {
        console.error('Failed to parse deleted vocab ids', e);
      }
    }

    const mergedPresets = presetVocabulary.map(w => {
      if (vocabEdits[w.id]) {
        return { ...w, ...vocabEdits[w.id] };
      }
      return w;
    });

    const mergedCustoms = customWords.map(w => {
      if (vocabEdits[w.id]) {
        return { ...w, ...vocabEdits[w.id] };
      }
      return w;
    });

    // Sort custom words by creation timestamp descending (newest first)
    const sortedCustoms = [...mergedCustoms].sort((a, b) => {
      const tA = parseInt(a.id.replace('c-', '')) || 0;
      const tB = parseInt(b.id.replace('c-', '')) || 0;
      return tB - tA;
    });

    const finalVocab = [...sortedCustoms, ...mergedPresets].filter(w => !deletedIds.includes(w.id));
    setVocabulary(finalVocab);

    // B. Load word review progress
    const storedProgress = localStorage.getItem('ielts_vocab_progress');
    if (storedProgress) {
      try {
        setProgress(JSON.parse(storedProgress));
      } catch (e) {
        console.error('Failed to parse progress map', e);
      }
    }

    // C. Load daily learning statistics
    const storedStats = localStorage.getItem('ielts_vocab_stats');
    if (storedStats) {
      try {
        setStats(JSON.parse(storedStats));
      } catch (e) {
        console.error('Failed to parse stats list', e);
      }
    } else {
      // Seed first day stat
      const todayStr = localDateKey();
      const initialStats: DailyStats[] = [{
        date: todayStr,
        wordsReviewed: 0,
        wordsLearned: 0,
        minutesSpent: 0,
        correctAnswers: 0,
        totalAnswers: 0
      }];
      setStats(initialStats);
      localStorage.setItem('ielts_vocab_stats', JSON.stringify(initialStats));
    }

    // D. Load daily goal & streak & AI history
    const storedGoal = localStorage.getItem('ielts_daily_goal');
    if (storedGoal) setDailyGoal(Number(storedGoal));

    const storedStreak = localStorage.getItem('ielts_streak');
    if (storedStreak) setStreak(Number(storedStreak));

    const storedAIHistory = localStorage.getItem('ielts_ai_history');
    if (storedAIHistory) {
      try {
        setAiHistory(JSON.parse(storedAIHistory));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // 2. Active duration tracking (increases study time stats by 1 every minute of active engagement)
  useEffect(() => {
    let previous = Date.now();
    let lastInteraction = previous;
    let elapsed = 0;
    let day = localDateKey();
    const interact = () => { lastInteraction = Date.now(); };
    const visibilityChanged = () => {
      previous = Date.now();
      if (document.visibilityState === 'visible') interact();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach(event => window.addEventListener(event, interact, { passive: true }));
    document.addEventListener('visibilitychange', visibilityChanged);
    const interval = setInterval(() => {
      const now = Date.now();
      const todayStr = localDateKey();
      if (todayStr !== day) { elapsed = 0; day = todayStr; }
      elapsed += activeElapsed(previous, now, lastInteraction, document.visibilityState === 'visible');
      previous = now;
      if (elapsed < 60000) return;
      elapsed -= 60000;
      setStats(prevStats => {
        const foundIndex = prevStats.findIndex(s => s.date === todayStr);
        let updated = [...prevStats];

        if (foundIndex >= 0) {
          updated[foundIndex] = {
            ...updated[foundIndex],
            minutesSpent: updated[foundIndex].minutesSpent + 1
          };
        } else {
          updated.push({
            date: todayStr,
            wordsReviewed: 0,
            wordsLearned: 0,
            minutesSpent: 1,
            correctAnswers: 0,
            totalAnswers: 0
          });
        }
        localStorage.setItem('ielts_vocab_stats', JSON.stringify(updated));
        return updated;
      });
    }, 5000);

    return () => {
      clearInterval(interval);
      events.forEach(event => window.removeEventListener(event, interact));
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  // 3. Streak Calculator (Recalculate streak whenever stats update)
  useEffect(() => {
    if (stats.length === 0) return;

    // Filter stats for days when user actually learned/reviewed words
    const activeDates = stats
      .filter(s => s.wordsReviewed > 0 || s.wordsLearned > 0 || s.correctAnswers > 0)
      .map(s => s.date)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime()); // descending (newest first)

    if (activeDates.length === 0) {
      setStreak(0);
      localStorage.setItem('ielts_streak', '0');
      return;
    }

    const todayStr = localDateKey();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDateKey(yesterday);

    // If the user hasn't studied today or yesterday, streak breaks
    if (activeDates[0] !== todayStr && activeDates[0] !== yesterdayStr) {
      setStreak(0);
      localStorage.setItem('ielts_streak', '0');
      return;
    }

    // Calculate consecutive days
    let currentStreak = 1;
    let testDate = new Date(activeDates[0]);

    for (let i = 1; i < activeDates.length; i++) {
      const prevDate = new Date(activeDates[i]);
      const diffTime = Math.abs(testDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        currentStreak++;
        testDate = prevDate;
      } else if (diffDays > 1) {
        break; // gap found, stop count
      }
    }

    setStreak(currentStreak);
    localStorage.setItem('ielts_streak', String(currentStreak));
  }, [stats]);

  // ----------------- STATE MODIFIERS -----------------

  // Toggle Starring Word
  const handleToggleStar = (wordId: string) => {
    setProgress(prev => {
      const current = prev[wordId] || {
        wordId,
        box: 1,
        nextReviewDate: new Date().toISOString(),
        status: 'new',
        starred: false,
        timesReviewed: 0
      };

      const updated = {
        ...prev,
        [wordId]: {
          ...current,
          starred: !current.starred
        }
      };

      localStorage.setItem('ielts_vocab_progress', JSON.stringify(updated));
      return updated;
    });
  };

  // Add custom vocabulary word from IELTS book
  const handleAddCustomWord = (newWordData: Omit<IELTSWord, 'id' | 'custom'>) => {
    const customId = `c-${Date.now()}`;
    const newWord: IELTSWord = {
      ...newWordData,
      id: customId,
      custom: true
    };

    // Update vocabulary state
    setVocabulary(prev => {
      // Prepend the newly added word so it appears at the very top
      const updated = [newWord, ...prev];
      
      // Save ONLY custom words to their own localstorage list
      const customList = updated.filter(w => w.custom);
      localStorage.setItem('ielts_custom_vocab', JSON.stringify(customList));
      return updated;
    });
  };

  // Update an existing vocabulary word's fields (e.g. custom notes)
  const handleUpdateWord = (wordId: string, updatedFields: Partial<IELTSWord>) => {
    setVocabulary(prev => {
      const updated = prev.map(w => w.id === wordId ? { ...w, ...updatedFields } : w);

      // Save custom words
      const customList = updated.filter(w => w.custom);
      localStorage.setItem('ielts_custom_vocab', JSON.stringify(customList));

      // Save edits/annotations
      const storedEdits = localStorage.getItem('ielts_vocab_edits');
      let vocabEdits: Record<string, Partial<IELTSWord>> = {};
      if (storedEdits) {
        try {
          vocabEdits = JSON.parse(storedEdits);
        } catch (e) {
          console.error('Failed to parse vocab edits', e);
        }
      }

      vocabEdits[wordId] = {
        ...vocabEdits[wordId],
        ...updatedFields
      };
      localStorage.setItem('ielts_vocab_edits', JSON.stringify(vocabEdits));

      return updated;
    });
  };

  // Delete a word from vocabulary lists (both preset and custom)
  const handleDeleteWord = (wordId: string) => {
    const confirmDelete = window.confirm('确定要从你的词书中删除这个单词吗？');
    if (!confirmDelete) return;

    // 1. Get current deleted word ids
    const storedDeleted = localStorage.getItem('ielts_deleted_vocab_ids');
    let deletedIds: string[] = [];
    if (storedDeleted) {
      try {
        deletedIds = JSON.parse(storedDeleted);
      } catch (e) {
        console.error(e);
      }
    }
    if (!deletedIds.includes(wordId)) {
      deletedIds.push(wordId);
    }
    localStorage.setItem('ielts_deleted_vocab_ids', JSON.stringify(deletedIds));

    // 2. Filter vocabulary state
    setVocabulary(prev => {
      const updated = prev.filter(w => w.id !== wordId);
      // Also update stored custom vocab if it was a custom word
      const customList = updated.filter(w => w.custom);
      localStorage.setItem('ielts_custom_vocab', JSON.stringify(customList));
      return updated;
    });
  };

  // Leitner Spaced Repetition Core Algorithm
  const handleRegisterReview = (wordId: string, result: 'easy' | 'good' | 'hard' | 'forgot') => {
    const now = new Date();
    const todayStr = localDateKey(now);

    const prev = progress;
    const current = prev[wordId] || {
      wordId,
      box: 1,
      nextReviewDate: now.toISOString(),
      status: 'new',
      starred: false,
      timesReviewed: 0
    };

    let newBox = current.box;
    let newStatus: WordProgress['status'] = 'learning';

    // Leitner Scheduling Intervals based on Box levels
    // Box 1 -> Review in 4 hours
    // Box 2 -> Review in 12 hours
    // Box 3 -> Review in 1 day
    // Box 4 -> Review in 3 days
    // Box 5 -> Review in 7 days (fully mastered)
    let nextReviewOffsetHours = 4;

    if (result === 'forgot') {
      newBox = 1;
      newStatus = 'learning';
      nextReviewOffsetHours = 4;
    } else if (result === 'hard') {
      newBox = Math.max(1, current.box - 1);
      newStatus = 'learning';
      nextReviewOffsetHours = 8;
    } else if (result === 'good') {
      newBox = Math.min(5, current.box + 1);
      newStatus = newBox >= 5 ? 'mastered' : newBox >= 3 ? 'familiar' : 'learning';

      // Define intervals based on box level
      if (newBox === 2) nextReviewOffsetHours = 12;
      else if (newBox === 3) nextReviewOffsetHours = 24; // 1 day
      else if (newBox === 4) nextReviewOffsetHours = 72; // 3 days
      else if (newBox === 5) nextReviewOffsetHours = 168; // 7 days (Mastered)
    } else if (result === 'easy') {
      newBox = 5; // skip straight to mastered
      newStatus = 'mastered';
      nextReviewOffsetHours = 168; // 7 days
    }

    // Calculate exact next review timestamp
    const nextReviewDateObj = new Date();
    nextReviewDateObj.setHours(nextReviewDateObj.getHours() + nextReviewOffsetHours);

    const isFirstTimeLearned = current.timesReviewed === 0;

    const updatedProgress: WordProgress = {
      ...current,
      box: newBox,
      status: newStatus,
      lastReviewed: now.toISOString(),
      nextReviewDate: nextReviewDateObj.toISOString(),
      timesReviewed: current.timesReviewed + 1
    };

    const updatedProgressMap = {
      ...prev,
      [wordId]: updatedProgress
    };

    setProgress(updatedProgressMap);
    localStorage.setItem('ielts_vocab_progress', JSON.stringify(updatedProgressMap));

    // Update statistical dashboard counters
    setStats(prevStats => {
      const foundIndex = prevStats.findIndex(s => s.date === todayStr);
      let updatedStats = [...prevStats];

      if (foundIndex >= 0) {
        updatedStats[foundIndex] = {
          ...updatedStats[foundIndex],
          wordsReviewed: updatedStats[foundIndex].wordsReviewed + 1,
          wordsLearned: updatedStats[foundIndex].wordsLearned + (isFirstTimeLearned ? 1 : 0)
        };
      } else {
        updatedStats.push({
          date: todayStr,
          wordsReviewed: 1,
          wordsLearned: isFirstTimeLearned ? 1 : 0,
          minutesSpent: 0,
          correctAnswers: 0,
          totalAnswers: 0
        });
      }
      localStorage.setItem('ielts_vocab_stats', JSON.stringify(updatedStats));
      return updatedStats;
    });

  };

  // Record Quiz Score Outcomes
  const handleRecordQuizResult = (correctCount: number, totalCount: number) => {
    const todayStr = localDateKey();

    setStats(prevStats => {
      const foundIndex = prevStats.findIndex(s => s.date === todayStr);
      let updatedStats = [...prevStats];

      if (foundIndex >= 0) {
        updatedStats[foundIndex] = {
          ...updatedStats[foundIndex],
          correctAnswers: updatedStats[foundIndex].correctAnswers + correctCount,
          totalAnswers: updatedStats[foundIndex].totalAnswers + totalCount
        };
      } else {
        updatedStats.push({
          date: todayStr,
          wordsReviewed: 0,
          wordsLearned: 0,
          minutesSpent: 0,
          correctAnswers: correctCount,
          totalAnswers: totalCount
        });
      }
      localStorage.setItem('ielts_vocab_stats', JSON.stringify(updatedStats));
      return updatedStats;
    });
  };

  // Navigation router helper when jumping from lists into AI COACH
  const handleSelectWordForAI = (word: IELTSWord, tab: 'mnemonic' | 'writing' | 'speaking' | 'chat') => {
    setActiveWordForAI(word);
    setActiveTab('ai-coach');
  };

  const handleAddAIHistory = (record: AISessionHistory) => {
    setAiHistory(prev => {
      const updated = [record, ...prev].slice(0, 50); // limit to 50 logs
      localStorage.setItem('ielts_ai_history', JSON.stringify(updated));
      return updated;
    });
  };

  // Apply goals update
  const handleSaveDailyGoal = (goal: number) => {
    setDailyGoal(goal);
    localStorage.setItem('ielts_daily_goal', String(goal));
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-850 font-sans flex flex-col selection:bg-amber-200">
      
      {/* Top Academic Elegant Navigation Header */}
      <header className="bg-white border-b border-stone-200/80 sticky top-0 z-40 shadow-xs" id="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            
            {/* Logo / Title */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div className="bg-stone-900 text-amber-400 p-2 rounded-xl flex items-center justify-center border border-stone-850">
                <Brain className="h-5 w-5" />
              </div>
              <div className="text-left">
                <span className="text-lg font-serif font-bold text-stone-900 block tracking-tight">IELTS Vocabulary Builder</span>
                <span className="text-[10px] font-mono text-stone-400 block uppercase tracking-widest">雅思词汇记背伴侣 v2.5</span>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-1.5 text-xs font-semibold">
              {[
                { id: 'dashboard', label: '我的看板', icon: TrendingUp },
                { id: 'wordlist', label: '我的词书', icon: BookOpen },
                { id: 'materials', label: '材料文件夹', icon: FolderSync },
                { id: 'flashcards', label: '记忆闪卡', icon: Bookmark },
                { id: 'quizzes', label: '多维自测', icon: Award },
                { id: 'ai-coach', label: 'AI 辅导中心', icon: Sparkles }
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`nav-btn-${tab.id}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      if (tab.id !== 'ai-coach') setActiveWordForAI(null);
                    }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition cursor-pointer ${
                      isActive 
                        ? 'bg-stone-900 text-white shadow-xs' 
                        : 'text-stone-500 hover:text-stone-900 hover:bg-stone-100'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive && tab.id === 'ai-coach' ? 'text-amber-400 animate-pulse' : ''}`} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            {/* Quick Stats Summary Right Section */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1 bg-stone-100 border px-3 py-1.5 rounded-full text-xs font-mono font-medium text-stone-600">
                <Flame className="h-4 w-4 text-amber-500" />
                <span>{streak} 天</span>
              </div>

              {/* Settings Trigger */}
              <button
                id="btn-trigger-settings"
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-stone-500 hover:text-stone-900 bg-stone-50 border border-stone-200 hover:bg-stone-100 rounded-xl transition cursor-pointer"
                title="账号与设置"
              >
                <Settings className="h-4 w-4" />
              </button>

              {/* Mobile Menu Icon */}
              <button
                id="btn-mobile-menu-toggle"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-stone-500 hover:text-stone-950 md:hidden transition cursor-pointer"
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-stone-200 py-3 px-4 space-y-1 animate-fade-in z-30" id="mobile-nav">
          {[
            { id: 'dashboard', label: '我的看板', icon: TrendingUp },
            { id: 'wordlist', label: '我的词书', icon: BookOpen },
            { id: 'materials', label: '材料文件夹', icon: FolderSync },
            { id: 'flashcards', label: '记忆闪卡', icon: Bookmark },
            { id: 'quizzes', label: '多维自测', icon: Award },
            { id: 'ai-coach', label: 'AI 辅导中心', icon: Sparkles }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`mobile-nav-btn-${tab.id}`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false);
                  if (tab.id !== 'ai-coach') setActiveWordForAI(null);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition ${
                  isActive 
                    ? 'bg-stone-900 text-white' 
                    : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">

        {/* AI 未配置提示条 */}
        {!user.llmConfigured && (
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-full mb-5 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-left text-xs text-amber-900 hover:bg-amber-100 transition cursor-pointer"
          >
            <KeyRound className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              AI 功能未配置：点击这里在「账号与设置 → AI 大模型」填写你自己的 API Key（如 DeepSeek），即可使用 AI 助教、翻译、总结等功能。
              <span className="ml-1 font-semibold underline underline-offset-2">去配置 →</span>
            </span>
          </button>
        )}

        {activeTab === 'dashboard' && (
          <Dashboard 
            vocabulary={vocabulary}
            progress={progress}
            stats={stats}
            dailyGoal={dailyGoal}
            streak={streak}
            onNavigate={(tab) => {
              setActiveTab(tab);
              if (tab !== 'ai-coach') setActiveWordForAI(null);
            }}
          />
        )}

        {activeTab === 'wordlist' && (
          <WordList 
            vocabulary={vocabulary}
            progress={progress}
            onToggleStar={handleToggleStar}
            onAddCustomWord={handleAddCustomWord}
            onUpdateWord={handleUpdateWord}
            onDeleteWord={handleDeleteWord}
            onSelectWordForAI={handleSelectWordForAI}
            onTraceMaterial={(matId, wordText) => {
              setTracedMaterialId(matId);
              if (wordText) setTracedWord(wordText);
              setActiveTab('materials');
            }}
          />
        )}

        {activeTab === 'materials' && (
          <MaterialsLibrary 
            vocabulary={vocabulary}
            onAddCustomWord={handleAddCustomWord}
            initialMaterialId={tracedMaterialId}
            onClearInitialMaterialId={() => setTracedMaterialId(null)}
            initialWord={tracedWord}
            onClearInitialWord={() => setTracedWord(null)}
          />
        )}

        {activeTab === 'flashcards' && (
          <Flashcards 
            vocabulary={vocabulary}
            progress={progress}
            onRegisterReview={handleRegisterReview}
            onToggleStar={handleToggleStar}
            onNavigate={(tab) => {
              setActiveTab(tab);
              if (tab !== 'ai-coach') setActiveWordForAI(null);
            }}
          />
        )}

        {activeTab === 'quizzes' && (
          <QuizEngine 
            vocabulary={vocabulary}
            progress={progress}
            onToggleStar={handleToggleStar}
            onRecordQuizResult={handleRecordQuizResult}
          />
        )}

        {activeTab === 'ai-coach' && (
          <AIAssistant 
            vocabulary={vocabulary}
            activeWord={activeWordForAI}
            onClearActiveWord={() => setActiveWordForAI(null)}
            aiHistory={aiHistory}
            onAddHistory={handleAddAIHistory}
          />
        )}

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200/80 py-6 text-center text-xs font-mono text-stone-400 mt-auto">
        <div className="max-w-7xl mx-auto px-4">
          <p>IELTS Vocabulary Builder © 2026. Designed with Ivory-Slate Aesthetics.</p>
          <p className="mt-1 text-[10px] text-stone-300">Spaced Repetition Engine · 每账号自带大模型 Key</p>
        </div>
      </footer>

      {/* MODAL: 账号与设置（含 AI 大模型 BYOK / 学习目标 / 数据备份） */}
      <AccountModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        dailyGoal={dailyGoal}
        onSaveGoal={handleSaveDailyGoal}
        onLogout={onLogout}
        onUserChanged={onUserChanged}
      />

    </div>
  );
}
