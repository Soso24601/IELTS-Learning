/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Sparkles, 
  BookMarked, 
  Volume2, 
  MessageSquare, 
  Copy, 
  Send, 
  ArrowRight, 
  CheckCircle2, 
  Search,
  BookOpen,
  Mic,
  FileText,
  Lightbulb,
  X,
  HelpCircle,
  AlertCircle
} from 'lucide-react';
import { IELTSWord, AISessionHistory } from '../types';
import { friendlyApiError } from '../lib/authApi';

interface AIAssistantProps {
  vocabulary: IELTSWord[];
  activeWord: IELTSWord | null;
  onClearActiveWord: () => void;
  aiHistory: AISessionHistory[];
  onAddHistory: (record: AISessionHistory) => void;
}

type AITab = 'mnemonic' | 'writing' | 'speaking' | 'chat';

export default function AIAssistant({
  vocabulary,
  activeWord,
  onClearActiveWord,
  aiHistory,
  onAddHistory
}: AIAssistantProps) {
  const [activeTab, setActiveTab] = useState<AITab>('mnemonic');
  const [selectedWord, setSelectedWord] = useState<IELTSWord | null>(activeWord);
  const [wordSearchQuery, setWordSearchQuery] = useState('');
  
  // Loading & error states
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Mnemonic State
  const [mnemonicData, setMnemonicData] = useState<{
    etymology: string;
    association: string;
    trick: string;
    synonyms: string[];
    collocations: string[];
  } | null>(null);

  // 2. Writing (Multi-select) State
  const [selectedWordsForWriting, setSelectedWordsForWriting] = useState<string[]>([]);
  const [writingData, setWritingData] = useState<{
    essayPrompt: string;
    topicName: string;
    paragraph: string;
    translation: string;
    tips: string;
  } | null>(null);

  // 3. Speaking State
  const [speakingData, setSpeakingData] = useState<{
    part: string;
    question: string;
    answer: string;
    translation: string;
    coaching: string;
  } | null>(null);
  const [hideSpeakingTranslation, setHideSpeakingTranslation] = useState(false);

  // 4. Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Synchronize with external active word selection
  useEffect(() => {
    if (activeWord) {
      setSelectedWord(activeWord);
      // Reset generated data when word changes
      setMnemonicData(null);
      setSpeakingData(null);
      setChatMessages([]);
    }
  }, [activeWord]);

  // Handle activeTab transition
  useEffect(() => {
    if (activeWord && activeWord.id) {
      // If we got here from a direct link, trigger the appropriate generation
      if (activeTab === 'mnemonic' && !mnemonicData) {
        handleGenerateMnemonic();
      } else if (activeTab === 'speaking' && !speakingData) {
        handleGenerateSpeaking();
      }
    }
  }, [activeTab, selectedWord]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Filter words for selection
  const filteredWords = useMemo(() => {
    if (!wordSearchQuery) return [];
    return vocabulary.filter(w => 
      w.word.toLowerCase().includes(wordSearchQuery.toLowerCase()) ||
      w.chinese.includes(wordSearchQuery)
    ).slice(0, 5);
  }, [vocabulary, wordSearchQuery]);

  // Copy to clipboard helper
  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccessMsg('已成功复制到剪贴板！');
    setTimeout(() => setSuccessMsg(''), 2000);
  };

  // Voice playback
  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    }
  };

  // ----------------- API INVOCATIONS -----------------

  // 1. Generate Mnemonic
  const handleGenerateMnemonic = async () => {
    if (!selectedWord) return;
    setLoading(true);
    setError('');
    setLoadingMessage('正在调配趣味助记方案，AI 词汇导师正在脑暴中...');

    try {
      const response = await fetch('/api/gemini/mnemonic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: selectedWord.word,
          definition: selectedWord.definition,
          partOfSpeech: selectedWord.partOfSpeech,
          chinese: selectedWord.chinese
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '生成助记失败');
      }

      const data = await response.json();
      setMnemonicData(data);
      
      onAddHistory({
        wordId: selectedWord.id,
        promptType: 'mnemonic',
        response: JSON.stringify(data),
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message ? friendlyApiError(err) : '由于网络波动，无法联系到 AI 助记大师。');
    } finally {
      setLoading(false);
    }
  };

  // 2. Generate Writing Context Paragraph (Multi-word combining)
  const handleGenerateWriting = async () => {
    if (selectedWordsForWriting.length === 0) {
      alert('请至少选择一个雅思单词进行作文融合！');
      return;
    }
    
    setLoading(true);
    setError('');
    setLoadingMessage('雅思官方写作考官正在构思 Band 8.5+ 高分作文段落，请稍候...');

    try {
      const response = await fetch('/api/gemini/writing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: selectedWordsForWriting })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '合成高分段落失败');
      }

      const data = await response.json();
      setWritingData(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message ? friendlyApiError(err) : 'AI 写作考官连接中断，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  // 3. Generate Speaking Interview
  const handleGenerateSpeaking = async () => {
    if (!selectedWord) return;
    setLoading(true);
    setError('');
    setLoadingMessage('考官正向你发出雅思口语对话邀约，录音设备准备中...');

    try {
      const response = await fetch('/api/gemini/speaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: selectedWord.word })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '口语真题模拟失败');
      }

      const data = await response.json();
      setSpeakingData(data);
      
      onAddHistory({
        wordId: selectedWord.id,
        promptType: 'speaking',
        response: JSON.stringify(data),
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message ? friendlyApiError(err) : '口语考场信号受阻，请重试。');
    } finally {
      setLoading(false);
    }
  };

  // 4. Send Message to AI Vocabulary Coach Chat
  const handleSendChatMessage = async () => {
    if (!selectedWord || !chatInput.trim()) return;

    const userText = chatInput.trim();
    setChatInput('');
    
    const newUserMessage = { role: 'user' as const, text: userText };
    setChatMessages(prev => [...prev, newUserMessage]);
    
    setLoading(true);
    setLoadingMessage('AI 词汇导师正在精细剖析词伙语境...');

    try {
      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: selectedWord.word,
          message: userText,
          history: chatMessages
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '导师解答出错');
      }

      const data = await response.json();
      setChatMessages(prev => [...prev, { role: 'assistant', text: data.reply }]);
    } catch (err: any) {
      console.error(err);
      setError(err.message ? friendlyApiError(err) : 'AI 导师解答时遇到迷雾，请重试。');
    } finally {
      setLoading(false);
    }
  };

  // Add word to writing list
  const toggleWordForWriting = (wordText: string) => {
    if (selectedWordsForWriting.includes(wordText)) {
      setSelectedWordsForWriting(prev => prev.filter(w => w !== wordText));
    } else {
      if (selectedWordsForWriting.length >= 4) {
        alert('为了保证段落质量，一次最多合并 4 个单词！');
        return;
      }
      setSelectedWordsForWriting(prev => [...prev, wordText]);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" id="ai-assistant-view">
      
      {/* Toast Success Notification */}
      {successMsg && (
        <div className="fixed top-20 right-6 bg-stone-900 text-white py-3 px-5 rounded-2xl shadow-xl flex items-center gap-2 z-50 text-xs font-mono border border-stone-850">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Word Context Selector bar */}
      <div className="bg-white rounded-3xl p-5 border border-stone-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl border border-amber-500/10">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-serif font-bold text-stone-900 text-sm">
              当前交互核心单词：
              {selectedWord ? (
                <span className="text-amber-600 ml-1 font-bold select-all">{selectedWord.word}</span>
              ) : (
                <span className="text-stone-400 ml-1 font-normal">暂未选择单词</span>
              )}
            </h3>
            <p className="text-stone-500 text-xs mt-0.5">
              {selectedWord ? `中文释义: ${selectedWord.chinese} | 音标: ${selectedWord.phonetic}` : '在下方检索或挑选，启动 AI 多维强化记忆'}
            </p>
          </div>
        </div>

        {/* Word Quicksearch within AI tab */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-3 h-4 w-4 text-stone-400" />
          <input
            id="ai-word-search"
            type="text"
            placeholder="搜索词库并关联 AI 辅导..."
            value={wordSearchQuery}
            onChange={(e) => setWordSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-stone-50 border border-stone-200 focus:border-amber-500/50 focus:bg-white rounded-xl text-xs transition focus:outline-hidden"
          />
          {wordSearchQuery && (
            <button 
              onClick={() => setWordSearchQuery('')}
              className="absolute right-3 top-3 text-stone-400 hover:text-stone-600"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {/* Autocomplete list */}
          {filteredWords.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-stone-200 rounded-2xl shadow-xl p-2 z-40 space-y-1">
              {filteredWords.map(w => (
                <button
                  key={w.id}
                  id={`ai-search-result-${w.id}`}
                  onClick={() => {
                    setSelectedWord(w);
                    setWordSearchQuery('');
                    setMnemonicData(null);
                    setSpeakingData(null);
                    setChatMessages([]);
                  }}
                  className="w-full p-2 text-left text-xs rounded-xl hover:bg-stone-50 flex justify-between items-center"
                >
                  <span className="font-bold text-stone-850">{w.word} <span className="font-normal text-stone-400 font-mono">({w.partOfSpeech})</span></span>
                  <span className="text-stone-500">{w.chinese}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Assistant Tabs Navigation */}
      <div className="flex border-b border-stone-200 text-sm font-serif overflow-x-auto whitespace-nowrap">
        {[
          { id: 'mnemonic', label: 'AI 智能助记法', icon: Lightbulb },
          { id: 'writing', label: 'AI 作文词伙联立', icon: FileText },
          { id: 'speaking', label: 'AI 口语模拟实战', icon: Mic },
          { id: 'chat', label: 'AI 词汇答疑导师', icon: MessageSquare }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`ai-tab-btn-${tab.id}`}
              onClick={() => setActiveTab(tab.id as AITab)}
              className={`py-3 px-5 font-semibold border-b-2 flex items-center gap-2 cursor-pointer transition ${
                isActive 
                  ? 'border-stone-900 text-stone-900' 
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="bg-stone-50/70 border border-stone-200/50 rounded-3xl p-10 flex flex-col items-center justify-center space-y-4 text-center min-h-[300px]">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-stone-200 border-t-amber-500 animate-spin"></div>
            <Sparkles className="h-5 w-5 text-amber-500 absolute inset-0 m-auto animate-pulse" />
          </div>
          <div className="space-y-1">
            <h4 className="font-serif font-bold text-stone-850 text-sm">Gemini AI 正在全力运作</h4>
            <p className="text-stone-500 text-xs font-mono max-w-sm">{loadingMessage}</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && !loading && (
        <div className="bg-red-50 text-red-700 p-4 rounded-2xl border border-red-200 text-xs flex items-start gap-3">
          <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5 text-red-500" />
          <div className="space-y-1">
            <p className="font-bold">生成失败</p>
            <p>{error}</p>
            <p className="text-[10px] text-red-500">提示: 单词可能需要更详细的定义支持，请检查或尝试重新提交。</p>
          </div>
        </div>
      )}

      {/* ----------------- TAB CONTENTS ----------------- */}

      {/* TAB 1: AI MNEMONICS (助记法) */}
      {activeTab === 'mnemonic' && !loading && (
        <div className="space-y-5" id="ai-tab-mnemonic">
          {!selectedWord ? (
            <div className="bg-white rounded-3xl p-12 border text-center text-stone-400 text-sm space-y-3">
              <Lightbulb className="h-10 w-10 text-stone-300 mx-auto" />
              <p>请先在顶部检索并选择一个雅思单词，开启趣味 AI 联想助记法。</p>
            </div>
          ) : mnemonicData ? (
            /* Mnemonics Output Cards */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              
              {/* Column 1 & 2: Main memory tricks */}
              <div className="md:col-span-2 space-y-5">
                {/* 1. Etymology Roots */}
                <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-3">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">📐 词源与词根词缀解析</span>
                  <p className="text-stone-700 text-sm leading-relaxed">{mnemonicData.etymology}</p>
                </div>

                {/* 2. Visual / Sound association */}
                <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-3">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">💡 趣味记忆联想与视觉情境</span>
                  <p className="text-stone-700 text-sm leading-relaxed">{mnemonicData.association}</p>
                </div>

                {/* 3. Golden Formula Word Tip */}
                <div className="bg-amber-50/40 rounded-3xl p-6 border border-amber-200/50 space-y-3 relative overflow-hidden">
                  <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 text-amber-500/10">
                    <Sparkles className="h-24 w-24" />
                  </div>
                  <span className="text-[10px] font-mono text-amber-600 uppercase tracking-widest block">🏆 黄金一句话神级口诀</span>
                  <p className="text-amber-900 text-base font-serif font-bold italic leading-relaxed relative z-10">
                    "{mnemonicData.trick}"
                  </p>
                </div>
              </div>

              {/* Column 3: Collocations & Synonyms */}
              <div className="space-y-5">
                {/* Synonyms */}
                <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-4">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">🔗 考官推荐高含金量替换词</span>
                  <div className="space-y-2">
                    {mnemonicData.synonyms.map((syn, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-stone-700 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                        <code className="bg-stone-50 px-1.5 py-0.5 rounded-sm font-mono font-medium">{syn}</code>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Collocations */}
                <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-4">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">🎯 雅思常考高频词伙搭配</span>
                  <div className="space-y-2">
                    {mnemonicData.collocations.map((col, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-stone-700 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
                        <span>{col}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rerun */}
                <button
                  id="btn-rerun-mnemonic"
                  onClick={handleGenerateMnemonic}
                  className="w-full py-2.5 bg-stone-50 hover:bg-stone-100 border text-stone-600 rounded-xl text-xs font-serif font-semibold transition text-center cursor-pointer"
                >
                  换一个助记脑洞
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-10 border border-stone-200/80 shadow-xs text-center space-y-4">
              <div className="h-12 w-12 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center mx-auto border border-amber-100">
                <Lightbulb className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-serif font-bold text-stone-900 text-sm">为单词 "{selectedWord.word}" 生成联想记忆法</h4>
                <p className="text-stone-500 text-xs max-w-sm mx-auto leading-relaxed">
                  我们将通过 Google Gemini AI 挖掘最巧妙、生动的词源词缀记忆与趣味联想公式，帮你摆脱死记硬背。
                </p>
              </div>
              <button
                id="btn-trigger-mnemonic"
                onClick={handleGenerateMnemonic}
                className="py-2.5 px-6 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-serif font-bold transition shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <Sparkles className="h-4 w-4" /> 激发智能助记卡片
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: AI WRITING ESSAY CO-LOCATION (作文词伙联立) */}
      {activeTab === 'writing' && !loading && (
        <div className="space-y-5" id="ai-tab-writing">
          
          {/* Word multi-selector panel */}
          <div className="bg-white rounded-3xl p-5 border border-stone-200/80 shadow-xs space-y-4">
            <div className="space-y-1">
              <h4 className="font-serif font-semibold text-stone-900 text-sm">选择需要合成写作段落的雅思单词</h4>
              <p className="text-stone-500 text-xs leading-relaxed">
                请勾选 1 至 4 个单词。AI 考官将以这些单词为核心，在同一篇雅思 Task 2 议论文中熔炼出一个高分论证段落（Band 8.5+）。
              </p>
            </div>

            {/* Selected words wrap tags */}
            {selectedWordsForWriting.length > 0 && (
              <div className="flex flex-wrap gap-1.5 bg-stone-50 p-3 rounded-2xl border border-stone-100">
                <span className="text-[10px] font-mono text-stone-400 self-center mr-1">已选词:</span>
                {selectedWordsForWriting.map(wText => (
                  <div key={wText} className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-800 border border-amber-500/20 px-2 py-0.5 rounded-lg text-xs font-mono">
                    <span>{wText}</span>
                    <button 
                      onClick={() => toggleWordForWriting(wText)}
                      className="text-amber-600 hover:text-amber-800"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Quick checkbox list of vocabulary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {vocabulary.slice(0, 12).map(v => {
                const isChecked = selectedWordsForWriting.includes(v.word);
                return (
                  <button
                    key={v.id}
                    id={`writing-select-${v.id}`}
                    onClick={() => toggleWordForWriting(v.word)}
                    className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition ${
                      isChecked 
                        ? 'bg-amber-500/10 border-amber-500/50 text-amber-800 font-bold' 
                        : 'bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-600'
                    }`}
                  >
                    <span className="truncate">{v.word}</span>
                    <span className="text-[10px] text-stone-400 italic shrink-0 ml-1">({v.partOfSpeech})</span>
                  </button>
                );
              })}
            </div>

            <div className="pt-3 flex justify-between items-center text-xs text-stone-400">
              <span>* 想要融合其他生词？请先在主词库中将新词添加进来。</span>
              <button
                id="btn-trigger-writing"
                disabled={selectedWordsForWriting.length === 0}
                onClick={handleGenerateWriting}
                className="py-2.5 px-6 bg-stone-900 hover:bg-stone-850 disabled:bg-stone-100 disabled:text-stone-400 text-white rounded-xl text-xs font-serif font-bold transition shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <FileText className="h-4 w-4" /> 熔炼 Band 8.5+ 作文段落
              </button>
            </div>
          </div>

          {/* Output of Writing Block */}
          {writingData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-slide-in">
              {/* Essay Content */}
              <div className="md:col-span-2 bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-5">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">
                    ✍️ 官方作文模拟题目 ({writingData.topicName})
                  </span>
                  <h4 className="font-serif font-bold text-stone-900 text-base leading-snug">
                    "{writingData.essayPrompt}"
                  </h4>
                </div>

                <div className="space-y-2 border-t border-stone-100 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-amber-600 uppercase tracking-widest block">
                      💯 考官高分范本段落 (Academic Essay Paragraph)
                    </span>
                    <button 
                      onClick={() => handleSpeak(writingData.paragraph)}
                      className="p-1 text-stone-400 hover:text-amber-500"
                      title="段落朗读"
                    >
                      <Volume2 className="h-4.5 w-4.5" />
                    </button>
                  </div>
                  {/* Clean rendered text, with word highlighting */}
                  <p className="text-stone-800 font-serif text-sm leading-relaxed bg-stone-50 p-4 rounded-2xl border select-all whitespace-pre-wrap">
                    {writingData.paragraph}
                  </p>
                </div>

                <div className="space-y-2 border-t border-stone-100 pt-4">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">
                    🇨🇳 段落中文释义
                  </span>
                  <p className="text-stone-600 text-xs leading-relaxed">
                    {writingData.translation}
                  </p>
                </div>
              </div>

              {/* Examiner Tips & Coaching */}
              <div className="bg-stone-950 text-white rounded-3xl p-6 border border-stone-800 shadow-md flex flex-col justify-between">
                <div className="space-y-4">
                  <span className="text-[10px] font-mono text-amber-400 uppercase tracking-widest block">
                    👨‍🏫 考官高分语境解析
                  </span>
                  <p className="text-stone-300 text-xs leading-relaxed whitespace-pre-wrap">
                    {writingData.tips}
                  </p>
                </div>

                <div className="pt-6 border-t border-stone-850 flex gap-2">
                  <button
                    onClick={() => handleCopyToClipboard(writingData.paragraph)}
                    className="flex-1 py-2 px-3 bg-stone-900 hover:bg-stone-850 text-stone-300 rounded-xl text-xs font-medium transition flex items-center justify-center gap-1 cursor-pointer border border-stone-800"
                  >
                    <Copy className="h-3.5 w-3.5" /> 复制英文范本
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* TAB 3: AI SPEAKING MOCK (口语真题实战) */}
      {activeTab === 'speaking' && !loading && (
        <div className="space-y-5" id="ai-tab-speaking">
          {!selectedWord ? (
            <div className="bg-white rounded-3xl p-12 border text-center text-stone-400 text-sm space-y-3">
              <Mic className="h-10 w-10 text-stone-300 mx-auto" />
              <p>请先在顶部检索并选择一个雅思单词，开启口语考场真题模拟。</p>
            </div>
          ) : speakingData ? (
            /* Speaking Mock Outputs */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-slide-in">
              
              {/* Exam Content */}
              <div className="md:col-span-2 bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-5">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-amber-600 uppercase tracking-widest block">
                    🗣️ 口语考官提问 ({speakingData.part})
                  </span>
                  <div className="flex items-center justify-between bg-stone-50 p-4 rounded-xl border border-stone-100">
                    <h4 className="font-serif font-bold text-stone-900 text-sm select-all">
                      "{speakingData.question}"
                    </h4>
                    <button
                      onClick={() => handleSpeak(speakingData.question)}
                      className="p-1.5 text-stone-400 hover:text-amber-500"
                    >
                      <Volume2 className="h-4.5 w-4.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-stone-100 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-emerald-600 uppercase tracking-widest block">
                      🎤 Band 8.5+ 考官满分答卷范例
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setHideSpeakingTranslation(!hideSpeakingTranslation)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                          hideSpeakingTranslation
                            ? 'bg-amber-50 border-amber-300 text-amber-800'
                            : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
                        }`}
                        title={hideSpeakingTranslation ? "切换显示中文翻译对照" : "切换为纯英文整段原文显示"}
                      >
                        {hideSpeakingTranslation ? '📄 整段原文(不翻译)' : '📖 显示对照翻译'}
                      </button>
                      <button 
                        onClick={() => handleSpeak(speakingData.answer)}
                        className="p-1.5 text-stone-400 hover:text-emerald-500 bg-stone-50 border border-stone-200 rounded-lg transition cursor-pointer"
                        title="朗读答案"
                      >
                        <Volume2 className="h-4.5 w-4.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-stone-850 font-serif text-sm leading-relaxed bg-stone-50 p-4 rounded-2xl border select-all whitespace-pre-wrap">
                    {speakingData.answer}
                  </p>
                </div>

                {!hideSpeakingTranslation && (
                  <div className="space-y-2 border-t border-stone-100 pt-4 animate-fade-in">
                    <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">
                      🇨🇳 答卷中文翻译
                    </span>
                    <p className="text-stone-600 text-xs leading-relaxed">
                      {speakingData.translation}
                    </p>
                  </div>
                )}
              </div>

              {/* Coaching & Rerun */}
              <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs flex flex-col justify-between">
                <div className="space-y-4">
                  <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block font-bold">
                    💡 口语高分表达技巧与连读建议
                  </span>
                  <p className="text-stone-600 text-xs leading-relaxed whitespace-pre-wrap">
                    {speakingData.coaching}
                  </p>
                </div>

                <div className="pt-6 border-t border-stone-100 flex flex-col gap-2">
                  <button
                    onClick={() => handleCopyToClipboard(speakingData.answer)}
                    className="w-full py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-medium transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" /> 复制示范答案
                  </button>
                  <button
                    id="btn-rerun-speaking"
                    onClick={handleGenerateSpeaking}
                    className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-serif font-bold transition flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                  >
                    换一个口语提问场景
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-white rounded-3xl p-10 border border-stone-200/80 shadow-xs text-center space-y-4">
              <div className="h-12 w-12 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center mx-auto border border-emerald-100">
                <Mic className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-serif font-bold text-stone-900 text-sm">为单词 "{selectedWord.word}" 开启雅思口语实战模拟</h4>
                <p className="text-stone-500 text-xs max-w-sm mx-auto leading-relaxed">
                  模拟口语 Part 1 独立陈述或 Part 3 深度论证，听音跟读满分口语答案，纠正发音，训练即时口语反应能力。
                </p>
              </div>
              <button
                id="btn-trigger-speaking"
                onClick={handleGenerateSpeaking}
                className="py-2.5 px-6 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-serif font-bold transition shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <Sparkles className="h-4 w-4" /> 开启口语真题模拟
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: INTERACTIVE VOCABULARY COACH CHAT (答疑导师) */}
      {activeTab === 'chat' && (
        <div className="space-y-4" id="ai-tab-chat">
          {!selectedWord ? (
            <div className="bg-white rounded-3xl p-12 border text-center text-stone-400 text-sm space-y-3">
              <MessageSquare className="h-10 w-10 text-stone-300 mx-auto" />
              <p>请先在顶部检索并选择一个雅思单词，以便向 AI 导师提问。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              
              {/* Word info panel */}
              <div className="lg:col-span-1 bg-white rounded-3xl p-5 border border-stone-200/80 shadow-xs space-y-4 text-xs h-fit">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block font-bold">📖 讨论单词卡片</span>
                <div>
                  <h4 className="font-serif font-bold text-stone-900 text-base">{selectedWord.word}</h4>
                  <p className="text-stone-500 font-mono text-[10px] mt-0.5">{selectedWord.partOfSpeech} • {selectedWord.phonetic}</p>
                </div>
                <div className="space-y-1 text-stone-600">
                  <p><b>中文释义:</b> {selectedWord.chinese}</p>
                  <p><b>英文释义:</b> {selectedWord.definition}</p>
                </div>
                <div className="pt-3 border-t border-stone-100">
                  <p className="font-semibold text-stone-700">你可以提问以下方向：</p>
                  <ul className="list-disc pl-4 mt-1.5 space-y-1 text-stone-500">
                    <li>这个词常用来搭配什么介词？</li>
                    <li>它和同义词有什么区别？</li>
                    <li>能在雅思听力中告诉我注意什么？</li>
                    <li>请给我三个高分英文写作例句</li>
                  </ul>
                </div>
              </div>

              {/* Chat Container */}
              <div className="lg:col-span-3 bg-white rounded-3xl border border-stone-200/80 shadow-xs flex flex-col h-[480px]">
                {/* Chat header */}
                <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between text-xs text-stone-500">
                  <span className="flex items-center gap-1.5 font-serif font-semibold text-stone-850">
                    <MessageSquare className="h-4 w-4 text-amber-500" /> AI 词汇答疑导师 Workspace
                  </span>
                  <span>在线答疑中</span>
                </div>

                {/* Messages Panel */}
                <div className="flex-1 p-5 overflow-y-auto space-y-4">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-stone-400 text-xs space-y-2 text-center max-w-sm mx-auto">
                      <Sparkles className="h-8 w-8 text-amber-500 animate-pulse" />
                      <p className="font-serif font-bold text-stone-800">雅思词汇疑难解答室</p>
                      <p>你可以询问关于单词 <b>{selectedWord.word}</b> 的任何学术疑问。比如：“它和另一个近义词有什么语境区别？”</p>
                    </div>
                  ) : (
                    chatMessages.map((msg, idx) => {
                      const isAI = msg.role === 'assistant';
                      return (
                        <div key={idx} className={`flex ${isAI ? 'justify-start' : 'justify-end'} animate-fade-in`}>
                          <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                            isAI 
                              ? 'bg-stone-100 text-stone-850 rounded-tl-sm' 
                              : 'bg-amber-500 text-white rounded-tr-sm font-medium'
                          }`}>
                            {isAI ? (
                              /* Clean text wrap for Markdown formatting response */
                              <div className="whitespace-pre-wrap select-all font-sans">{msg.text}</div>
                            ) : (
                              <p className="whitespace-pre-wrap">{msg.text}</p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-stone-50 border px-4 py-2.5 rounded-2xl rounded-tl-sm text-xs text-stone-400 flex items-center gap-2">
                        <div className="h-1.5 w-1.5 bg-stone-400 rounded-full animate-bounce"></div>
                        <div className="h-1.5 w-1.5 bg-stone-400 rounded-full animate-bounce delay-75"></div>
                        <div className="h-1.5 w-1.5 bg-stone-400 rounded-full animate-bounce delay-150"></div>
                        <span>导师正在精心解答中...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input form */}
                <div className="p-4 border-t border-stone-100 bg-stone-50 rounded-b-3xl flex gap-2">
                  <input
                    id="ai-chat-input"
                    type="text"
                    disabled={loading}
                    placeholder={`关于单词 "${selectedWord.word}"，你想询问老师什么？...`}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && chatInput.trim() && !loading) {
                        handleSendChatMessage();
                      }
                    }}
                    className="flex-1 px-4 py-2.5 bg-white border border-stone-200 focus:border-amber-500 rounded-xl text-xs focus:outline-hidden"
                  />
                  <button
                    id="btn-send-chat"
                    disabled={loading || !chatInput.trim()}
                    onClick={handleSendChatMessage}
                    className="px-4 bg-stone-900 hover:bg-stone-850 disabled:bg-stone-100 disabled:text-stone-400 text-white rounded-xl transition flex items-center justify-center cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

    </div>
  );
}
