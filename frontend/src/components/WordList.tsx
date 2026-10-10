/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  Star, 
  Volume2, 
  Plus, 
  BookMarked, 
  X, 
  Sparkles, 
  Brain, 
  ExternalLink,
  PlusCircle,
  FileSpreadsheet,
  BookOpen,
  MessageSquare,
  Headphones,
  FileText,
  Trash2
} from 'lucide-react';
import { IELTSWord, WordProgress, WordCategory } from '../types';
import { apiFetch } from '../lib/apiUrl';

interface WordListProps {
  vocabulary: IELTSWord[];
  progress: Record<string, WordProgress>;
  onToggleStar: (wordId: string) => void;
  onAddCustomWord: (word: Omit<IELTSWord, 'id' | 'custom'>) => void;
  onUpdateWord?: (wordId: string, updatedFields: Partial<IELTSWord>) => void;
  onDeleteWord?: (wordId: string) => void;
  onSelectWordForAI: (word: IELTSWord, tab: 'mnemonic' | 'writing' | 'speaking' | 'chat') => void;
  onTraceMaterial?: (materialId: string, wordText?: string) => void;
}

export default function WordList({
  vocabulary,
  progress,
  onToggleStar,
  onAddCustomWord,
  onUpdateWord,
  onDeleteWord,
  onSelectWordForAI,
  onTraceMaterial
}: WordListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [selectedWord, setSelectedWord] = useState<IELTSWord | null>(null);

  // Dynamic traceback materials resolver
  const [materials, setMaterials] = useState<any[]>([]);
  React.useEffect(() => {
    const storedMaterials = localStorage.getItem('ielts_material_files');
    if (storedMaterials) {
      try {
        setMaterials(JSON.parse(storedMaterials));
      } catch (e) {
        console.error('Failed to parse materials from local storage', e);
      }
    }
  }, []);

  // Helper to find real academic source of a word from study materials dynamically
  const getWordSourceInfo = (word: IELTSWord) => {
    if (word.sourceMaterialId) {
      const exists = materials.some(m => m.id === word.sourceMaterialId);
      if (exists) {
        return {
          sourceMaterialId: word.sourceMaterialId,
          sourceMaterialName: word.sourceMaterialName || 'Academic Material',
          sourceSentence: word.sourceSentence || 'Original context sentence'
        };
      }
    }

    // Try dynamic substring scan across all materials
    if (materials.length > 0 && word.word) {
      const searchWord = word.word.toLowerCase().trim();
      
      // Generate some common variants of the word for smarter matching (e.g. plurals, past tense, adverb)
      const variants = [searchWord];
      if (searchWord.endsWith('y')) {
        variants.push(searchWord.slice(0, -1) + 'ies');
        variants.push(searchWord.slice(0, -1) + 'ied');
      } else if (searchWord.endsWith('e')) {
        variants.push(searchWord + 's');
        variants.push(searchWord + 'd');
        variants.push(searchWord.slice(0, -1) + 'ing');
      } else {
        variants.push(searchWord + 's');
        variants.push(searchWord + 'es');
        variants.push(searchWord + 'ed');
        variants.push(searchWord + 'ing');
        if (searchWord.length > 3) {
          variants.push(searchWord + searchWord[searchWord.length - 1] + 'ing'); // e.g. run -> running
          variants.push(searchWord + searchWord[searchWord.length - 1] + 'ed');  // e.g. stop -> stopped
        }
      }

      for (const material of materials) {
        // A. Search in videoSubtitles if present
        if (material.videoSubtitles && material.videoSubtitles.length > 0) {
          for (const sub of material.videoSubtitles) {
            const subTextLower = sub.text.toLowerCase();
            for (const variant of variants) {
              if (subTextLower.includes(variant)) {
                return {
                  sourceMaterialId: material.id,
                  sourceMaterialName: material.name,
                  sourceSentence: sub.text
                };
              }
            }
          }
        }

        // B. Search in sentences array if present
        if (material.sentences && material.sentences.length > 0) {
          for (const sentence of material.sentences) {
            const cleanSentence = sentence.trim();
            if (!cleanSentence) continue;
            const sentLower = cleanSentence.toLowerCase();
            for (const variant of variants) {
              if (sentLower.includes(variant)) {
                return {
                  sourceMaterialId: material.id,
                  sourceMaterialName: material.name,
                  sourceSentence: cleanSentence
                };
              }
            }
          }
        }

        // C. Search in content text
        if (material.content) {
          const sentences = material.content.split(/[.!?：；。！？\n]/);
          for (const sentence of sentences) {
            const cleanSentence = sentence.trim();
            if (!cleanSentence) continue;
            const sentLower = cleanSentence.toLowerCase();
            for (const variant of variants) {
              if (sentLower.includes(variant)) {
                return {
                  sourceMaterialId: material.id,
                  sourceMaterialName: material.name,
                  sourceSentence: cleanSentence
                };
              }
            }
          }
        }
      }
    }

    return null;
  };
  
  // Mobile active column view state
  const [mobileActiveCol, setMobileActiveCol] = useState<WordCategory>('reading');

  // Add custom word modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customWord, setCustomWord] = useState({
    word: '',
    phonetic: '',
    partOfSpeech: 'n.',
    chinese: '',
    definition: '',
    example: '',
    exampleTranslation: '',
    category: 'reading' as WordCategory,
    topic: 'General',
    userNotes: ''
  });

  // Bulk import modal state
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkError, setBulkError] = useState('');

  // AI smart word lookup state
  const [aiLookupQuery, setAiLookupQuery] = useState('');
  const [aiLookupCategory, setAiLookupCategory] = useState<'auto' | WordCategory>('auto');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuccessMessage, setAiSuccessMessage] = useState('');

  const handleAiLookupAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = aiLookupQuery.trim();
    if (!query) return;

    setIsAiLoading(true);
    setAiError('');
    setAiSuccessMessage('');

    try {
      const response = await apiFetch('/api/gemini/word-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          word: query, 
          category: aiLookupCategory === 'auto' ? undefined : aiLookupCategory 
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '检索失败');
      }

      const wordData = await response.json();
      
      onAddCustomWord({
        word: wordData.word || query,
        phonetic: wordData.phonetic || '',
        partOfSpeech: wordData.partOfSpeech || 'n.',
        chinese: wordData.chinese || '',
        definition: wordData.definition || '',
        example: wordData.example || '',
        exampleTranslation: wordData.exampleTranslation || '',
        category: wordData.category || 'reading',
        topic: wordData.topic || 'General',
        allMeanings: wordData.allMeanings || [],
        collocations: wordData.collocations || []
      });

      const categoryMap: Record<string, string> = {
        reading: '阅读',
        writing: '写作',
        speaking: '口语',
        listening: '听力'
      };
      const catLabel = categoryMap[wordData.category] || '未分类';

      setAiSuccessMessage(`✅ 已自动解析并添加「${wordData.word || query}」至 ${catLabel} 词书！`);
      setAiLookupQuery('');
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        setAiSuccessMessage('');
      }, 5000);
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || '网络错误，请稍后重试');
    } finally {
      setIsAiLoading(false);
    }
  };

  // Extract all unique topics
  const topics = useMemo(() => {
    const list = new Set<string>();
    vocabulary.forEach(v => {
      if (v.topic) list.add(v.topic);
    });
    return Array.from(list);
  }, [vocabulary]);

  // Helper to filter words by general criteria
  const getFilteredList = (cat: WordCategory) => {
    return vocabulary.filter(w => {
      // 1. Matches IELTS Category
      if (w.category !== cat) return false;

      // 2. Matches Search
      const matchSearch = 
        w.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.chinese.includes(searchQuery) ||
        w.definition.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;
        
      // 3. Matches Topic
      const matchTopic = selectedTopic === 'all' || w.topic === selectedTopic;
      if (!matchTopic) return false;
      
      // 4. Matches Starred
      const isStarred = progress[w.id]?.starred || false;
      const matchStar = !showStarredOnly || isStarred;
      if (!matchStar) return false;

      return true;
    });
  };

  // Filtered lists for each column
  const readingWords = useMemo(() => getFilteredList('reading'), [vocabulary, searchQuery, selectedTopic, showStarredOnly, progress]);
  const writingWords = useMemo(() => getFilteredList('writing'), [vocabulary, searchQuery, selectedTopic, showStarredOnly, progress]);
  const speakingWords = useMemo(() => getFilteredList('speaking'), [vocabulary, searchQuery, selectedTopic, showStarredOnly, progress]);
  const listeningWords = useMemo(() => getFilteredList('listening'), [vocabulary, searchQuery, selectedTopic, showStarredOnly, progress]);

  const totalFilteredCount = readingWords.length + writingWords.length + speakingWords.length + listeningWords.length;

  // Handle word speak using Speech Synthesis
  const handleSpeak = (wordText: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(wordText);
      utterance.lang = 'en-US';
      utterance.rate = 0.85; // Slightly slower for clear IELTS phonetic checking
      window.speechSynthesis.speak(utterance);
    }
  };

  // Submit custom word
  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customWord.word.trim() || !customWord.chinese.trim()) {
      alert('请输入单词和中文释义！');
      return;
    }
    onAddCustomWord({
      ...customWord,
      userNotes: customWord.userNotes.trim() || undefined
    });
    setIsModalOpen(false);
    // Reset form
    setCustomWord({
      word: '',
      phonetic: '',
      partOfSpeech: 'n.',
      chinese: '',
      definition: '',
      example: '',
      exampleTranslation: '',
      category: 'reading',
      topic: 'General',
      userNotes: ''
    });
  };

  // Submit bulk import
  const handleBulkImport = () => {
    try {
      if (!bulkInput.trim()) return;
      
      let wordsToImport: any[] = [];
      try {
        const parsed = JSON.parse(bulkInput);
        wordsToImport = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        // Parse line-by-line format e.g. "mitigate /缓和/Make less severe"
        const lines = bulkInput.split('\n').filter(l => l.trim());
        wordsToImport = lines.map((line, idx) => {
          const parts = line.split(/[//,;，]/).map(p => p.trim());
          if (parts.length < 2) {
            throw new Error(`第 ${idx + 1} 行格式不正确，至少需要包含 "单词/中文释义"`);
          }
          return {
            word: parts[0],
            chinese: parts[1],
            phonetic: parts[2] || '',
            definition: parts[3] || 'Academic IELTS word',
            example: parts[4] || 'A high-scoring IELTS example sentence using this word.',
            exampleTranslation: parts[5] || '一个使用该词的雅思高分例句。',
            category: 'reading_writing',
            topic: parts[6] || 'General'
          };
        });
      }

      wordsToImport.forEach(w => {
        if (!w.word || !w.chinese) {
          throw new Error('导入的每个单词必须包含 word 和 chinese 字段');
        }

        // Map categories safely
        let mappedCategory: WordCategory = 'reading';
        if (w.category === 'speaking' || w.category === 'listening' || w.category === 'reading' || w.category === 'writing') {
          mappedCategory = w.category;
        } else if (w.category === 'reading_writing') {
          mappedCategory = 'reading';
        } else {
          // map legacy values or others
          if (w.category === 'foundation' || w.category === 'core') {
            mappedCategory = 'listening';
          } else if (w.category === 'advanced') {
            mappedCategory = 'speaking';
          } else {
            mappedCategory = 'reading';
          }
        }

        onAddCustomWord({
          word: w.word.trim(),
          phonetic: w.phonetic?.trim() || '',
          partOfSpeech: w.partOfSpeech?.trim() || 'n.',
          chinese: w.chinese.trim(),
          definition: w.definition?.trim() || 'Academic IELTS word',
          example: w.example?.trim() || '',
          exampleTranslation: w.exampleTranslation?.trim() || '',
          category: mappedCategory,
          topic: w.topic?.trim() || 'General'
        });
      });

      setIsBulkOpen(false);
      setBulkInput('');
      setBulkError('');
    } catch (err: any) {
      setBulkError(err.message || '导入失败，请检查输入格式。');
    }
  };

  // Subcomponent to render a single word card inside a lane
  const renderWordCard = (word: IELTSWord) => {
    const isStarred = progress[word.id]?.starred || false;
    const learnedBox = progress[word.id]?.box || 0;
    const isSelected = selectedWord?.id === word.id;
    const resolvedSource = getWordSourceInfo(word);

    return (
      <div
        key={word.id}
        id={`word-card-${word.id}`}
        onClick={() => setSelectedWord(word)}
        className={`p-4 rounded-2xl border transition cursor-pointer text-left flex flex-col justify-between ${
          isSelected 
            ? 'bg-amber-500/10 border-amber-500 shadow-xs ring-1 ring-amber-500/10' 
            : 'bg-white hover:bg-stone-50 border-stone-200/80 hover:border-stone-350'
        }`}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-stone-900 font-serif font-bold text-base select-all tracking-tight leading-tight">
              {word.word}
            </span>
            <div className="flex items-center gap-1">
              {resolvedSource && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onTraceMaterial && resolvedSource.sourceMaterialId) {
                      onTraceMaterial(resolvedSource.sourceMaterialId, word.word);
                    }
                  }}
                  className="text-[8px] font-mono bg-amber-50 text-amber-700 border border-amber-200/50 hover:bg-amber-100 hover:border-amber-300 px-1 py-0.5 rounded-sm font-bold flex items-center gap-0.5 cursor-pointer transition hover:scale-105 active:scale-95"
                  title={`一键跳转学术原著: ${resolvedSource.sourceMaterialName}`}
                >
                  🔍 追溯
                </button>
              )}
              {word.userNotes && (
                <span className="text-[9px] font-mono bg-amber-50 text-amber-700 border border-amber-200/50 px-1 py-0.5 rounded-sm" title={word.userNotes}>
                  📝 笔记
                </span>
              )}
              {learnedBox > 0 && (
                <span className="text-[9px] font-mono bg-stone-100 text-stone-500 border border-stone-200/50 px-1 py-0.5 rounded-sm">
                  Box {learnedBox}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(word.id);
                }}
                className="p-0.5 text-stone-400 hover:text-pink-500 transition"
              >
                <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-pink-500 text-pink-500' : ''}`} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-400">
            <span className="font-semibold text-stone-500">{word.partOfSpeech}</span>
            <span>{word.phonetic}</span>
          </div>
          
          <p className="text-stone-700 text-xs font-medium line-clamp-1">
            {word.chinese}
          </p>
        </div>

        <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-stone-100 text-[9px] text-stone-400">
          <span className="bg-stone-100 px-1.5 py-0.5 rounded-sm">{word.topic}</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={(e) => handleSpeak(word.word, e)}
              className="text-stone-450 hover:text-amber-500 p-0.5 transition"
              title="发音"
            >
              <Volume2 className="h-3 w-3" />
            </button>
            {onDeleteWord && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteWord(word.id);
                  if (selectedWord?.id === word.id) {
                    setSelectedWord(null);
                  }
                }}
                className="text-stone-400 hover:text-red-500 p-0.5 transition"
                title="从词书中删除单词"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fade-in" id="wordlist-view">
      
      {/* Sidebar: Filters & Management */}
      <div className="space-y-5 lg:col-span-1">
        <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-serif font-semibold text-stone-900 text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-stone-500" /> 检索与词库
            </h3>
            <span className="text-xs font-mono bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">
              共 {totalFilteredCount} 词
            </span>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-stone-400" />
            <input 
              id="search-input"
              type="text"
              placeholder="搜索单词、中文、释义..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-stone-50/80 border border-stone-200 focus:border-amber-500/50 focus:bg-white rounded-xl text-sm transition-all focus:outline-hidden"
            />
          </div>

          {/* Topic Filter */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-stone-400 uppercase tracking-widest block">学术分类主题</label>
            <select
              id="topic-select"
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="w-full p-2.5 bg-stone-50/80 border border-stone-200 focus:border-amber-500/50 focus:bg-white rounded-xl text-sm transition focus:outline-hidden"
            >
              <option value="all">所有话题 (All Topics)</option>
              {topics.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Starred Switcher */}
          <button
            id="toggle-starred-filter"
            onClick={() => setShowStarredOnly(!showStarredOnly)}
            className={`w-full py-2.5 px-4 rounded-xl border flex items-center justify-between text-sm transition ${
              showStarredOnly 
                ? 'bg-pink-50 border-pink-200 text-pink-700' 
                : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
            }`}
          >
            <span className="flex items-center gap-2">
              <Star className={`h-4 w-4 ${showStarredOnly ? 'fill-pink-500 text-pink-500' : 'text-stone-400'}`} />
              仅显示我的收藏生词
            </span>
            <span className="text-xs font-mono bg-white border px-1.5 py-0.5 rounded-md">
              {Object.values(progress).filter(p => p.starred).length}
            </span>
          </button>

          {/* Custom Vocabulary Actions */}
          <div className="pt-4 border-t border-stone-100 grid grid-cols-2 gap-2">
            <button
              id="btn-add-word-modal"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-stone-900 text-white rounded-xl hover:bg-stone-850 text-xs font-medium transition cursor-pointer"
            >
              <Plus className="h-4 w-4" /> 新增生词
            </button>
            <button
              id="btn-bulk-import-modal"
              onClick={() => setIsBulkOpen(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 text-xs font-medium transition cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4" /> 批量导入
            </button>
          </div>

          {/* AI 智能检索并快捷加词 */}
          <div className="pt-4 border-t border-stone-100 space-y-2.5">
            <label className="text-xs font-serif font-bold text-stone-800 tracking-wide block flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> AI 智能检索自动加词
            </label>
            <form onSubmit={handleAiLookupAndAdd} className="space-y-2">
              {/* Target module selector */}
              <div className="grid grid-cols-5 gap-1 bg-stone-100 p-0.5 rounded-xl border border-stone-250">
                <button
                  type="button"
                  onClick={() => setAiLookupCategory('auto')}
                  className={`py-1 rounded-lg text-[9.5px] font-bold text-center transition cursor-pointer ${
                    aiLookupCategory === 'auto'
                      ? 'bg-stone-900 text-white shadow-xs'
                      : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-850'
                  }`}
                  title="让 AI 自动推荐最适合的科目分册"
                >
                  🤖 自动
                </button>
                <button
                  type="button"
                  onClick={() => setAiLookupCategory('reading')}
                  className={`py-1 rounded-lg text-[9.5px] font-bold text-center transition cursor-pointer ${
                    aiLookupCategory === 'reading'
                      ? 'bg-amber-400 text-stone-950 shadow-xs'
                      : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-850'
                  }`}
                >
                  📖 阅读
                </button>
                <button
                  type="button"
                  onClick={() => setAiLookupCategory('writing')}
                  className={`py-1 rounded-lg text-[9.5px] font-bold text-center transition cursor-pointer ${
                    aiLookupCategory === 'writing'
                      ? 'bg-amber-400 text-stone-950 shadow-xs'
                      : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-850'
                  }`}
                >
                  ✍️ 写作
                </button>
                <button
                  type="button"
                  onClick={() => setAiLookupCategory('speaking')}
                  className={`py-1 rounded-lg text-[9.5px] font-bold text-center transition cursor-pointer ${
                    aiLookupCategory === 'speaking'
                      ? 'bg-amber-400 text-stone-950 shadow-xs'
                      : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-850'
                  }`}
                >
                  🗣️ 口语
                </button>
                <button
                  type="button"
                  onClick={() => setAiLookupCategory('listening')}
                  className={`py-1 rounded-lg text-[9.5px] font-bold text-center transition cursor-pointer ${
                    aiLookupCategory === 'listening'
                      ? 'bg-amber-400 text-stone-950 shadow-xs'
                      : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-850'
                  }`}
                >
                  🎧 听力
                </button>
              </div>

              <div className="relative flex items-center">
                <input 
                  type="text"
                  placeholder="输入雅思单词/短语..."
                  value={aiLookupQuery}
                  onChange={(e) => setAiLookupQuery(e.target.value)}
                  disabled={isAiLoading}
                  className="w-full pl-3 pr-22 py-2.5 bg-stone-50 border border-stone-200 focus:border-amber-500/50 focus:bg-white rounded-xl text-xs transition-all focus:outline-hidden disabled:opacity-50 font-sans"
                />
                <button
                  type="submit"
                  disabled={isAiLoading || !aiLookupQuery.trim()}
                  className="absolute right-1 top-1 bottom-1 px-3 bg-amber-400 text-stone-900 rounded-lg hover:bg-amber-300 text-[11px] font-bold transition disabled:opacity-45 disabled:pointer-events-none flex items-center gap-1 cursor-pointer"
                >
                  {isAiLoading ? '解析中...' : '自动录入'}
                </button>
              </div>
              
              {aiSuccessMessage && (
                <div className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-100/60 p-2 rounded-xl animate-fade-in font-medium leading-normal">
                  {aiSuccessMessage}
                </div>
              )}
              {aiError && (
                <div className="text-[11px] text-red-600 bg-red-50 border border-red-100/60 p-2 rounded-xl animate-fade-in font-medium leading-normal">
                  {aiError}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Main Area: Words List and Detail View */}
      <div className="lg:col-span-3 space-y-5">
        {selectedWord ? (
          /* Detailed Word Card Panel */
          <div className="bg-white rounded-3xl p-6 border border-stone-200/80 shadow-xs space-y-6 animate-slide-in" id="word-detail-panel">
            {/* Header: Word & Actions */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-3xl font-serif font-bold text-stone-900 tracking-tight select-all">
                    {selectedWord.word}
                  </h2>
                  <button 
                    onClick={(e) => handleSpeak(selectedWord.word, e)}
                    className="p-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg border border-amber-100 transition cursor-pointer"
                    title="发音"
                  >
                    <Volume2 className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-stone-500 pt-1">
                  <span className="font-semibold text-stone-600">{selectedWord.partOfSpeech}</span>
                  <span>•</span>
                  <span>{selectedWord.phonetic}</span>
                  <span>•</span>
                  <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">{selectedWord.topic}</span>
                  <span>•</span>
                  <span className="bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                    {selectedWord.category === 'reading' ? '📖 阅读词汇' : 
                     selectedWord.category === 'writing' ? '✍️ 写作词汇' :
                     selectedWord.category === 'speaking' ? '🗣️ 口语' : '🎧 听力'}
                  </span>
                </div>

                {/* 修改分册模块的快捷按键 */}
                {onUpdateWord && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 bg-stone-50 p-1 rounded-xl border border-stone-200/80 w-fit">
                    <span className="text-[10px] text-stone-500 font-bold px-1.5 font-sans">切换分册模块:</span>
                    {(['reading', 'writing', 'speaking', 'listening'] as WordCategory[]).map((cat) => {
                      const isActive = selectedWord.category === cat;
                      const label = cat === 'reading' ? '📖 阅读' :
                                    cat === 'writing' ? '✍️ 写作' :
                                    cat === 'speaking' ? '🗣️ 口语' : '🎧 听力';
                      return (
                        <button
                          key={cat}
                          onClick={() => {
                            if (onUpdateWord) {
                              onUpdateWord(selectedWord.id, { category: cat });
                              setSelectedWord({ ...selectedWord, category: cat });
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer font-sans border ${
                            isActive 
                              ? 'bg-amber-400 border-amber-400 text-stone-900 shadow-xs' 
                              : 'bg-white border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-stone-850'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => onToggleStar(selectedWord.id)}
                  className="p-2 border border-stone-200 rounded-xl hover:bg-stone-50 transition cursor-pointer"
                  title="收藏单词"
                >
                  <Star className={`h-5 w-5 ${progress[selectedWord.id]?.starred ? 'fill-pink-500 text-pink-500' : 'text-stone-400'}`} />
                </button>
                {onDeleteWord && (
                  <button 
                    onClick={() => {
                      onDeleteWord(selectedWord.id);
                      setSelectedWord(null);
                    }}
                    className="p-2 border border-red-200 text-red-500 rounded-xl hover:bg-red-50 hover:border-red-300 transition cursor-pointer"
                    title="删除单词"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                )}
                <button 
                  onClick={() => setSelectedWord(null)}
                  className="p-2 border border-stone-200 rounded-xl hover:bg-stone-50 text-stone-500 transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Definitions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-stone-100">
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">中文释义</span>
                <p className="text-stone-900 text-base font-medium">{selectedWord.chinese}</p>
              </div>
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">英文定义</span>
                <p className="text-stone-600 text-sm leading-relaxed">{selectedWord.definition}</p>
              </div>
            </div>

            {/* Core Spaced Repetition Info */}
            <div className="bg-stone-50 rounded-2xl p-4 border border-stone-100 flex items-center justify-between text-xs font-mono text-stone-500">
              <div className="flex items-center gap-1.5">
                <Brain className="h-4 w-4 text-amber-500" />
                <span>莱特纳记忆级别: <b>Box {progress[selectedWord.id]?.box || 1}/5</b></span>
              </div>
              <div>
                <span>复习状态: <b className="capitalize text-stone-700">{progress[selectedWord.id]?.status || '新词'}</b></span>
              </div>
              <div>
                <span>复习过: <b>{progress[selectedWord.id]?.timesReviewed || 0}次</b></span>
              </div>
            </div>

            {/* Sample Sentence */}
            {selectedWord.example && (
              <div className="space-y-2 bg-stone-50/50 p-4 rounded-2xl border border-stone-200/40">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">考官级学术例句</span>
                <p className="text-stone-800 text-sm leading-relaxed italic select-all">
                  "{selectedWord.example}"
                </p>
                <p className="text-stone-500 text-xs">{selectedWord.exampleTranslation}</p>
              </div>
            )}

            {/* Multiple Meanings Extension */}
            {selectedWord.allMeanings && selectedWord.allMeanings.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-stone-100">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block font-bold">📖 单词多重词义 & 词性拓展</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedWord.allMeanings.map((meaning, index) => (
                    <div key={index} className="p-3 bg-stone-50/70 rounded-xl border border-stone-200/50 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-100/60 px-1.5 py-0.5 rounded border border-amber-200/40">{meaning.partOfSpeech}</span>
                        <span className="text-xs font-semibold text-stone-800">{meaning.chinese}</span>
                      </div>
                      {meaning.definition && (
                        <p className="text-[11px] text-stone-500 leading-relaxed font-sans pt-0.5">{meaning.definition}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collocations & Common Phrases */}
            {selectedWord.collocations && selectedWord.collocations.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-stone-100">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block font-bold">🎯 雅思核心搭配 / 考点词组 (Core Collocations)</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selectedWord.collocations.map((col, index) => (
                    <div key={index} className="p-3 bg-amber-50/15 rounded-xl border border-stone-200/50 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-stone-900 select-all font-serif break-words">{col.phrase}</h4>
                          <button
                            onClick={(e) => handleSpeak(col.phrase, e)}
                            className="p-1 text-stone-400 hover:text-amber-600 rounded hover:bg-stone-100/60 transition cursor-pointer shrink-0"
                            title="朗读词组搭配"
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="text-[10px] text-amber-800 bg-amber-50/80 px-1.5 py-0.5 rounded-md font-bold shrink-0">{col.translation}</span>
                      </div>
                      {col.example && (
                        <div className="border-t border-dashed border-stone-200/70 pt-1.5 flex items-start gap-1.5 justify-between">
                          <p className="text-[11px] text-stone-500 leading-relaxed italic flex-1">"{col.example}"</p>
                          <button
                            onClick={(e) => handleSpeak(col.example, e)}
                            className="p-1 text-stone-400 hover:text-amber-600 rounded hover:bg-stone-100/60 transition cursor-pointer shrink-0 mt-0.5"
                            title="朗读搭配例句"
                          >
                            <Volume2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* My Personal Notes Box */}
            <div className="space-y-2 bg-amber-50/20 p-4 rounded-2xl border border-amber-200/30">
              <span className="text-[10px] font-mono text-amber-800 uppercase tracking-widest block font-bold">✍️ 我的记忆与学练笔记 (My Personal Notes)</span>
              <textarea
                placeholder="在这里写下你的高频词伙、助记联想或特殊用法笔记，实时自动保存..."
                rows={3}
                value={selectedWord.userNotes || ''}
                onChange={(e) => {
                  if (onUpdateWord) {
                    onUpdateWord(selectedWord.id, { userNotes: e.target.value });
                    setSelectedWord(prev => prev ? { ...prev, userNotes: e.target.value } : null);
                  }
                }}
                className="w-full p-2.5 bg-white border border-stone-250 rounded-xl text-xs font-sans focus:outline-hidden focus:border-amber-500 leading-relaxed text-stone-850"
              />
            </div>

            {/* Academic Source Traceback */}
            {(() => {
              const resolvedSource = selectedWord ? getWordSourceInfo(selectedWord) : null;
              if (resolvedSource) {
                return (
                  <div className="bg-amber-50/40 p-4 rounded-2xl border border-amber-200/40 space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-amber-950 uppercase tracking-widest block font-bold">📄 学术源头追溯 (Source Reference)</span>
                      <span className="text-[9px] font-mono bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                        {selectedWord.sourceMaterialId ? '100% 真实定位' : '智能语境定位'}
                      </span>
                    </div>
                    <div className="text-xs text-stone-750 space-y-1.5">
                      <div className="flex items-center gap-1">
                        <span className="text-stone-400 shrink-0 font-medium">源于材料:</span>
                        <span className="font-semibold text-stone-850 truncate bg-white px-2 py-0.5 rounded border border-stone-200/30">
                          {resolvedSource.sourceMaterialName}
                        </span>
                      </div>
                      {resolvedSource.sourceSentence && (
                        <div className="space-y-1 bg-white p-2.5 rounded-lg border border-amber-200/20">
                          <span className="text-[9px] font-mono text-stone-400 block font-semibold">所处原句 (Context Sentence):</span>
                          <p className="text-stone-700 leading-normal italic text-[11px] font-mono select-all">
                            "{resolvedSource.sourceSentence}"
                          </p>
                        </div>
                      )}
                    </div>
                    {onTraceMaterial && (
                      <button
                        onClick={() => onTraceMaterial(resolvedSource.sourceMaterialId, selectedWord.word)}
                        className="w-full py-2 bg-amber-600 hover:bg-amber-750 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        一键跳转到该学术材料 & 语境精读
                      </button>
                    )}
                  </div>
                );
              } else {
                return (
                  <div className="bg-stone-50/50 p-4 rounded-2xl border border-stone-200/40 space-y-2 text-stone-500 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block font-bold">📄 学术源头追溯 (Source Reference)</span>
                      <span className="text-[9px] font-mono bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded font-bold">暂无匹配材料</span>
                    </div>
                    <p className="text-xs leading-relaxed">
                      目前学术材料库中尚未发现包含该单词的句段。您可以导入包含该词的文章到材料库，系统将自动关联并激活 <b>100% 语境追溯 & 真题精读</b> 功能。
                    </p>
                  </div>
                );
              }
            })()}

            {/* AI Integration Prompts Grid */}
            <div className="space-y-3 pt-4 border-t border-stone-100">
              <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest block">Gemini 3.5 AI 深度辅导与记忆加速</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => onSelectWordForAI(selectedWord, 'mnemonic')}
                  className="flex items-center justify-between p-3.5 bg-amber-50/60 hover:bg-amber-50 border border-amber-100 hover:border-amber-300 rounded-xl transition group cursor-pointer text-left"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-amber-800 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" /> AI 词源与谐音助记
                    </div>
                    <div className="text-[10px] text-amber-600">趣味口语、词根词缀</div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-amber-400 group-hover:text-amber-600 transition" />
                </button>

                <button
                  onClick={() => onSelectWordForAI(selectedWord, 'writing')}
                  className="flex items-center justify-between p-3.5 bg-sky-50/60 hover:bg-sky-50 border border-sky-100 hover:border-sky-300 rounded-xl transition group cursor-pointer text-left"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-sky-800 flex items-center gap-1">
                      <BookMarked className="h-3.5 w-3.5 text-sky-500" /> 雅思写作语境合成
                    </div>
                    <div className="text-[10px] text-sky-600">合成考官高分段落</div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-sky-400 group-hover:text-sky-600 transition" />
                </button>

                <button
                  onClick={() => onSelectWordForAI(selectedWord, 'speaking')}
                  className="flex items-center justify-between p-3.5 bg-emerald-50/60 hover:bg-emerald-50 border border-emerald-100 hover:border-emerald-300 rounded-xl transition group cursor-pointer text-left"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-emerald-800 flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5 text-emerald-500" /> 雅思口语真题模拟
                    </div>
                    <div className="text-[10px] text-emerald-600">考官Part1/3模拟提问</div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-emerald-400 group-hover:text-emerald-600 transition" />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* --- IELTS MULTI-COLUMN (分栏) VIEW SYSTEM --- */}
        <div className="space-y-4">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white px-6 py-4 rounded-2xl border border-stone-200/80">
            <div>
              <h4 className="font-serif font-bold text-stone-900 text-sm">
                {searchQuery || selectedTopic !== 'all' || showStarredOnly ? '筛查分栏结果' : '雅思专科分栏词库'}
              </h4>
              <p className="text-[11px] text-stone-400 mt-0.5">
                分科精准备考：雅思各单科对应的核心记背词库。点击卡片可查看AI精讲。
              </p>
            </div>
            <span className="text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-100 self-start sm:self-center">
              * 分栏记录，左右拖拽或在下方选择切换
            </span>
          </div>

          {/* 1. MOBILE TABS (only visible under lg:) */}
          <div className="flex lg:hidden bg-stone-100 p-1 rounded-xl border border-stone-200 overflow-x-auto">
            <button
              onClick={() => setMobileActiveCol('reading')}
              className={`flex-1 min-w-[70px] py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${
                mobileActiveCol === 'reading' 
                  ? 'bg-stone-900 text-white shadow-xs' 
                  : 'text-stone-600 hover:bg-stone-50/50'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              阅读 ({readingWords.length})
            </button>
            <button
              onClick={() => setMobileActiveCol('writing')}
              className={`flex-1 min-w-[70px] py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${
                mobileActiveCol === 'writing' 
                  ? 'bg-stone-900 text-white shadow-xs' 
                  : 'text-stone-600 hover:bg-stone-50/50'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              写作 ({writingWords.length})
            </button>
            <button
              onClick={() => setMobileActiveCol('speaking')}
              className={`flex-1 min-w-[70px] py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${
                mobileActiveCol === 'speaking' 
                  ? 'bg-stone-900 text-white shadow-xs' 
                  : 'text-stone-600 hover:bg-stone-50/50'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              口语 ({speakingWords.length})
            </button>
            <button
              onClick={() => setMobileActiveCol('listening')}
              className={`flex-1 min-w-[70px] py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${
                mobileActiveCol === 'listening' 
                  ? 'bg-stone-900 text-white shadow-xs' 
                  : 'text-stone-600 hover:bg-stone-50/50'
              }`}
            >
              <Headphones className="h-3.5 w-3.5" />
              听力 ({listeningWords.length})
            </button>
          </div>

          {/* 2. FOUR-LANE GRID WRAPPER */}
          {/* On Desktop: 4 columns side-by-side. On Mobile: only show active tab's column */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" id="word-lanes-container">
            
            {/* COLUMN 1: READING */}
            <div className={`flex flex-col rounded-3xl border border-stone-200 bg-stone-50/40 p-4 space-y-3 ${mobileActiveCol === 'reading' ? 'block' : 'hidden lg:flex'}`}>
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center border border-blue-100">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <h5 className="font-serif font-bold text-stone-900 text-xs">阅读核心词汇</h5>
                    <p className="text-[9px] text-stone-400">学术文章 & 快速精读大词</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                  {readingWords.length} 词
                </span>
              </div>

              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {readingWords.length === 0 ? (
                  <div className="py-12 text-center text-stone-400 text-xs bg-white rounded-2xl border border-dashed border-stone-200 p-4">
                    无匹配词汇
                  </div>
                ) : (
                  readingWords.map(renderWordCard)
                )}
              </div>
            </div>

            {/* COLUMN 2: WRITING */}
            <div className={`flex flex-col rounded-3xl border border-stone-200 bg-stone-50/40 p-4 space-y-3 ${mobileActiveCol === 'writing' ? 'block' : 'hidden lg:flex'}`}>
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center border border-indigo-100">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <h5 className="font-serif font-bold text-stone-900 text-xs">写作核心词伙</h5>
                    <p className="text-[9px] text-stone-400">大作文 & 段落过渡逻辑</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                  {writingWords.length} 词
                </span>
              </div>

              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {writingWords.length === 0 ? (
                  <div className="py-12 text-center text-stone-400 text-xs bg-white rounded-2xl border border-dashed border-stone-200 p-4">
                    无匹配词汇
                  </div>
                ) : (
                  writingWords.map(renderWordCard)
                )}
              </div>
            </div>

            {/* COLUMN 2: SPEAKING */}
            <div className={`flex flex-col rounded-3xl border border-stone-200 bg-stone-50/40 p-4 space-y-3 ${mobileActiveCol === 'speaking' ? 'block' : 'hidden lg:flex'}`}>
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center border border-emerald-100">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <h5 className="font-serif font-bold text-stone-900 text-xs">口语表达词汇</h5>
                    <p className="text-[9px] text-stone-400">Part 1/2/3 高分表达</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                  {speakingWords.length} 词
                </span>
              </div>

              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {speakingWords.length === 0 ? (
                  <div className="py-12 text-center text-stone-400 text-xs bg-white rounded-2xl border border-dashed border-stone-200 p-4">
                    无匹配词汇
                  </div>
                ) : (
                  speakingWords.map(renderWordCard)
                )}
              </div>
            </div>

            {/* COLUMN 3: LISTENING */}
            <div className={`flex flex-col rounded-3xl border border-stone-200 bg-stone-50/40 p-4 space-y-3 ${mobileActiveCol === 'listening' ? 'block' : 'hidden lg:flex'}`}>
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center border border-amber-100">
                    <Headphones className="h-4 w-4" />
                  </div>
                  <div>
                    <h5 className="font-serif font-bold text-stone-900 text-xs">听力与听写词汇</h5>
                    <p className="text-[9px] text-stone-400">听力填空常考、拼写纠偏</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                  {listeningWords.length} 词
                </span>
              </div>

              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {listeningWords.length === 0 ? (
                  <div className="py-12 text-center text-stone-400 text-xs bg-white rounded-2xl border border-dashed border-stone-200 p-4">
                    无匹配词汇
                  </div>
                ) : (
                  listeningWords.map(renderWordCard)
                )}
              </div>
            </div>

          </div>

        </div>
      </div>

      {/* MODAL: ADD CUSTOM WORD */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 border border-stone-200 shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif font-bold text-lg text-stone-900 flex items-center gap-2">
                <PlusCircle className="h-5 w-5 text-amber-500" /> 手动新增雅思生词
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 bg-stone-100 hover:bg-stone-200 rounded-lg text-stone-500 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCustom} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-mono text-stone-500">单词 *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. scrutinized"
                    value={customWord.word}
                    onChange={(e) => setCustomWord({ ...customWord, word: e.target.value })}
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-hidden focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-stone-500">音标</label>
                  <input
                    type="text"
                    placeholder="e.g. /ˈskruː.tɪ.naɪz/"
                    value={customWord.phonetic}
                    onChange={(e) => setCustomWord({ ...customWord, phonetic: e.target.value })}
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-hidden focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-mono text-stone-500">词性</label>
                  <select
                    value={customWord.partOfSpeech}
                    onChange={(e) => setCustomWord({ ...customWord, partOfSpeech: e.target.value })}
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-xs focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="n.">名词 (n.)</option>
                    <option value="v.">动词 (v.)</option>
                    <option value="adj.">形容词 (adj.)</option>
                    <option value="adv.">副词 (adv.)</option>
                    <option value="v. / n.">动名词 (v. / n.)</option>
                    <option value="prep.">介词 (prep.)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-stone-500">雅思专项分类 *</label>
                  <select
                    value={customWord.category}
                    onChange={(e) => setCustomWord({ ...customWord, category: e.target.value as WordCategory })}
                    className="w-full p-2 bg-stone-50 border border-stone-250 rounded-lg text-xs focus:outline-hidden focus:border-amber-500 font-semibold text-amber-900"
                  >
                    <option value="reading">📖 阅读词汇</option>
                    <option value="writing">✍️ 写作词汇</option>
                    <option value="speaking">🗣️ 口语表达词汇</option>
                    <option value="listening">🎧 听力与听写词汇</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-stone-500">雅思学术话题</label>
                  <input
                    type="text"
                    placeholder="e.g. Environment"
                    value={customWord.topic}
                    onChange={(e) => setCustomWord({ ...customWord, topic: e.target.value })}
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-hidden focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-500">中文解释 *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 仔细检查，审视"
                  value={customWord.chinese}
                  onChange={(e) => setCustomWord({ ...customWord, chinese: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-500">英文释义</label>
                <textarea
                  placeholder="English definition or description..."
                  value={customWord.definition}
                  onChange={(e) => setCustomWord({ ...customWord, definition: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-xs h-16 resize-none focus:outline-hidden focus:border-amber-500"
                ></textarea>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-500">学术例句</label>
                <textarea
                  placeholder="The examiner closely scrutinized the candidate's paper..."
                  value={customWord.example}
                  onChange={(e) => setCustomWord({ ...customWord, example: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-xs h-14 resize-none focus:outline-hidden focus:border-amber-500"
                ></textarea>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-500">例句中文翻译</label>
                <input
                  type="text"
                  placeholder="考官仔细审查了考生的考卷..."
                  value={customWord.exampleTranslation}
                  onChange={(e) => setCustomWord({ ...customWord, exampleTranslation: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-500">生词记忆笔记 My Notes</label>
                <textarea
                  placeholder="输入关于该单词的自定义背诵、记忆笔记或学习标注..."
                  value={customWord.userNotes}
                  onChange={(e) => setCustomWord({ ...customWord, userNotes: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-xs h-14 resize-none focus:outline-hidden focus:border-amber-500"
                ></textarea>
              </div>

              <div className="pt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-medium text-stone-700 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 rounded-xl text-xs font-medium text-white transition cursor-pointer"
                >
                  保存并加入专项分栏
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: BULK IMPORT */}
      {isBulkOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 border border-stone-200 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif font-bold text-lg text-stone-900 flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-amber-500" /> 批量导入我的雅思词汇书
              </h3>
              <button 
                onClick={() => setIsBulkOpen(false)}
                className="p-1 bg-stone-100 hover:bg-stone-200 rounded-lg text-stone-500 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="text-xs text-stone-500 leading-relaxed space-y-1">
                <p>支持两种格式：</p>
                <p>1. <b>快捷文本格式</b> (每行一个，用斜杠分隔)：<b>单词/中文释义/音标/英文定义/学术例句/例句翻译</b></p>
                <p className="bg-stone-50 p-1.5 rounded-md font-mono text-[10px] text-stone-600">
                  scrutinize/仔细检查/ˈskruː.tɪ.naɪz/Examine closely/The examiner scrutinized it./考官审查了它。
                </p>
                <p>2. <b>JSON数组格式</b>：传入包含 <code>word</code> 和 <code>chinese</code> 属性的JSON对象数组。</p>
              </div>

              {bulkError && (
                <div className="bg-red-50 text-red-600 text-xs p-2.5 rounded-xl border border-red-200">
                  {bulkError}
                </div>
              )}

              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="在此粘贴您的词汇列表..."
                className="w-full h-44 p-3 bg-stone-50 border border-stone-200 focus:border-amber-500 focus:bg-white rounded-xl text-xs font-mono resize-none focus:outline-hidden"
              ></textarea>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsBulkOpen(false)}
                  className="flex-1 py-2.5 bg-stone-100 hover:bg-stone-200 rounded-xl text-xs font-medium text-stone-700 transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleBulkImport}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 rounded-xl text-xs font-medium text-white transition cursor-pointer"
                >
                  解析并导入词库
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
