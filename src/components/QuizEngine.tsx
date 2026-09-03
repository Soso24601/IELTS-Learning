/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Volume2, 
  HelpCircle, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ChevronRight, 
  RotateCcw, 
  Sparkles,
  BookOpen,
  Keyboard,
  Mic,
  Trophy,
  Star
} from 'lucide-react';
import { IELTSWord, QuizQuestion, WordProgress } from '../types';

interface QuizEngineProps {
  vocabulary: IELTSWord[];
  progress: Record<string, WordProgress>;
  onToggleStar: (wordId: string) => void;
  onRecordQuizResult: (correctCount: number, totalCount: number) => void;
}

type QuizMode = 'setup' | 'active' | 'completed';
type QuestionType = 'multiple-choice' | 'spelling' | 'dictation';

export default function QuizEngine({
  vocabulary,
  progress,
  onToggleStar,
  onRecordQuizResult
}: QuizEngineProps) {
  const [mode, setMode] = useState<QuizMode>('setup');
  const [selectedType, setSelectedType] = useState<QuestionType>('multiple-choice');
  const [questionCount, setQuestionCount] = useState<number>(10);
  
  // Quiz running states
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [showFeedback, setShowFeedback] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);

  // Sound play
  const handleSpeak = (wordText: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(wordText);
      utterance.lang = 'en-US';
      utterance.rate = 0.8; // slightly slower for exam dictation focus
      window.speechSynthesis.speak(utterance);
    }
  };

  // Generate a random quiz
  const handleStartQuiz = () => {
    if (vocabulary.length < 4) {
      alert('词库中单词过少，请先添加更多单词！');
      return;
    }

    const shuffled = [...vocabulary].sort(() => 0.5 - Math.random());
    const selectedWords = shuffled.slice(0, Math.min(questionCount, vocabulary.length));

    const generatedQuestions: QuizQuestion[] = selectedWords.map((word, index) => {
      const qId = `q-${index}`;
      
      if (selectedType === 'multiple-choice') {
        // Generate options: 1 correct + 3 random incorrect
        const incorrectChinese = vocabulary
          .filter(v => v.id !== word.id)
          .map(v => v.chinese)
          .sort(() => 0.5 - Math.random())
          .slice(0, 3);
        
        const options = [word.chinese, ...incorrectChinese].sort(() => 0.5 - Math.random());
        
        return {
          id: qId,
          type: 'multiple-choice',
          word,
          prompt: `单词 "${word.word}" (${word.partOfSpeech}) 的正确中文含义是什么？`,
          options,
          correctAnswer: word.chinese
        };
      } else if (selectedType === 'spelling') {
        // Prepare sentence with blank
        let blankedExample = word.example;
        if (word.example && word.example.toLowerCase().includes(word.word.toLowerCase())) {
          const regex = new RegExp(word.word, 'gi');
          blankedExample = word.example.replace(regex, '_______');
        } else {
          blankedExample = `例句缺省中。该词中文为 "${word.chinese}" (${word.partOfSpeech})`;
        }

        return {
          id: qId,
          type: 'spelling',
          word,
          prompt: blankedExample,
          correctAnswer: word.word.toLowerCase().trim()
        };
      } else {
        // Dictation
        return {
          id: qId,
          type: 'dictation',
          word,
          prompt: `请听发音，拼写出正确的英文单词。(提示：意为 "${word.chinese}"，首字母为 "${word.word[0].toUpperCase()}")`,
          correctAnswer: word.word.toLowerCase().trim()
        };
      }
    });

    setQuestions(generatedQuestions);
    setCurrentIdx(0);
    setCurrentAnswer('');
    setShowFeedback(false);
    setScore(0);
    setMode('active');

    // If dictation, trigger speak automatically for the first question
    if (selectedType === 'dictation') {
      setTimeout(() => {
        handleSpeak(selectedWords[0].word);
      }, 300);
    }
  };

  // Handle answering choice/typing
  const handleSubmitAnswer = (answer: string) => {
    if (showFeedback) return;

    const currentQuestion = questions[currentIdx];
    const sanitizedAnswer = answer.toLowerCase().trim();
    const sanitizedCorrect = currentQuestion.correctAnswer.toLowerCase().trim();
    
    const isCorrect = sanitizedAnswer === sanitizedCorrect;

    const updatedQuestions = [...questions];
    updatedQuestions[currentIdx] = {
      ...currentQuestion,
      userAnswer: answer,
      isCorrect
    };

    setQuestions(updatedQuestions);
    setShowFeedback(true);
    setCurrentAnswer(answer);

    if (isCorrect) {
      setScore(prev => prev + 1);
    }

    // Auto speak the word for spelling/choice so the user reviews pronunciation immediately
    if (selectedType !== 'dictation') {
      handleSpeak(currentQuestion.word.word);
    }
  };

  // Next Question or Finish
  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      const nextIndex = currentIdx + 1;
      setCurrentIdx(nextIndex);
      setCurrentAnswer('');
      setShowFeedback(false);

      // Auto trigger dictation speak
      if (selectedType === 'dictation') {
        setTimeout(() => {
          handleSpeak(questions[nextIndex].word.word);
        }, 150);
      }
    } else {
      // Quiz completed!
      onRecordQuizResult(score + (questions[currentIdx].isCorrect ? 0 : 0), questions.length); // wait, the final score was already computed in handleSubmit
      setMode('completed');
    }
  };

  const currentQuestion = questions[currentIdx];

  return (
    <div className="max-w-xl mx-auto animate-fade-in" id="quiz-engine-view">
      
      {/* 1. SETUP SCREEN */}
      {mode === 'setup' && (
        <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-md space-y-6" id="quiz-setup">
          <div className="text-center space-y-2 pb-2">
            <h3 className="font-serif font-bold text-2xl text-stone-900">雅思词汇多维自测诊断</h3>
            <p className="text-stone-500 text-sm max-w-sm mx-auto">
              选择适合你的测试模式，实时检测词汇记忆盲区，巩固听说读写能力。
            </p>
          </div>

          {/* Test Type Selectors */}
          <div className="space-y-3">
            <span className="text-xs font-mono text-stone-400 uppercase tracking-widest block">选择诊断形式</span>
            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  id: 'multiple-choice',
                  title: '单项释义选择 (Multiple Choice)',
                  desc: '最快速的词义辨析，配合雅思阅读词汇的高效识别',
                  icon: BookOpen,
                  colorClass: 'text-amber-500 bg-amber-50 border-amber-200'
                },
                {
                  id: 'spelling',
                  title: '语境填空拼写 (Contextual Spelling)',
                  desc: '给出考官例句缺省空位，根据释义拼写，强化写作实战拼写',
                  icon: Keyboard,
                  colorClass: 'text-sky-500 bg-sky-50 border-sky-200'
                },
                {
                  id: 'dictation',
                  title: '听音盲听听写 (IELTS Dictation)',
                  desc: '完美模拟雅思听力第1/4部分，考官发音，默写单词，纠正发音偏误',
                  icon: Mic,
                  colorClass: 'text-emerald-500 bg-emerald-50 border-emerald-200'
                }
              ].map(type => {
                const Icon = type.icon;
                const isSelected = selectedType === type.id;
                return (
                  <button
                    key={type.id}
                    id={`quiz-type-btn-${type.id}`}
                    onClick={() => setSelectedType(type.id as QuestionType)}
                    className={`p-4 rounded-2xl border text-left flex items-start gap-3.5 transition cursor-pointer ${
                      isSelected 
                        ? 'bg-amber-500/5 border-amber-500/60 ring-1 ring-amber-500/10' 
                        : 'bg-stone-50 hover:bg-stone-100 border-stone-200'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl border ${type.colorClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-serif font-semibold text-stone-900 text-sm">{type.title}</h4>
                      <p className="text-stone-500 text-xs mt-0.5 leading-relaxed">{type.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Question Count Selectors */}
          <div className="space-y-2">
            <span className="text-xs font-mono text-stone-400 uppercase tracking-widest block">题目数量 (Questions)</span>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20].map(count => (
                <button
                  key={count}
                  id={`btn-count-${count}`}
                  onClick={() => setQuestionCount(count)}
                  className={`py-2 px-3 rounded-xl border font-mono text-xs font-semibold text-center transition ${
                    questionCount === count 
                      ? 'bg-stone-900 border-stone-900 text-white' 
                      : 'bg-stone-50 border-stone-250 text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  {count} 题
                </button>
              ))}
            </div>
          </div>

          {/* Launch Button */}
          <button
            id="btn-launch-quiz"
            onClick={handleStartQuiz}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-serif font-bold text-sm transition text-center shadow-md cursor-pointer"
          >
            开始测试 (Start Diagnostic Quiz)
          </button>
        </div>
      )}

      {/* 2. ACTIVE QUIZ RUNNING SCREEN */}
      {mode === 'active' && currentQuestion && (
        <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-md space-y-6" id="quiz-active">
          {/* Progress Header */}
          <div className="flex items-center justify-between text-xs font-mono text-stone-500">
            <span>正在测试: <b>{currentIdx + 1} / {questions.length}</b> 题</span>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"></span>
              <span>得分: <b>{score}</b></span>
            </div>
          </div>

          {/* Progress line */}
          <div className="w-full h-1 bg-stone-100 rounded-full overflow-hidden">
            <div 
              className="bg-amber-500 h-1 transition-all duration-300"
              style={{ width: `${((currentIdx) / questions.length) * 100}%` }}
            ></div>
          </div>

          {/* Question Stage */}
          <div className="space-y-4 pt-2">
            {selectedType === 'dictation' ? (
              /* Dictation Mode Specific Panel */
              <div className="bg-stone-50 rounded-2xl p-6 border border-stone-100 text-center space-y-3">
                <div className="h-12 w-12 bg-amber-100/50 text-amber-700 rounded-xl flex items-center justify-center mx-auto border border-amber-200 animate-bounce">
                  <Volume2 className="h-6 w-6" />
                </div>
                <button
                  id="btn-replay-audio"
                  onClick={() => handleSpeak(currentQuestion.word.word)}
                  className="py-1.5 px-3 bg-amber-500 text-white text-xs font-mono font-medium rounded-lg hover:bg-amber-600 shadow-xs cursor-pointer inline-flex items-center gap-1"
                >
                  <Volume2 className="h-3.5 w-3.5" /> 重新播放单词发音
                </button>
                <p className="text-stone-500 text-xs leading-relaxed pt-2">
                  {currentQuestion.prompt}
                </p>
              </div>
            ) : selectedType === 'spelling' ? (
              /* Spelling Mode Sentence block */
              <div className="space-y-3 text-center sm:text-left">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">考官例句缺省拼写 (拼写整个单词)</span>
                <div className="p-4 bg-stone-50/60 rounded-2xl border border-stone-200/50 leading-relaxed text-sm text-stone-700 font-serif italic">
                  "{currentQuestion.prompt}"
                </div>
                <p className="text-stone-500 text-xs">
                  中文含义: <b>{currentQuestion.word.chinese}</b> ({currentQuestion.word.partOfSpeech})
                </p>
              </div>
            ) : (
              /* Multiple Choice */
              <div className="space-y-2 text-center sm:text-left">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">选择正确意思</span>
                <p className="text-stone-900 font-serif font-bold text-xl">
                  {currentQuestion.word.word} 
                  <span className="text-xs font-mono font-normal text-stone-500 ml-2">({currentQuestion.word.partOfSpeech})</span>
                </p>
                <p className="text-stone-500 text-xs font-mono">
                  音标: {currentQuestion.word.phonetic}
                </p>
              </div>
            )}
          </div>

          {/* Interactive Input Area */}
          <div className="pt-2">
            {selectedType === 'multiple-choice' ? (
              /* 4 Choices Grid */
              <div className="grid grid-cols-1 gap-2.5">
                {currentQuestion.options?.map((option, oIdx) => {
                  const isChecked = currentAnswer === option;
                  const isCorrectAnswer = option === currentQuestion.correctAnswer;
                  
                  let buttonClass = 'bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-700';
                  if (showFeedback) {
                    if (isCorrectAnswer) {
                      buttonClass = 'bg-emerald-50 border-emerald-400 text-emerald-800 font-medium ring-1 ring-emerald-500/10';
                    } else if (isChecked) {
                      buttonClass = 'bg-red-50 border-red-400 text-red-800 ring-1 ring-red-500/10';
                    } else {
                      buttonClass = 'bg-stone-50/50 border-stone-150 text-stone-400 opacity-60';
                    }
                  }

                  return (
                    <button
                      key={oIdx}
                      id={`option-btn-${oIdx}`}
                      disabled={showFeedback}
                      onClick={() => handleSubmitAnswer(option)}
                      className={`w-full p-3.5 rounded-2xl border text-left text-sm transition flex items-center justify-between ${buttonClass} ${!showFeedback ? 'cursor-pointer' : ''}`}
                    >
                      <span>{option}</span>
                      {showFeedback && isCorrectAnswer && <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 shrink-0" />}
                      {showFeedback && isChecked && !isCorrectAnswer && <XCircle className="h-4.5 w-4.5 text-red-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Text Input spelling / dictation form */
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    id="quiz-spelling-input"
                    type="text"
                    disabled={showFeedback}
                    placeholder="在此输入您的拼写答案..."
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && currentAnswer.trim() && !showFeedback) {
                        handleSubmitAnswer(currentAnswer);
                      }
                    }}
                    className={`flex-1 p-3.5 bg-stone-50 border rounded-2xl text-sm focus:outline-hidden transition font-mono ${
                      showFeedback 
                        ? currentQuestion.isCorrect 
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-800 ring-1 ring-emerald-500/10'
                          : 'bg-red-50 border-red-400 text-red-800'
                        : 'border-stone-200 focus:border-amber-500/50 focus:bg-white'
                    }`}
                  />
                  {!showFeedback && (
                    <button
                      id="btn-submit-spelling"
                      disabled={!currentAnswer.trim()}
                      onClick={() => handleSubmitAnswer(currentAnswer)}
                      className="px-5 bg-stone-900 hover:bg-stone-850 disabled:bg-stone-100 disabled:text-stone-400 text-white rounded-2xl text-xs font-serif font-bold transition cursor-pointer"
                    >
                      提交
                    </button>
                  )}
                </div>

                {/* Spell help feedback card */}
                {showFeedback && (
                  <div className={`p-4 rounded-2xl border flex items-start gap-3.5 ${
                    currentQuestion.isCorrect ? 'bg-emerald-50/50 border-emerald-200 text-emerald-800' : 'bg-red-50/50 border-red-200 text-red-800'
                  }`}>
                    {currentQuestion.isCorrect ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1 text-xs leading-relaxed">
                      <p className="font-bold">{currentQuestion.isCorrect ? '回答完全正确！' : '拼写错误。'}</p>
                      <p className="font-mono">正确拼写: <b className="text-stone-900 text-sm">{currentQuestion.correctAnswer}</b></p>
                      {!currentQuestion.isCorrect && (
                        <p className="text-stone-500 text-[11px]">您的输入: <code>{currentAnswer || '(无输入)'}</code></p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Explanation during active feedback */}
          {showFeedback && (
            <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/50 space-y-3 animate-fade-in text-xs">
              <div className="flex items-center justify-between">
                <span className="font-serif font-bold text-stone-800">单词释义详解 (Glossary & Example)</span>
                <span className="text-[10px] bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded-sm">
                  {currentQuestion.word.topic}
                </span>
              </div>
              
              <div className="space-y-1 text-stone-600 leading-relaxed">
                <p><b>{currentQuestion.word.word}</b> ({currentQuestion.word.partOfSpeech}) - {currentQuestion.word.chinese}</p>
                <p className="text-stone-500">Definition: {currentQuestion.word.definition}</p>
                {currentQuestion.word.example && (
                  <div className="bg-stone-100/50 p-2 rounded-lg border border-stone-200/30 mt-1 italic font-serif">
                    "{currentQuestion.word.example}"
                    <p className="text-[11px] text-stone-500 font-sans not-italic mt-1">{currentQuestion.word.exampleTranslation}</p>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="pt-2 flex justify-between items-center gap-3 border-t border-stone-200/50">
                <button
                  onClick={() => onToggleStar(currentQuestion.word.id)}
                  className="p-1.5 border border-stone-200 rounded-lg hover:bg-stone-150 transition text-stone-600 flex items-center gap-1 cursor-pointer"
                >
                  <Star className={`h-3.5 w-3.5 ${progress[currentQuestion.word.id]?.starred ? 'fill-pink-500 text-pink-500' : ''}`} />
                  收藏这个错词
                </button>

                <button
                  id="btn-next-question"
                  onClick={handleNext}
                  className="py-1.5 px-4 bg-stone-900 hover:bg-stone-850 text-white rounded-lg text-xs font-serif font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  下一题 <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. COMPLETED VIEW */}
      {mode === 'completed' && (
        <div className="bg-white rounded-3xl p-8 border border-stone-200/80 shadow-md text-center space-y-6 py-12" id="quiz-completed">
          <div className="h-16 w-16 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto border border-amber-100">
            <Trophy className="h-10 w-10 animate-bounce" />
          </div>

          <div className="space-y-2">
            <h3 className="font-serif font-bold text-2xl text-stone-900">自测诊断完成！</h3>
            <p className="text-stone-500 text-sm max-w-sm mx-auto">
              你已经完成了本次雅思词汇训练。以下是你的成绩单。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto font-mono text-center">
            <div className="bg-stone-50 p-3 rounded-2xl border">
              <span className="text-[10px] text-stone-400 uppercase tracking-wider block">题量</span>
              <span className="text-xl font-bold text-stone-850">{questions.length} 题</span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100">
              <span className="text-[10px] text-emerald-500 uppercase tracking-wider block">答对</span>
              <span className="text-xl font-bold text-emerald-700">{score} 题</span>
            </div>
            <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100">
              <span className="text-[10px] text-amber-500 uppercase tracking-wider block">准确率</span>
              <span className="text-xl font-bold text-amber-700">{Math.round((score / questions.length) * 100)}%</span>
            </div>
          </div>

          {/* Mistake highlights & review */}
          {score < questions.length && (
            <div className="text-left space-y-2.5 max-w-sm mx-auto bg-stone-50/50 p-4 rounded-2xl border border-stone-200/50">
              <h4 className="text-xs font-serif font-bold text-stone-700 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 text-red-500" /> 本轮错词（建议加入星标生词）：
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {questions.filter(q => !q.isCorrect).map(q => (
                  <div key={q.word.id} className="inline-flex items-center gap-1 bg-white border border-stone-200/80 px-2 py-1 rounded-lg text-xs font-mono">
                    <span className="text-stone-800">{q.word.word}</span>
                    <button
                      onClick={() => onToggleStar(q.word.id)}
                      className="text-stone-400 hover:text-pink-500"
                    >
                      <Star className={`h-3 w-3 ${progress[q.word.id]?.starred ? 'fill-pink-500 text-pink-500' : ''}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="pt-4 flex gap-3 justify-center max-w-sm mx-auto">
            <button
              id="btn-quiz-retry"
              onClick={() => setMode('setup')}
              className="flex-1 py-3 px-4 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-medium text-stone-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" /> 重新测试
            </button>
            <button
              id="btn-quick-setup"
              onClick={handleStartQuiz}
              className="flex-1 py-3 px-4 bg-stone-900 hover:bg-stone-850 rounded-xl text-xs font-medium text-white transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              再来一组相同模式
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
