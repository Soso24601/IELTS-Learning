/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Folder, 
  Plus, 
  FileText, 
  Music, 
  Video, 
  Link as LinkIcon, 
  Sparkles, 
  Download, 
  Volume2, 
  Play, 
  Pause,
  Check, 
  Trash2, 
  ArrowLeft, 
  ChevronRight, 
  File as FileIcon,
  Edit3, 
  CheckCircle, 
  XCircle, 
  HelpCircle,
  FolderOpen,
  CornerDownRight,
  BookOpen,
  FileSpreadsheet,
  UploadCloud,
  Clipboard,
  Eye,
  EyeOff,
  Search
} from 'lucide-react';
import { alignSubtitleBatches, cleanAlignedSubtitles, cleanMusicCue, normalizeTranscriptForImport, subtitleAtTime, subtitlesToOriginalTranscript } from '../lib/subtitles';
import { parseSubtitleSheetRows } from '../lib/subtitleSheet';
import { IELTSWord, WordCategory, StudyMaterial, MaterialFolder, MaterialType } from '../types';

function subtitleRowsFromHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const rows: Array<{ time: number; text: string; translation: string }> = [];
  for (const row of Array.from(document.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('th,td')).map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim());
    const timeIndex = cells.findIndex(cell => /^(?:(?:(?:\d{1,2}:)?\d{1,2}:\d{2})(?:\.\d+)?|\d+(?:\.\d+)?\s*s)$/i.test(cell));
    if (timeIndex < 0) continue;
    const match = cells[timeIndex].match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d+))?\s*$/)
      || cells[timeIndex].match(/^(\d+(?:\.\d+)?)\s*s$/i);
    if (!match) continue;
    const time = match[2] !== undefined
      ? Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`)
      : Number(match[1]);
    const content = cells.filter((_cell, index) => index !== timeIndex);
    const english = content.find(cell => /[a-z]/i.test(cell));
    if (!english) continue;
    const translation = content.find(cell => /[\u3400-\u9fff]/.test(cell)) || '';
    const cleanText = cleanMusicCue(english);
    if (cleanText) rows.push({ time, text: cleanText, translation: cleanMusicCue(translation) });
  }
  return rows.map((row, index) => {
    const next = rows[index + 1]?.time;
    const end = next !== undefined && next > row.time ? next : row.time + 3;
    return `[${row.time}-${end}] ${row.text}${row.translation ? ` | ${row.translation}` : ''}`;
  }).join('\n');
}


async function parseSubtitleSpreadsheetLocally(file: File) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false }) as unknown[][];
    try {
      return parseSubtitleSheetRows(matrix);
    } catch {
      // Try another sheet in case the first one is a cover or metadata sheet.
    }
  }
  throw new Error('没有找到可识别的字幕工作表。请确认表格有 Time、Subtitle 列。');
}

async function requestSubtitleSpreadsheetImport(file: File, duration: number) {
  let apiError = '服务器暂不可用';
  try {
    const readerResult = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => typeof event.target?.result === 'string' ? resolve(event.target.result) : reject(new Error('读取文件失败'));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    const response = await fetch('/api/materials/parse-subtitle-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: readerResult.split(',')[1], fileName: file.name, duration }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `服务器返回 ${response.status}`);
    if (!result.success || !Array.isArray(result.subtitles) || !result.subtitles.length) throw new Error('服务器没有返回有效字幕');
    return { subtitles: result.subtitles, sourceCueCount: result.sourceCueCount, usedLocalFallback: false };
  } catch (error: any) {
    apiError = error?.message || apiError;
  }

  const subtitles = await parseSubtitleSpreadsheetLocally(file);
  return { subtitles, sourceCueCount: subtitles.length, usedLocalFallback: true, apiError };
}
// --- IndexedDB for persistent audio files storage ---
const dbPromise = typeof window !== 'undefined' ? new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('ielts_audio_db', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('audios');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
}) : null;

async function saveAudio(id: string, base64: string, mimeType: string) {
  if (typeof window === 'undefined') return;
  const db = await dbPromise;
  if (!db) return;
  const tx = db.transaction('audios', 'readwrite');
  tx.objectStore('audios').put({ base64, mimeType }, id);
  return new Promise((resolve) => (tx.oncomplete = resolve));
}

async function getAudio(id: string): Promise<{ base64: string, mimeType: string } | null> {
  if (typeof window === 'undefined') return null;
  const db = await dbPromise;
  if (!db) return null;
  const tx = db.transaction('audios', 'readonly');
  const req = tx.objectStore('audios').get(id);
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function deleteAudio(id: string) {
  if (typeof window === 'undefined') return;
  const db = await dbPromise;
  if (!db) return;
  const tx = db.transaction('audios', 'readwrite');
  tx.objectStore('audios').delete(id);
  return new Promise((resolve) => (tx.oncomplete = resolve));
}
// ----------------------------------------------------

export interface TextAnnotation {
  id: string;
  text: string;
  startChar: number;
  endChar: number;
  type: 'highlight' | 'underline';
  color?: string; // yellow, green, blue, pink
  comment?: string;
  timestamp: string;
}

interface MaterialsLibraryProps {
  vocabulary: IELTSWord[];
  onAddCustomWord: (wordData: Omit<IELTSWord, 'id' | 'custom'>) => void;
  initialMaterialId?: string | null;
  onClearInitialMaterialId?: () => void;
  initialWord?: string | null;
  onClearInitialWord?: () => void;
}

// Initial Preset Folders and Materials to make the workspace look alive immediately!
const PRESET_FOLDERS: MaterialFolder[] = [
  { id: 'f1', name: 'Cambridge 18 Academic Test 1', category: 'reading', createdAt: new Date().toISOString() },
  { id: 'f2', name: 'Task 2 High-Scoring Essays', category: 'writing', createdAt: new Date().toISOString() },
  { id: 'f3', name: 'Part 3 Abstract Discussions', category: 'speaking', createdAt: new Date().toISOString() },
  { id: 'f4', name: 'Section 4 Academic Lecture', category: 'listening', createdAt: new Date().toISOString() }
];

const PRESET_MATERIALS: StudyMaterial[] = [
  {
    id: 'm1',
    name: 'The Impact of Climate Change on Cities',
    type: 'document',
    category: 'reading',
    folderId: 'f1',
    content: 'Global temperatures are rising at an unprecedented rate, posing immediate threats to low-lying coastal urban areas. To mitigate these risks, municipal governments must transition to sustainable infrastructure. Empirical evidence suggests that green roofs and solar panels can substantially reduce energy consumption and alleviate heat-island effects in metropolitan regions. However, the initial capital expenditure remains a major barrier for many developing countries, calling for international funding and financial support.',
    notes: 'Important article for environmental topics! Key word: mitigate, empirical, alleviate.',
    timestamp: new Date().toISOString()
  },
  {
    id: 'm2',
    name: 'IELTS Writing Task 2 Model Essay',
    type: 'document',
    category: 'writing',
    folderId: 'f2',
    content: 'In modern society, some argue that the rapid development of artificial intelligence will make human labor obsolete. Personally, I advocate a more balanced view. While AI will certainly automate repetitive tasks, it will also facilitate the creation of high-skilled jobs. Therefore, governments should focus on reskilling the workforce to adapt to this new economic paradigm rather than trying to restrict technological innovation. In conclusion, AI is an empowering tool rather than a threat.',
    notes: 'High-scoring phrase: "balanced view", "obsolete", "economic paradigm". Use these in my next essay!',
    timestamp: new Date().toISOString()
  },
  {
    id: 'm3',
    name: 'Speaking Part 3 - Technological Influence',
    type: 'link',
    category: 'speaking',
    folderId: 'f3',
    url: 'https://ielts.org/speaking-practice',
    content: 'Examiner: How has technology changed the way children learn in schools?\n\nCandidate: Well, in my view, technology has completely revolutionised modern classrooms. The integration of interactive tablets and educational software allows students to learn at their own pace, fostering independent thinking. Moreover, online resources provide unprecedented access to global databases, meaning children are no longer limited by their school library. However, we must ensure technology does not become a distraction, and screen time is kept within healthy limits.',
    notes: 'Good vocabulary used: revolutionised, fostering independent thinking, unprecedented access.',
    timestamp: new Date().toISOString()
  },
  {
    id: 'm4',
    name: 'Section 4 - Renewable Energy Lecture',
    type: 'audio',
    category: 'listening',
    folderId: 'f4',
    content: 'Welcome to today\'s university lecture on modern architecture. Today we will discuss the implications of renewable energy in urban design. Many cities are struggling to implement solar panels on historical buildings due to strict regulations. To foster wider adoption, engineering solutions must align with aesthetic standards. This ensures historical landmarks maintain their traditional charm while contributing to global sustainability goals.',
    notes: 'Dictation practice was hard! "implications", "implement", "regulations". Need to master spellings!',
    sentences: [
      "Welcome to today's university lecture on modern architecture.",
      "Today we will discuss the implications of renewable energy in urban design.",
      "Many cities are struggling to implement solar panels on historical buildings due to strict regulations.",
      "To foster wider adoption, engineering solutions must align with aesthetic standards.",
      "This ensures historical landmarks maintain their traditional charm while contributing to global sustainability goals."
    ],
    timestamp: new Date().toISOString()
  }
];

export default function MaterialsLibrary({ 
  vocabulary, 
  onAddCustomWord,
  initialMaterialId,
  onClearInitialMaterialId,
  initialWord,
  onClearInitialWord
}: MaterialsLibraryProps) {
  const [activeCategory, setActiveCategory] = useState<WordCategory>('reading');
  
  // Data State loaded from LocalStorage
  const [folders, setFolders] = useState<MaterialFolder[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  
  // Navigation / Selection State
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  
  // Modal / Inputs State
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  
  const [isNewMaterialOpen, setIsNewMaterialOpen] = useState(false);
  const [newMatName, setNewMatName] = useState('');
  const [newMatType, setNewMatType] = useState<MaterialType>('document');
  const [newMatUrl, setNewMatUrl] = useState('');
  const [newMatContent, setNewMatContent] = useState('');
  
  // Study Panel States
  const [notes, setNotes] = useState('');
  const [aiSummary, setAiSummary] = useState<any | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  
  // Quick Add Word State
  const [quickWord, setQuickWord] = useState('');
  const [quickPhonetic, setQuickPhonetic] = useState('');
  const [quickPos, setQuickPos] = useState('v.');
  const [quickChinese, setQuickChinese] = useState('');
  const [quickDef, setQuickDef] = useState('');
  const [quickExample, setQuickExample] = useState('');
  const [quickTranslation, setQuickTranslation] = useState('');
  const [quickUserNotes, setQuickUserNotes] = useState('');
  const [quickWordAdded, setQuickWordAdded] = useState(false);
  const [manualSearchWord, setManualSearchWord] = useState('');
  
  // Dictation Mode States
  const [isDictationMode, setIsDictationMode] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [userDictationInput, setUserDictationInput] = useState('');
  const [dictationResult, setDictationResult] = useState<{
    score: number;
    checked: boolean;
    diff: { word: string; status: 'correct' | 'incorrect' | 'missing' }[];
  } | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  // Intensive Study & Annotation States
  const [annotationsMap, setAnnotationsMap] = useState<{ [materialId: string]: TextAnnotation[] }>({});
  const [selectionState, setSelectionState] = useState<{ text: string; startChar: number; endChar: number; contextSentence?: string; } | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<TextAnnotation | null>(null);
  const [annotationCommentText, setAnnotationCommentText] = useState('');
  
  // AI Translation & Context State
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<any | null>(null);
  const [lineTranslationsMap, setLineTranslationsMap] = useState<{ [materialId: string]: { original: string; translation: string; }[] }>({});
  const [showLineByLine, setShowLineByLine] = useState(false);
  const [readingMode, setReadingMode] = useState<'continuous' | 'paragraph' | 'sentence'>('continuous');
  const [isTranslatingByLine, setIsTranslatingByLine] = useState(false);
  const [speakingReadingMode, setSpeakingReadingMode] = useState<'bilingual' | 'continuous'>('bilingual');

  // Audio specific UI and persistent player States
  const [activeAudioUrl, setActiveAudioUrl] = useState<string>('');
  const [showAudioTranscript, setShowAudioTranscript] = useState<boolean>(true);

  // Document Text-to-Speech (TTS) Reader States
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [isTtsPaused, setIsTtsPaused] = useState(false);
  const [currentTtsSentenceIndex, setCurrentTtsSentenceIndex] = useState<number | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedTtsVoice, setSelectedTtsVoice] = useState<string>('');

  // Video and Subtitle Study Player States
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const [isCrawlingVideo, setIsCrawlingVideo] = useState<boolean>(false);
  const [crawlNotice, setCrawlNotice] = useState<string>('');
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null);
  const [isAutoSyncSubtitles, setIsAutoSyncSubtitles] = useState<boolean>(true);
  const [youtubeSyncStatus, setYoutubeSyncStatus] = useState<'connecting' | 'ready' | 'unavailable'>('connecting');
  
  const videoCurrentTimeRef = useRef<number>(0);
  const activeSubtitleIdRef = useRef<string | null>(null);
  const isAutoSyncSubtitlesRef = useRef<boolean>(true);

  useEffect(() => {
    videoCurrentTimeRef.current = videoCurrentTime;
  }, [videoCurrentTime]);

  useEffect(() => {
    activeSubtitleIdRef.current = activeSubtitleId;
  }, [activeSubtitleId]);

  useEffect(() => {
    isAutoSyncSubtitlesRef.current = isAutoSyncSubtitles;
  }, [isAutoSyncSubtitles]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const [tempAudioBase64, setTempAudioBase64] = useState<string>('');
  const [tempAudioMimeType, setTempAudioMimeType] = useState<string>('');

  const skipAudio = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + seconds));
    }
  };

  const subtitlesContainerRef = useRef<HTMLDivElement | null>(null);
  const [localDictationId, setLocalDictationId] = useState<string | null>(null);
  const [localDictationInput, setLocalDictationInput] = useState<string>('');
  const [localDictationScore, setLocalDictationScore] = useState<number | null>(null);
  const [localDictationChecked, setLocalDictationChecked] = useState<boolean>(false);

  // Subtitle Editor state variables
  const [isSubtitleEditorOpen, setIsSubtitleEditorOpen] = useState(false);
  const [editorSubtitles, setEditorSubtitles] = useState<any[]>([]);
  const [rawSubtitlePaste, setRawSubtitlePaste] = useState('');
  const [isAligningWithAI, setIsAligningWithAI] = useState(false);
  const [alignmentProgress, setAlignmentProgress] = useState('');
  const alignTranscript = () => alignSubtitleBatches(normalizeTranscriptForImport(rawSubtitlePaste), maxSubtitleTime || 120, (done, total) => setAlignmentProgress(`AI 分段：${done}/${total} 批`));
  const [globalTimeShift, setGlobalTimeShift] = useState(0);
  const [editorTab, setEditorTab] = useState<'paste' | 'shift' | 'excel'>('excel');
  const [isTranscribingMedia, setIsTranscribingMedia] = useState(false);
  const [transcribingMediaMessage, setTranscribingMediaMessage] = useState('正在上传音视频…');
  const [ccVideoUrl, setCcVideoUrl] = useState('');
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceAudioFileInputRef = useRef<HTMLInputElement | null>(null);

  // Material rename modal state
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renamingMaterialId, setRenamingMaterialId] = useState<string | null>(null);
  const [renamingMaterialName, setRenamingMaterialName] = useState('');

  // Embed Player Simulation States & Helpers
  const [iframeSrc, setIframeSrc] = useState<string>('');
  const [isSimulatedPlaying, setIsSimulatedPlaying] = useState<boolean>(false);
  const simTimerRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);

  const isEmbedUrl = (url?: string): boolean => {
    if (!url) return false;
    const lowercase = url.toLowerCase();
    return lowercase.includes('embed') || 
           lowercase.includes('player.bilibili') || 
           lowercase.includes('youtube.com/embed') || 
           lowercase.includes('player.html') ||
           (!lowercase.endsWith('.mp4') && !lowercase.endsWith('.webm') && !lowercase.endsWith('.ogg') && (lowercase.includes('youtube') || lowercase.includes('bilibili') || lowercase.includes('ted.com')));
  };

  const getIframeUrl = (baseUrl: string, seekTime: number, autoplay: boolean = true) => {
    if (!baseUrl) return '';
    const lowercase = baseUrl.toLowerCase();
    
    // YouTube
    if (lowercase.includes('youtube.com/embed/') || lowercase.includes('youtube.com') || lowercase.includes('youtu.be')) {
      let videoId = '';
      if (lowercase.includes('youtu.be/')) {
        videoId = baseUrl.split('youtu.be/')[1]?.split(/[?#]/)[0] || '';
      } else if (lowercase.includes('v=')) {
        videoId = baseUrl.split('v=')[1]?.split('&')[0] || '';
      } else if (lowercase.includes('embed/')) {
        videoId = baseUrl.split('embed/')[1]?.split(/[?#]/)[0] || '';
      }
      if (videoId) {
        const params = new URLSearchParams({
          start: String(Math.floor(seekTime)),
          autoplay: autoplay ? '1' : '0',
          enablejsapi: '1',
          origin: window.location.origin,
          cc_load_policy: '0',
          controls: '1',
          modestbranding: '1',
          rel: '0',
        });
        return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
      }
    }
    
    // Bilibili
    if (lowercase.includes('player.bilibili.com') || lowercase.includes('bilibili.com')) {
      let bvid = '';
      const bvMatch = baseUrl.match(/(BV[a-zA-Z0-9]{10})/i);
      if (bvMatch) {
        bvid = bvMatch[1];
      }
      if (bvid) {
        return `https://player.bilibili.com/player.html?bvid=${bvid}&t=${Math.floor(seekTime)}&autoplay=${autoplay ? 1 : 0}&high_quality=1&danmaku=0`;
      }
    }
    
    return baseUrl;
  };

  const activeFolder = useMemo(() => {
    return folders.find(f => f.id === selectedFolderId);
  }, [folders, selectedFolderId]);

  const activeMaterial = useMemo(() => {
    return materials.find(m => m.id === selectedMaterialId);
  }, [materials, selectedMaterialId]);

  // Max subtitle end time helper
  const maxSubtitleTime = useMemo(() => {
    if (!activeMaterial || !activeMaterial.videoSubtitles || activeMaterial.videoSubtitles.length === 0) return 60;
    return Math.max(...activeMaterial.videoSubtitles.map((s: any) => s.end));
  }, [activeMaterial]);

  // Synchronize iframeSrc and reset simulated state when switching materials or material URL changes
  useEffect(() => {
    if (activeMaterial) {
      // Always convert to a valid working embed URL first, so it doesn't fail with "connection refused"!
      const initialEmbedSrc = isEmbedUrl(activeMaterial.url) 
        ? getIframeUrl(activeMaterial.url || '', 0)
        : (activeMaterial.url || '');
      setIframeSrc(initialEmbedSrc);
      setIsSimulatedPlaying(false);
      setVideoCurrentTime(0);
      setActiveSubtitleId(null);
    } else {
      setIframeSrc('');
      setIsSimulatedPlaying(false);
      setVideoCurrentTime(0);
      setActiveSubtitleId(null);
    }
    ytPlayerRef.current = null;
  }, [selectedMaterialId, activeMaterial?.url]);

  // Handle YouTube Iframe Player API & 100% Perfect Syncing
  useEffect(() => {
    if (!activeMaterial || !isEmbedUrl(activeMaterial.url)) return;
    const isYouTube = activeMaterial.url.includes('youtube') || activeMaterial.url.includes('youtu.be');
    if (!isYouTube) return;
    setYoutubeSyncStatus('connecting');

    // Load YouTube API script globally if not already loaded
    if (!window.hasOwnProperty('YT')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    let intervalId: any = null;
    let retries = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const initYtPlayer = () => {
      if (disposed) return;
      const iframeEl = document.getElementById('youtube-iframe');
      if (window.hasOwnProperty('YT') && (window as any).YT && (window as any).YT.Player && iframeEl) {
        try {
          ytPlayerRef.current = new (window as any).YT.Player('youtube-iframe', {
            events: {
              onReady: () => {
                if (disposed) return;
                setYoutubeSyncStatus('ready');
              },
              onError: () => {
                if (!disposed) setYoutubeSyncStatus('unavailable');
              },
              onStateChange: (event: any) => {
                // YT.PlayerState.PLAYING is 1, PAUSED is 2, ENDED is 0
                if (event.data === 1) {
                  setIsSimulatedPlaying(true);
                } else if (event.data === 2 || event.data === 0) {
                  setIsSimulatedPlaying(false);
                }
              }
            }
          });

          // Continuously track actual playback time to auto-scroll the subtitles
          intervalId = setInterval(() => {
            if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
              try {
                const currTime = ytPlayerRef.current.getCurrentTime();
                if (Number.isFinite(currTime)) setVideoCurrentTime(currTime);
              } catch (e) {
                // Player may not be ready yet; onReady reports the connection state.
              }
            }
          }, 250);
        } catch (err) {
          console.warn("YouTube player init failed:", err);
          if (!disposed) setYoutubeSyncStatus('unavailable');
        }
      } else {
        if (retries < 100) {
          retries++;
          retryTimeout = setTimeout(initYtPlayer, 300);
        } else {
          setYoutubeSyncStatus('unavailable');
        }
      }
    };

    const delayTimeout = setTimeout(initYtPlayer, 800);

    return () => {
      disposed = true;
      clearTimeout(retryTimeout);
      clearTimeout(delayTimeout);
      if (intervalId) clearInterval(intervalId);
      ytPlayerRef.current = null;
    };
  }, [selectedMaterialId, activeMaterial?.url, !!activeMaterial?.videoSubtitles?.length]);

  useEffect(() => {
    if (!isAutoSyncSubtitles) return;
    const id = subtitleAtTime(activeMaterial?.videoSubtitles || [], videoCurrentTime);
    setActiveSubtitleId(id);
    if (!id || id === activeSubtitleIdRef.current) return;
    const element = document.getElementById(`sub-${id}`);
    const container = subtitlesContainerRef.current;
    if (element && container) {
      const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      // Follow the media clock directly; animated scrolling lags behind at faster playback speeds.
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 2 + element.offsetHeight / 2), behavior: 'auto' });
    }
  }, [videoCurrentTime, activeMaterial?.videoSubtitles, isAutoSyncSubtitles]);

  // Handle fallback simulated progress timer for non-YouTube iframe embed videos (e.g. Bilibili)
  useEffect(() => {
    if (!activeMaterial || !isEmbedUrl(activeMaterial.url)) return;
    const isYouTube = activeMaterial.url.includes('youtube') || activeMaterial.url.includes('youtu.be');
    if (isYouTube) return; // Managed by YouTube native Player API instead!

    if (isSimulatedPlaying) {
      simTimerRef.current = setInterval(() => {
        setVideoCurrentTime(prev => {
          const next = Math.min(maxSubtitleTime, prev + 0.1);
          
          // Match subtitle block based on simulated time
          if (isAutoSyncSubtitlesRef.current && activeMaterial.videoSubtitles) {
            const activeSub = activeMaterial.videoSubtitles.find(
              (sub: any) => next >= sub.start && next <= sub.end
            );
            if (activeSub && activeSub.id !== activeSubtitleIdRef.current) {
              setActiveSubtitleId(activeSub.id);
              
              // Auto-scroll subtitle
              const subElement = document.getElementById(`sub-${activeSub.id}`);
              if (subElement && subtitlesContainerRef.current) {
                const container = subtitlesContainerRef.current;
                const subTop = subElement.offsetTop;
                const subHeight = subElement.offsetHeight;
                const containerHeight = container.offsetHeight;
                container.scrollTo({
                  top: subTop - (containerHeight / 2) + (subHeight / 2),
                  behavior: 'smooth'
                });
              }
            }
          }
          return next;
        });
      }, 100);
    } else {
      if (simTimerRef.current) {
        clearInterval(simTimerRef.current);
        simTimerRef.current = null;
      }
    }
    return () => {
      if (simTimerRef.current) {
        clearInterval(simTimerRef.current);
      }
    };
  }, [isSimulatedPlaying, activeMaterial, maxSubtitleTime]);

  // Nudge adjustment / slider seek change handlers
  const handleSeekSliderChange = (newVal: number) => {
    setVideoCurrentTime(newVal);
    
    // Auto-match active subtitle block instantly
    if (activeMaterial && activeMaterial.videoSubtitles) {
      const activeSub = activeMaterial.videoSubtitles.find(
        (sub: any) => newVal >= sub.start && newVal <= sub.end
      );
      if (activeSub) {
        setActiveSubtitleId(activeSub.id);
        const subElement = document.getElementById(`sub-${activeSub.id}`);
        if (subElement && subtitlesContainerRef.current) {
          const container = subtitlesContainerRef.current;
          const subTop = subElement.offsetTop;
          const subHeight = subElement.offsetHeight;
          const containerHeight = container.offsetHeight;
          container.scrollTo({
            top: subTop - (containerHeight / 2) + (subHeight / 2),
            behavior: 'smooth'
          });
        }
      } else {
        setActiveSubtitleId(null);
      }
    }

    if (activeMaterial && isEmbedUrl(activeMaterial.url)) {
      const isYouTube = activeMaterial.url.includes('youtube') || activeMaterial.url.includes('youtu.be');
      if (isYouTube && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        ytPlayerRef.current.seekTo(newVal, true);
      }
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = newVal;
      }
    }
  };

  const nudgeTime = (amount: number) => {
    const nextVal = Math.max(0, Math.min(maxSubtitleTime, videoCurrentTime + amount));
    handleSeekSliderChange(nextVal);
  };

  // 1. Load Materials & Folders
  useEffect(() => {
    // Load stored annotations
    const storedAnns = localStorage.getItem('ielts_material_annotations');
    if (storedAnns) {
      try { setAnnotationsMap(JSON.parse(storedAnns)); } catch (e) { console.error(e); }
    }

    // Load stored line-by-line translations
    const storedLineTrans = localStorage.getItem('ielts_material_line_translations');
    if (storedLineTrans) {
      try { setLineTranslationsMap(JSON.parse(storedLineTrans)); } catch (e) { console.error(e); }
    }

    // Populate voices for TTS
    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const engAndZhVoices = voices.filter(v => v.lang.startsWith('en') || v.lang.startsWith('zh'));
      setAvailableVoices(engAndZhVoices);
      const defaultVoice = engAndZhVoices.find(v => v.lang === 'en-GB' || v.name.includes('GB') || v.name.includes('Google US English')) || engAndZhVoices[0];
      if (defaultVoice) {
        setSelectedTtsVoice(defaultVoice.name);
      }
    };
    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    const storedFolders = localStorage.getItem('ielts_material_folders');
    const storedMaterials = localStorage.getItem('ielts_material_files');
    
    if (storedFolders) {
      try { setFolders(JSON.parse(storedFolders)); } catch (e) { console.error(e); }
    } else {
      setFolders(PRESET_FOLDERS);
      localStorage.setItem('ielts_material_folders', JSON.stringify(PRESET_FOLDERS));
    }
    
    if (storedMaterials) {
      try { setMaterials(JSON.parse(storedMaterials)); } catch (e) { console.error(e); }
    } else {
      setMaterials(PRESET_MATERIALS);
      localStorage.setItem('ielts_material_files', JSON.stringify(PRESET_MATERIALS));
    }
  }, []);

  // Handle source word traceback navigation/selection
  useEffect(() => {
    if (initialMaterialId && materials.length > 0) {
      const targetMat = materials.find(m => m.id === initialMaterialId);
      if (targetMat) {
        setSelectedMaterialId(initialMaterialId);
        if (targetMat.folderId) {
          setSelectedFolderId(targetMat.folderId);
        }
        if (targetMat.category) {
          setActiveCategory(targetMat.category);
        }
        if (onClearInitialMaterialId) {
          onClearInitialMaterialId();
        }
      }
    }
  }, [initialMaterialId, materials, onClearInitialMaterialId]);

  // Reset line-by-line and reading mode view state on switching materials
  useEffect(() => {
    setShowLineByLine(false);
    setReadingMode('continuous');
    setSpeakingReadingMode('bilingual');
  }, [selectedMaterialId]);

  // Precompute precise character start/end positions for each sentence in the full document content
  const linePositions = useMemo(() => {
    if (!activeMaterial || !activeMaterial.content) return [];
    const lines = lineTranslationsMap[activeMaterial.id];
    if (!lines || lines.length === 0) return [];
    
    const positions: { start: number; end: number }[] = [];
    let searchStart = 0;
    const content = activeMaterial.content;
    
    for (const line of lines) {
      const original = line.original;
      if (!original) {
        positions.push({ start: -1, end: -1 });
        continue;
      }
      const idx = content.indexOf(original, searchStart);
      if (idx !== -1) {
        positions.push({ start: idx, end: idx + original.length });
        searchStart = idx + original.length;
      } else {
        const fallbackIdx = content.indexOf(original);
        if (fallbackIdx !== -1) {
          positions.push({ start: fallbackIdx, end: fallbackIdx + original.length });
          searchStart = fallbackIdx + original.length;
        } else {
          positions.push({ start: -1, end: -1 });
        }
      }
    }
    return positions;
  }, [activeMaterial, lineTranslationsMap]);

  // Extract and map annotations that fall within the boundaries of a specific sentence
  const getLineAnnotations = (lineOriginal: string, lineIdx: number, positionsList: { start: number; end: number }[]) => {
    if (!activeMaterial) return [];
    const pos = positionsList[lineIdx];
    if (!pos || pos.start === -1) return [];
    
    const currentAnns = activeAnnotations;
    const localAnns: TextAnnotation[] = [];
    
    for (const ann of currentAnns) {
      // Overlap or containment check inside this sentence
      if (ann.startChar >= pos.start && ann.endChar <= pos.end) {
        localAnns.push({
          ...ann,
          startChar: ann.startChar - pos.start,
          endChar: ann.endChar - pos.start
        });
      }
    }
    return localAnns;
  };

  // ----------------- TRACED WORD HIGHLIGHT & SCROLL -----------------
  
  // Dynamically inject a highlight for the traced word coming from the word list
  const tracedWordAnnotations = useMemo(() => {
    if (!initialWord || !activeMaterial || !activeMaterial.content) return [];
    
    const content = activeMaterial.content;
    const word = initialWord.trim();
    if (!word) return [];
    
    // Find all occurrences of the word case-insensitively
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedWord}\\b`, 'gi');
    const anns: TextAnnotation[] = [];
    
    let match;
    let count = 0;
    while ((match = regex.exec(content)) !== null) {
      anns.push({
        id: `trace-temp-${count++}`,
        text: word,
        type: 'highlight',
        color: 'yellow',
        startChar: match.index,
        endChar: match.index + word.length,
        comment: `🔍 词书追溯定位: "${word}"`,
        timestamp: new Date().toISOString()
      });
    }
    
    return anns;
  }, [initialWord, activeMaterial]);

  // Combine saved annotations and temporary trace annotations
  const activeAnnotations = useMemo(() => {
    if (!activeMaterial) return [];
    const saved = annotationsMap[activeMaterial.id] || [];
    return [...saved, ...tracedWordAnnotations];
  }, [activeMaterial, annotationsMap, tracedWordAnnotations]);

  // Scroll to traced word element and trigger onClearInitialWord
  useEffect(() => {
    if (initialWord && activeMaterial) {
      // Force reading view to continuous paragraph original text mode (整段显示不翻译)
      setReadingMode('continuous');
      setShowLineByLine(false);
      setSpeakingReadingMode('continuous');

      const timer = setTimeout(() => {
        const element = document.getElementById('traced-word-element');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('ring-4', 'ring-amber-500/50', 'ring-offset-2', 'scale-105', 'transition-all', 'duration-500');
          setTimeout(() => {
            element.classList.remove('ring-4', 'ring-amber-500/50', 'ring-offset-2', 'scale-105');
          }, 3000);
        }
        if (onClearInitialWord) {
          onClearInitialWord();
        }
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [initialWord, activeMaterial, onClearInitialWord]);

  // ----------------- PARAGRAPH BLOCKS HANDLING -----------------

  // Split content into paragraph blocks while preserving character positions
  const paragraphBlocks = useMemo(() => {
    if (!activeMaterial || !activeMaterial.content) return [];
    
    const content = activeMaterial.content;
    const blocks: { text: string; start: number; end: number }[] = [];
    
    // Try splitting by double newlines first, then single newlines
    let rawParas = content.split(/\n\s*\n/);
    if (rawParas.length <= 1) {
      rawParas = content.split(/\n+/);
    }
    
    let currentOffset = 0;
    for (const para of rawParas) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      
      const idx = content.indexOf(trimmed, currentOffset);
      if (idx !== -1) {
        blocks.push({
          text: trimmed,
          start: idx,
          end: idx + trimmed.length
        });
        currentOffset = idx + trimmed.length;
      } else {
        const fallbackIdx = content.indexOf(trimmed);
        if (fallbackIdx !== -1) {
          blocks.push({
            text: trimmed,
            start: fallbackIdx,
            end: fallbackIdx + trimmed.length
          });
          currentOffset = fallbackIdx + trimmed.length;
        }
      }
    }
    
    return blocks;
  }, [activeMaterial]);

  // Filter and map annotations specifically for a single paragraph block
  const getParagraphAnnotations = (blockStart: number, blockEnd: number) => {
    if (!activeMaterial) return [];
    const currentAnns = activeAnnotations;
    const adjustedAnns: TextAnnotation[] = [];
    
    for (const ann of currentAnns) {
      if (ann.startChar >= blockStart && ann.endChar <= blockEnd) {
        adjustedAnns.push({
          ...ann,
          startChar: ann.startChar - blockStart,
          endChar: ann.endChar - blockStart
        });
      }
    }
    return adjustedAnns;
  };

  // Reconstruct paragraph translation on-the-fly from sentence translations
  const getParagraphTranslation = (blockText: string) => {
    if (!activeMaterial) return '';
    const lines = lineTranslationsMap[activeMaterial.id];
    if (!lines || lines.length === 0) return '';
    
    const matchedLines = lines.filter(line => {
      const trimmedOriginal = line.original?.trim();
      return trimmedOriginal && blockText.includes(trimmedOriginal);
    });
    
    if (matchedLines.length === 0) return '';
    return matchedLines.map(line => line.translation).join(' ');
  };

  // Handle precise character text selections inside a specific paragraph block
  const handleParagraphTextSelection = (blockStartOffset: number, paragraphEl: HTMLParagraphElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !contentRef.current) return;
    
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 1 || selectedText.length > 300) {
      return;
    }

    const { start, end } = getSelectionCharacterOffsetWithin(paragraphEl);
    if (start === end) return;

    setSelectionState({
      text: selectedText,
      startChar: blockStartOffset + start,
      endChar: blockStartOffset + end,
      contextSentence: paragraphEl.textContent || selectedText
    });
  };

  // Track manual text selections for vocabulary lookup and floating tools
  const contentRef = useRef<HTMLDivElement>(null);
  const handleTextSelection = () => {
    if (showLineByLine) return; // Ignore full-text selections when in line-by-line bilingual mode!
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !contentRef.current) return;
    
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 1 || selectedText.length > 300) {
      return;
    }

    const { start, end } = getSelectionCharacterOffsetWithin(contentRef.current);
    if (start === end) return;

    setSelectionState({
      text: selectedText,
      startChar: start,
      endChar: end
    });

    setQuickWord(selectedText);
    setQuickWordAdded(false);
    setSelectedAnnotation(null);
  };

  // Track text selections within individual sentences in the line-by-line translation view
  const handleLineTextSelection = (lineIdx: number, lineStartCharInContent: number, element: HTMLParagraphElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 1 || selectedText.length > 300) {
      return;
    }

    let startInLine = 0;
    let endInLine = 0;
    try {
      // Compute start and end offsets relative to the text content of the sentence element itself
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      startInLine = preCaretRange.toString().length;
      endInLine = startInLine + range.toString().length;
    } catch (e) {
      // Robust fallback: index search inside the line textContent
      const textContent = element.textContent || '';
      const fallbackIndex = textContent.indexOf(selectedText);
      if (fallbackIndex !== -1) {
        startInLine = fallbackIndex;
        endInLine = fallbackIndex + selectedText.length;
      }
    }

    const startInContent = lineStartCharInContent + startInLine;
    const endInContent = lineStartCharInContent + endInLine;

    setSelectionState({
      text: selectedText,
      startChar: startInContent,
      endChar: endInContent
    });

    setQuickWord(selectedText);
    setQuickWordAdded(false);
    setSelectedAnnotation(null);
  };

  const getSelectionCharacterOffsetWithin = (element: HTMLElement) => {
    let start = 0;
    let end = 0;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      try {
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.startContainer, range.startOffset);
        start = preCaretRange.toString().length;
        end = start + range.toString().length;
      } catch (e) {
        // Robust fallback: index search inside the element textContent
        const textContent = element.textContent || '';
        const selectedText = sel.toString().trim();
        const fallbackIndex = textContent.indexOf(selectedText);
        if (fallbackIndex !== -1) {
          start = fallbackIndex;
          end = fallbackIndex + selectedText.length;
        }
      }
    }
    return { start, end };
  };

  // Handle click on existing annotation to inspect/edit notes
  const handleAnnotationClick = (ann: TextAnnotation) => {
    setSelectedAnnotation(ann);
    setAnnotationCommentText(ann.comment || '');
    setSelectionState(null); // Clear active selection panel
    
    // Auto populate Quick Add Word form with this text
    setQuickWord(ann.text);
    setQuickWordAdded(false);
  };

  // Add highlight or underline annotation
  const handleAddAnnotation = (type: 'highlight' | 'underline', color?: string) => {
    if (!activeMaterial || !selectionState) return;

    const newAnn: TextAnnotation = {
      id: `ann-${Date.now()}`,
      text: selectionState.text,
      startChar: selectionState.startChar,
      endChar: selectionState.endChar,
      type,
      color,
      timestamp: new Date().toISOString()
    };

    const currentAnns = annotationsMap[activeMaterial.id] || [];
    const updatedAnns = [...currentAnns, newAnn].sort((a, b) => a.startChar - b.startChar);
    
    const updatedMap = {
      ...annotationsMap,
      [activeMaterial.id]: updatedAnns
    };

    setAnnotationsMap(updatedMap);
    localStorage.setItem('ielts_material_annotations', JSON.stringify(updatedMap));

    setSelectedAnnotation(newAnn);
    setAnnotationCommentText('');
    setSelectionState(null);

    window.getSelection()?.removeAllRanges();
  };

  // Save annotation custom notes/comments
  const handleSaveAnnotationComment = () => {
    if (!activeMaterial || !selectedAnnotation) return;

    const currentAnns = annotationsMap[activeMaterial.id] || [];
    const updatedAnns = currentAnns.map(ann => {
      if (ann.id === selectedAnnotation.id) {
        return { ...ann, comment: annotationCommentText };
      }
      return ann;
    });

    const updatedMap = {
      ...annotationsMap,
      [activeMaterial.id]: updatedAnns
    };

    setAnnotationsMap(updatedMap);
    localStorage.setItem('ielts_material_annotations', JSON.stringify(updatedMap));
    setSelectedAnnotation(prev => prev ? { ...prev, comment: annotationCommentText } : null);
    alert('精读批注笔记保存成功！');
  };

  // Delete annotation
  const handleDeleteAnnotation = (annId: string) => {
    if (!activeMaterial) return;

    const currentAnns = annotationsMap[activeMaterial.id] || [];
    const updatedAnns = currentAnns.filter(ann => ann.id !== annId);

    const updatedMap = {
      ...annotationsMap,
      [activeMaterial.id]: updatedAnns
    };

    setAnnotationsMap(updatedMap);
    localStorage.setItem('ielts_material_annotations', JSON.stringify(updatedMap));
    setSelectedAnnotation(null);
  };

  // Context-aware translation
  const handleTranslateSelection = async () => {
    if (!activeMaterial || !selectionState) return;

    setIsTranslating(true);
    setTranslationResult(null);

    try {
      const res = await fetch('/api/gemini/translate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectionState.text,
          context: activeMaterial.content,
          category: activeCategory,
          name: activeMaterial.name
        })
      });

      if (!res.ok) {
        throw new Error('翻译服务请求失败');
      }

      const data = await res.json();
      setTranslationResult(data);

      setQuickWord(data.word || selectionState.text);
      setQuickPhonetic(data.phonetic || '');
      setQuickPos(data.partOfSpeech || 'v.');
      setQuickChinese(data.translation || '');
      setQuickDef(data.englishDefinition || '');
      setQuickExample(data.example || '');
      setQuickTranslation(data.exampleTranslation || '');
    } catch (err: any) {
      console.error(err);
      alert('AI 语境翻译失败，请检查 API Key 设置: ' + err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  // Manual word lookup translation
  const handleTranslateManualWord = async (wordToSearch: string) => {
    const trimmedWord = wordToSearch.trim();
    if (!trimmedWord) return;

    setIsTranslating(true);
    setTranslationResult(null);

    // Create a simulated selectionState for manual query so the floating translation result card shows it
    setSelectionState({
      text: trimmedWord,
      startChar: 0,
      endChar: trimmedWord.length,
      contextSentence: activeMaterial?.content?.slice(0, 300) || 'Manual dictionary query'
    });

    try {
      const res = await fetch('/api/gemini/translate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmedWord,
          context: activeMaterial?.content || 'General academic English word query',
          category: activeCategory,
          name: activeMaterial?.name || 'Manual Search'
        })
      });

      if (!res.ok) {
        throw new Error('翻译服务请求失败');
      }

      const data = await res.json();
      setTranslationResult(data);

      setQuickWord(data.word || trimmedWord);
      setQuickPhonetic(data.phonetic || '');
      setQuickPos(data.partOfSpeech || 'v.');
      setQuickChinese(data.translation || '');
      setQuickDef(data.englishDefinition || '');
      setQuickExample(data.example || '');
      setQuickTranslation(data.exampleTranslation || '');
    } catch (err: any) {
      console.error(err);
      alert('AI 语境翻译失败，请检查 API Key 设置: ' + err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslateByLine = async () => {
    if (!activeMaterial || !activeMaterial.content) return;
    
    if (lineTranslationsMap[activeMaterial.id]) {
      setShowLineByLine(!showLineByLine);
      return;
    }

    setIsTranslatingByLine(true);
    try {
      const res = await fetch('/api/gemini/translate-by-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: activeMaterial.content })
      });

      if (!res.ok) {
        throw new Error('逐行翻译请求失败');
      }

      const data = await res.json();
      if (data && data.lines) {
        const updatedMap = {
          ...lineTranslationsMap,
          [activeMaterial.id]: data.lines
        };
        setLineTranslationsMap(updatedMap);
        localStorage.setItem('ielts_material_line_translations', JSON.stringify(updatedMap));
        setShowLineByLine(true);
      } else {
        throw new Error('未返回正确的对照翻译结果');
      }
    } catch (err: any) {
      console.error(err);
      alert('AI 逐行翻译失败，请重试: ' + err.message);
    } finally {
      setIsTranslatingByLine(false);
    }
  };

  // Playback TTS
  const parsedSentences = useMemo(() => {
    if (!activeMaterial || !activeMaterial.content) return [];
    return activeMaterial.content
      .split(/(?<=[.!?。！？\n])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }, [activeMaterial]);

  const playTtsFromIndex = (index: number) => {
    window.speechSynthesis.cancel();
    if (index < 0 || index >= parsedSentences.length) {
      setIsTtsPlaying(false);
      setIsTtsPaused(false);
      setCurrentTtsSentenceIndex(null);
      return;
    }

    setCurrentTtsSentenceIndex(index);
    setIsTtsPlaying(true);
    setIsTtsPaused(false);

    const utterance = new SpeechSynthesisUtterance(parsedSentences[index]);
    if (selectedTtsVoice) {
      const voice = availableVoices.find(v => v.name === selectedTtsVoice);
      if (voice) utterance.voice = voice;
    }
    utterance.rate = playbackSpeed;
    utterance.onend = () => {
      playTtsFromIndex(index + 1);
    };
    utterance.onerror = () => {
      setIsTtsPlaying(false);
      setIsTtsPaused(false);
      setCurrentTtsSentenceIndex(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  const handlePauseTts = () => {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setIsTtsPaused(true);
    }
  };

  const handleResumeTts = () => {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsTtsPaused(false);
    } else if (currentTtsSentenceIndex !== null) {
      playTtsFromIndex(currentTtsSentenceIndex);
    } else {
      playTtsFromIndex(0);
    }
  };

  const handleStopTts = () => {
    window.speechSynthesis.cancel();
    setIsTtsPlaying(false);
    setIsTtsPaused(false);
    setCurrentTtsSentenceIndex(null);
  };

  // Render annotated text sections
  const renderAnnotatedText = (content: string, annotationsList: TextAnnotation[]) => {
    if (!content) return <span className="text-stone-400 italic">暂无内容</span>;
    if (!annotationsList || annotationsList.length === 0) {
      return <span>{content}</span>;
    }

    const sorted = [...annotationsList].sort((a, b) => a.startChar - b.startChar);
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    for (let i = 0; i < sorted.length; i++) {
      const ann = sorted[i];
      if (ann.startChar < lastIndex) continue;
      if (ann.startChar > content.length) break;

      if (ann.startChar > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}-${ann.startChar}`}>
            {content.substring(lastIndex, ann.startChar)}
          </span>
        );
      }

      const annotatedText = content.substring(ann.startChar, ann.endChar);
      let styleClass = '';
      if (ann.type === 'highlight') {
        switch (ann.color) {
          case 'green':
            styleClass = 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border-b-2 border-emerald-300';
            break;
          case 'blue':
            styleClass = 'bg-sky-100 hover:bg-sky-200 text-sky-900 border-b-2 border-sky-300';
            break;
          case 'pink':
            styleClass = 'bg-rose-100 hover:bg-rose-200 text-rose-900 border-b-2 border-rose-300';
            break;
          case 'yellow':
          default:
            styleClass = 'bg-amber-100 hover:bg-amber-200 text-amber-950 border-b-2 border-amber-300';
            break;
        }
      } else if (ann.type === 'underline') {
        styleClass = 'underline decoration-dashed decoration-red-500 hover:bg-stone-50 cursor-pointer';
      }

      const isTraced = ann.id && ann.id.toString().startsWith('trace-temp');
      elements.push(
        <span
          key={`ann-${ann.id}-${ann.startChar}`}
          id={isTraced ? "traced-word-element" : undefined}
          className={`px-0.5 rounded-xs transition-all duration-150 cursor-pointer relative font-medium ${styleClass} ${isTraced ? 'font-bold ring-2 ring-amber-400 ring-offset-1 bg-amber-200' : ''}`}
          onClick={(e) => { e.stopPropagation(); handleAnnotationClick(ann); }}
          title={ann.comment || '点击查看我的批注/生词'}
        >
          {annotatedText}
          {ann.comment && (
            <span className="inline-flex items-center justify-center ml-0.5 w-3.5 h-3.5 bg-stone-900 text-[8px] text-amber-400 rounded-full align-super">
              📝
            </span>
          )}
        </span>
      );

      lastIndex = ann.endChar;
    }

    if (lastIndex < content.length) {
      elements.push(
        <span key={`text-end-${lastIndex}`}>
          {content.substring(lastIndex)}
        </span>
      );
    }

    return elements;
  };

  // Sync notes state when material changes
  useEffect(() => {
    if (activeMaterial) {
      setNotes(activeMaterial.notes || '');
      setAiSummary(activeMaterial.summary ? JSON.parse(activeMaterial.summary) : null);
      
      // Reconstruct local Blob URL from IndexedDB if the material is an audio type
      if (activeMaterial.type === 'audio') {
        setShowAudioTranscript(true); // default to show
        getAudio(activeMaterial.id).then((audioRecord) => {
          if (audioRecord) {
            try {
              const byteCharacters = atob(audioRecord.base64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: audioRecord.mimeType });
              const localBlobUrl = URL.createObjectURL(blob);
              setActiveAudioUrl(localBlobUrl);
            } catch (err) {
              console.error('Failed to reconstruct local audio blob url from IndexedDB:', err);
              setActiveAudioUrl(activeMaterial.url || '');
            }
          } else {
            setActiveAudioUrl(activeMaterial.url || '');
          }
        }).catch((err) => {
          console.error('Error fetching audio from db:', err);
          setActiveAudioUrl(activeMaterial.url || '');
        });
      } else {
        setActiveAudioUrl('');
      }

      // Initialize sentence items for dictation if empty for audio
      if (activeMaterial.type === 'audio' && (!activeMaterial.sentences || activeMaterial.sentences.length === 0)) {
        // Automatically split text into sentences
        const content = activeMaterial.content || '';
        const rawSentences = content
          .split(/(?<=[.!?])\s+/)
          .filter(s => s.trim().length > 3);
        
        if (rawSentences.length > 0) {
          setMaterials(prev => {
            const updated = prev.map(m => m.id === activeMaterial.id ? { ...m, sentences: rawSentences } : m);
            localStorage.setItem('ielts_material_files', JSON.stringify(updated));
            return updated;
          });
        }
      }
      
      // Reset dictation progress
      setCurrentSentenceIndex(0);
      setUserDictationInput('');
      setDictationResult(null);
      setIsDictationMode(false);
    } else {
      setActiveAudioUrl('');
    }
  }, [selectedMaterialId]);

  // Auto-save notes
  const handleSaveNotes = (val: string) => {
    setNotes(val);
    if (selectedMaterialId) {
      setMaterials(prev => {
        const updated = prev.map(m => m.id === selectedMaterialId ? { ...m, notes: val } : m);
        localStorage.setItem('ielts_material_files', JSON.stringify(updated));
        return updated;
      });
    }
  };

  // Import link (video embed / webpage real content). 不再让 AI 编造字幕/文稿
  const handleCrawlVideo = async (material: StudyMaterial) => {
    const linkToImport = material.url || material.content || '';
    if (!linkToImport.trim()) {
      alert('请先为该材料填写网页/视频链接。');
      return;
    }

    setIsCrawlingVideo(true);
    setCrawlNotice('');
    try {
      const response = await fetch('/api/materials/crawl-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkToImport, category: activeCategory })
      });

      let result: any = null;
      try { result = await response.json(); } catch { /* ignore non-json */ }

      if (!response.ok || !result) {
        throw new Error(result?.error || result?.message || '导入链接失败，请稍后重试');
      }

      const hasRealSubtitles = Array.isArray(result.subtitles) && result.subtitles.length > 0;

      const updatedMaterials = materials.map((m) => {
        if (m.id !== material.id) return m;
        const base = {
          ...m,
          name: result.title && String(result.title).trim() ? String(result.title).trim() : m.name,
        };
        // 有可内嵌的真实视频地址 → 升级为视频材料并指向该地址（可能是解析后的 embed）
        const withVideo = result.videoUrl
          ? { ...base, url: String(result.videoUrl), type: 'video' as MaterialType }
          : base;

        if (hasRealSubtitles) {
          // 真实字幕（目前仅 YouTube 官方 CC 可自动拿到）
          return {
            ...withVideo,
            content: result.transcript || withVideo.content,
            sentences: result.subtitles.map((s: any) => s.text),
            videoSubtitles: result.subtitles,
          };
        }
        // 普通网页抓到的真实正文：更新正文，但保持原有类型与字幕不动（不生成假字幕）
        return result.videoUrl
          ? withVideo
          : { ...withVideo, content: result.transcript || withVideo.content };
      });

      setMaterials(updatedMaterials);
      localStorage.setItem('ielts_material_files', JSON.stringify(updatedMaterials));

      // 有真实内容摘要时同步 AI 面板
      if (result.summary || (Array.isArray(result.vocab) && result.vocab.length > 0)) {
        setAiSummary({
          summary: result.summary || '',
          keyVocabulary: Array.isArray(result.vocab) ? result.vocab : [],
          grammarPoints: [],
          collocations: []
        });
      }

      if (result.note) setCrawlNotice(String(result.note));
      setSelectionState(null);
    } catch (err: any) {
      console.error('Import link error:', err);
      alert((err && err.message) || '导入链接失败，请重试');
    } finally {
      setIsCrawlingVideo(false);
    }
  };

  // Synchronize editor state when subtitle editor is opened
  useEffect(() => {
    if (isSubtitleEditorOpen && activeMaterial) {
      setEditorSubtitles(activeMaterial.videoSubtitles ? JSON.parse(JSON.stringify(activeMaterial.videoSubtitles)) : []);
      setRawSubtitlePaste(activeMaterial.videoSubtitles ? activeMaterial.videoSubtitles.map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text} | ${s.translation}`).join('\n') : '');
      if (activeMaterial.url) {
        setCcVideoUrl(activeMaterial.url);
      }
    }
  }, [isSubtitleEditorOpen, activeMaterial]);

  const receiveTranscription = async (jobId: string, materialId: string, startOffset = 0, clientTiming = '') => {
      let result: any;
      for (let attempt = 0; attempt < 360; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const statusResponse = await fetch(`/api/asr/transcribe-media/${encodeURIComponent(jobId)}`, { signal: AbortSignal.timeout(30000) });
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status.error || '读取转写进度失败');
        if (status.message) setTranscribingMediaMessage(status.message);
        if (status.status === 'failed') throw new Error(status.error || '百炼语音识别失败');
        if (status.status === 'completed') {
          result = status.result;
          break;
        }
      }
      if (!result) throw new Error('语音识别等待超时，请缩短视频片段后重试。');
      if (!Array.isArray(result.subtitles) || result.subtitles.length === 0) {
        throw new Error('没有识别到可导入的语音片段。');
      }

      const importedSubtitles = result.subtitles.map((subtitle: any, index: number) => ({
        ...subtitle,
        id: subtitle.id || `asr-${Date.now()}-${index}`,
        start: (Number.isFinite(Number(subtitle.start)) ? Number(subtitle.start) : 0) + startOffset,
        end: (Number.isFinite(Number(subtitle.end)) ? Number(subtitle.end) : Number(subtitle.start || 0) + 2) + startOffset,
        text: String(subtitle.text || '').trim(),
        translation: String(subtitle.translation || ''),
      })).filter((subtitle: any) => subtitle.text);
      setMaterials(previous => {
        const updated = previous.map(material => material.id === materialId ? {
          ...material,
          content: result.transcript || importedSubtitles.map((subtitle: any) => subtitle.text).join(' '),
          videoSubtitles: importedSubtitles,
          transcriptionReport: clientTiming + (result.warning || ''),
          sentences: importedSubtitles.map((subtitle: any) => subtitle.text),
        } : material);
        localStorage.setItem('ielts_material_files', JSON.stringify(updated));
        return updated;
      });
      setSelectedMaterialId(materialId);
      const isAudioMaterial = materials.some(material => material.id === materialId && material.type === 'audio');
      if (isAudioMaterial) {
        const updatedMap = {
          ...lineTranslationsMap,
          [materialId]: importedSubtitles.map((subtitle: any) => ({ original: subtitle.text, translation: subtitle.translation || '' })),
        };
        setLineTranslationsMap(updatedMap);
        localStorage.setItem('ielts_material_line_translations', JSON.stringify(updatedMap));
        setShowLineByLine(true);
        setShowAudioTranscript(true);
      } else {
        setIsSubtitleEditorOpen(true);
        setEditorSubtitles(importedSubtitles);
        setRawSubtitlePaste(formatSubtitlesToRawText(importedSubtitles));
      }
      alert(`语音识别完成，已导入 ${importedSubtitles.length} 句字幕。${clientTiming}${result.warning || '可以在下方校对并保存修改。'}`);
  };

  const handleTranscribeMediaFile = async (file: File, materialId = activeMaterial?.id) => {
    if (!materialId) return;
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const mimeByExtension: Record<string, string> = {
      aac: 'audio/aac', flac: 'audio/flac', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4',
      mov: 'video/mov', avi: 'video/avi', mpeg: 'video/mpeg', mpg: 'video/mpg', webm: file.type.startsWith('audio/') ? 'audio/webm' : 'video/webm',
      wav: 'audio/wav', wma: 'audio/mp4', ogg: 'audio/ogg', '3gp': 'video/3gpp', flv: 'video/x-flv', wmv: 'video/wmv',
    };
    let mimeType = file.type.toLowerCase();
    if (mimeType === 'audio/x-m4a') mimeType = 'audio/mp4';
    if (mimeType === 'video/quicktime') mimeType = 'video/mov';
    if (mimeType === 'video/x-msvideo') mimeType = 'video/avi';
    if (mimeType === 'video/x-ms-wmv') mimeType = 'video/wmv';
    if (mimeType === 'audio/x-wav') mimeType = 'audio/wav';
    if (!mimeType || mimeType === 'application/octet-stream') mimeType = mimeByExtension[extension] || '';
    if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
      alert('请选择常见音频或视频文件，例如 MP3、M4A、WAV、MP4、MOV、AVI 或 WebM。');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      alert('文件不能超过 200 MB。建议剪出需要精听的片段，或先导出压缩后的音频。');
      return;
    }

    setIsTranscribingMedia(true);
    setTranscribingMediaMessage('正在上传音视频…');
    const uploadStarted = performance.now();
    try {
      const response = await fetch('/api/asr/transcribe-media', {
        signal: AbortSignal.timeout(5 * 60 * 1000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Media-Mime-Type': mimeType,
          'X-Media-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const uploadResult = await response.json();
      if (!response.ok) throw new Error(uploadResult.error || '音视频转写失败');
      if (!uploadResult.jobId) throw new Error('服务器没有返回转写任务编号。');
      await receiveTranscription(uploadResult.jobId, materialId, 0, `上传 ${((performance.now() - uploadStarted) / 1000).toFixed(1)} 秒。`);
    } catch (error: any) {
      console.error('Error transcribing media file:', error);
      alert(`音视频转写失败：${error?.name === 'TimeoutError' ? '上传或查询识别进度超时，本次等待已结束，请检查网络。' : error.message || '请重试或检查百炼 API Key 配置。'}`);
    } finally {
      setIsTranscribingMedia(false);
      setTranscribingMediaMessage('正在上传音视频…');
      if (mediaFileInputRef.current) mediaFileInputRef.current.value = '';
    }
  };

  // Save the modified subtitle array
  const handleSaveSubtitleEdits = () => {
    if (!activeMaterial) return;

    // Validate and sort subtitles by start time
    const sortedSubtitles = [...editorSubtitles]
      .filter(s => s.text && s.text.trim().length > 0)
      .map((s, index) => ({
        ...s,
        id: s.id || `s-${Date.now()}-${index}`,
        start: isNaN(parseFloat(s.start)) ? 0 : parseFloat(parseFloat(s.start).toFixed(2)),
        end: isNaN(parseFloat(s.end)) ? 5 : parseFloat(parseFloat(s.end).toFixed(2)),
      }))
      .sort((a, b) => a.start - b.start);

    const updatedMaterials = materials.map(m => {
      if (m.id === activeMaterial.id) {
        return {
          ...m,
          content: subtitlesToOriginalTranscript(sortedSubtitles),
          videoSubtitles: sortedSubtitles,
          sentences: sortedSubtitles.map(s => s.text) // sync sentences for dictation too
        };
      }
      return m;
    });

    setMaterials(updatedMaterials);
    localStorage.setItem('ielts_material_files', JSON.stringify(updatedMaterials));
    setIsSubtitleEditorOpen(false);
    
    alert('双语字幕编辑与对齐修改保存成功！');
  };

  // Synchronized formatting and parsing helpers
  const formatSubtitlesToRawText = (subs: any[]) => {
    return subs.map(s => `[${s.start.toFixed(3)}-${s.end.toFixed(3)}] ${s.text} | ${s.translation}`).join('\n');
  };

  const isMusicOnlyCue = (text: string) => !cleanMusicCue(text);

  const mergeShortSubtitleCues = (cues: any[]) => {
    const merged: any[] = [];
    for (const source of cues) {
      const text = cleanMusicCue(String(source.text || ''));
      if (!text || isMusicOnlyCue(String(source.text || ''))) continue;
      const cue = { ...source, text, translation: cleanMusicCue(String(source.translation || '')) };
      const previous = merged[merged.length - 1];
      if (!previous) {
        merged.push(cue);
        continue;
      }
      const gap = cue.start - previous.end;
      const previousWords = previous.text.split(/\s+/).length;
      const combinedDuration = cue.end - previous.start;
      const previousEndsSentence = /[.!?。！？]["')\]]?$/.test(previous.text);
      const hasReadableSentence = previousEndsSentence && previousWords >= 8;
      const shouldMerge = !hasReadableSentence && gap <= 0.9 && gap >= -0.15
        && previousWords < 24 && `${previous.text} ${cue.text}`.length <= 180 && combinedDuration <= 15;
      if (shouldMerge) {
        previous.text = `${previous.text} ${cue.text}`.replace(/\s+([,.;!?])/g, '$1');
        previous.translation = [previous.translation, cue.translation].filter(Boolean).join('');
        previous.end = Math.max(previous.end, cue.end);
      } else {
        merged.push(cue);
      }
    }
    return merged.map((cue, index) => ({ ...cue, id: cue.id || `merged-${Date.now()}-${index}` }));
  };

  const parseRawTextToSubtitles = (text: string) => {
    const normalizedText = normalizeTranscriptForImport(text);
    const lines = normalizedText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const parsed: any[] = [];
    const duration = maxSubtitleTime || 120;
    const slice = duration / lines.length;

    lines.forEach((line, index) => {
      // Check for timestamp prefix like [0.0-5.5] or [5.5]
      const timeMatch = line.match(/^\[([\d.]+)(?:-([\d.]+))?\]/);
      let start = index * slice;
      let end = (index + 1) * slice;
      let content = line;

      if (timeMatch) {
        start = parseFloat(timeMatch[1]);
        if (timeMatch[2]) {
          end = parseFloat(timeMatch[2]);
        } else {
          const nextTimedLine = lines.slice(index + 1).map(next => next.match(/^\[([\d.]+)(?:-([\d.]+))?\]/)).find(Boolean);
          const nextStart = nextTimedLine ? Number(nextTimedLine[1]) : NaN;
          end = Number.isFinite(nextStart) && nextStart > start ? nextStart : start + Math.max(1, Math.min(slice, 5));
        }
        content = line.replace(timeMatch[0], '').trim();
      }

      const parts = content.split('|');
      const textVal = parts[0]?.trim() || '';
      const translation = parts[1]?.trim() || '（点击编辑中文翻译）';

      parsed.push({
        id: `s-parsed-${index}-${Date.now()}`,
        start: parseFloat(start.toFixed(1)),
        end: parseFloat(end.toFixed(1)),
        text: textVal,
        translation
      });
    });
    return mergeShortSubtitleCues(parsed);
  };

  const handleTextareaChange = (value: string) => {
    setRawSubtitlePaste(value);
    const parsed = parseRawTextToSubtitles(value);
    setEditorSubtitles(parsed);
  };


  const pasteTranscriptFromClipboard = async () => {
    try {
      let clipboardText = '';
      if (navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('text/html')) {
              clipboardText = subtitleRowsFromHtml(await (await item.getType('text/html')).text());
              if (clipboardText) break;
            }
          }
        } catch {
          // Fall back to plain text when rich clipboard permission is unavailable.
        }
      }
      if (!clipboardText && navigator.clipboard?.readText) clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) throw new Error('剪贴板没有可识别的字幕表格。请直接粘贴文字稿，或导入插件导出的 HTML 文件。');
      const normalized = normalizeTranscriptForImport(clipboardText);
      setRawSubtitlePaste(normalized);
      setEditorSubtitles(parseRawTextToSubtitles(normalized));
    } catch (error: any) {
      alert(error?.message || '无法读取剪贴板。请允许浏览器访问剪贴板，或直接粘贴文字稿。');
    }
  };

  // Shift all timestamps globally forward/backward
  const handleApplyGlobalTimeShift = () => {
    if (globalTimeShift === 0) return;
    const shifted = editorSubtitles.map(sub => {
      const newStart = Math.max(0, parseFloat((sub.start + globalTimeShift).toFixed(2)));
      const newEnd = Math.max(0, parseFloat((sub.end + globalTimeShift).toFixed(2)));
      return {
        ...sub,
        start: newStart,
        end: newEnd
      };
    });
    setEditorSubtitles(shifted);
    setRawSubtitlePaste(formatSubtitlesToRawText(shifted));
    setGlobalTimeShift(0);
    alert(`批量时间校准成功！所有字幕时间轴已微调 ${globalTimeShift > 0 ? '+' : ''}${globalTimeShift} 秒。\n（注意：请点击下方“保存修改并关闭”按钮使修改正式生效）`);
  };

  // AI subtitle auto-alignment helper
  const handleAIAlignSubtitles = async () => {
    if (!rawSubtitlePaste.trim()) {
      alert('请先输入文稿或字幕文本内容。');
      return;
    }
    setAlignmentProgress('正在准备分批处理…');
    setIsAligningWithAI(true);
    try {
      const data = { subtitles: await alignTranscript() };

      if (data && data.subtitles) {
        const alignedSubtitles = cleanAlignedSubtitles(data.subtitles)
          .map((subtitle, index) => ({ ...subtitle, id: subtitle.id || `aligned-${index}` }))
          .sort((a, b) => a.start - b.start);
        setEditorSubtitles(alignedSubtitles);
        setRawSubtitlePaste(formatSubtitlesToRawText(alignedSubtitles));
        alert('AI 智能字幕对齐与学术分段成功！已将原文智能重构并切分为双语段落，已保留已有字幕时间范围；句内拆分时间为估算，请校对后点击“保存修改并关闭”。');
      } else {
        throw new Error('返回的字幕格式无效');
      }
    } catch (err: any) {
      console.error(err);
      alert('AI 字幕分段失败：' + (err?.name === 'TimeoutError' ? '本批处理超过 2 分钟，原字幕未修改，请稍后重试。' : err.message));
    } finally {
      setIsAligningWithAI(false);
    }
  };

  // Directly parse lines and evenly distribute over the timeline
  const handleDirectTextImport = () => {
    if (!rawSubtitlePaste.trim()) {
      alert('请先粘贴原始文稿文本。');
      return;
    }
    const parsed = parseRawTextToSubtitles(rawSubtitlePaste);
    if (parsed.length === 0) return;

    setEditorSubtitles(parsed);
    setRawSubtitlePaste(formatSubtitlesToRawText(parsed));
    alert(`成功直接解析并生成 ${parsed.length} 行双语段落！您可以在下方的预览表格中微调并保存。`);
  };

  const handleHtmlSubtitleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const html = await file.text();
      const document = new DOMParser().parseFromString(html, 'text/html');
      const rows = Array.from(document.querySelectorAll('tr'));
      const parsedRows: { time: number; text: string; translation: string }[] = [];
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('th,td')).map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim());
        if (cells.length < 2) continue;
        const headerText = cells.join(' ').toLowerCase();
        if (/\btime\b/.test(headerText) && /subtitle|字幕/.test(headerText)) continue;
        const timeIndex = cells.findIndex(cell => /^(?:(\d{1,2}:)?\d{1,2}:)?\d{1,2}(?:\.\d+)?\s*s?$/i.test(cell));
        if (timeIndex < 0) continue;
        const timeMatch = cells[timeIndex].match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d+))?\s*s?$/i);
        const seconds = timeMatch
          ? Number(timeMatch[1] || 0) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]) + Number(`0.${timeMatch[4] || 0}`)
          : Number(cells[timeIndex].replace(/\s*s$/i, ''));
        const contentCells = cells.filter((_cell, index) => index !== timeIndex);
        const textIndex = contentCells.findIndex(cell => /[a-z]/i.test(cell));
        if (!Number.isFinite(seconds) || textIndex < 0) continue;
        const text = cleanMusicCue(contentCells[textIndex]);
        const translation = cleanMusicCue(contentCells.find((cell, index) => index !== textIndex && /[\u3400-\u9fff]/.test(cell)) || contentCells.find((_cell, index) => index !== textIndex) || '');
        if (text && !isMusicOnlyCue(contentCells[textIndex])) parsedRows.push({ time: seconds, text, translation });
      }
      const uniqueRows = parsedRows.filter((row, index) => index === 0 || row.time >= parsedRows[index - 1].time)
        .filter((row, index, all) => index === 0 || row.time !== all[index - 1].time || row.text !== all[index - 1].text);
      if (!uniqueRows.length) throw new Error('没有在 HTML 表格中识别到“时间 / 字幕 / 翻译”数据。请确认选择的是插件导出的字幕 HTML 文件。');
      const imported = mergeShortSubtitleCues(uniqueRows.map((row, index) => ({
        id: `html-${Date.now()}-${index}`,
        start: row.time,
        end: index + 1 < uniqueRows.length ? Math.max(row.time + 0.5, uniqueRows[index + 1].time) : row.time + 3,
        text: row.text,
        translation: row.translation || '（点击编辑中文翻译）',
      })));
      setEditorSubtitles(imported);
      setRawSubtitlePaste(formatSubtitlesToRawText(imported));
      alert(`已从 HTML 导入 ${imported.length} 条双语字幕。请检查预览并保存。`);
    } catch (error: any) {
      alert(`HTML 字幕导入失败：${error?.message || '文件读取失败。'}`);
    } finally {
      event.target.value = '';
    }
  };

  // Excel/CSV subtitle import and smart AI resegmentation
  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls') && !lowerName.endsWith('.csv')) {
      alert('请上传有效的 Excel (.xlsx, .xls) 或 CSV (.csv) 文件。');
      return;
    }

    setIsParsingExcel(true);
    void (async () => {
      try {
        const result = await requestSubtitleSpreadsheetImport(file, maxSubtitleTime || 120);
        setEditorSubtitles(result.subtitles);
        setRawSubtitlePaste(formatSubtitlesToRawText(result.subtitles));
        setEditorTab('visual');
        const fallbackNote = result.usedLocalFallback ? ' 服务器接口不可用，已在浏览器本地解析。' : '';
        alert(`字幕表格导入完成：整理出 ${result.subtitles.length} 段，时间轴取自表格，音乐标注已清理。${fallbackNote} 请在“可视化编辑”检查并保存。`);
      } catch (err: any) {
        console.error('Excel processing error:', err);
        alert('Excel/CSV 导入失败：' + err.message);
      } finally {
        setIsParsingExcel(false);
        e.target.value = '';
      }
    })();
  };

  // Direct active material Excel import uploader
  const handleActiveMaterialExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls') && !lowerName.endsWith('.csv')) {
      alert('请上传有效的 Excel (.xlsx, .xls) 或 CSV (.csv) 文件。');
      return;
    }

    setIsParsingExcel(true);
    void (async () => {
      try {
        const result = await requestSubtitleSpreadsheetImport(file, maxSubtitleTime || 120);
        const importedSubtitles = result.subtitles;
        if (importedSubtitles.length) {
          // Save back to materials list and local storage
          const updatedMaterials = materials.map(m => {
            if (m.id === activeMaterial?.id) {
              return {
                ...m,
                content: subtitlesToOriginalTranscript(importedSubtitles),
                videoSubtitles: importedSubtitles,
                sentences: importedSubtitles.map(s => s.text)
              };
            }
            return m;
          });

          setMaterials(updatedMaterials);
          localStorage.setItem('ielts_material_files', JSON.stringify(updatedMaterials));
          setSpeakingReadingMode('bilingual');
          setActiveSubtitleId(importedSubtitles[0].id);

          // Force state refresh so activeMaterial is updated instantly in the UI
          setTimeout(() => {
            const currentId = selectedMaterialId;
            setSelectedMaterialId(null);
            setTimeout(() => setSelectedMaterialId(currentId), 20);
          }, 50);

          const fallbackNote = result.usedLocalFallback ? '服务器解析接口尚不可用，已改用浏览器本地解析。' : '';
          alert(`字幕已导入：整理为 ${importedSubtitles.length} 段；保留时间轴和双语字幕，并生成了去除翻译与音乐标注的完整英文原文。${fallbackNote}`);
        } else {
          throw new Error('材料保存失败，请重新选择当前视频后再导入。');
        }
      } catch (err: any) {
        console.error('Active material Excel processing error:', err);
        alert('Excel/CSV 导入失败：' + err.message);
      } finally {
        setIsParsingExcel(false);
        e.target.value = '';
      }
    })();
  };

  // Synchronized video timeline tracker
  const handleVideoTimeUpdate = () => {
    if (!videoRef.current || !activeMaterial || !activeMaterial.videoSubtitles) return;
    const currentTime = videoRef.current.currentTime;
    setVideoCurrentTime(currentTime);

  };

  // Jump video directly to selected subtitle sentence
  const handleSubtitleClick = (start: number, id: string, forceSeek: boolean = false) => {
    setActiveSubtitleId(id);

    // If we are NOT forcing a seek (e.g. normal click on subtitle card), return early
    // to prevent shifting the video playback time or causing jarring auto-scrolling.
    if (!forceSeek) {
      return;
    }

    setVideoCurrentTime(start);

    // Auto-scroll the subtitle into view smoothly immediately
    const subElement = document.getElementById(`sub-${id}`);
    if (subElement && subtitlesContainerRef.current) {
      const container = subtitlesContainerRef.current;
      const subTop = subElement.offsetTop;
      const subHeight = subElement.offsetHeight;
      const containerHeight = container.offsetHeight;
      
      container.scrollTo({
        top: subTop - (containerHeight / 2) + (subHeight / 2),
        behavior: 'smooth'
      });
    }
    
    if (activeMaterial && isEmbedUrl(activeMaterial.url)) {
      const isYouTube = activeMaterial.url.includes('youtube') || activeMaterial.url.includes('youtu.be');
      if (isYouTube && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        try {
          ytPlayerRef.current.seekTo(start, true);
          // Maintain play/pause state: Only play if simulated playing is active or if user explicitly playing
          if (isSimulatedPlaying) {
            ytPlayerRef.current.playVideo();
          } else {
            ytPlayerRef.current.pauseVideo();
          }
        } catch (e) {
          // Fallback if player broke or reloaded
          const nextSrc = getIframeUrl(activeMaterial.url, start, isSimulatedPlaying);
          setIframeSrc(nextSrc);
        }
      } else {
        const nextSrc = getIframeUrl(activeMaterial.url, start, isSimulatedPlaying);
        setIframeSrc(nextSrc);
      }
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = start;
        // Maintain play/pause state: Only play if it was already playing (not paused)
        if (!videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
        }
      }
    }
  };

  // Direct context-aware single word translation and quick-add population
  const handleTranslateWordDirectly = async (word: string, contextSentence?: string) => {
    if (!word) return;
    
    setSelectionState({
      text: word,
      startChar: 0,
      endChar: word.length,
      contextSentence: contextSentence
    });
    setIsTranslating(true);
    setTranslationResult(null);

    try {
      const res = await fetch('/api/gemini/translate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: word,
          context: contextSentence || activeMaterial?.content || '',
          category: activeCategory,
          name: activeMaterial?.name || ''
        })
      });

      if (!res.ok) {
        throw new Error('单词语境解析失败');
      }

      const data = await res.json();
      setTranslationResult(data);

      setQuickWord(data.word || word);
      setQuickPhonetic(data.phonetic || '');
      setQuickPos(data.partOfSpeech || 'v.');
      setQuickChinese(data.translation || '');
      setQuickDef(data.englishDefinition || '');
      setQuickExample(data.example || '');
      setQuickTranslation(data.exampleTranslation || '');
    } catch (err: any) {
      console.error('Error translating word directly:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  // Render clickable words inside bilingual subtitles for swift dictionary lookups
  const renderSubtitleTextWithLookup = (text: string, contextSentence?: string) => {
    if (!text) return '';
    const tokens = text.split(/(\s+)/);
    return tokens.map((token, index) => {
      const isWord = /[a-zA-Z]+/.test(token);
      if (isWord) {
        const cleanWord = token.replace(/[^a-zA-Z]/g, '');
        return (
          <span
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              handleTranslateWordDirectly(cleanWord, contextSentence || text);
            }}
            className="hover:bg-amber-100 hover:text-amber-950 px-0.5 rounded cursor-pointer transition-colors duration-150 font-sans font-semibold text-stone-900 border-b border-dashed border-stone-300 hover:border-amber-400"
            title="点击划词：AI智能语境翻译并收录"
          >
            {token}
          </span>
        );
      }
      return <span key={index}>{token}</span>;
    });
  };

  // Subtitle spelling validation
  const handleCheckLocalDictation = (originalText: string) => {
    const cleanOriginal = originalText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").toLowerCase().trim();
    const cleanInput = localDictationInput.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").toLowerCase().trim();
    
    const origWords = cleanOriginal.split(/\s+/).filter(Boolean);
    const inputWords = cleanInput.split(/\s+/).filter(Boolean);
    
    let matches = 0;
    origWords.forEach(w => {
      if (inputWords.includes(w)) matches++;
    });
    
    const score = origWords.length > 0 ? Math.round((matches / origWords.length) * 100) : 100;
    setLocalDictationScore(score);
    setLocalDictationChecked(true);
  };

  // 2. Folder Actions
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: MaterialFolder = {
      id: `f-${Date.now()}`,
      name: newFolderName,
      category: activeCategory,
      createdAt: new Date().toISOString()
    };
    
    setFolders(prev => {
      const updated = [...prev, newFolder];
      localStorage.setItem('ielts_material_folders', JSON.stringify(updated));
      return updated;
    });
    setNewFolderName('');
    setIsNewFolderOpen(false);
    setSelectedFolderId(newFolder.id);
  };

  const handleDeleteFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Bypassed window.confirm for iframe compatibility
    setFolders(prev => {
      const updated = prev.filter(f => f.id !== id);
      localStorage.setItem('ielts_material_folders', JSON.stringify(updated));
      return updated;
    });
    setMaterials(prev => {
      // Also delete any audio files from IndexedDB for materials inside this folder
      const insideMats = prev.filter(m => m.folderId === id);
      insideMats.forEach(m => {
        if (m.type === 'audio') {
          deleteAudio(m.id).catch(console.error);
        }
      });
      const updated = prev.filter(m => m.folderId !== id);
      localStorage.setItem('ielts_material_files', JSON.stringify(updated));
      return updated;
    });
    if (selectedFolderId === id) {
      setSelectedFolderId(null);
      setSelectedMaterialId(null);
    }
  };

  // 3. Material Actions
  const handleRenameMaterial = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingMaterialId(id);
    setRenamingMaterialName(currentName);
    setIsRenameModalOpen(true);
  };

  const handleSaveRenameMaterial = () => {
    if (!renamingMaterialId || !renamingMaterialName.trim()) return;
    
    const updated = materials.map(m => 
      m.id === renamingMaterialId ? { ...m, name: renamingMaterialName.trim() } : m
    );
    setMaterials(updated);
    localStorage.setItem('ielts_material_files', JSON.stringify(updated));
    
    setIsRenameModalOpen(false);
    setRenamingMaterialId(null);
    setRenamingMaterialName('');
  };

  const handleCreateMaterial = async () => {
    if (!selectedFolderId) {
      alert('请先在上方文件夹列表中选择或创建一个分类文件夹！');
      return;
    }
    if (!newMatName.trim()) {
      alert('请输入材料名称！');
      return;
    }
    if (newMatType === 'audio' && newMatUrl.startsWith('blob:') && !tempAudioBase64) {
      alert('音频文件仍在读取或读取失败，请等待读取完成后再保存，或重新选择音频文件。');
      return;
    }
    
    // Auto generate sentences if audio
    let sentences: string[] = [];
    const audioTranscriptPlaceholder = /^正在加载本地音频|录入后可点击一键AI智能转写/i.test(newMatContent.trim());
    if (newMatType === 'audio' && newMatContent && !audioTranscriptPlaceholder) {
      sentences = newMatContent
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 3);
    }

    const newMat: StudyMaterial = {
      id: `m-${Date.now()}`,
      name: newMatName,
      type: newMatType,
      category: activeCategory,
      folderId: selectedFolderId,
      url: newMatUrl || undefined,
      content: newMatContent,
      notes: '',
      sentences: sentences.length > 0 ? sentences : undefined,
      timestamp: new Date().toISOString()
    };

    if (newMat.type === 'audio' && tempAudioBase64) {
      try {
        await saveAudio(newMat.id, tempAudioBase64, tempAudioMimeType);
      } catch (error: any) {
        console.error('Failed to save uploaded audio to IndexedDB:', error);
        alert(`音频保存失败：${error?.name === 'QuotaExceededError' ? '浏览器本地空间不足，请删除部分材料后重试。' : error?.message || '请重新选择音频后重试。'}`);
        return;
      }
    }
    setTempAudioBase64('');
    setTempAudioMimeType('');

    setMaterials(prev => {
      const updated = [newMat, ...prev];
      localStorage.setItem('ielts_material_files', JSON.stringify(updated));
      return updated;
    });

    setNewMatName('');
    setNewMatUrl('');
    setNewMatContent('');
    setIsNewMaterialOpen(false);
    setSelectedMaterialId(newMat.id);
  };

  const handleDeleteMaterial = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Bypassed window.confirm for iframe compatibility
    deleteAudio(id).catch(console.error);
    setMaterials(prev => {
      const updated = prev.filter(m => m.id !== id);
      localStorage.setItem('ielts_material_files', JSON.stringify(updated));
      return updated;
    });
    if (selectedMaterialId === id) {
      setSelectedMaterialId(null);
    }
  };

  // 4. File Upload Handler
  const handleLocalFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const lastDotIndex = fileName.lastIndexOf('.');
    setNewMatName(lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName);
    
    if (file.type.startsWith('audio/')) {
      setNewMatType('audio');
      setIsParsingFile(true);
      // Create local object URL for preview audio
      const objUrl = URL.createObjectURL(file);
      setNewMatUrl(objUrl);
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        // Do not put a loading hint in material.content: the UI treats content as an existing transcript.
        setNewMatContent('');
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          const base64 = dataUrl.split(',')[1];
          setTempAudioBase64(base64);
          setTempAudioMimeType(file.type);
        }
        setIsParsingFile(false);
      };
      reader.onerror = () => {
        setIsParsingFile(false);
        alert('读取音频失败，请重新选择该文件。');
      };
      reader.readAsDataURL(file);
    } else {
      setNewMatType('document');
      const lowerName = fileName.toLowerCase();
      
      if (lowerName.endsWith('.pdf') || lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
        setIsParsingFile(true);
        setNewMatContent('正在深度解析文档内容，请稍候...');
        
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const dataUrl = event.target?.result as string;
            if (!dataUrl) throw new Error('读取文件失败');
            const base64 = dataUrl.split(',')[1];
            
            const response = await fetch('/api/materials/parse-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                base64,
                fileName,
                fileType: file.type
              })
            });
            
            if (!response.ok) {
              const errData = await response.json();
              throw new Error(errData.error || '解析服务器返回错误');
            }
            
            const result = await response.json();
            setNewMatContent(result.text || '(未提取到任何有效文本)');
          } catch (err: any) {
            console.error('File parsing error:', err);
            setNewMatContent('文档解析失败: ' + err.message + '\n请尝试直接复制文本内容填入下方输入框。');
            alert('文件解析失败: ' + err.message);
          } finally {
            setIsParsingFile(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setNewMatContent(text || '');
        };
        reader.readAsText(file);
      }
    }
  };

  // 5. AI Call - Summarize Material
  const handleAISummarize = async () => {
    if (!activeMaterial) return;
    
    setIsSummarizing(true);
    try {
      const res = await fetch('/api/gemini/summarize-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activeMaterial.name,
          type: activeMaterial.type,
          content: activeMaterial.content
        })
      });
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setAiSummary(data);
      // Save summary back to materials list
      setMaterials(prev => {
        const updated = prev.map(m => m.id === activeMaterial.id ? { ...m, summary: JSON.stringify(data) } : m);
        localStorage.setItem('ielts_material_files', JSON.stringify(updated));
        return updated;
      });
    } catch (e: any) {
      console.error(e);
      alert('AI总结失败，请检查API Key设置: ' + (e.message || '网络连接超时'));
    } finally {
      setIsSummarizing(false);
    }
  };

  // 6. AI Call - Transcribe Audio for Listening
  const handleAITranscribe = async (replacementFile?: File) => {
    if (!activeMaterial || isSummarizing || isTranscribingMedia) return;
    setIsSummarizing(true);
    try {
      const saveAndTranscribeFile = async (file: File) => {
        if (file.size > 200 * 1024 * 1024) throw new Error('音频超过 200 MB 上传上限，请压缩或剪短后重试。');
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = event => typeof event.target?.result === 'string' ? resolve(event.target.result) : reject(new Error('读取音频失败，请重新选择文件。'));
          reader.onerror = () => reject(new Error('读取音频失败，请重新选择文件。'));
          reader.readAsDataURL(file);
        });
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const mimeType = file.type || ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' } as Record<string, string>)[extension] || 'audio/mpeg';
        await saveAudio(activeMaterial.id, dataUrl.split(',')[1], mimeType);
        setActiveAudioUrl(URL.createObjectURL(new Blob([file], { type: mimeType })));
        setIsSummarizing(false);
        await handleTranscribeMediaFile(file, activeMaterial.id);
      };

      if (replacementFile) {
        await saveAndTranscribeFile(replacementFile);
        return;
      }

      const audioRecord = await getAudio(activeMaterial.id);
      if (!audioRecord) {
        // A blob URL can be recovered only while the page that created it is still open.
        // This salvages uploads saved before their IndexedDB write completed.
        if (activeMaterial.url?.startsWith('blob:')) {
          try {
            const response = await fetch(activeMaterial.url);
            if (response.ok) {
              const blob = await response.blob();
              const mimeType = blob.type || 'audio/mpeg';
              const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('flac') ? 'flac' : 'mp3';
              await saveAndTranscribeFile(new File([blob], `${activeMaterial.name}.${extension}`, { type: mimeType }));
              return;
            }
          } catch (error) {
            console.warn('Could not recover audio from the current blob URL:', error);
          }
        }
        throw new Error('浏览器本地音频缓存已丢失。请点下方“重新选择音频并识别”，可保留当前材料和笔记，无需删除材料。');
      }
      if (!audioRecord.base64) throw new Error('本地音频内容为空，请重新上传音频后重试。');
      const estimatedBytes = Math.floor(audioRecord.base64.length * 3 / 4);
      if (estimatedBytes > 200 * 1024 * 1024) throw new Error('音频超过 200 MB 上传上限，请压缩或剪短后重试。');
      const binary = atob(audioRecord.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      let mimeType = (audioRecord.mimeType || '').toLowerCase().split(';')[0].trim();
      const audioMimeAliases: Record<string, string> = {
        'audio/x-m4a': 'audio/mp4',
        'audio/x-wav': 'audio/wav',
        'audio/wave': 'audio/wav',
        'audio/x-pn-wav': 'audio/wav',
        'audio/mp3': 'audio/mpeg',
      };
      mimeType = audioMimeAliases[mimeType] || mimeType || 'audio/mpeg';
      if (!mimeType.startsWith('audio/')) {
        throw new Error(`音频格式标记异常（${audioRecord.mimeType || '未知'}），请重新上传 MP3、M4A 或 WAV 文件。`);
      }
      const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('flac') ? 'flac' : 'mp3';
      const file = new File([bytes], `audio.${extension}`, { type: mimeType });
      setIsSummarizing(false);
      await handleTranscribeMediaFile(file, activeMaterial.id);
    } catch (e: any) {
      console.error(e);
      alert('音频转写失败: ' + e.message);
    } finally {
      setIsSummarizing(false);
    }
  };

  // 7. Add Word to Wordbook (生词加入词汇书)
  const handleQuickAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickWord.trim() || !quickChinese.trim()) return;

    onAddCustomWord({
      word: quickWord.toLowerCase().trim(),
      phonetic: quickPhonetic || '/.../',
      partOfSpeech: quickPos,
      chinese: quickChinese,
      definition: quickDef || 'Added from context: ' + (activeMaterial?.name || ''),
      example: quickExample || (activeMaterial?.content?.slice(0, 80) + '...'),
      exampleTranslation: quickTranslation || '源于学习材料。',
      category: activeCategory,
      topic: activeFolder?.name || 'Academic',
      sourceMaterialId: activeMaterial?.id,
      sourceMaterialName: activeMaterial?.name,
      sourceSentence: selectionState?.contextSentence || selectionState?.text || activeMaterial?.content?.slice(0, 150) + '...',
      userNotes: quickUserNotes.trim() || undefined
    });

    setQuickWordAdded(true);
    // Reset quick fields
    setTimeout(() => {
      setQuickWord('');
      setQuickPhonetic('');
      setQuickChinese('');
      setQuickDef('');
      setQuickExample('');
      setQuickTranslation('');
      setQuickUserNotes('');
      setQuickWordAdded(false);
    }, 1500);
  };

  // 8. Multi-format Note Exporter
  const getMarkdownExport = () => {
    if (!activeMaterial) return '';
    const activeAnnotations = annotationsMap[activeMaterial.id] || [];
    const summaryData = aiSummary;
    
    let md = `# 雅思高分精读材料: ${activeMaterial.name}\n`;
    md += `科目模块: ${activeCategory.toUpperCase()} | 导出时间: ${new Date().toLocaleDateString()}\n`;
    md += `------------------------------------------------------\n\n`;
    
    md += `## 💡 1. 标注与精读文章内容\n\n`;
    
    let annotatedText = "";
    let lastIndex = 0;
    const sortedAnns = [...activeAnnotations].sort((a, b) => a.startChar - b.startChar);
    
    for (const ann of sortedAnns) {
      if (ann.startChar < lastIndex) continue;
      if (ann.startChar > activeMaterial.content.length) break;
      
      annotatedText += activeMaterial.content.substring(lastIndex, ann.startChar);
      
      const textSpan = activeMaterial.content.substring(ann.startChar, ann.endChar);
      if (ann.type === 'highlight') {
        annotatedText += `==${textSpan}== [批注: ${ann.comment || '高亮标记'}]`;
      } else {
        annotatedText += `**<u>${textSpan}</u>** [批注: ${ann.comment || '下划线标记'}]`;
      }
      
      lastIndex = ann.endChar;
    }
    
    if (lastIndex < activeMaterial.content.length) {
      annotatedText += activeMaterial.content.substring(lastIndex);
    }
    
    md += annotatedText + `\n\n`;
    
    md += `## 📝 2. 我的学术精读批注清单\n\n`;
    if (activeAnnotations.length === 0) {
      md += `暂无标注笔记。\n\n`;
    } else {
      activeAnnotations.forEach((ann, i) => {
        md += `### 【标注 ${i + 1}】 ${ann.type === 'highlight' ? '🟡 高亮' : '✍️ 划线'}\n`;
        md += `* **原文词伙/句子**: "${ann.text}"\n`;
        if (ann.comment) {
          md += `* **我的精读批注**: ${ann.comment}\n`;
        }
        md += `\n`;
      });
    }

    md += `## ✍️ 3. 核心备考随堂笔记 (My Global Notes)\n\n`;
    md += `${notes || '暂无全局笔记'}\n\n`;

    if (summaryData) {
      md += `## 🤖 4. AI 考点深度智能提炼\n\n`;
      md += `> ${summaryData.summary || ''}\n\n`;
      
      if (summaryData.keyVocabulary && summaryData.keyVocabulary.length > 0) {
        md += `### 📖 核心词伙提炼\n`;
        summaryData.keyVocabulary.forEach((v: any, index: number) => {
          md += `${index + 1}. **${v.word}** (${v.partOfSpeech}) [${v.chinese}]: ${v.definition}\n`;
          md += `   *学术例句*: ${v.example}\n`;
        });
        md += `\n`;
      }
      
      if (summaryData.grammarPoints && summaryData.grammarPoints.length > 0) {
        md += `### ✍️ 经典语法长难句分析\n`;
        summaryData.grammarPoints.forEach((g: any, index: number) => {
          md += `${index + 1}. **句式**: ${g.point}\n`;
          md += `   *考点解析*: ${g.explanation}\n`;
          md += `   *例句*: ${g.example}\n`;
        });
        md += `\n`;
      }

      if (summaryData.collocations && summaryData.collocations.length > 0) {
        md += `### 📖 推荐学术词伙搭配\n`;
        summaryData.collocations.forEach((col: string) => {
          md += `- ${col}\n`;
        });
      }
    }

    return md;
  };

  const handleExportDocument = () => {
    if (!activeMaterial) return;
    const mdContent = getMarkdownExport();
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${activeMaterial.name.replace(/\s+/g, '_')}_StudyNotes.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportWord = () => {
    if (!activeMaterial) return;
    const activeAnnotations = annotationsMap[activeMaterial.id] || [];
    const summaryData = aiSummary;
    
    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>IELTS Study Notes: ${activeMaterial.name}</title>
        <style>
          body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; line-height: 1.6; color: #333; padding: 20px; }
          h1 { font-family: 'Georgia', serif; color: #1a1a1a; border-bottom: 2px solid #333; padding-bottom: 8px; }
          h2 { color: #2c3e50; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          .highlight-yellow { background-color: #fff2cc; border-bottom: 1px solid #ffd966; }
          .highlight-green { background-color: #d9ead3; border-bottom: 1px solid #93c47d; }
          .highlight-blue { background-color: #cfe2f3; border-bottom: 1px solid #6fa8dc; }
          .highlight-pink { background-color: #f4cccc; border-bottom: 1px solid #e06666; }
          .underline-wavy { text-decoration: underline; text-decoration-style: wavy; text-decoration-color: #cc0000; }
          .note-box { background-color: #f9f9f9; border-left: 4px solid #d0a96c; padding: 10px 15px; margin: 10px 0; font-style: italic; }
          .ann-list-item { border-bottom: 1px dashed #eee; padding: 12px 0; }
          .word-card { background-color: #fafbfc; border: 1px solid #e1e4e8; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <h1>雅思精读备考材料: ${activeMaterial.name}</h1>
        <p style="font-size: 12px; color: #666;">模块科目: ${activeCategory.toUpperCase()} | 导出时间: ${new Date().toLocaleDateString()}</p>
        
        <h2>1. 标注后文章内容</h2>
        <p style="text-align: justify; font-size: 14px; white-space: pre-wrap;">`;
        
    let lastIndex = 0;
    const sortedAnns = [...activeAnnotations].sort((a, b) => a.startChar - b.startChar);
    
    for (const ann of sortedAnns) {
      if (ann.startChar < lastIndex) continue;
      if (ann.startChar > activeMaterial.content.length) break;
      
      html += activeMaterial.content.substring(lastIndex, ann.startChar);
      
      const textSpan = activeMaterial.content.substring(ann.startChar, ann.endChar);
      let colorClass = 'highlight-yellow';
      if (ann.color === 'green') colorClass = 'highlight-green';
      if (ann.color === 'blue') colorClass = 'highlight-blue';
      if (ann.color === 'pink') colorClass = 'highlight-pink';

      if (ann.type === 'highlight') {
        html += `<span class="${colorClass}">${textSpan}</span>`;
      } else {
        html += `<span class="underline-wavy">${textSpan}</span>`;
      }
      
      lastIndex = ann.endChar;
    }
    
    if (lastIndex < activeMaterial.content.length) {
      html += activeMaterial.content.substring(lastIndex);
    }
        
    html += `</p>
        
        <h2>2. 精读批注详细清单</h2>`;
        
    if (activeAnnotations.length === 0) {
      html += `<p style="color: #888;">暂无批注标注内容。</p>`;
    } else {
      activeAnnotations.forEach((ann, i) => {
        html += `
          <div class="ann-list-item">
            <strong>【批注 ${i+1}】 原文词伙：</strong> <span style="font-size: 14px; background-color: #f1f1f1; padding: 2px 4px;">"${ann.text}"</span> <br/>
            <strong>批注笔记：</strong> <span style="color: #2c3e50;">${ann.comment || '（仅划线高亮，暂无文字批注）'}</span>
          </div>`;
      });
    }
    
    html += `
        <h2>3. 备考笔记本 (Study Notes)</h2>
        <div class="note-box">${(notes || '暂无笔记').replace(/\n/g, '<br/>')}</div>`;
        
    if (summaryData) {
      html += `
        <h2>4. AI 学术考点深度解析</h2>
        <h3>💡 核心词汇列表</h3>`;
      summaryData.keyVocabulary?.forEach((v: any) => {
        html += `
          <div class="word-card">
            <strong>${v.word}</strong> (${v.partOfSpeech}) - <em>${v.chinese}</em> <br/>
            <strong>定义：</strong> ${v.definition} <br/>
            <strong>真题考点：</strong> ${v.example}
          </div>`;
      });
    }
    
    html += `
      </body>
      </html>`;
      
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${activeMaterial.name.replace(/\s+/g, '_')}_StudyNotes.doc`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    if (!activeMaterial) return;
    const activeAnnotations = annotationsMap[activeMaterial.id] || [];
    const summaryData = aiSummary;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('请允许浏览器弹出窗口以生成 PDF 打印预览！');
      return;
    }
    
    let htmlContent = `
      <html>
      <head>
        <title>IELTS Academic Study Notes - ${activeMaterial.name}</title>
        <style>
          @media print {
            body { font-family: "Georgia", "PingFang SC", "Microsoft YaHei", serif; line-height: 1.6; color: #111; padding: 20px; }
            h1 { font-size: 24px; text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
            h2 { font-size: 18px; margin-top: 30px; border-bottom: 1px solid #ccc; padding-bottom: 5px; page-break-after: avoid; }
            .content-box { text-align: justify; white-space: pre-wrap; font-size: 14px; margin-bottom: 30px; line-height: 1.8; }
            .highlight-yellow { background-color: #fff2cc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-bottom: 1px solid #ffd966; }
            .highlight-green { background-color: #d9ead3 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-bottom: 1px solid #93c47d; }
            .highlight-blue { background-color: #cfe2f3 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-bottom: 1px solid #6fa8dc; }
            .highlight-pink { background-color: #f4cccc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-bottom: 1px solid #e06666; }
            .underline-wavy { text-decoration: underline; text-decoration-style: wavy; text-decoration-color: #cc0000; }
            .notes-section { background-color: #f9f9f9; border-left: 4px solid #d0a96c; padding: 15px; margin: 15px 0; font-style: italic; }
            .footer-info { font-size: 10px; text-align: center; color: #666; margin-top: 50px; border-top: 1px solid #eee; padding-top: 10px; }
            .ann-item { border-bottom: 1px dashed #ddd; padding: 10px 0; page-break-inside: avoid; }
          }
          body { font-family: "Georgia", "PingFang SC", "Microsoft YaHei", serif; line-height: 1.6; color: #111; max-width: 800px; margin: 0 auto; padding: 40px; }
          h1 { font-size: 26px; text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          h2 { font-size: 20px; margin-top: 35px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
          .content-box { text-align: justify; white-space: pre-wrap; font-size: 15px; margin-bottom: 30px; line-height: 1.8; }
          .highlight-yellow { background-color: #fff2cc; border-bottom: 1px solid #ffd966; }
          .highlight-green { background-color: #d9ead3; border-bottom: 1px solid #93c47d; }
          .highlight-blue { background-color: #cfe2f3; border-bottom: 1px solid #6fa8dc; }
          .highlight-pink { background-color: #f4cccc; border-bottom: 1px solid #e06666; }
          .underline-wavy { text-decoration: underline; text-decoration-style: wavy; text-decoration-color: #cc0000; }
          .notes-section { background-color: #f9f9f9; border-left: 4px solid #d0a96c; padding: 15px; margin: 15px 0; font-style: italic; }
          .ann-item { border-bottom: 1px dashed #ddd; padding: 10px 0; }
          .print-btn { display: block; width: 200px; margin: 20px auto; padding: 10px; background: #1a1a1a; color: white; text-align: center; border: none; font-weight: bold; cursor: pointer; border-radius: 5px; }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">立即生成 / 打印 PDF</button>
        <h1>雅思学术精读笔记：${activeMaterial.name}</h1>
        <div style="text-align: center; font-size: 12px; color: #666; margin-bottom: 30px;">
          科目模块: ${activeCategory.toUpperCase()} | 导出时间: ${new Date().toLocaleDateString()}
        </div>
        
        <h2>1. 标注后文章内容 (Annotated Content)</h2>
        <div class="content-box">`;

    let lastIndex = 0;
    const sortedAnns = [...activeAnnotations].sort((a, b) => a.startChar - b.startChar);
    
    for (const ann of sortedAnns) {
      if (ann.startChar < lastIndex) continue;
      if (ann.startChar > activeMaterial.content.length) break;
      
      htmlContent += activeMaterial.content.substring(lastIndex, ann.startChar);
      
      const textSpan = activeMaterial.content.substring(ann.startChar, ann.endChar);
      let colorClass = 'highlight-yellow';
      if (ann.color === 'green') colorClass = 'highlight-green';
      if (ann.color === 'blue') colorClass = 'highlight-blue';
      if (ann.color === 'pink') colorClass = 'highlight-pink';

      if (ann.type === 'highlight') {
        htmlContent += `<span class="${colorClass}">${textSpan}</span>`;
      } else {
        htmlContent += `<span class="underline-wavy">${textSpan}</span>`;
      }
      
      lastIndex = ann.endChar;
    }
    
    if (lastIndex < activeMaterial.content.length) {
      htmlContent += activeMaterial.content.substring(lastIndex);
    }

    htmlContent += `</div>
        
        <h2>2. 精读批注详细清单 (Annotations & Glossary)</h2>`;
        
    if (activeAnnotations.length === 0) {
      htmlContent += `<p style="color: #666; font-style: italic;">暂无标注批注。</p>`;
    } else {
      activeAnnotations.forEach((ann, i) => {
        htmlContent += `
          <div class="ann-item">
            <strong>【标注 ${i+1}】 ${ann.type === 'highlight' ? '高亮' : '下划线'}:</strong> "${ann.text}" <br/>
            ${ann.comment ? `<strong>我的精读批注:</strong> ${ann.comment} <br/>` : ''}
          </div>`;
      });
    }

    htmlContent += `
        <h2>3. 备考随手记笔记 (My Notes)</h2>
        <div class="notes-section">${(notes || '暂无全局笔记内容').replace(/\n/g, '<br/>')}</div>
        
        <div class="footer-info">
          Powered by IELTS Vocabulary Builder | 备考雅思，自律精读，提炼学术词伙
        </div>
        
        <script>
          setTimeout(function() {
            window.print();
          }, 500);
        </script>
      </body>
      </html>`;
      
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // 9. Dictation Speech Playback (听力精听朗读)
  const handlePlaySentence = (text: string) => {
    // Stop any speaking first
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; // British English for IELTS feeling!
    utterance.rate = playbackSpeed;
    window.speechSynthesis.speak(utterance);
  };

  // 10. Check Dictation Spelling (逐字校验听写)
  const handleCheckDictation = () => {
    if (!activeMaterial?.sentences) return;
    const correctSentence = activeMaterial.sentences[currentSentenceIndex];
    if (!correctSentence) return;

    // Split words, stripping common punctuation
    const cleanWords = (str: string) => str
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 0);

    const targetWords = cleanWords(correctSentence);
    const userWords = cleanWords(userDictationInput);

    // Build diff comparison
    const diff: { word: string; status: 'correct' | 'incorrect' | 'missing' }[] = [];
    let correctCount = 0;

    targetWords.forEach((word, index) => {
      const userWord = userWords[index];
      if (!userWord) {
        diff.push({ word, status: 'missing' });
      } else if (userWord === word) {
        diff.push({ word, status: 'correct' });
        correctCount++;
      } else {
        diff.push({ word: `${word} (${userWord})`, status: 'incorrect' });
      }
    });

    const score = targetWords.length > 0 ? Math.round((correctCount / targetWords.length) * 100) : 0;
    setDictationResult({
      score,
      checked: true,
      diff
    });
  };

  const handleNextDictationSentence = () => {
    if (!activeMaterial?.sentences) return;
    setUserDictationInput('');
    setDictationResult(null);
    setCurrentSentenceIndex((prev) => (prev + 1) % activeMaterial.sentences!.length);
  };

  // Filter folders and materials for the active module category
  const filteredFolders = folders.filter(f => f.category === activeCategory);
  
  const currentFolderMaterials = useMemo(() => {
    if (!selectedFolderId) return [];
    return materials.filter(m => m.folderId === selectedFolderId);
  }, [materials, selectedFolderId]);

  return (
    <div className="space-y-6" id="materials-library-container">
      {/* Category Tabs Indicator */}
      <div className="flex items-center justify-between border-b border-stone-200/80 pb-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-stone-900 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-stone-700" />
            雅思真题学术材料库
          </h2>
          <p className="text-xs text-stone-400 mt-1">分模块归类文件夹，支持文档精读笔记、听写精听，以及 AI 学术总结</p>
        </div>
        
        {/* Module Switcher */}
        <div className="flex bg-stone-100 p-1 rounded-xl border border-stone-200">
          {[
            { id: 'reading', label: '📖 阅读模块' },
            { id: 'writing', label: '✍️ 写作模块' },
            { id: 'speaking', label: '🗣️ 口语模块' },
            { id: 'listening', label: '🎧 听力模块' }
          ].map((tab) => {
            const isActive = activeCategory === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveCategory(tab.id as WordCategory);
                  setSelectedFolderId(null);
                  setSelectedMaterialId(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  isActive 
                    ? 'bg-white text-stone-950 shadow-xs border border-stone-250/20' 
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Folder & File Explorer (Col Span: 4) */}
        <div className="lg:col-span-4 bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-4">
          
          {/* Header Row: Add Folder button */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-stone-400 uppercase tracking-wider">
              文件夹目录
            </span>
            <button
              onClick={() => setIsNewFolderOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-stone-50 text-stone-700 hover:bg-stone-100 border border-stone-200 rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              新建文件夹
            </button>
          </div>

          {/* New Folder Inline Form */}
          {isNewFolderOpen && (
            <div className="bg-stone-50 border p-3 rounded-xl space-y-2.5 animate-fade-in">
              <input
                type="text"
                placeholder="文件夹名称 (如: Cambridge 18)..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border rounded-lg text-xs font-sans focus:outline-hidden focus:border-stone-900"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => setIsNewFolderOpen(false)}
                  className="flex-1 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-md text-[11px] font-semibold transition"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateFolder}
                  className="flex-1 py-1.5 bg-stone-900 hover:bg-stone-850 text-white rounded-md text-[11px] font-semibold transition"
                >
                  创建
                </button>
              </div>
            </div>
          )}

          {/* Folders List */}
          <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
            {filteredFolders.length === 0 ? (
              <p className="text-center text-xs text-stone-400 py-6">无文件夹。请创建新文件夹</p>
            ) : (
              filteredFolders.map((folder) => {
                const isSelected = selectedFolderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    onClick={() => {
                      setSelectedFolderId(folder.id);
                      setSelectedMaterialId(null);
                    }}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer border transition ${
                      isSelected 
                        ? 'bg-stone-900 text-white border-stone-900 shadow-xs' 
                        : 'bg-stone-50/40 hover:bg-stone-100/50 border-stone-200/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isSelected ? <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" /> : <Folder className="h-4 w-4 text-stone-500 shrink-0" />}
                      <span className="text-xs font-semibold truncate">{folder.name}</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteFolder(folder.id, e)}
                      className={`p-1 rounded-md transition ${isSelected ? 'text-stone-400 hover:text-red-400' : 'text-stone-400 hover:text-stone-900'}`}
                      title="删除文件夹"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Files List Section (Only visible when folder is selected) */}
          {selectedFolderId && (
            <div className="border-t border-stone-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-1">
                  <CornerDownRight className="h-3.5 w-3.5" />
                  材料列表
                </span>
                
                <button
                  onClick={() => setIsNewMaterialOpen(true)}
                  className="flex items-center gap-1 px-2 py-1 bg-stone-900 text-white hover:bg-stone-800 rounded-lg text-[10px] font-bold transition cursor-pointer"
                >
                  <Plus className="h-2.5 w-2.5" />
                  上传/新增
                </button>
              </div>

              {/* Add Material Modal/Form */}
              {isNewMaterialOpen && (
                <div className="bg-stone-50 border p-3 rounded-xl space-y-3.5 animate-fade-in">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-stone-500 block uppercase">材料名称</label>
                    <input
                      type="text"
                      placeholder="如: Oxford Environmental Reading..."
                      value={newMatName}
                      onChange={(e) => setNewMatName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateMaterial();
                        }
                      }}
                      className="w-full px-2 py-1.5 bg-white border rounded-lg text-xs font-sans focus:outline-hidden"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-mono text-stone-500 block uppercase mb-1">材料格式</label>
                      <select
                        value={newMatType}
                        onChange={(e) => setNewMatType(e.target.value as MaterialType)}
                        className="w-full p-1.5 bg-white border rounded-lg text-xs focus:outline-hidden"
                      >
                        <option value="document">📄 文本/文档</option>
                        <option value="audio">🎧 录音/音频</option>
                        <option value="video">🎬 视频短片</option>
                        <option value="link">🌐 网页链接</option>
                      </select>
                    </div>
                    {newMatType === 'document' || newMatType === 'audio' ? (
                      <div>
                        <label className="text-[10px] font-mono text-stone-500 block uppercase mb-1 flex items-center justify-between">
                          <span>{newMatType === 'audio' ? '选择音频文件' : '选择文档文件'}</span>
                          {isParsingFile && <span className="text-amber-600 animate-pulse font-bold text-[9px]">{newMatType === 'audio' ? '读取音频中…' : '解析中…'}</span>}
                        </label>
                        <input
                          type="file"
                          disabled={isParsingFile}
                          onChange={handleLocalFileUpload}
                          accept={newMatType === 'audio' ? 'audio/*' : '.pdf,.doc,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain'}
                          className="w-full text-[10px] file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:font-semibold file:bg-stone-200 file:text-stone-700 hover:file:bg-stone-300 disabled:opacity-55"
                        />
                      </div>
                    ) : (
                      <div className="self-end rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-[10px] leading-relaxed text-stone-500">
                        {newMatType === 'video' ? '视频请填写链接；本地音视频可在创建后上传识别。' : '网页材料填写链接，创建后可导入正文。'}
                      </div>
                    )}
                  </div>

                  {newMatType !== 'document' && newMatType !== 'audio' && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-stone-500 block uppercase">{newMatType === 'video' ? '视频链接（可稍后填写）' : '网页链接（可稍后填写）'}</label>
                      <input
                        type="text"
                        placeholder={newMatType === 'video' ? '粘贴 YouTube、B站或视频地址' : '粘贴要导入的网页地址'}
                        value={newMatUrl}
                        onChange={(e) => setNewMatUrl(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border rounded-lg text-xs font-sans"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-stone-500 block uppercase">
                      {newMatType === 'audio' || newMatType === 'video' ? '字幕或听力稿（可选）' : '正文内容（可选）'}
                    </label>
                    <textarea
                      placeholder={newMatType === 'video' ? '可先留空；创建后再导入字幕或上传音视频识别。' : newMatType === 'audio' ? '可选：粘贴听力稿；也可以创建后使用语音识别。' : '可直接粘贴文章正文；也可上传文档后自动提取。'}
                      rows={7}
                      value={newMatContent}
                      onChange={(e) => setNewMatContent(e.target.value)}
                      className="w-full p-2 bg-white border border-stone-250 rounded-lg text-xs font-sans focus:outline-hidden min-h-[128px] resize-y"
                    />
                    {(newMatType === 'document' || newMatType === 'audio') && <p className="text-[9px] text-stone-400 leading-normal">
                      {newMatType === 'document' ? '支持 PDF、DOC、DOCX、TXT；扫描版或无法解析的文件可以直接粘贴正文。' : '音频保存在当前浏览器本机，不会同步到其他设备；选好文件并等待读取完成后创建材料，再开始识别。若本地缓存丢失，可在材料页重新选择音频，无需删除材料。'}
                    </p>}
                  </div>

                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => setIsNewMaterialOpen(false)}
                      className="flex-1 py-1.5 bg-stone-200 text-stone-700 rounded-md text-[10px] font-bold"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreateMaterial}
                      disabled={isParsingFile}
                      className="flex-1 py-1.5 bg-stone-900 text-white rounded-md text-[10px] font-bold disabled:cursor-wait disabled:opacity-50"
                    >
                      {isParsingFile ? (newMatType === 'audio' ? '请等待音频读取完成…' : '请等待文档解析完成…') : '保存新增'}
                    </button>
                  </div>
                </div>
              )}

              {/* Material List Items */}
              <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1">
                {currentFolderMaterials.length === 0 ? (
                  <p className="text-center text-xs text-stone-400 py-4">当前文件夹为空</p>
                ) : (
                  currentFolderMaterials.map((mat) => {
                    const isSelected = selectedMaterialId === mat.id;
                    const TypeIcon = mat.type === 'audio' ? Music 
                      : mat.type === 'video' ? Video 
                      : mat.type === 'link' ? LinkIcon : FileText;
                    
                    return (
                      <div
                        key={mat.id}
                        onClick={() => setSelectedMaterialId(mat.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer border transition ${
                          isSelected 
                            ? 'bg-amber-100/65 text-stone-900 border-amber-300' 
                            : 'bg-stone-50/20 hover:bg-stone-50 border-stone-200/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <TypeIcon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-amber-600' : 'text-stone-400'}`} />
                          <span className="text-xs font-medium truncate">{mat.name}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => handleRenameMaterial(mat.id, mat.name, e)}
                            className="p-1 text-stone-400 hover:text-amber-600 transition"
                            title="重命名材料"
                          >
                            <Edit3 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteMaterial(mat.id, e)}
                            className="p-1 text-stone-400 hover:text-red-500 transition"
                            title="删除材料"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Study workspace (Col Span: 8) */}
        <div className="lg:col-span-8 flex flex-col space-y-6">
          
          {!activeMaterial ? (
            /* Workspace Empty State */
            <div className="bg-white border border-stone-200/80 rounded-2xl p-12 text-center shadow-xs flex flex-col items-center justify-center min-h-[450px]">
              <div className="p-4 bg-stone-50 rounded-full border border-stone-100 text-stone-400 mb-4">
                <FileIcon className="h-8 w-8 text-stone-400" />
              </div>
              <h3 className="font-serif font-bold text-stone-950 text-base">
                请先选择或创建一个学习材料
              </h3>
              <p className="text-xs text-stone-400 mt-2 max-w-sm leading-relaxed">
                点击左侧目录下的文件夹并选中文件材料，即可进入精读笔记本，自动识别文本，运行雅思专项 AI 考点总结。
              </p>
            </div>
          ) : (
            /* Active Study Workspace */
            <div className="space-y-6 animate-fade-in">
              
              {/* Material Workspace Header Card */}
              <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    {activeMaterial.type === 'audio' ? <Music className="h-5 w-5 text-amber-500" />
                      : activeMaterial.type === 'video' ? <Video className="h-5 w-5 text-indigo-500" />
                      : activeMaterial.type === 'link' ? <LinkIcon className="h-5 w-5 text-sky-500" />
                      : <FileText className="h-5 w-5 text-emerald-500" />}
                    <div>
                      <h3 className="font-serif font-bold text-stone-950 text-base leading-tight">
                        {activeMaterial.name}
                      </h3>
                      <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest mt-0.5 block">
                        材料类型: {activeMaterial.type === 'audio' ? '🎧 听力音频' : activeMaterial.type === 'video' ? '🎬 视频材料' : activeMaterial.type === 'link' ? '🌐 网页链接' : '📄 学术文章/文档'}
                      </span>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Multi-format export group */}
                    <div className="flex items-center gap-1 border border-stone-200 rounded-xl p-0.5 bg-stone-50">
                      <span className="text-[9px] font-mono font-bold text-stone-400 px-1.5 uppercase">导出笔记:</span>
                      <button
                        onClick={handleExportDocument}
                        className="px-2 py-1 bg-white hover:bg-stone-100 text-stone-850 rounded-lg text-[10px] font-bold shadow-xs border transition flex items-center gap-1"
                        title="导出 Markdown (.md) 备考文档"
                      >
                        MD
                      </button>
                      <button
                        onClick={handleExportWord}
                        className="px-2 py-1 bg-white hover:bg-stone-100 text-stone-850 rounded-lg text-[10px] font-bold shadow-xs border transition flex items-center gap-1"
                        title="导出 Microsoft Word (.doc) 彩色高亮版"
                      >
                        Word
                      </button>
                      <button
                        onClick={handleExportPDF}
                        className="px-2 py-1 bg-white hover:bg-stone-100 text-stone-850 rounded-lg text-[10px] font-bold shadow-xs border transition flex items-center gap-1"
                        title="一键生成 / 打印排版 PDF 笔记"
                      >
                        PDF
                      </button>
                    </div>

                    {/* AI Summarize Call button */}
                    <button
                      onClick={handleAISummarize}
                      disabled={isSummarizing}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-stone-950 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {isSummarizing ? 'AI 总结中...' : 'AI 提炼考点'}
                    </button>
                  </div>
                </div>

                {/* Subtitle / Web URL Link */}
                {activeMaterial.url && (
                  <p className="text-xs text-stone-500 font-mono truncate">
                    链接源: <a href={activeMaterial.url} target="_blank" rel="noreferrer" className="text-amber-600 underline hover:text-amber-500">{activeMaterial.url}</a>
                  </p>
                )}
              </div>

              {/* TWO COLUMN WORKSPACE GRID: Content vs Notes/Tools */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Left Column: Material Content Box (Col: 8) */}
                <div className="md:col-span-8 space-y-4">
                  
                  {activeMaterial.type === 'video' || activeMaterial.type === 'link' ? (
                    /* ========================================================= */
                    /* SPECIALIZED BILINGUAL VIDEO & VLOG STUDY SYSTEM           */
                    /* ========================================================= */
                    <div className="space-y-4">
                      
                      {/* Subtitles & Extraction Controller Checker */}
                      {!activeMaterial.videoSubtitles || activeMaterial.videoSubtitles.length === 0 ? (
                        /* Case A: Video captions not yet extracted / Paste & AI Segment Portal */
                        <div className="bg-white border border-stone-200/80 rounded-2xl p-6 shadow-xs flex flex-col min-h-[440px] text-left space-y-4">
                          <div className="flex items-center gap-3 border-b pb-3.5">
                            <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-100 text-amber-600">
                              <Sparkles className="h-5 w-5 animate-pulse" />
                            </div>
                            <div>
                              <h3 className="font-serif font-bold text-stone-950 text-base">
                                🎬 视频已就绪 · 添加字幕开始精听
                              </h3>
                              <p className="text-[11px] text-stone-500 leading-relaxed">
                                下方会内嵌<b>该链接对应的原视频</b>，可直接播放。
                                请在 YouTube 播放器菜单中打开“显示文字稿”，复制字幕后粘贴到本网页；导入结果会保存在这条视频材料中。
                              </p>
                            </div>
                          </div>

                          {/* 导入结果 / 注意事项 */}
                          {crawlNotice && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[11px] text-emerald-800 leading-relaxed">
                              ✅ {crawlNotice}
                            </div>
                          )}

                          {/(youtube\.com|youtu\.be)/i.test(activeMaterial.url || '') && (
                            <button type="button"
                              onClick={() => {
                                setCcVideoUrl(activeMaterial.url || '');
                                setRawSubtitlePaste(activeMaterial.content || '');
                                setIsSubtitleEditorOpen(true);
                              }}
                              className="w-full py-3 px-4 bg-amber-400 hover:bg-amber-500 text-stone-900 rounded-xl text-sm font-bold transition">
                              粘贴 YouTube 字幕/文字稿
                            </button>
                          )}

                          {/* 无字幕时也内嵌原视频，让用户先看到真实视频 */}
                          {activeMaterial.url &&
                            (() => {
                              const u = activeMaterial.url;
                              const isDirectFile = /\.(mp4|webm|ogg)(\?.*)?$/i.test(u);
                              const isEmbeddable = isEmbedUrl(u);
                              if (!isDirectFile && !isEmbeddable) {
                                return (
                                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 leading-relaxed">
                                    ⚠️ 此链接暂无法自动内嵌播放。请改用 YouTube / B站 / TED 视频链接或 <b>mp4 直链</b>；
                                    若是普通网页，可点下方「从链接导入」提取正文要点。
                                  </div>
                                );
                              }
                              return (
                                <div className="bg-stone-950 border border-stone-800 rounded-2xl overflow-hidden shadow-md">
                                  {isEmbeddable ? (
                                    <div className="relative aspect-video bg-black">
                                      <iframe
                                        src={iframeSrc || u}
                                        title="Video preview"
                                        className="w-full h-full border-0"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                        allowFullScreen
                                      />
                                    </div>
                                  ) : (
                                    <video src={u} controls className="w-full aspect-video outline-hidden bg-black" />
                                  )}
                                </div>
                              );
                            })()}

                          {activeMaterial.url && (
                            <div className="bg-amber-50/40 border border-amber-200/60 rounded-xl p-4 space-y-3 mb-2">
                              <div className="flex items-start gap-3">
                                <div className="p-2 bg-amber-100/80 text-amber-800 rounded-lg shrink-0 mt-0.5">
                                  <Sparkles className="h-4 w-4 animate-pulse" />
                                </div>
                                <div className="space-y-1">
                                  <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                                    🌐 从链接导入内容（视频 / 网页）
                                  </h4>
                                  <p className="text-[10.5px] text-stone-500 leading-relaxed space-y-0.5">
                                    · <b>YouTube</b>：尝试自动抓取官方字幕（真实）；无字幕则只嵌入原视频。<br />
                                    · <b>B站 / TED / mp4 直链</b>：嵌入原视频播放，字幕请自行粘贴到下方区域。<br />
                                    · <b>普通网页</b>：抓取真实正文并生成要点（不会编造字幕）。
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => handleCrawlVideo(activeMaterial)}
                                disabled={isCrawlingVideo}
                                className="w-full py-2.5 px-4 bg-amber-400 hover:bg-amber-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-950 rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                              >
                                {isCrawlingVideo ? (
                                  <>
                                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-stone-950 border-t-transparent"></span>
                                    <span>正在解析链接并嵌入视频…</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4" />
                                    <span>从链接导入（嵌入原视频 / 提取正文）</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {activeMaterial.url && (
                            <div className="relative flex py-1 items-center">
                              <div className="flex-grow border-t border-stone-200"></div>
                              <span className="flex-shrink mx-4 text-[10px] text-stone-400 font-bold uppercase tracking-wider">或者：手动粘贴字幕/文稿</span>
                              <div className="flex-grow border-t border-stone-200"></div>
                            </div>
                          )}

                          <div className="flex-1 flex flex-col space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-3">
                              <div>
                                <h4 className="text-xs font-bold text-stone-900">📝 视频文字稿面板</h4>
                                <p className="mt-1 text-[10px] leading-relaxed text-stone-500">YouTube 播放器里的文字稿不能被网页自动读取。请在 YouTube 点“显示文字稿”并复制，再粘贴到这里。</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void pasteTranscriptFromClipboard()}
                                  className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-[11px] font-bold text-stone-700 transition hover:border-amber-400 hover:bg-amber-50"
                                >
                                  <Clipboard className="h-3.5 w-3.5" />粘贴已复制的文字稿
                                </button>
                                <label className="shrink-0 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-950 transition hover:bg-amber-100">
                                  <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={handleHtmlSubtitleImport} />
                                  导入字幕 HTML
                                </label>
                                <label className={`shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-950 transition hover:bg-emerald-100 ${isParsingExcel ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}>
                                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={isParsingExcel} onChange={handleExcelImport} />
                                  {isParsingExcel ? '正在导入…' : '导入 Excel 字幕'}
                                </label>
                              </div>
                            </div>
                            <p className="text-[10px] leading-relaxed text-stone-500">插件导出包含 Time / Subtitle / Machine Translation 表格的 HTML 时，可直接导入；文件只在本机浏览器解析。</p>
                            <textarea
                              rows={16}
                              value={rawSubtitlePaste}
                              onPaste={(event) => {
                                const html = event.clipboardData.getData('text/html');
                                const richText = html ? subtitleRowsFromHtml(html) : '';
                                const pasted = richText || event.clipboardData.getData('text/plain');
                                if (!pasted) return;
                                event.preventDefault();
                                const normalized = normalizeTranscriptForImport(pasted);
                                setRawSubtitlePaste(normalized);
                                setEditorSubtitles(parseRawTextToSubtitles(normalized));
                              }}
                              onChange={(e) => setRawSubtitlePaste(e.target.value)}
                              placeholder="复制 YouTube 文字稿后，点上方“粘贴已复制的文字稿”，或直接在这里粘贴。
支持整段英文和带时间轴的文字稿，例如：
例如：
Welcome to the library! Today, we are focusing on low-lying coastal urban areas and mitigating climate dangers..."
                              className="w-full flex-1 p-3 font-mono text-xs bg-stone-50/50 border border-stone-250 rounded-xl focus:border-stone-900 focus:outline-hidden min-h-[320px] resize-y"
                            />

                            <div className="flex gap-3">
                              <button
                                onClick={async () => {
                                  if (!rawSubtitlePaste.trim()) {
                                    alert('请先输入文稿或字幕文本内容。');
                                    return;
                                  }
                                  setIsAligningWithAI(true);
                                  try {
                                    const data = { subtitles: await alignTranscript() };

                                    if (data && data.subtitles) {
                                      const sortedSubtitles = cleanAlignedSubtitles(data.subtitles)
                                        .filter((s: any) => s.text && s.text.trim().length > 0)
                                        .map((s: any, index: number) => ({
                                          ...s,
                                          id: s.id || `s-${Date.now()}-${index}`,
                                          start: isNaN(parseFloat(s.start)) ? 0 : parseFloat(parseFloat(s.start).toFixed(2)),
                                          end: isNaN(parseFloat(s.end)) ? 5 : parseFloat(parseFloat(s.end).toFixed(2)),
                                        }))
                                        .sort((a, b) => a.start - b.start);

                                      const updatedMaterials = materials.map(m => {
                                        if (m.id === activeMaterial.id) {
                                          return {
                                            ...m,
                                            videoSubtitles: sortedSubtitles,
                                            sentences: sortedSubtitles.map(s => s.text)
                                          };
                                        }
                                        return m;
                                      });

                                      setMaterials(updatedMaterials);
                                      localStorage.setItem('ielts_material_files', JSON.stringify(updatedMaterials));
                                      
                                      alert('✨ AI 智能分段并双语对照生成成功！已为您开启精听影子训练系统。');
                                    } else {
                                      throw new Error('返回的字幕格式无效');
                                    }
                                  } catch (err: any) {
                                    console.error(err);
                                    alert('AI 字幕分段失败：' + (err?.name === 'TimeoutError' ? '本批处理超过 2 分钟，原字幕未修改，请稍后重试。' : err.message));
                                  } finally {
                                    setIsAligningWithAI(false);
                                  }
                                }}
                                disabled={isAligningWithAI || !rawSubtitlePaste.trim()}
                                className="flex-grow py-3 bg-amber-450 hover:bg-amber-400 disabled:bg-stone-100 disabled:text-stone-400 text-stone-950 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                              >
                                {isAligningWithAI ? (
                                  <>
                                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-amber-950 border-t-transparent"></span>
                                    <span>{alignmentProgress || '正在准备分批处理…'}</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4 text-amber-950" />
                                    <span>🪄 一键 AI 智能分段与对齐</span>
                                  </>
                                )}
                              </button>

                              <button
                                onClick={() => {
                                  if (!rawSubtitlePaste.trim()) {
                                    alert('请先输入文稿或字幕文本内容。');
                                    return;
                                  }
                                  const parsed = parseRawTextToSubtitles(rawSubtitlePaste);
                                  const sortedSubtitles = [...parsed]
                                    .filter((s: any) => s.text && s.text.trim().length > 0)
                                    .map((s: any, index: number) => ({
                                      ...s,
                                      id: s.id || `s-${Date.now()}-${index}`,
                                      start: isNaN(parseFloat(s.start)) ? 0 : parseFloat(parseFloat(s.start).toFixed(2)),
                                      end: isNaN(parseFloat(s.end)) ? 5 : parseFloat(parseFloat(s.end).toFixed(2)),
                                    }))
                                    .sort((a, b) => a.start - b.start);

                                  const updatedMaterials = materials.map(m => {
                                    if (m.id === activeMaterial.id) {
                                      return {
                                        ...m,
                                        videoSubtitles: sortedSubtitles,
                                        sentences: sortedSubtitles.map(s => s.text)
                                      };
                                    }
                                    return m;
                                  });

                                  setMaterials(updatedMaterials);
                                  localStorage.setItem('ielts_material_files', JSON.stringify(updatedMaterials));

                                  setTimeout(() => {
                                    const currentId = selectedMaterialId;
                                    setSelectedMaterialId(null);
                                    setTimeout(() => setSelectedMaterialId(currentId), 20);
                                  }, 50);

                                  alert('📥 已直接按行导入并保存！现在可以随时点击 “🔧 修正与调整” 来编辑每一行内容。');
                                }}
                                disabled={isAligningWithAI || !rawSubtitlePaste.trim()}
                                className="px-5 py-3 bg-stone-900 hover:bg-stone-800 text-white disabled:bg-stone-100 disabled:text-stone-400 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                              >
                                <Download className="h-4 w-4" />
                                <span>📥 直接按每行规则导入</span>
                              </button>
                            </div>
                          </div>

                          <div className="text-[10px] text-stone-400 leading-normal bg-amber-50/40 p-3 rounded-lg border border-amber-100/30">
                            💡 <b>提示：</b> AI 只基于你<b>粘贴的真实字幕</b>做切句与中英对照，不会编造内容。若字幕没有时间戳，
                            AI 会按视频总长（约 <b>{maxSubtitleTime.toFixed(1)} 秒</b>）估算时间，仅供排序展示、不保证与画面逐帧同步；
                            如需精确跳转，请粘贴<b>带时间戳的字幕</b>，或对 YouTube 用「抓取官方字幕」。生成后可用 “🔧 修正与调整” 微调任意句子。
                          </div>
                        </div>
                      ) : (
                        /* Case B: Subtitles are active - Render Interactive Bilingual Video Studio */
                        <div className="space-y-4">
                          
                          {/* Video Player Box */}
                          <div className="bg-stone-950 border border-stone-800 rounded-2xl overflow-hidden shadow-md relative group">
                            {isEmbedUrl(activeMaterial?.url) ? (
                              <div className="relative aspect-video bg-black">
                                <iframe
                                  id={activeMaterial.url?.includes('youtube') || activeMaterial.url?.includes('youtu.be') ? 'youtube-iframe' : undefined}
                                  src={iframeSrc}
                                  title="IELTS Video Player"
                                  className="w-full h-full border-0"
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                  allowFullScreen
                                />
                              </div>
                            ) : (
                              <video
                                ref={videoRef}
                                src={activeMaterial.url}
                                onTimeUpdate={handleVideoTimeUpdate}
                                controls
                                className="w-full aspect-video outline-hidden"
                                poster="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=600&auto=format&fit=crop"
                              />
                            )}
                            
                            {/* Current timestamp HUD */}
                            <div className="absolute top-3 right-3 bg-black/60 px-2.5 py-1 rounded-md text-[10px] font-mono text-amber-400 font-bold backdrop-blur-xs pointer-events-none z-10">
                              ⏰ {Math.floor(videoCurrentTime / 60)}:{(videoCurrentTime % 60).toFixed(1).padStart(4, '0')}
                            </div>

                            {/* Embed Control Board Dock (below video iframe / video element) */}
                            {isEmbedUrl(activeMaterial?.url) && (
                              <div className="bg-stone-900 border-t border-stone-800 p-3 flex flex-col gap-2 text-white">
                                {/* Progress Slider */}
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-stone-400 select-none">0.0s</span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={maxSubtitleTime}
                                    step={0.1}
                                    value={videoCurrentTime}
                                    onChange={(e) => handleSeekSliderChange(parseFloat(e.target.value))}
                                    className="flex-1 accent-amber-400 bg-stone-800 h-1.5 rounded-lg appearance-none cursor-pointer hover:h-2 transition-all"
                                  />
                                  <span className="text-[9px] font-mono text-stone-400 select-none">{maxSubtitleTime.toFixed(1)}s</span>
                                </div>

                                {/* Control Buttons */}
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setIsSimulatedPlaying(!isSimulatedPlaying);
                                      }}
                                      className={`px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer ${
                                        isSimulatedPlaying 
                                          ? 'bg-amber-400 text-stone-950 hover:bg-amber-300' 
                                          : 'bg-stone-800 text-stone-200 hover:bg-stone-700'
                                      }`}
                                      title={isSimulatedPlaying ? '暂停字幕随时间滚动同步' : '开启字幕随时间滚动同步'}
                                    >
                                      {isSimulatedPlaying ? '⏸️ 暂停时间同步' : '▶️ 启动时间同步'}
                                    </button>

                                    <span className="text-[10px] text-stone-300 font-mono pl-1.5 border-l border-stone-800">
                                      滚动进度: <b className="text-amber-400">{videoCurrentTime.toFixed(1)}</b> / {maxSubtitleTime.toFixed(1)} 秒
                                    </span>
                                  </div>

                                  {/* Nudge fine-tuning buttons */}
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] font-mono text-stone-500 uppercase mr-1.5 select-none">字幕对齐微调:</span>
                                    <button
                                      onClick={() => nudgeTime(-5)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title="后退5秒"
                                    >
                                      -5s
                                    </button>
                                    <button
                                      onClick={() => nudgeTime(-1)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title="后退1秒"
                                    >
                                      -1s
                                    </button>
                                    <button
                                      onClick={() => nudgeTime(1)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title="前进1秒"
                                    >
                                      +1s
                                    </button>
                                    <button
                                      onClick={() => nudgeTime(5)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title="前进5秒"
                                    >
                                      +5s
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          {/(youtube\.com|youtu\.be)/i.test(activeMaterial.url || '') && (
                            <p role="status" className={`text-xs px-3 py-2 rounded-lg ${youtubeSyncStatus === 'ready' ? 'bg-emerald-50 text-emerald-800' : youtubeSyncStatus === 'unavailable' ? 'bg-amber-50 text-amber-900' : 'bg-stone-100 text-stone-600'}`}>
                              {youtubeSyncStatus === 'ready' ? '字幕已连接视频时间轴；播放或拖动进度时，当前句会高亮。' : youtubeSyncStatus === 'unavailable' ? '未能连接 YouTube 播放器时间轴，暂时无法自动高亮。请刷新页面并确认视频可播放。' : '正在连接 YouTube 播放器时间轴…'}
                            </p>
                          )}

                          {activeMaterial.transcriptionReport && <details className="text-xs text-stone-600 bg-stone-50 rounded-lg p-3">
                            <summary className="cursor-pointer font-semibold">完整字幕处理耗时</summary>
                            <p className="mt-2 leading-relaxed">{activeMaterial.transcriptionReport}</p>
                          </details>}

                          {/* Bilingual Subtitle scrolling viewport */}
                          <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-stone-100 pb-2 flex-wrap">
                              <span className="text-xs font-serif font-bold text-stone-900 flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                                {speakingReadingMode === 'continuous' 
                                  ? '📄 口语素材整段原文 (点击单词可即时译查并收录)' 
                                  : '📖 智能中英双语对照字幕 (点击单词可即时译查并收录)'}
                              </span>
                              
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Auto-Sync Toggle Button (Only in bilingual mode) */}
                                {speakingReadingMode === 'bilingual' && (
                                  <button
                                    onClick={() => setIsAutoSyncSubtitles(!isAutoSyncSubtitles)}
                                    className={`text-[10px] px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer border ${
                                      isAutoSyncSubtitles
                                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                                        : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100 hover:text-stone-850'
                                    }`}
                                    title={isAutoSyncSubtitles ? "自动跟踪模式：字幕跟随视频进度自动高亮并滚动定位" : "手动切换模式：点击任意字幕卡片可直接进行精读高亮，不会打断或跳转视频播放进度"}
                                  >
                                    {isAutoSyncSubtitles ? '🔄 自动定位：开' : '📍 自由滚动：手动'}
                                  </button>
                                )}

                                <button
                                  onClick={() => {
                                    setIsSubtitleEditorOpen(true);
                                  }}
                                  className="text-[10px] bg-amber-450 hover:bg-amber-400 text-stone-950 font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                                  title="导入完整的英文字幕/文本并进行 AI 智能分段"
                                >
                                  📥 导入并 AI 分段
                                </button>
                                <label className={`text-[10px] bg-emerald-100 hover:bg-emerald-200 text-emerald-950 font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors border border-emerald-200 ${isParsingExcel ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}>
                                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={isParsingExcel} onChange={handleActiveMaterialExcelImport} />
                                  {isParsingExcel ? '正在导入…' : '📊 导入 Excel'}
                                </label>
                              </div>
                            </div>

                            {/* Subtitle Scroll container */}
                              <div
                              ref={subtitlesContainerRef}
                              className="overflow-y-auto max-h-[650px] pr-1 space-y-2.5 text-left"
                            >
                              {speakingReadingMode === 'continuous' ? (
                                <div className="space-y-4 py-2 px-1 focus:outline-hidden selection:bg-amber-200 cursor-text leading-relaxed text-sm sm:text-base text-stone-800">
                                  {paragraphBlocks.length === 0 ? (
                                    <span className="text-stone-400 italic">暂无内容</span>
                                  ) : (
                                    paragraphBlocks.map((block, idx) => (
                                      <p 
                                        key={idx}
                                        onMouseUp={(e) => {
                                          e.stopPropagation();
                                          handleParagraphTextSelection(block.start, e.currentTarget);
                                        }}
                                        className="text-stone-900 text-sm sm:text-base leading-relaxed focus:outline-hidden selection:bg-amber-200 cursor-text mb-4"
                                      >
                                        {renderAnnotatedText(block.text, getParagraphAnnotations(block.start, block.end))}
                                      </p>
                                    ))
                                  )}
                                </div>
                              ) : (!activeMaterial.videoSubtitles || activeMaterial.videoSubtitles.length === 0) ? (
                                <div className="text-center py-10 px-4 bg-stone-50 border border-dashed border-stone-250 rounded-2xl space-y-3.5 my-2">
                                  <div className="flex justify-center">
                                    <div className="p-3 bg-amber-50 rounded-full border border-amber-100">
                                      <Sparkles className="h-6 w-6 text-amber-500 animate-pulse" />
                                    </div>
                                  </div>
                                  <div className="space-y-1 max-w-md mx-auto">
                                    <p className="text-xs font-serif font-bold text-stone-800">当前视频暂无中英对照双语字幕</p>
                                    <p className="text-[11px] text-stone-500 leading-relaxed">
                                      请点击下方导入按钮，粘贴视频的完整英文文稿、字幕文本或听力段落。顶级 AI 大模型将自动为您智能断句并一键生成严谨雅思级双语翻译，开启影子跟读精听！
                                    </p>
                                  </div>
                                  <div className="flex justify-center pt-1.5">
                                    <button
                                      onClick={() => {
                                        setIsSubtitleEditorOpen(true);
                                      }}
                                      className="text-[11px] bg-amber-450 hover:bg-amber-400 text-stone-950 font-bold py-2.5 px-5 rounded-xl flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                                    >
                                      📥 导入字幕并 AI 智能分段
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                (activeMaterial.videoSubtitles || []).map((sub) => {
                                  const isActive = sub.id === activeSubtitleId;
                                  const isDictatingThis = localDictationId === sub.id;

                                  return (
                                    <div
                                      key={sub.id}
                                      id={`sub-${sub.id}`}
                                      onClick={() => handleSubtitleClick(sub.start, sub.id)}
                                      className={`p-3.5 border rounded-xl transition-all duration-200 text-left group/sub cursor-pointer relative ${
                                        isActive 
                                          ? 'bg-amber-100 border-amber-500 ring-2 ring-amber-500 shadow-md scale-[1.005]'
                                          : 'bg-stone-50/50 border-stone-200/50 hover:bg-stone-100/60'
                                      }`}
                                    >
                                      {/* Timing bubble & indicators */}
                                      <div className="flex items-center justify-between mb-1">
                                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm ${isActive ? 'bg-amber-500 text-stone-950 animate-pulse' : 'bg-stone-200/50 text-stone-500'}`}>
                                          ⏱️ {Math.floor(sub.start)}s - {Math.floor(sub.end)}s
                                        </span>
                                        
                                        {/* Micro Actions Menu */}
                                        <div className="opacity-0 group-hover/sub:opacity-100 transition-opacity duration-150 flex items-center gap-1.5">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              // Play TTS speech synthesis
                                              window.speechSynthesis.cancel();
                                              const utterance = new SpeechSynthesisUtterance(sub.text);
                                              utterance.rate = playbackSpeed;
                                              window.speechSynthesis.speak(utterance);
                                            }}
                                            className="p-1 hover:bg-stone-200 rounded text-[10px]"
                                            title="🔊 单句朗读"
                                          >
                                            🔊 朗读
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (isDictatingThis) {
                                                setLocalDictationId(null);
                                              } else {
                                                setLocalDictationId(sub.id);
                                                setLocalDictationInput('');
                                                setLocalDictationScore(null);
                                                setLocalDictationChecked(false);
                                              }
                                            }}
                                            className={`p-1 rounded text-[10px] font-bold ${isDictatingThis ? 'bg-amber-500 text-stone-950' : 'hover:bg-stone-200'}`}
                                            title="✍️ 精听默写"
                                          >
                                            ✍️ 听写
                                          </button>
                                        </div>
                                      </div>

                                      {/* English Clickable Subtitle Words */}
                                      <div className="leading-relaxed break-words mb-1.5">
                                        {renderSubtitleTextWithLookup(sub.text, sub.text)}
                                      </div>

                                      {/* Chinese Translation */}
                                      <p className={`text-[11px] font-sans leading-relaxed border-l-2 pl-2 ${isActive ? 'border-amber-400 text-stone-700 font-semibold' : 'border-stone-200 text-stone-500'}`}>
                                        {sub.translation}
                                      </p>

                                      {/* Localised Dictation block inside subtitle item */}
                                      {isDictatingThis && (
                                        <div 
                                          className="mt-3 p-3 bg-white border border-stone-200 rounded-xl space-y-2 animate-fade-in text-xs cursor-default"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-stone-700">✍️ 视频精听拼写 (IELTS Sentence Dictation):</span>
                                            <button
                                              onClick={() => handleSubtitleClick(sub.start, sub.id, true)}
                                              className="text-[9px] text-amber-600 hover:underline"
                                            >
                                              🔊 重新听音
                                            </button>
                                          </div>
                                          <textarea
                                            placeholder="写下你听到的英文句子..."
                                            rows={1.5}
                                            value={localDictationInput}
                                            onChange={(e) => setLocalDictationInput(e.target.value)}
                                            className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-xs leading-relaxed text-stone-850 focus:outline-hidden"
                                          />
                                          <div className="flex gap-2 justify-end">
                                            <button
                                              onClick={() => handleCheckLocalDictation(sub.text)}
                                              className="px-3 py-1 bg-stone-900 text-white rounded-md text-[10.5px] font-bold"
                                            >
                                              提交校验
                                            </button>
                                            <button
                                              onClick={() => setLocalDictationId(null)}
                                              className="px-3 py-1 bg-stone-100 text-stone-600 rounded-md text-[10.5px]"
                                            >
                                              取消
                                            </button>
                                          </div>

                                          {localDictationChecked && localDictationScore !== null && (
                                            <div className="pt-2 border-t border-dashed border-stone-150">
                                              <span className="text-[10.5px] font-bold">
                                                拼写正确率: <span className={localDictationScore >= 90 ? 'text-green-600 font-mono text-sm' : 'text-amber-600 font-mono text-sm'}>{localDictationScore}%</span>
                                              </span>
                                              <p className="text-[9.5px] text-stone-400 mt-1">
                                                原句: <b className="font-mono text-stone-600 font-medium">"{sub.text}"</b>
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          {speakingReadingMode === 'bilingual' && activeMaterial.content?.trim() && (
                            <details open className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                              <summary className="cursor-pointer text-xs font-bold text-stone-700">📄 完整英文原文（已去除翻译和音乐标注）</summary>
                              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{activeMaterial.content}</p>
                            </details>
                          )}

                        </div>
                      )}

                    </div>
                  ) : (
                    /* ========================================================= */
                    /* STANDARD ACADEMIC READERS & DOCUMENT/AUDIO DICTATION VIEW  */
                    /* ========================================================= */
                    <div className="space-y-4">
                      
                      {/* Content viewer card */}
                      <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-xs flex flex-col min-h-[580px]">
                        
                        {/* TTS Reader Control Panel */}
                        {activeMaterial.type !== 'audio' && (
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-50 p-2.5 rounded-xl border border-stone-200 mb-4 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Volume2 className="h-4 w-4 text-amber-500 shrink-0" />
                              <span className="font-semibold text-stone-800">AI 原文朗读 / 跟读模式</span>
                            </div>
                            
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Voice select */}
                              <select
                                value={selectedTtsVoice}
                                onChange={(e) => setSelectedTtsVoice(e.target.value)}
                                className="p-1 bg-white border border-stone-200 rounded text-[10px] text-stone-600 focus:outline-hidden"
                                title="选择朗读发音人"
                              >
                                <option value="">默认系统发音</option>
                                {availableVoices.map(v => (
                                  <option key={v.name} value={v.name}>
                                    {v.name.slice(0, 15)} ({v.lang})
                                  </option>
                                ))}
                              </select>

                              {/* Speed multiplier */}
                              <select
                                value={playbackSpeed}
                                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                                className="p-1 bg-white border border-stone-200 rounded text-[10px] text-stone-600 focus:outline-hidden"
                                title="设置阅读语速"
                              >
                                <option value="0.75">0.75x 慢速</option>
                                <option value="0.9">0.9x 略慢</option>
                                <option value="1.0">1.0x 标准</option>
                                <option value="1.15">1.15x 略快</option>
                                <option value="1.3">1.3x 快速</option>
                                <option value="1.5">1.5x 挑战</option>
                              </select>

                              {/* Play/Pause/Stop triggers */}
                              <div className="flex items-center gap-1">
                                {!isTtsPlaying || isTtsPaused ? (
                                  <button
                                    onClick={handleResumeTts}
                                    className="px-2.5 py-1 bg-stone-950 text-white rounded hover:bg-stone-850 font-bold text-[10px] transition flex items-center gap-0.5 cursor-pointer shadow-xs"
                                  >
                                    <Play className="h-2.5 w-2.5 fill-white" />
                                    朗读
                                  </button>
                                ) : (
                                  <button
                                    onClick={handlePauseTts}
                                    className="px-2.5 py-1 bg-white border border-stone-200 text-stone-800 rounded hover:bg-stone-50 font-bold text-[10px] transition flex items-center gap-0.5 cursor-pointer shadow-xs"
                                  >
                                    <Pause className="h-2.5 w-2.5 text-stone-700" />
                                    暂停
                                  </button>
                                )}

                                {isTtsPlaying && (
                                  <button
                                    onClick={handleStopTts}
                                    className="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded hover:bg-rose-100 font-bold text-[10px] transition cursor-pointer"
                                  >
                                    停止
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Interactive View Display Modes & Controls */}
                        {activeMaterial.content && (
                          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-stone-50 border border-stone-200/60 p-2.5 rounded-xl mb-4 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-stone-500 mr-1 shrink-0">阅读显示模式:</span>
                              <div className="flex bg-stone-200/60 p-0.5 rounded-lg border border-stone-200 flex-wrap sm:flex-nowrap">
                                <button
                                  onClick={() => {
                                    setReadingMode('continuous');
                                    setShowLineByLine(false);
                                  }}
                                  className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer text-xs ${
                                    readingMode === 'continuous'
                                      ? 'bg-white text-stone-900 shadow-xs' 
                                      : 'text-stone-500 hover:text-stone-800'
                                  }`}
                                >
                                  📄 整段原文(不翻译)
                                </button>
                                <button
                                  onClick={async () => {
                                    if (lineTranslationsMap[activeMaterial.id]) {
                                      setReadingMode('paragraph');
                                      setShowLineByLine(false);
                                    } else {
                                      setIsTranslatingByLine(true);
                                      try {
                                        const res = await fetch('/api/gemini/translate-by-line', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ content: activeMaterial.content })
                                        });
                                        if (!res.ok) throw new Error('断句对照翻译请求失败');
                                        const data = await res.json();
                                        if (data && data.lines) {
                                          const updatedMap = {
                                            ...lineTranslationsMap,
                                            [activeMaterial.id]: data.lines
                                          };
                                          setLineTranslationsMap(updatedMap);
                                          localStorage.setItem('ielts_material_line_translations', JSON.stringify(updatedMap));
                                          setReadingMode('paragraph');
                                          setShowLineByLine(false);
                                        }
                                      } catch (err: any) {
                                        console.error(err);
                                        alert('AI 断句翻译失败，请重试: ' + err.message);
                                      } finally {
                                        setIsTranslatingByLine(false);
                                      }
                                    }
                                  }}
                                  className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer text-xs ${
                                    readingMode === 'paragraph'
                                      ? 'bg-amber-450 text-stone-950 shadow-xs' 
                                      : 'text-stone-500 hover:text-stone-800'
                                  }`}
                                  disabled={isTranslatingByLine}
                                >
                                  {isTranslatingByLine && readingMode !== 'sentence' ? (
                                    <>
                                      <span className="animate-spin rounded-full h-3 w-3 border-2 border-stone-900 border-t-transparent"></span>
                                      <span>AI 断句翻译中...</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>📖 整段双语对照</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (lineTranslationsMap[activeMaterial.id]) {
                                      setReadingMode('sentence');
                                      setShowLineByLine(true);
                                    } else {
                                      setIsTranslatingByLine(true);
                                      try {
                                        const res = await fetch('/api/gemini/translate-by-line', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ content: activeMaterial.content })
                                        });
                                        if (!res.ok) throw new Error('逐行翻译请求失败');
                                        const data = await res.json();
                                        if (data && data.lines) {
                                          const updatedMap = {
                                            ...lineTranslationsMap,
                                            [activeMaterial.id]: data.lines
                                          };
                                          setLineTranslationsMap(updatedMap);
                                          localStorage.setItem('ielts_material_line_translations', JSON.stringify(updatedMap));
                                          setReadingMode('sentence');
                                          setShowLineByLine(true);
                                        }
                                      } catch (err: any) {
                                        console.error(err);
                                        alert('AI 逐行翻译失败，请重试: ' + err.message);
                                      } finally {
                                        setIsTranslatingByLine(false);
                                      }
                                    }
                                  }}
                                  className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer text-xs ${
                                    readingMode === 'sentence'
                                      ? 'bg-amber-450 text-stone-950 shadow-xs' 
                                      : 'text-stone-500 hover:text-stone-800'
                                  }`}
                                  disabled={isTranslatingByLine}
                                >
                                  {isTranslatingByLine && readingMode === 'sentence' ? (
                                    <>
                                      <span className="animate-spin rounded-full h-3 w-3 border-2 border-stone-900 border-t-transparent"></span>
                                      <span>AI 翻译对照中...</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>📑 逐行单句对照</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>

                            <div className="text-[10px] text-stone-400">
                              {readingMode === 'sentence' ? (
                                <span className="text-amber-700 font-medium">💡 选中单句中任何词句，均可划线高亮或查看 AI 考点释义</span>
                              ) : readingMode === 'paragraph' ? (
                                <span className="text-amber-700 font-medium">💡 完整展现学术篇章段落结构！双语整段完美对照，选中任何词句均可划线高亮</span>
                              ) : (
                                <span className="text-stone-500">💡 选中原文任何词句，可随时划线高亮或让 AI 深入释义</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Interactive Text Display Viewport */}
                        <div 
                          ref={contentRef}
                          onMouseUp={handleTextSelection}
                          className="flex-1 text-sm font-sans text-stone-800 leading-relaxed space-y-4 overflow-y-auto max-h-[500px] whitespace-pre-line focus:outline-hidden selection:bg-amber-200"
                        >
                          {isSummarizing ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center space-y-3.5">
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
                              <div className="space-y-1">
                                <p className="text-xs font-bold text-stone-700">百炼正在识别音频并生成逐句文本...</p>
                                <p className="text-[11px] text-stone-400">识别完成后会保存英文文本与时间轴；中文翻译会在可用时一并生成。</p>
                              </div>
                            </div>
                          ) : isTranslatingByLine ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center space-y-3.5">
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
                              <div className="space-y-1">
                                <p className="text-xs font-bold text-stone-700">AI 正在进行智能断句与对照翻译中...</p>
                                <p className="text-[11px] text-stone-400">我们将对篇章按语意拆分，并生成精准中英双语逐句对照，请耐心稍候</p>
                              </div>
                            </div>
                          ) : activeMaterial.type === 'audio' && !showAudioTranscript ? (
                            <div className="flex flex-col items-center justify-center py-16 px-6 bg-stone-50/50 border border-dashed border-stone-200 rounded-2xl text-center space-y-3.5">
                              <div className="p-3 bg-stone-100 rounded-full text-stone-400">
                                <EyeOff className="h-6 w-6" />
                              </div>
                              <div className="space-y-1">
                                <h4 className="text-xs font-bold text-stone-700">听写文本已遮蔽</h4>
                                <p className="text-[11px] text-stone-400 max-w-sm leading-relaxed">
                                  为了锻炼你的雅思听力拼写与默写能力，当前的转写文本及翻译已被隐藏。点击右上方“显示文本”按钮可随时开启对照。
                                </p>
                              </div>
                              <button
                                onClick={() => setShowAudioTranscript(true)}
                                className="px-3 py-1.5 bg-stone-900 hover:bg-stone-850 text-white text-[11px] font-semibold rounded-lg shadow-sm transition"
                              >
                                👁️ 显示听写文本
                              </button>
                            </div>
                          ) : activeMaterial.type === 'audio' && (
                            !activeMaterial.sentences?.length ||
                            /^正在加载本地音频|录入后可点击一键AI智能转写/i.test((activeMaterial.content || '').trim())
                          ) ? (
                            <div className="flex flex-col items-center justify-center py-16 px-6 bg-amber-50/20 border border-dashed border-amber-200 rounded-2xl text-center space-y-4 w-full">
                              <div className="p-3.5 bg-amber-50 rounded-full text-amber-600">
                                <Sparkles className="h-5 w-5 animate-bounce" />
                              </div>
                              <div className="space-y-1 max-w-sm">
                                <h4 className="text-xs font-bold text-stone-900">🎧 暂无音频听抄文稿</h4>
                                <p className="text-[10.5px] text-stone-500 leading-relaxed">
                                  该音频材料还没有逐句听写文稿。请使用已配置的阿里云百炼语音识别生成文本。
                                </p>
                              </div>
                              <button
                                onClick={handleAITranscribe}
                                disabled={isSummarizing || isTranscribingMedia}
                                className="py-2.5 px-5 bg-amber-400 hover:bg-amber-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-950 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer"
                              >
                                {isSummarizing || isTranscribingMedia ? transcribingMediaMessage : '🎧 使用百炼识别音频并生成逐句听写'}
                              </button>
                              <input
                                ref={replaceAudioFileInputRef}
                                type="file"
                                accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac"
                                className="hidden"
                                onChange={event => {
                                  const file = event.target.files?.[0];
                                  if (file) void handleAITranscribe(file);
                                  event.target.value = '';
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => replaceAudioFileInputRef.current?.click()}
                                disabled={isSummarizing || isTranscribingMedia}
                                className="text-[10px] text-stone-500 underline underline-offset-2 hover:text-stone-800 disabled:opacity-50"
                              >
                                音频缓存丢失或想更换文件？重新选择并识别（保留材料）
                              </button>
                            </div>
                          ) : activeMaterial.content ? (
                            readingMode === 'sentence' && lineTranslationsMap[activeMaterial.id] ? (
                              <div className="space-y-4 overflow-y-auto max-h-[500px] pr-1">
                                {lineTranslationsMap[activeMaterial.id].map((line, idx) => (
                                  <div key={idx} className="p-3 bg-stone-50/70 border border-stone-200/50 rounded-xl space-y-1.5 hover:bg-amber-50/20 transition-all duration-200 group">
                                    <div className="flex items-start gap-1.5">
                                      <span className="text-[10px] font-mono text-stone-400 select-none bg-stone-200/40 px-1 rounded mt-0.5 shrink-0">
                                        {idx + 1}
                                      </span>
                                      <p 
                                        onMouseUp={(e) => {
                                          e.stopPropagation(); // Prevent bubbling to generic container handler
                                          const currentTarget = e.currentTarget as HTMLParagraphElement;
                                          const pos = linePositions[idx];
                                          if (pos && pos.start !== -1) {
                                            handleLineTextSelection(idx, pos.start, currentTarget);
                                          }
                                        }}
                                        className="text-xs sm:text-sm font-sans text-stone-900 leading-relaxed font-semibold focus:outline-hidden selection:bg-amber-200 cursor-text"
                                      >
                                        {renderAnnotatedText(line.original, getLineAnnotations(line.original, idx, linePositions))}
                                      </p>
                                    </div>
                                    <p className="text-[11px] sm:text-xs font-sans text-stone-600 leading-relaxed pl-5 border-l-2 border-stone-200 group-hover:border-amber-400 transition-colors">
                                      {line.translation}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            ) : readingMode === 'paragraph' ? (
                              <div className="space-y-6 overflow-y-auto max-h-[500px] pr-1">
                                {paragraphBlocks.map((block, idx) => {
                                  const translation = getParagraphTranslation(block.text);
                                  return (
                                    <div key={idx} className="p-4 bg-stone-50/40 border border-stone-200/40 rounded-2xl space-y-2.5 hover:bg-amber-50/10 transition-all duration-200 group">
                                      <div className="flex items-start gap-2">
                                        <span className="text-[10px] font-mono text-stone-400 select-none bg-stone-200/40 px-1.5 py-0.5 rounded shrink-0">
                                          段落 {idx + 1}
                                        </span>
                                        <p 
                                          onMouseUp={(e) => {
                                            e.stopPropagation();
                                            handleParagraphTextSelection(block.start, e.currentTarget);
                                          }}
                                          className="text-stone-900 text-sm sm:text-base leading-relaxed focus:outline-hidden selection:bg-amber-200 cursor-text"
                                        >
                                          {renderAnnotatedText(block.text, getParagraphAnnotations(block.start, block.end))}
                                        </p>
                                      </div>
                                      {translation && (
                                        <p className="text-xs sm:text-sm font-sans text-stone-600 leading-relaxed pl-7 border-l-2 border-stone-200 group-hover:border-amber-400 transition-colors">
                                          {translation}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : isTtsPlaying ? (
                              <div className="space-y-3">
                                {parsedSentences.map((sentence, idx) => {
                                  const isActive = idx === currentTtsSentenceIndex;
                                  return (
                                    <span
                                      key={idx}
                                      onClick={() => playTtsFromIndex(idx)}
                                      className={`inline mr-1.5 px-1 rounded transition-all duration-200 cursor-pointer text-sm leading-relaxed ${
                                        isActive 
                                          ? 'bg-amber-100 text-amber-950 font-medium border-l-2 border-amber-500 pl-2 pr-1 shadow-xs' 
                                          : 'text-stone-850 hover:bg-stone-50'
                                      }`}
                                      title="点击从此句开始朗读"
                                    >
                                      {sentence}{' '}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="space-y-4 overflow-y-auto max-h-[500px] pr-1">
                                {paragraphBlocks.map((block, idx) => (
                                  <p 
                                    key={idx}
                                    onMouseUp={(e) => {
                                      e.stopPropagation();
                                      handleParagraphTextSelection(block.start, e.currentTarget);
                                    }}
                                    className="text-stone-900 text-sm sm:text-base leading-relaxed focus:outline-hidden selection:bg-amber-200 cursor-text mb-4"
                                  >
                                    {renderAnnotatedText(block.text, getParagraphAnnotations(block.start, block.end))}
                                  </p>
                                ))}
                              </div>
                            )
                          ) : (
                            <p className="text-stone-400 italic py-10 text-center">暂无内容，请在左侧目录上传或新增文稿内容。</p>
                          )}
                        </div>

                        {/* Custom Audio Element Player (if audio url is valid) */}
                        {activeMaterial.type === 'audio' && activeAudioUrl && (
                          <div className="mt-4 p-3.5 bg-stone-50 rounded-xl border border-stone-200/70 space-y-3">
                            <div className="flex items-center gap-2">
                              <Volume2 className="h-4 w-4 text-amber-600 shrink-0" />
                              <span className="text-xs font-semibold text-stone-700">音频播放器控制</span>
                            </div>
                            
                            <audio 
                              ref={audioRef}
                              src={activeAudioUrl} 
                              controls 
                              className="w-full h-8 outline-hidden"
                            />

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => skipAudio(-15)}
                                className="flex-1 py-1.5 px-3 bg-white hover:bg-stone-100 active:bg-stone-200 border border-stone-200/80 text-stone-700 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center justify-center gap-1"
                                title="后退 15 秒"
                              >
                                ⏪ 后退 15s
                              </button>
                              <button
                                onClick={() => skipAudio(15)}
                                className="flex-1 py-1.5 px-3 bg-white hover:bg-stone-100 active:bg-stone-200 border border-stone-200/80 text-stone-700 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center justify-center gap-1"
                                title="快进 15 秒"
                              >
                                快进 15s ⏩
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  )}

                </div>

                {/* Right Column: Study Notes, AI Summary and Quick Word Add (Col: 4) */}
                <div className="md:col-span-4 space-y-4">
                  
                  {/* DYNAMIC ACTIVE SELECTION TOOL PANEL */}
                  {selectionState && (
                    <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-4 shadow-xs space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-amber-200/50 pb-2">
                        <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-amber-600 animate-pulse" />
                          已选中文本 (Selected Text)
                        </span>
                        <button 
                          onClick={() => setSelectionState(null)} 
                          className="text-stone-400 hover:text-stone-600 text-xs cursor-pointer font-bold"
                        >
                          ✕ 取消
                        </button>
                      </div>
                      <div className="text-xs text-stone-700 bg-white/90 p-2.5 rounded-lg border border-amber-200/40 italic font-mono max-h-24 overflow-y-auto leading-relaxed">
                        "{selectionState.text}"
                      </div>

                      {/* Highlight color block selectors */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-mono text-stone-400 block font-semibold">1. 划线/高亮类型:</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'yellow')}
                            className="px-2 py-1 bg-yellow-50 hover:bg-yellow-100 border border-yellow-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title="高亮黄"
                          >
                            🟡 黄高亮
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'green')}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title="高亮绿"
                          >
                            🟢 绿高亮
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'blue')}
                            className="px-2 py-1 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title="高亮蓝"
                          >
                            🔵 蓝高亮
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'pink')}
                            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title="高亮粉"
                          >
                            🔴 粉高亮
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('underline')}
                            className="px-2 py-1 bg-white hover:bg-stone-50 border border-stone-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title="波浪下划线"
                          >
                            ✍️ 划下划线
                          </button>
                        </div>
                      </div>

                      {/* AI Translation button */}
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-mono text-stone-400 block font-semibold">2. 智能雅思学术语境翻译:</span>
                        <button
                          onClick={handleTranslateSelection}
                          disabled={isTranslating}
                          className="w-full py-2 bg-amber-400 hover:bg-amber-300 text-stone-950 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-55"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {isTranslating ? 'AI 正在深度释义其多维语境...' : 'AI 智能语境学术翻译'}
                        </button>
                      </div>

                      {/* Display context-aware translation card */}
                      {translationResult && (
                        <div className="bg-white border border-amber-200 rounded-xl p-3 text-xs space-y-2.5 animate-fade-in shadow-xs">
                          <div className="flex items-center justify-between border-b border-stone-100 pb-1.5">
                            <span className="font-bold text-stone-900 text-[11px] flex items-center gap-1">
                              📖 AI 语境释义与考点
                            </span>
                            {translationResult.phonetic && (
                              <span className="text-[9.5px] font-mono text-stone-500 bg-stone-100 px-1 rounded">
                                {translationResult.phonetic} {translationResult.partOfSpeech}
                              </span>
                            )}
                          </div>

                          {/* ASR Correction Indicator */}
                          {translationResult.isCorrected && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-2.5 rounded-lg flex flex-col gap-1">
                              <span className="font-bold text-[10.5px] flex items-center gap-1">
                                ⚠️ ASR语音识别/拼写自动纠错
                              </span>
                              <p className="text-[10px] leading-normal text-amber-850">
                                {translationResult.correctionExplanation || `检测到输入可能存在语音识别或拼写错误。已自动将词汇纠正为标准学术表达：`}
                              </p>
                              <div className="text-[9.5px] text-stone-600 font-mono mt-0.5">
                                划选原文: <span className="line-through text-red-500 font-sans">"{selectionState?.text}"</span> ➔ 修正后: <span className="font-bold text-emerald-700 font-sans">"{translationResult.word}"</span>
                              </div>
                            </div>
                          )}
                          
                          <div>
                            <span className="text-[9px] font-mono text-stone-400 uppercase tracking-wider block font-bold">释义 (Translation):</span>
                            <p className="text-stone-850 font-semibold text-[11px]">{translationResult.translation}</p>
                          </div>

                          {translationResult.englishDefinition && (
                            <div>
                              <span className="text-[9px] font-mono text-stone-400 uppercase tracking-wider block font-bold">英文定义 (English Definition):</span>
                              <p className="text-stone-800 font-medium text-[11px] font-mono">{translationResult.englishDefinition}</p>
                            </div>
                          )}
                          
                          {translationResult.contextualExplanation && (
                            <div>
                              <span className="text-[9px] font-mono text-stone-400 uppercase tracking-wider block font-bold">学术语境与指代分析 (Contextual Match):</span>
                              <p className="text-stone-600 leading-normal text-[10.5px]">{translationResult.contextualExplanation}</p>
                            </div>
                          )}
                          
                          {translationResult.ieltsTips && (
                            <div className="bg-amber-50/60 p-2 rounded-lg border border-amber-200/20">
                              <span className="text-[9px] font-mono text-amber-800 font-bold block">💡 雅思备考高分干货:</span>
                              <p className="text-stone-600 leading-relaxed text-[10.5px] whitespace-pre-line">{translationResult.ieltsTips}</p>
                            </div>
                          )}
                          
                          {translationResult.example && (
                            <div className="border-t border-dashed pt-2">
                              <span className="text-[9px] font-mono text-stone-400 block font-bold">学术原创例句 (IELTS Academic Sample):</span>
                              <p className="text-stone-800 italic font-medium font-sans text-[10.5px] leading-normal">"{translationResult.example}"</p>
                              <p className="text-stone-500 text-[10px] mt-0.5">{translationResult.exampleTranslation}</p>
                            </div>
                          )}

                          <div className="pt-1.5 border-t border-stone-100 text-[9px] text-stone-400">
                            💡 AI 已将本生词智能载入下方 <b>"快捷收录生词"</b> 表单，只需点击最下方 <b>"一键收录到词本"</b> 即可快速背诵。
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ACTIVE ANNOTATION DETAILED INSPECTOR */}
                  {selectedAnnotation && !selectionState && (
                    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 shadow-xs space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-stone-200/60 pb-2">
                        <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                          <span>📝 批注标注详情 (Annotation Note)</span>
                        </span>
                        <button 
                          onClick={() => setSelectedAnnotation(null)} 
                          className="text-stone-400 hover:text-stone-600 text-xs font-bold cursor-pointer"
                        >
                          ✕ 关闭
                        </button>
                      </div>
                      
                      <div className="text-xs text-stone-700 bg-white p-2.5 rounded-lg border border-stone-200 italic font-mono leading-relaxed">
                        "{selectedAnnotation.text}"
                      </div>

                      {/* Custom comments block */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono font-bold text-stone-400 block">编辑我的精读批注笔记 (Comments):</label>
                        <textarea
                          placeholder="在此记录你的学练心得、熟词僻义、派生同义词词伙..."
                          rows={3}
                          value={annotationCommentText}
                          onChange={(e) => setAnnotationCommentText(e.target.value)}
                          className="w-full p-2 bg-white border border-stone-250 rounded-xl text-xs leading-normal focus:outline-hidden text-stone-800"
                        />
                        <div className="flex justify-between items-center pt-1">
                          <button
                            onClick={() => handleDeleteAnnotation(selectedAnnotation.id)}
                            className="text-xs text-red-500 hover:text-red-600 font-semibold cursor-pointer"
                          >
                            🗑️ 删除划线/高亮
                          </button>
                          <button
                            onClick={handleSaveAnnotationComment}
                            className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-850 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                          >
                            保存批注
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Study notes tab card */}
                  <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-2 flex flex-col">
                    <span className="text-xs font-mono font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Edit3 className="h-3.5 w-3.5" />
                      我的备考笔记
                    </span>
                    <textarea
                      placeholder="在这里写下你的高频词伙、特殊语法笔记，内容在退出时也会自动保存..."
                      rows={5}
                      value={notes}
                      onChange={(e) => handleSaveNotes(e.target.value)}
                      className="w-full p-2.5 bg-stone-50 border border-stone-250 rounded-xl text-xs font-sans focus:outline-hidden focus:border-stone-900 leading-relaxed"
                    />
                  </div>

                  {/* MANUAL SEARCH DICTIONARY CARD */}
                  <div className="bg-white border border-amber-200/60 rounded-2xl p-4 shadow-xs space-y-3">
                    <span className="text-xs font-mono font-semibold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Search className="h-3.5 w-3.5 text-amber-500" />
                      随机生词检索与分析 (Instant Word Query)
                    </span>
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleTranslateManualWord(manualSearchWord);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        placeholder="输入你想查询的任何单词 (e.g. resilient)..."
                        value={manualSearchWord}
                        onChange={(e) => setManualSearchWord(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-stone-50 border rounded-lg text-xs font-sans focus:outline-hidden focus:border-amber-500 text-stone-850"
                      />
                      <button
                        type="submit"
                        disabled={isTranslating || !manualSearchWord.trim()}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-xs flex items-center gap-1 cursor-pointer transition disabled:bg-stone-100 disabled:text-stone-400"
                      >
                        {isTranslating ? '查询中...' : '查询'}
                      </button>
                    </form>
                    <p className="text-[10px] text-stone-400 leading-normal">
                      💡 随机输入任何你突然想到的单词，AI 将自动分析其雅思考点并载入下方的快速收录表单。
                    </p>
                  </div>

                  {/* QUICK ADD VOCABULARY CARD */}
                  <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-3">
                    <span className="text-xs font-mono font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-1">
                      <Plus className="h-3.5 w-3.5" />
                      快捷收录生词到 {activeCategory === 'reading' ? '阅读' : activeCategory === 'writing' ? '写作' : activeCategory === 'speaking' ? '口语' : '听力'} 词书
                    </span>

                    <form onSubmit={handleQuickAddWord} className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">生词 Word</label>
                          <input
                            type="text"
                            required
                            placeholder="自动填入或手动输入"
                            value={quickWord}
                            onChange={(e) => setQuickWord(e.target.value)}
                            className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">音标 Phonetic</label>
                          <input
                            type="text"
                            placeholder="/.../"
                            value={quickPhonetic}
                            onChange={(e) => setQuickPhonetic(e.target.value)}
                            className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1">
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">词性 POS</label>
                          <select
                            value={quickPos}
                            onChange={(e) => setQuickPos(e.target.value)}
                            className="w-full p-1.5 bg-stone-50 border rounded-lg text-xs"
                          >
                            <option value="v.">v. 动词</option>
                            <option value="n.">n. 名词</option>
                            <option value="adj.">adj. 形容词</option>
                            <option value="adv.">adv. 副词</option>
                            <option value="phrase">phrase 词伙</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">中文释义 Chinese</label>
                          <input
                            type="text"
                            required
                            placeholder="如: 缓解，减轻"
                            value={quickChinese}
                            onChange={(e) => setQuickChinese(e.target.value)}
                            className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-mono text-stone-400 block uppercase">英文定义 Definition</label>
                        <input
                          type="text"
                          placeholder="English meaning..."
                          value={quickDef}
                          onChange={(e) => setQuickDef(e.target.value)}
                          className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] font-mono text-stone-400 block uppercase">备考学术例句 Example</label>
                        <textarea
                          placeholder="IELTS context example sentence..."
                          rows={1}
                          value={quickExample}
                          onChange={(e) => setQuickExample(e.target.value)}
                          className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs font-sans"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] font-mono text-stone-400 block uppercase">生词记忆笔记 My Notes</label>
                        <textarea
                          placeholder="输入你对该词的记忆法、联想或特别用法笔记..."
                          rows={1.5}
                          value={quickUserNotes}
                          onChange={(e) => setQuickUserNotes(e.target.value)}
                          className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs font-sans"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={quickWordAdded || !quickWord || !quickChinese}
                        className={`w-full py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center justify-center gap-1 ${
                          quickWordAdded 
                            ? 'bg-green-600 text-white' 
                            : 'bg-stone-900 text-white hover:bg-stone-850'
                        }`}
                      >
                        {quickWordAdded ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            成功加入该模块词书！
                          </>
                        ) : '收录生词'}
                      </button>
                    </form>
                  </div>

                  {/* DISPLAY AI KNOWLEDGE POINTS CARD */}
                  {aiSummary && (
                    <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-4 animate-fade-in">
                      <div className="flex items-center gap-1 text-amber-600 border-b border-stone-100 pb-2">
                        <Sparkles className="h-4 w-4 fill-amber-500 text-amber-500 animate-pulse" />
                        <span className="text-xs font-bold font-sans">AI 核心考点总结提炼</span>
                      </div>

                      {/* Brief overview */}
                      <p className="text-xs text-stone-600 bg-amber-50/50 p-2.5 rounded-xl leading-relaxed border border-amber-100">
                        <b>核心要点:</b> {aiSummary.summary}
                      </p>

                      {/* Vocabulary list */}
                      {aiSummary.keyVocabulary && aiSummary.keyVocabulary.length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">🌟 高频学术词汇</h5>
                          <div className="space-y-2">
                            {aiSummary.keyVocabulary.map((v: any, index: number) => (
                              <div key={index} className="bg-stone-50 p-2.5 rounded-lg border border-stone-150 flex flex-col space-y-1">
                                <div className="flex items-col space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-stone-900">{v.word} <span className="text-[10px] font-mono text-stone-400 font-normal">({v.partOfSpeech})</span></span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onAddCustomWord({
                                          word: v.word,
                                          phonetic: '/.../',
                                          partOfSpeech: v.partOfSpeech,
                                          chinese: v.chinese,
                                          definition: v.definition,
                                          example: v.example,
                                          exampleTranslation: '源自AI考点提炼。',
                                          category: activeCategory,
                                          topic: activeFolder?.name || 'Academic Summary',
                                          sourceMaterialId: activeMaterial?.id,
                                          sourceMaterialName: activeMaterial?.name,
                                          sourceSentence: v.example || activeMaterial?.content?.slice(0, 150) + '...'
                                        });
                                        alert(`已将 "${v.word}" 收录到我的词书！`);
                                      }}
                                      className="text-[9px] bg-stone-900 text-white px-1.5 py-0.5 rounded hover:bg-stone-850"
                                    >
                                      收录
                                    </button>
                                  </div>
                                  <span className="text-[11px] text-stone-600">{v.chinese}</span>
                                  <span className="text-[10px] italic text-stone-400 leading-snug">{v.example}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Grammar points */}
                      {aiSummary.grammarPoints && aiSummary.grammarPoints.length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">✍️ 推荐学术句型</h5>
                          <div className="space-y-1.5">
                            {aiSummary.grammarPoints.map((g: any, index: number) => (
                              <div key={index} className="bg-stone-50 p-2.5 rounded-lg border text-xs">
                                <p className="font-bold text-stone-900">{g.point}</p>
                                <p className="text-[11px] text-stone-500 mt-0.5">{g.explanation}</p>
                                <p className="text-[10px] text-stone-400 italic mt-0.5 font-sans">e.g. {g.example}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Collocations */}
                      {aiSummary.collocations && aiSummary.collocations.length > 0 && (
                        <div className="space-y-1.5">
                          <h5 className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">📖 高分词组/词伙搭配</h5>
                          <div className="flex flex-wrap gap-1.5">
                            {aiSummary.collocations.map((col: string, index: number) => (
                              <span key={index} className="bg-stone-100 border text-stone-600 text-[10px] px-2 py-0.5 rounded-full font-mono font-medium">
                                {col}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                </div>

              </div>

            </div>
          )}

        </div>

      </div>

      {/* 📥 Subtitle Smart Import Studio Modal */}
      {isSubtitleEditorOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="bg-stone-900 text-white p-4.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-400" />
                <div>
                  <h3 className="font-serif font-bold text-base leading-tight">📥 智能双语字幕导入与 AI 自动断句</h3>
                  <p className="text-[10px] text-stone-400 font-sans mt-0.5">
                    粘贴自己从 YouTube 获取的文字稿，字幕会保存在当前视频材料中。
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSubtitleEditorOpen(false)}
                className="text-stone-400 hover:text-white p-1 rounded-lg hover:bg-stone-800 transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body Container with scrolling */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              <div className="space-y-4">
                <div className="bg-stone-50 border rounded-xl p-4 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <h4 className="text-xs font-bold text-stone-900">📥 粘贴视频英文文稿、文字稿或带时间轴的字幕:</h4>
                      <button
                        type="button"
                        onClick={() => void pasteTranscriptFromClipboard()}
                        className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-stone-300 bg-white px-3 py-2 text-[10px] font-bold text-stone-700 transition hover:border-amber-400 hover:bg-amber-50"
                      >
                        <Clipboard className="h-3.5 w-3.5" />粘贴剪贴板文字稿
                      </button>
                    </div>
                    <p className="text-[11px] text-stone-500 leading-relaxed">
                      先在 YouTube 视频菜单中打开“显示文字稿”，复制文字稿，再点右侧按钮放入输入框。浏览器不会允许网页直接读取播放器内部内容。<br/>
                      1. <b>🪄 AI 自动断句与翻译 (极力推荐):</b> 您可以粘贴任何一长段、杂乱或未分句的英文文稿，点击下方按钮。AI 将按真实文稿切分为逐句中英字幕；没有时间戳时会估算时间，不能保证逐帧同步。<br/>
                      2. <b>传统文本直接导入:</b> 按回车换行拆分每一行字幕。如果以 <code className="font-mono bg-stone-100 px-1 py-0.5 text-red-600">[0.0-5.5] English | Chinese</code> 的标准格式贴入，系统将自动高精度解包该时间段。
                    </p>

                    {/(youtube\.com|youtu\.be)/i.test(ccVideoUrl) && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
                        在 YouTube 播放器菜单中选择“显示文字稿”，复制字幕后粘贴到下方。没有文字稿时，请先自行取得可用的字幕或文稿。
                      </p>
                    )}

                    {!/(youtube\.com|youtu\.be)/i.test(activeMaterial?.url || '') && <input
                      ref={mediaFileInputRef}
                      type="file"
                      accept="audio/*,video/mp4,video/webm,video/quicktime,video/x-msvideo,video/mpeg,video/3gpp,.mp3,.m4a,.wav,.ogg,.flac,.aac,.mp4,.mov,.avi,.webm,.wmv,.mpeg,.mpg,.3gp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleTranscribeMediaFile(file);
                      }}
                    />}
                    {!/(youtube\.com|youtu\.be)/i.test(activeMaterial?.url || '') && <button
                      type="button"
                      onClick={() => mediaFileInputRef.current?.click()}
                      disabled={isTranscribingMedia}
                      className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-950 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isTranscribingMedia ? transcribingMediaMessage : '上传对应音频/视频，生成本材料字幕'}
                    </button>}
                    {!/(youtube\.com|youtu\.be)/i.test(activeMaterial?.url || '') && <p className="text-[10px] text-stone-500">
                      适用于没有字幕的内容。选择本地 MP3、M4A、WAV、MP4、MOV、AVI 或 WebM 文件，单个文件最大 200 MB；需先在「账号与设置 → 语音识别」配置百炼 API Key。
                    </p>}

                    <textarea
                      rows={18}
                      value={rawSubtitlePaste}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData('text/plain');
                        if (!pasted) return;
                        event.preventDefault();
                        const normalized = normalizeTranscriptForImport(pasted);
                        setRawSubtitlePaste(normalized);
                        setEditorSubtitles(parseRawTextToSubtitles(normalized));
                      }}
                      onChange={(e) => handleTextareaChange(e.target.value)}
                      placeholder="支持格式(可以直接贴入整段英文段落)：
例1（直接贴英文段落，系统将为您切句对时）：
Welcome to the library! Today, we are focusing on low-lying coastal urban areas and mitigating climate dangers...

例2（带时间戳的标准解析格式，每行一句）：
[0.0-5.2] Welcome back to my study vlog! | 欢迎回到我的学习VLOG！
[5.2-12.0] Today we are analyzing high-scoring IELTS collocations. | 今天我们正在分析雅思高分词伙搭配。"
                      className="w-full p-3 font-mono text-xs bg-white border border-stone-250 rounded-xl focus:border-stone-900 focus:outline-hidden min-h-[380px] resize-y"
                    />

                    <div className="flex gap-3">
                      <button
                        onClick={handleAIAlignSubtitles}
                        disabled={isAligningWithAI}
                        className="flex-1 py-2.5 bg-amber-450 hover:bg-amber-400 disabled:bg-stone-200 disabled:text-stone-400 text-stone-950 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition"
                      >
                        {isAligningWithAI ? (
                          <>
                            <span className="animate-spin rounded-full h-3 w-3 border-2 border-amber-800 border-t-transparent"></span>
                            {alignmentProgress || '正在准备分批处理…'}
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-amber-950 animate-pulse" />
                            🪄 AI 自动断句并生成逐句翻译
                          </>
                        )}
                      </button>

                      <button
                        onClick={handleDirectTextImport}
                        disabled={isAligningWithAI}
                        className="flex-1 py-2.5 bg-stone-900 hover:bg-stone-850 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
                      >
                        📥 按每行文本规则直接导入
                      </button>
                    </div>
                  </div>
                </div>

              {/* Unified Subtitle Paragraph Review & Edit List */}
              {editorSubtitles.length > 0 && (
                <div className="space-y-4 pt-6 border-t border-stone-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-stone-850 flex items-center gap-1.5">
                        📖 当前待导入的逐句双语字幕预览 (共 {editorSubtitles.length} 句)
                      </h4>
                      <p className="text-[10px] text-stone-400 mt-0.5">
                        您可以直接在下方表格中微调时间、修改文字或删除单句。修改完成后点击右下角 “保存修改并关闭” 生效。
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const newId = `s-new-${Date.now()}`;
                        const lastSub = editorSubtitles[editorSubtitles.length - 1];
                        const nextStart = lastSub ? parseFloat((lastSub.end + 0.1).toFixed(1)) : 0;
                        const newSubtitles = [
                          ...editorSubtitles,
                          {
                            id: newId,
                            start: nextStart,
                            end: nextStart + 5.0,
                            text: '',
                            translation: ''
                          }
                        ];
                        setEditorSubtitles(newSubtitles);
                        setRawSubtitlePaste(formatSubtitlesToRawText(newSubtitles));
                      }}
                      className="bg-stone-900 hover:bg-stone-800 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
                    >
                      ➕ 新增双语字幕单句
                    </button>
                  </div>

                  <div className="border border-stone-200 rounded-xl overflow-hidden shadow-xs max-h-[400px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-mono text-stone-500 uppercase tracking-wider sticky top-0 z-10">
                          <th className="p-2.5 w-[90px] text-center bg-stone-50">开始时间(s)</th>
                          <th className="p-2.5 w-[90px] text-center bg-stone-50">结束时间(s)</th>
                          <th className="p-2.5 bg-stone-50">英文原文字幕 (English Sentence)</th>
                          <th className="p-2.5 bg-stone-50">中文翻译对照 (Chinese Translation)</th>
                          <th className="p-2.5 w-[60px] text-center bg-stone-50">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-150 text-xs">
                        {editorSubtitles.map((sub, idx) => (
                          <tr key={sub.id || idx} className="hover:bg-stone-50/40">
                            <td className="p-2">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={sub.start}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  const updated = editorSubtitles.map(s => s.id === sub.id ? { ...s, start: isNaN(val) ? 0 : val } : s);
                                  setEditorSubtitles(updated);
                                  setRawSubtitlePaste(formatSubtitlesToRawText(updated));
                                }}
                                className="w-full px-1.5 py-1 bg-white border border-stone-200 rounded-md font-mono text-center text-xs text-stone-850 focus:border-amber-450 focus:outline-hidden"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={sub.end}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  const updated = editorSubtitles.map(s => s.id === sub.id ? { ...s, end: isNaN(val) ? 0 : val } : s);
                                  setEditorSubtitles(updated);
                                  setRawSubtitlePaste(formatSubtitlesToRawText(updated));
                                }}
                                className="w-full px-1.5 py-1 bg-white border border-stone-200 rounded-md font-mono text-center text-xs text-stone-850 focus:border-amber-450 focus:outline-hidden"
                              />
                            </td>
                            <td className="p-2">
                              <textarea
                                rows={2}
                                value={sub.text}
                                onChange={(e) => {
                                  const updated = editorSubtitles.map(s => s.id === sub.id ? { ...s, text: e.target.value } : s);
                                  setEditorSubtitles(updated);
                                  setRawSubtitlePaste(formatSubtitlesToRawText(updated));
                                }}
                                className="w-full px-2 py-1.5 bg-white border border-stone-250 rounded-md text-xs text-stone-850 focus:border-amber-450 focus:outline-hidden resize-y min-h-[50px] leading-relaxed"
                                placeholder="请输入英文单句内容..."
                              />
                            </td>
                            <td className="p-2">
                              <textarea
                                rows={2}
                                value={sub.translation}
                                onChange={(e) => {
                                  const updated = editorSubtitles.map(s => s.id === sub.id ? { ...s, translation: e.target.value } : s);
                                  setEditorSubtitles(updated);
                                  setRawSubtitlePaste(formatSubtitlesToRawText(updated));
                                }}
                                className="w-full px-2 py-1.5 bg-white border border-stone-250 rounded-md text-xs text-stone-850 focus:border-amber-450 focus:outline-hidden resize-y min-h-[50px] leading-relaxed"
                                placeholder="在此输入中文翻译对照..."
                              />
                            </td>
                            <td className="p-2 text-center">
                              <button
                                onClick={() => {
                                  const updated = editorSubtitles.filter(s => s.id !== sub.id);
                                  setEditorSubtitles(updated);
                                  setRawSubtitlePaste(formatSubtitlesToRawText(updated));
                                }}
                                className="p-1.5 hover:bg-red-50 text-stone-400 hover:text-red-500 rounded-lg transition"
                                title="删除这一句"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer Controls */}
            <div className="bg-stone-50 border-t border-stone-200 p-4 flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-stone-400">
                当前待保存条数: <b className="text-stone-700">{editorSubtitles.length}</b> 句字幕
              </span>

              <div className="flex gap-2">
                <button
                  onClick={() => setIsSubtitleEditorOpen(false)}
                  className="px-4 py-2 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-xl text-xs font-bold transition"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveSubtitleEdits}
                  className="px-5 py-2 bg-amber-450 hover:bg-amber-400 text-stone-950 rounded-xl text-xs font-extrabold shadow-sm transition flex items-center gap-1.5"
                >
                  <Check className="h-3.5 w-3.5 text-stone-950" />
                  保存修改并关闭
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 📝 Rename Material Custom Modal */}
      {isRenameModalOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md flex flex-col shadow-2xl border border-stone-200 overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="bg-stone-900 text-white p-4.5 flex items-center justify-between">
              <span className="font-serif font-bold text-sm tracking-wide">✏️ 重命名备考材料</span>
              <button 
                onClick={() => {
                  setIsRenameModalOpen(false);
                  setRenamingMaterialId(null);
                  setRenamingMaterialName('');
                }}
                className="text-stone-400 hover:text-white transition text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={(e) => {
              e.preventDefault();
              handleSaveRenameMaterial();
            }} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-500 block">新材料名称</label>
                <input
                  type="text"
                  autoFocus
                  value={renamingMaterialName}
                  onChange={(e) => setRenamingMaterialName(e.target.value)}
                  placeholder="请输入新的备考材料名称"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-250 rounded-xl text-xs text-stone-900 focus:border-stone-900 focus:outline-hidden leading-relaxed"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsRenameModalOpen(false);
                    setRenamingMaterialId(null);
                    setRenamingMaterialName('');
                  }}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-stone-900 rounded-xl text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!renamingMaterialName.trim()}
                  className="px-5 py-2 bg-amber-450 hover:bg-amber-400 disabled:bg-stone-200 disabled:text-stone-400 text-stone-950 rounded-xl text-xs font-extrabold shadow-xs transition"
                >
                  确认修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
