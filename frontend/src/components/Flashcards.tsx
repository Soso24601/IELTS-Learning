/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Volume2, 
  RotateCcw, 
  CheckCircle, 
  HelpCircle, 
  BookMarked,
  Sparkles,
  Flame,
  ArrowRight,
  Eye,
  Star
} from 'lucide-react';
import { IELTSWord, WordProgress, WordCategory } from '../types';

import { reviewQueue } from '../lib/study';

interface FlashcardsProps {
  vocabulary: IELTSWord[];
  progress: Record<string, WordProgress>;
  onRegisterReview: (wordId: string, result: 'easy' | 'good' | 'hard' | 'forgot') => void;
  onToggleStar: (wordId: string) => void;
  onNavigate: (tab: string) => void;
}

export default function Flashcards({
  vocabulary,
  progress,
  onRegisterReview,
  onToggleStar,
  onNavigate
}: FlashcardsProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);

  // Freeze this round so progress updates cannot shrink the queue and skip cards.
  const [dueWords, setDueWords] = useState(() => reviewQueue(vocabulary, progress));

  const currentWord = dueWords[currentIndex] || null;

  // Speak pronunciation
  const handleSpeak = (wordText: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(wordText);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Submit Leitner review choice
  const handleReview = (result: 'easy' | 'good' | 'hard' | 'forgot') => {
    if (!currentWord) return;
    
    onRegisterReview(currentWord.id, result);
    setSessionReviewedCount(prev => prev + 1);
    
    // Reset flip state and move to next
    setIsFlipped(false);
    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // Session finished or reached the end
      setCurrentIndex(dueWords.length);
    }
  };

  // Restart learning session
  const handleRestart = () => {
    setDueWords(reviewQueue(vocabulary, progress));
    setCurrentIndex(0);
    setIsFlipped(false);
    setSessionReviewedCount(0);
  };

  // Skip the word for now
  const handleSkip = () => {
    if (currentIndex < dueWords.length - 1) {
      setIsFlipped(false);
      setCurrentIndex(prev => prev + 1);
    } else {
      setCurrentIndex(dueWords.length);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in" id="flashcards-view">
      
      {/* Session Progress Header */}
      {currentWord && (
        <div className="flex items-center justify-between text-xs font-mono text-stone-500 bg-white/60 p-4 rounded-2xl border border-stone-200/50">
          <div className="flex items-center gap-1.5">
            <BookMarked className="h-4 w-4 text-amber-500" />
            <span>本次学习进度: <b>{currentIndex + 1} / {dueWords.length}</b> 个单词</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-amber-500" />
            <span>本轮已复习: <b>{sessionReviewedCount}</b> 词</span>
          </div>
        </div>
      )}

      {/* Main Flashcard Container */}
      {!currentWord || currentIndex >= dueWords.length ? (
        /* Finished Session Panel */
        <div className="bg-white rounded-3xl p-8 border border-stone-200/80 shadow-md text-center space-y-6 py-12">
          <div className="h-16 w-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100">
            <CheckCircle className="h-10 w-10" />
          </div>
          <div className="space-y-2">
            <h3 className="font-serif font-bold text-2xl text-stone-900">当前学习轮次已结束</h3>
            <p className="text-stone-500 text-sm max-w-md mx-auto leading-relaxed">
              已复习的词汇会按间隔再次进入复习队列；跳过的词汇可在下一轮继续学习。
            </p>
          </div>

          <div className="bg-stone-50 rounded-2xl p-4 max-w-xs mx-auto border border-stone-150 flex justify-between text-xs font-mono text-stone-600">
            <div>
              <p className="text-stone-400">本次练习</p>
              <p className="text-lg font-bold text-stone-850">{sessionReviewedCount} 个词</p>
            </div>
            <div className="border-r border-stone-200"></div>
            <div>
              <p className="text-stone-400">记忆算法</p>
              <p className="text-lg font-bold text-amber-600">Leitner v2</p>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center max-w-sm mx-auto">
            <button
              id="btn-restart-session"
              onClick={handleRestart}
              className="flex-1 py-3 px-4 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-medium text-stone-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" /> 开始下一轮
            </button>
            <button
              id="btn-navigate-to-ai"
              onClick={() => onNavigate('ai-coach')}
              className="flex-1 py-3 px-4 bg-stone-900 hover:bg-stone-850 rounded-xl text-xs font-medium text-white transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Sparkles className="h-4 w-4 text-amber-400" /> AI 写作与真题实战 <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* The Flashcard itself */
        <div className="space-y-6">
          <div 
            id={`interactive-flashcard-${currentWord.id}`}
            onClick={() => setIsFlipped(!isFlipped)}
            className={`min-h-[340px] rounded-3xl p-8 border cursor-pointer select-none transition-all duration-350 flex flex-col justify-between ${
              isFlipped 
                ? 'bg-amber-50/20 border-amber-500/30 shadow-xs' 
                : 'bg-white hover:bg-stone-50/50 border-stone-200/80 shadow-md hover:shadow-lg'
            }`}
          >
            {/* Top Row: Star / Category Badge */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono bg-stone-100 border text-stone-500 px-2.5 py-0.5 rounded-full capitalize">
                {currentWord.category === 'reading' ? '📖 阅读词汇' : 
                 currentWord.category === 'writing' ? '✍️ 写作词汇' : 
                 currentWord.category === 'speaking' ? '🗣️ 口语表达词汇' : '🎧 听力与听写词汇'}
              </span>
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-stone-400 bg-stone-100 px-2 py-0.5 rounded-md">
                  Box {progress[currentWord.id]?.box || 1}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleStar(currentWord.id);
                  }}
                  className="p-1 text-stone-400 hover:text-pink-500 transition cursor-pointer"
                >
                  <Star className={`h-4.5 w-4.5 ${progress[currentWord.id]?.starred ? 'fill-pink-500 text-pink-500' : ''}`} />
                </button>
              </div>
            </div>

            {/* Word Center */}
            <div className="py-8 text-center space-y-4">
              {!isFlipped ? (
                /* FRONT VIEW */
                <div className="space-y-3">
                  <h1 className="text-4xl sm:text-5xl font-serif font-bold text-stone-900 tracking-tight">
                    {currentWord.word}
                  </h1>
                  <div className="flex items-center justify-center gap-2 text-stone-500 font-mono text-sm">
                    <span>{currentWord.partOfSpeech}</span>
                    <span>•</span>
                    <span>{currentWord.phonetic}</span>
                    <button 
                      onClick={(e) => handleSpeak(currentWord.word, e)}
                      className="p-1 text-stone-400 hover:text-amber-500 rounded-sm"
                      title="朗读"
                    >
                      <Volume2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="pt-6 flex justify-center">
                    <span className="inline-flex items-center gap-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 border text-xs font-mono text-stone-600 rounded-full transition">
                      <Eye className="h-3.5 w-3.5 text-stone-400" /> 点击卡片或空格翻面
                    </span>
                  </div>
                </div>
              ) : (
                /* BACK VIEW */
                <div className="space-y-5 animate-fade-in text-left">
                  <div className="space-y-1 pb-3 border-b border-stone-200/50">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-serif font-bold text-stone-900">{currentWord.word}</h2>
                      <button 
                        onClick={(e) => handleSpeak(currentWord.word, e)}
                        className="p-1 text-stone-400 hover:text-amber-500 rounded-sm"
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-amber-800 text-lg font-medium">{currentWord.chinese}</p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">英文释义</span>
                    <p className="text-stone-600 text-sm leading-relaxed">{currentWord.definition}</p>
                  </div>

                  {currentWord.example && (
                    <div className="space-y-1 bg-amber-500/5 p-3 rounded-xl border border-amber-500/10">
                      <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">雅思真题例句</span>
                      <p className="text-stone-800 text-xs leading-relaxed italic">
                        "{currentWord.example}"
                      </p>
                      <p className="text-stone-500 text-[10px]">{currentWord.exampleTranslation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Row: Topic */}
            <div className="flex justify-between items-center text-[10px] font-mono text-stone-400">
              <span>学术门类: <b>{currentWord.topic}</b></span>
              <span>{isFlipped ? '再点一次可翻回正面' : '拼写检查：请注意该词拼写'}</span>
            </div>
          </div>

          {/* Leitner Feedback Options (only visible when flipped) */}
          {isFlipped ? (
            <div className="space-y-3 animate-slide-in">
              <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block text-center">
                你记住了这个单词吗？(Leitner 智能反馈)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  id="btn-review-forgot"
                  onClick={() => handleReview('forgot')}
                  className="flex flex-col items-center justify-center p-3.5 bg-red-50 hover:bg-red-100 border border-red-200 hover:border-red-300 rounded-2xl transition cursor-pointer text-center group"
                >
                  <span className="text-sm font-bold text-red-700">忘记了 ❌</span>
                  <span className="text-[10px] text-red-500 font-mono mt-1">退回到 Box 1</span>
                </button>

                <button
                  id="btn-review-hard"
                  onClick={() => handleReview('hard')}
                  className="flex flex-col items-center justify-center p-3.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 hover:border-orange-300 rounded-2xl transition cursor-pointer text-center group"
                >
                  <span className="text-sm font-bold text-orange-700">太费劲 ⚠️</span>
                  <span className="text-[10px] text-orange-500 font-mono mt-1">保持现级 复习加速</span>
                </button>

                <button
                  id="btn-review-good"
                  onClick={() => handleReview('good')}
                  className="flex flex-col items-center justify-center p-3.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 rounded-2xl transition cursor-pointer text-center group"
                >
                  <span className="text-sm font-bold text-amber-700">认出了 👍</span>
                  <span className="text-[10px] text-amber-500 font-mono mt-1">晋级 Box + 1</span>
                </button>

                <button
                  id="btn-review-easy"
                  onClick={() => handleReview('easy')}
                  className="flex flex-col items-center justify-center p-3.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 hover:border-emerald-300 rounded-2xl transition cursor-pointer text-center group"
                >
                  <span className="text-sm font-bold text-emerald-700">秒答太易 🎓</span>
                  <span className="text-[10px] text-emerald-500 font-mono mt-1">直达 Box 5 (Mastered)</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 justify-center">
              <button
                id="btn-reveal-back"
                onClick={() => setIsFlipped(true)}
                className="w-1/2 py-3 px-4 bg-stone-900 hover:bg-stone-850 rounded-xl text-xs font-medium text-white transition text-center shadow-xs cursor-pointer"
              >
                翻转卡片 (查看答案)
              </button>
              <button
                id="btn-skip-card"
                onClick={handleSkip}
                className="w-1/2 py-3 px-4 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-medium text-stone-600 transition text-center cursor-pointer"
              >
                跳过此词
              </button>
            </div>
          )}

          {/* Quick instructions on how the Leitner Box works */}
          <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/50 flex items-start gap-3">
            <HelpCircle className="h-4 w-4 text-stone-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-stone-500 leading-relaxed space-y-1">
              <p className="font-semibold text-stone-700">什么是莱特纳系统 (Leitner System)？</p>
              <p>
                这是一个经典的高效 Spaced Repetition 间隔复习法。所有新学单词都在 <b>Box 1</b>。当你回答“认出了”或“简单”，它会往上晋级（Box 2, 3... 最终到达 Box 5）；而一旦回答“忘记了”，单词会立刻跌落回 <b>Box 1</b>。高盒子的单词复习频次更低，低盒子频次更高。这能帮你省去 80% 的重复无用功，聚焦在短板记忆！
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
