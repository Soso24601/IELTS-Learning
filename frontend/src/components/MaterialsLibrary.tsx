import { SceneArt, domainArt } from './Brand';
import { uiText, useLanguage } from "../lib/language";
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
import { subtitleAtTime } from '../lib/subtitles';
import { IELTSWord, WordCategory, StudyMaterial, MaterialFolder } from '../types';
import { apiGetMaterialCatalog } from '../lib/authApi';
import { CatalogType, catalogType, MATERIAL_TYPES, catalogTopics, filterCatalog, materialDuration, formatDuration } from '../lib/materialCatalog';
import { SCENE_DOMAINS, scenesInDomain, PRACTICE_DIRECTIONS, EXPRESSION_USES, matchesScene } from '../lib/sceneCatalog';
import { apiUrl } from '../lib/apiUrl';
import { apiFetch } from '../lib/apiUrl';

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
  initialSceneFilter?: { domain: string; scene?: string } | null;
  vocabulary: IELTSWord[];
  onAddCustomWord: (wordData: Omit<IELTSWord, 'id' | 'custom'>) => void;
  initialMaterialId?: string | null;
  onClearInitialMaterialId?: () => void;
  initialWord?: string | null;
  onClearInitialWord?: () => void;
}

export default function MaterialsLibrary({ 
  initialSceneFilter,
  vocabulary, 
  onAddCustomWord,
  initialMaterialId,
  onClearInitialMaterialId,
  initialWord,
  onClearInitialWord
}: MaterialsLibraryProps) {
  useLanguage();
  const [materialType, setMaterialType] = useState<CatalogType | 'all'>('all');
  const [materialSearch, setMaterialSearch] = useState('');
  const [previewMaterialId, setPreviewMaterialId] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [learningCategory, setLearningCategory] = useState<WordCategory>('speaking');
  const [selectedDomain, setSelectedDomain] = useState(initialSceneFilter?.domain || '');
  const [selectedScene, setSelectedScene] = useState(initialSceneFilter?.scene || '');
  const [selectedPractice, setSelectedPractice] = useState('');
  const [selectedUse, setSelectedUse] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogReload, setCatalogReload] = useState(0);
  const [mediaPlaybackError, setMediaPlaybackError] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { const ids = JSON.parse(localStorage.getItem('ielts_recent_material_ids') || '[]'); return Array.isArray(ids) ? ids.filter(id => typeof id === 'string').slice(0, 5) : []; } catch { return []; }
  });
  
  // Data State loaded from LocalStorage
  const [folders, setFolders] = useState<MaterialFolder[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  
  // Navigation / Selection State
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  
  // Modal / Inputs State
  
  
  // Study Panel States
  const [notes, setNotes] = useState('');
  const [aiSummary, setAiSummary] = useState<any | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
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

  // Document Text-to-Speech (TTS) Reader States
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [isTtsPaused, setIsTtsPaused] = useState(false);
  const [currentTtsSentenceIndex, setCurrentTtsSentenceIndex] = useState<number | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedTtsVoice, setSelectedTtsVoice] = useState<string>('');

  // Video and Subtitle Study Player States
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
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

  const videoRef = useRef<HTMLMediaElement | null>(null);
  

  const subtitlesContainerRef = useRef<HTMLDivElement | null>(null);
  const [localDictationId, setLocalDictationId] = useState<string | null>(null);
  const [localDictationInput, setLocalDictationInput] = useState<string>('');
  const [localDictationScore, setLocalDictationScore] = useState<number | null>(null);
  const [localDictationChecked, setLocalDictationChecked] = useState<boolean>(false);

  // Subtitle Editor state variables

  // Material rename modal state

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

  const activeCategory: WordCategory = learningCategory;

  useEffect(() => {
    if (!selectedMaterialId) return;
    setRecentIds(previous => {
      const ids = [selectedMaterialId, ...previous.filter(id => id !== selectedMaterialId)].slice(0, 5);
      localStorage.setItem('ielts_recent_material_ids', JSON.stringify(ids));
      return ids;
    });
  }, [selectedMaterialId]);

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
    setMediaPlaybackError('');
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

    // Keep a one-time snapshot for admin migration before any personal-note writes
    // can replace the legacy local material array.
    if (localStorage.getItem('ielts_shared_catalog_loaded') !== 'true') {
      if (!localStorage.getItem('ielts_legacy_material_migration_backup')) {
        const legacyMaterials = localStorage.getItem('ielts_material_files');
        if (legacyMaterials) localStorage.setItem('ielts_legacy_material_migration_backup', legacyMaterials);
      }
      if (!localStorage.getItem('ielts_legacy_folder_migration_backup')) {
        const legacyFolders = localStorage.getItem('ielts_material_folders');
        if (legacyFolders) localStorage.setItem('ielts_legacy_folder_migration_backup', legacyFolders);
      }
    }

    // Learning materials are published by admins and read from the shared server catalog.
    // Browser-local legacy materials are never used as a learner fallback.
    let active = true;
    setCatalogLoading(true); setCatalogError('');
    void apiGetMaterialCatalog().then(catalog => {
      if (!active) return;
      const localMaterials: StudyMaterial[] = (() => {
        try { return JSON.parse(localStorage.getItem('ielts_material_files') || '[]'); } catch { return []; }
      })();
      const byId = new Map(localMaterials.map(material => [material.id, material]));
      const published = catalog.materials.map((material: any) => ({
        ...material,
        notes: byId.get(material.id)?.notes || '',
      })) as StudyMaterial[];
      setMaterials(published);
      localStorage.setItem('ielts_material_files', JSON.stringify(published));
      setFolders(catalog.folders as MaterialFolder[]);
      localStorage.setItem('ielts_material_folders', JSON.stringify(catalog.folders));
      localStorage.setItem('ielts_shared_catalog_loaded', 'true');
    }).catch(error => { if (active) setCatalogError(error.message || '暂时无法读取材料，请重试'); }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [catalogReload]);

  // Handle source word traceback navigation/selection
  useEffect(() => {
    if (initialMaterialId && materials.length > 0) {
      const targetMat = materials.find(m => m.id === initialMaterialId);
      if (targetMat) {
        setSelectedMaterialId(initialMaterialId);
        if (targetMat.folderId) {
          setSelectedFolderId(targetMat.folderId);
        }
        setMaterialType('all'); setMaterialSearch(''); setSelectedTopic('');
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
      const res = await apiFetch('/api/gemini/translate-context', {
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
      const res = await apiFetch('/api/gemini/translate-context', {
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
      const res = await apiFetch('/api/gemini/translate-by-line', {
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
    if (!content) return <span className="text-stone-400 italic">{uiText("暂无内容")}</span>;
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
      
      // Reset dictation progress
      setCurrentSentenceIndex(0);
      setUserDictationInput('');
      setDictationResult(null);
      setIsDictationMode(false);
    } else {
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

  const handleMediaMetadata = () => {
    const duration = videoRef.current?.duration;
    if (!Number.isFinite(duration) || !duration || !selectedMaterialId) return;
    setMaterials(previous => previous.map(material => material.id === selectedMaterialId ? { ...material, duration } : material));
  };

  // Synchronized video timeline tracker
  const handleVideoTimeUpdate = () => {
    if (!videoRef.current) return;
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
      const res = await apiFetch('/api/gemini/translate-context', {
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
            title={uiText("点击划词：AI智能语境翻译并收录")}
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

  // 5. AI Call - Summarize Material
  const handleAISummarize = async () => {
    if (!activeMaterial) return;
    
    setIsSummarizing(true);
    try {
      const res = await apiFetch('/api/gemini/summarize-material', {
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
      topic: activeMaterial?.scene?.primary || activeFolder?.name || '日常表达',
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
    md += `材料类型: ${activeMaterial ? MATERIAL_TYPES.find(type => type.id === catalogType(activeMaterial))?.label : ''} | 导出时间: ${new Date().toLocaleDateString()}\n`;
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
        <p style="font-size: 12px; color: #666;">材料类型: ${activeMaterial ? MATERIAL_TYPES.find(type => type.id === catalogType(activeMaterial))?.label : ''} | 导出时间: ${new Date().toLocaleDateString()}</p>
        
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
          材料类型: ${activeMaterial ? MATERIAL_TYPES.find(type => type.id === catalogType(activeMaterial))?.label : ''} | 导出时间: ${new Date().toLocaleDateString()}
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

  const sceneFilter = { domain: selectedDomain, scene: selectedScene, practice: selectedPractice, use: selectedUse };
  const visibleMaterials = filterCatalog<StudyMaterial>(materials, materialType, materialSearch, selectedTopic, sceneFilter);
  const availableTopics = catalogTopics(materials);
  const topicOptions = selectedTopic && !availableTopics.includes(selectedTopic) ? [...availableTopics, selectedTopic] : availableTopics;
  const recentMaterials = recentIds.flatMap(id => materials.find(material => material.id === id) || []);
  const openMaterial = (material: StudyMaterial) => {
    if (!matchesScene(material.scene, selectedDomain, selectedScene, selectedPractice, selectedUse)) {
      setSelectedDomain(''); setSelectedScene(''); setSelectedPractice(''); setSelectedUse('');
    }
    if (materialType !== 'all' && materialType !== catalogType(material)) setMaterialType(catalogType(material));
    setMaterialSearch('');
    if (selectedTopic && !material.tags?.includes(selectedTopic)) setSelectedTopic('');
    setSelectedMaterialId(material.id);
    setSelectedFolderId(material.folderId || null);
  };

  const previewMaterial = visibleMaterials.find(material => material.id === previewMaterialId) || visibleMaterials[0];

  return (
    <div className="ui-page-stack" id="materials-library-container">
      <header className={`library-heading flex flex-wrap items-end justify-between gap-4 ${activeMaterial ? "is-studying" : ""}`}>
        <div><p className="ui-kicker mb-2">{activeMaterial ? 'IN CONTEXT' : 'SCENE COLLECTION'}</p><h2 className="ui-page-title">{activeMaterial ? uiText('理解原句，留下想用的表达') : uiText('选一段，马上开口。')}</h2><p className="ui-description mt-2">{activeMaterial ? uiText('结合原文学习，划选词汇即可查询与收藏。') : uiText('先选场景，再选一份材料。视频、音频和文章都在这里。')}</p></div>
        {!activeMaterial && <SceneArt kind="book" className="library-heading-art"/>}<span className="library-total text-xs text-stone-500">{materials.length} {uiText("份材料")}</span>
      </header>
      {!activeMaterial && <section aria-label={uiText("生活场景浏览")} className="ui-filter-panel space-y-4">
        <div className="flex items-center justify-between gap-3"><h3 className="ui-section-title">{uiText("选择一个场景")}</h3><button type="button" onClick={() => { setSelectedDomain(''); setSelectedScene(''); setSelectedPractice(''); setSelectedUse(''); setSelectedTopic(''); setMaterialSearch(''); setMaterialType('all'); }} className="shrink-0 text-xs text-stone-500 underline underline-offset-4">{uiText("清除筛选")}</button></div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.2fr]">
          <label className="text-xs font-semibold text-stone-500">{uiText("生活领域")}<select aria-label={uiText("按生活领域筛选")} value={selectedDomain} onChange={event => { setSelectedDomain(event.target.value); setSelectedScene(''); }} className="mt-2 w-full rounded-xl border border-stone-200 bg-[#faf9f6] p-3 text-sm text-stone-800"><option value="">{uiText("全部生活领域")}</option><option value="unclassified">{uiText("其他材料（待分类）")}</option>{SCENE_DOMAINS.map(item => <option key={item.name} value={item.name}>{uiText(item.name)}</option>)}</select></label>
          <label className="text-xs font-semibold text-stone-500">{uiText("具体场景")}<select aria-label={uiText("按具体场景筛选")} value={selectedScene} disabled={!selectedDomain || selectedDomain === 'unclassified'} onChange={event => setSelectedScene(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-200 bg-[#faf9f6] p-3 text-sm text-stone-800 disabled:opacity-50"><option value="">{uiText("全部具体场景")}</option>{scenesInDomain(selectedDomain).map(item => <option key={item} value={item}>{uiText(item)}</option>)}</select></label>
          <label className="text-xs font-semibold text-stone-500">{uiText("搜索材料")}<span className="mt-2 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-3"><Search className="h-4 w-4 shrink-0 text-stone-400"/><input aria-label={uiText("搜索学习材料")} value={materialSearch} onChange={event => setMaterialSearch(event.target.value)} placeholder={uiText("标题、场景或想学的表达")} className="min-w-0 w-full bg-transparent text-sm font-normal outline-none"/></span></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <div className="ui-filter-controls flex flex-wrap gap-1" role="group" aria-label={uiText("材料类型筛选")}>
            {[{id:'all',label:'全部'}, ...MATERIAL_TYPES].map(tab => <button key={tab.id} aria-pressed={materialType === tab.id} onClick={() => setMaterialType(tab.id as CatalogType | 'all')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${materialType === tab.id ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100'}`}>{uiText(tab.label)}<span className="ml-1.5 opacity-50">{filterCatalog(materials, tab.id as CatalogType | 'all', materialSearch, selectedTopic, sceneFilter).length}</span></button>)}
          </div>
          <span className="text-xs text-stone-400">{visibleMaterials.length} {uiText("份匹配材料")}</span>
        </div>
        <details><summary className="cursor-pointer text-xs text-stone-500">{uiText("更多筛选")}{(selectedPractice || selectedUse || selectedTopic) && uiText(' · 已选择')}</summary><div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-stone-500">{uiText("练习方向")}<select aria-label={uiText("按练习方向筛选")} value={selectedPractice} onChange={event => setSelectedPractice(event.target.value)} className="mt-2 w-full rounded-lg border border-stone-200 bg-white p-2.5 text-sm"><option value="">{uiText("全部练习方向")}</option>{PRACTICE_DIRECTIONS.map(item => <option key={item} value={item}>{uiText(item)}</option>)}</select></label>
          <label className="text-xs text-stone-500">{uiText("表达用途")}<select aria-label={uiText("按表达用途筛选")} value={selectedUse} onChange={event => setSelectedUse(event.target.value)} className="mt-2 w-full rounded-lg border border-stone-200 bg-white p-2.5 text-sm"><option value="">{uiText("全部表达用途")}</option>{EXPRESSION_USES.map(item => <option key={item} value={item}>{uiText(item)}</option>)}</select></label>
          {!!topicOptions.length && <label className="text-xs text-stone-500">{uiText("话题")}<select aria-label={uiText("按话题筛选")} value={selectedTopic} onChange={event => setSelectedTopic(event.target.value)} className="mt-2 w-full rounded-lg border border-stone-200 bg-white p-2.5 text-sm"><option value="">{uiText("全部话题")}</option>{topicOptions.map(topic => <option key={topic} value={topic}>{topic}</option>)}</select></label>}
        </div></details>
      </section>}
      {!activeMaterial && !!recentMaterials.length && <section aria-label={uiText("最近学习")} className="flex flex-wrap items-center gap-2"><span className="mr-2 text-xs font-semibold text-stone-500">{uiText("最近学习")}</span>{recentMaterials.slice(0,3).map(material => <button key={material.id} onClick={() => openMaterial(material)} className="max-w-56 truncate rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{material.name}</button>)}</section>}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className={`catalog-browser ${activeMaterial ? "hidden" : "block"} lg:col-span-12`}>
          <div className="catalog-count mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">{uiText("浏览材料")}</h3><span className="text-xs text-stone-400">{visibleMaterials.length} {uiText("份")}</span></div>
          {catalogLoading ? <p role="status" className="py-8 text-center text-sm text-stone-500">{uiText("正在读取材料…")}</p> : catalogError ? <div role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"><p>{catalogError}</p><button onClick={() => setCatalogReload(value => value + 1)} className="mt-3 underline">{uiText("重新读取")}</button></div> : !visibleMaterials.length ? <p className="rounded-2xl border border-dashed border-stone-300 bg-white py-12 text-center text-sm text-stone-500">{materials.length ? uiText('这个场景暂时没有匹配材料，试试其他场景或清除筛选。') : uiText('场景材料正在准备中，发布后会显示在这里。')}</p> : <div className="material-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleMaterials.map(material => {
            const type = catalogType(material);
            const Icon = type === 'video' ? Video : type === 'audio' ? Music : FileText;
            const duration = formatDuration(materialDuration(material));
            let thumbnail = '';
            if (type === 'video' && material.url) { try { const url = new URL(material.url); const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : /(^|\.)youtube\.com$/.test(url.hostname) ? url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] : ''; if (id && /^[\w-]{11}$/.test(id)) thumbnail = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; } catch {} }
            return <button key={material.id} aria-pressed={previewMaterial?.id === material.id} onClick={() => setPreviewMaterialId(material.id)} className="ui-material-card w-full overflow-hidden text-left transition">
              <div className={`material-thumbnail material-kind-${type}`}><span className="material-type-badge"><Icon size={14}/>{uiText(MATERIAL_TYPES.find(item => item.id === type)?.label)}</span>{thumbnail ? <img src={thumbnail} alt="" loading="lazy" className="material-cover"/> : <SceneArt kind={type === "document" ? "book" : domainArt(material.scene?.domain || "")}/>}<span className="material-open-badge">↗</span></div>
              <div className="ui-material-caption"><p className="ui-material-name">{material.name}</p><p className="ui-material-meta mt-2">{uiText(MATERIAL_TYPES.find(item => item.id === type)?.label)}{duration && ` · ${duration}`}{type !== 'document' && ` · ${uiText(material.videoSubtitles?.length ? '有字幕' : '暂无字幕')}`}</p><p className="mt-2 text-[11px] text-amber-800">{material.scene ? `${uiText(material.scene.domain)} · ${uiText(material.scene.primary)}` : uiText('待分类')}</p>{!!material.scene?.practice.length && <p className="mt-1 text-[11px] text-stone-500">{material.scene.practice.map(uiText).join(' · ')}</p>}{!!material.tags?.length && <p className="ui-material-meta mt-2">{material.tags.map(uiText).join(' · ')}</p>}</div>
            </button>;
          })}</div>}
          {!activeMaterial && previewMaterial && !catalogLoading && !catalogError && <section className="material-ticket" aria-label={uiText('素材预览')}><div className="ticket-heading"><span>{uiText('你的练习单')}</span><span>↗</span></div><p className="ui-kicker">READY WHEN YOU ARE</p><h3>{previewMaterial.name}</h3><p className="ticket-meta">{uiText(MATERIAL_TYPES.find(item=>item.id===catalogType(previewMaterial))?.label)}{materialDuration(previewMaterial)>0 && ` · ${formatDuration(materialDuration(previewMaterial))}`}</p><div className="ticket-section"><p>{uiText('这份材料，带你走进')}</p><strong>{uiText(previewMaterial.scene?.primary || '真实英语表达')}</strong><span>{uiText(previewMaterial.scene?.domain || '自由学习')}</span></div>{!!previewMaterial.scene?.practice.length && <div className="ticket-section"><p>{uiText('可以这样练习')}</p>{previewMaterial.scene.practice.map(item=><span className="ticket-practice" key={item}>✓ {uiText(item)}</span>)}</div>}<button className="ui-button ui-button-primary" onClick={()=>openMaterial(previewMaterial)}>{uiText('就学这份材料')} <ChevronRight size={18}/></button><p className="ticket-note">{uiText('进入后可播放、阅读、划词与收藏。')}</p></section>}
        </aside>

        {/* Right Side: Study workspace (Col Span: 8) */}
        <div id="material-study-workspace" className={`lg:col-span-12 flex-col space-y-6 ${activeMaterial ? 'flex' : 'hidden'}`}>
          {activeMaterial && <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={() => setSelectedMaterialId(null)} className="inline-flex items-center gap-2 self-start rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600"><ArrowLeft className="h-3.5 w-3.5" />{uiText("返回场景材料")}</button><label className="flex items-center gap-2 text-xs text-stone-500">{uiText("词汇积累到")}<select aria-label={uiText("词汇积累方向")} value={learningCategory} onChange={event => setLearningCategory(event.target.value as WordCategory)} className="rounded-lg border border-stone-200 bg-white px-3 py-2 font-semibold text-stone-800"><option value="speaking">{uiText("口语表达")}</option><option value="listening">{uiText("听力词汇")}</option><option value="reading">{uiText("阅读词汇")}</option><option value="writing">{uiText("写作表达")}</option></select></label></div>}
          
          {!activeMaterial ? (
            /* Workspace Empty State */
            <div className="bg-white border border-stone-200/80 rounded-2xl p-12 text-center shadow-xs flex flex-col items-center justify-center min-h-[450px]">
              <div className="p-4 bg-stone-50 rounded-full border border-stone-100 text-stone-400 mb-4">
                <FileIcon className="h-8 w-8 text-stone-400" />
              </div>
              <h3 className="font-serif font-bold text-stone-950 text-base">
                {materials.length ? uiText('请先选择一份学习材料') : uiText('管理员尚未发布学习材料')}
              </h3>
              <p className="text-xs text-stone-400 mt-2 max-w-sm leading-relaxed">
                {materials.length ? uiText('从左侧列表选择材料，即可播放视频、跟随字幕学习并查询词汇。') : uiText('学习材料、视频链接和字幕由管理员统一整理并发布；发布后会显示在这里。')}
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
                      {activeMaterial.scene && <div className="mt-2 space-y-1 text-xs leading-5 text-amber-800"><p>{uiText(activeMaterial.scene.domain)} / {uiText(activeMaterial.scene.primary)}</p>{!!activeMaterial.scene.related.length && <p>{uiText("也适用：")}{activeMaterial.scene.related.map(uiText).join(' · ')}</p>}<p>{[...activeMaterial.scene.practice, ...activeMaterial.scene.uses].map(uiText).join(' · ')}</p></div>}
                      <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest mt-0.5 block">
                        {uiText("材料类型:")} {uiText(MATERIAL_TYPES.find(type => type.id === catalogType(activeMaterial))?.label)}
                      </span>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <details className="relative shrink-0"><summary className="cursor-pointer rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-500">{uiText("笔记导出与 AI 工具")}</summary><div className="absolute left-0 z-20 mt-2 flex w-64 max-w-[calc(100vw-4rem)] flex-wrap gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-lg sm:left-auto sm:right-0">
                    {/* Multi-format export group */}
                    <div className="flex items-center gap-1 border border-stone-200 rounded-xl p-0.5 bg-stone-50">
                      <span className="text-[9px] font-mono font-bold text-stone-400 px-1.5 uppercase">{uiText("导出笔记:")}</span>
                      <button
                        onClick={handleExportDocument}
                        className="px-2 py-1 bg-white hover:bg-stone-100 text-stone-850 rounded-lg text-[10px] font-bold shadow-xs border transition flex items-center gap-1"
                        title={uiText("导出 Markdown (.md) 备考文档")}
                      >
                        MD
                      </button>
                      <button
                        onClick={handleExportWord}
                        className="px-2 py-1 bg-white hover:bg-stone-100 text-stone-850 rounded-lg text-[10px] font-bold shadow-xs border transition flex items-center gap-1"
                        title={uiText("导出 Microsoft Word (.doc) 彩色高亮版")}
                      >
                        Word
                      </button>
                      <button
                        onClick={handleExportPDF}
                        className="px-2 py-1 bg-white hover:bg-stone-100 text-stone-850 rounded-lg text-[10px] font-bold shadow-xs border transition flex items-center gap-1"
                        title={uiText("一键生成 / 打印排版 PDF 笔记")}
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
                      {isSummarizing ? uiText('AI 总结中...') : uiText('AI 提炼考点')}
                    </button>
                  </div></details>
                </div>

                {/* Subtitle / Web URL Link */}
                {activeMaterial.url && (
                  <p className="text-xs text-stone-500 font-mono truncate">
                    {uiText("原材料:")} <a href={activeMaterial.url.startsWith('/api/media/') ? apiUrl(activeMaterial.url) : activeMaterial.url} target="_blank" rel="noreferrer" className="text-amber-600 underline hover:text-amber-500">{activeMaterial.url.startsWith('/api/media/') ? uiText('打开已发布的媒体文件') : activeMaterial.url}</a>
                  </p>
                )}
              </div>

              {/* TWO COLUMN WORKSPACE GRID: Content vs Notes/Tools */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Left Column: Material Content Box (Col: 8) */}
                <div className="md:col-span-8 space-y-4">
                  
                  {catalogType(activeMaterial) !== 'document' ? (
                    /* ========================================================= */
                    /* SPECIALIZED BILINGUAL VIDEO & VLOG STUDY SYSTEM           */
                    /* ========================================================= */
                    <div className="space-y-4">
                      
                      {/* Subtitles & Extraction Controller Checker */}
<div className="space-y-4">
                          
                          {/* Video Player Box */}
                          <div className="bg-stone-950 border border-stone-800 rounded-2xl overflow-hidden shadow-md relative group">
                            {catalogType(activeMaterial) === 'audio' ? <audio ref={videoRef as React.RefObject<HTMLAudioElement>} src={activeMaterial.url?.startsWith('/api/media/') ? apiUrl(activeMaterial.url) : activeMaterial.url} crossOrigin={activeMaterial.url?.startsWith('/api/media/') ? 'use-credentials' : undefined} controls onLoadedMetadata={handleMediaMetadata} onTimeUpdate={handleVideoTimeUpdate} onError={() => setMediaPlaybackError('音频暂时无法播放，请刷新或联系管理员检查材料文件。')} className="my-8 w-full px-4" /> : isEmbedUrl(activeMaterial?.url) ? (
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
                                ref={videoRef as React.RefObject<HTMLVideoElement>}
                                src={activeMaterial.url?.startsWith('/api/media/') ? apiUrl(activeMaterial.url) : activeMaterial.url}
                                crossOrigin={activeMaterial.url?.startsWith('/api/media/') ? 'use-credentials' : undefined}
                                onLoadedMetadata={handleMediaMetadata}
                                onTimeUpdate={handleVideoTimeUpdate}
                                onError={() => setMediaPlaybackError('视频暂时无法播放，请联系管理员检查播放链接。')}
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
                                      {isSimulatedPlaying ? uiText('⏸️ 暂停时间同步') : uiText('▶️ 启动时间同步')}
                                    </button>

                                    <span className="text-[10px] text-stone-300 font-mono pl-1.5 border-l border-stone-800">
                                      {uiText("滚动进度:")} <b className="text-amber-400">{videoCurrentTime.toFixed(1)}</b> / {maxSubtitleTime.toFixed(1)} {uiText("秒")}
                                    </span>
                                  </div>

                                  {/* Nudge fine-tuning buttons */}
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] font-mono text-stone-500 uppercase mr-1.5 select-none">{uiText("字幕对齐微调:")}</span>
                                    <button
                                      onClick={() => nudgeTime(-5)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title={uiText("后退5秒")}
                                    >
                                      -5s
                                    </button>
                                    <button
                                      onClick={() => nudgeTime(-1)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title={uiText("后退1秒")}
                                    >
                                      -1s
                                    </button>
                                    <button
                                      onClick={() => nudgeTime(1)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title={uiText("前进1秒")}
                                    >
                                      +1s
                                    </button>
                                    <button
                                      onClick={() => nudgeTime(5)}
                                      className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 rounded text-[10px] font-mono cursor-pointer"
                                      title={uiText("前进5秒")}
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
                              {youtubeSyncStatus === 'ready' ? uiText('字幕已连接视频时间轴；播放或拖动进度时，当前句会高亮。') : youtubeSyncStatus === 'unavailable' ? uiText('未能连接 YouTube 播放器时间轴，暂时无法自动高亮。请刷新页面并确认视频可播放。') : uiText('正在连接 YouTube 播放器时间轴…')}
                            </p>
                          )}

                          {activeMaterial.transcriptionReport && <details className="text-xs text-stone-600 bg-stone-50 rounded-lg p-3">
                            <summary className="cursor-pointer font-semibold">{uiText("完整字幕处理耗时")}</summary>
                            <p className="mt-2 leading-relaxed">{activeMaterial.transcriptionReport}</p>
                          </details>}

                          {mediaPlaybackError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{mediaPlaybackError}</p>}
                          {/* Bilingual Subtitle scrolling viewport */}
                          <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-stone-100 pb-2 flex-wrap">
                              <span className="text-xs font-serif font-bold text-stone-900 flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                                {speakingReadingMode === 'continuous' 
                                  ? uiText('📄 材料完整英文原文 (点击单词可即时译查并收录)')
                                  : uiText('📖 智能中英双语对照字幕 (点击单词可即时译查并收录)')}
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
                                    {isAutoSyncSubtitles ? uiText('🔄 自动定位：开') : uiText('📍 自由滚动：手动')}
                                  </button>
                                )}

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
                                    <span className="text-stone-400 italic">{uiText("暂无内容")}</span>
                                  ) : (
                                    paragraphBlocks.map((block, idx) => (
                                      <p 
                                        key={idx}
                                        onMouseUp={(e) => {
                                          e.stopPropagation();
                                          handleParagraphTextSelection(block.start, e.currentTarget);
                                        }}
                                    className="ui-reading-text text-stone-900 selection:bg-amber-200 cursor-text mb-4"
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
                                    <p className="text-xs font-serif font-bold text-stone-800">{uiText("当前材料暂无双语字幕")}</p>
                                    <p className="text-[11px] text-stone-500 leading-relaxed">
                                      {uiText("管理员尚未发布这份材料的字幕。字幕发布后会显示在这里，并按播放进度自动高亮。")}
                                    </p>
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
                                            title={uiText("🔊 单句朗读")}
                                          >
                                            {uiText("🔊 朗读")}
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
                                            title={uiText("✍️ 精听默写")}
                                          >
                                            {uiText("✍️ 听写")}
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
                                            <span className="text-[10px] font-bold text-stone-700">{uiText("✍️ 视频精听拼写 (IELTS Sentence Dictation):")}</span>
                                            <button
                                              onClick={() => handleSubtitleClick(sub.start, sub.id, true)}
                                              className="text-[9px] text-amber-600 hover:underline"
                                            >
                                              {uiText("🔊 重新听音")}
                                            </button>
                                          </div>
                                          <textarea
                                            placeholder={uiText("写下你听到的英文句子...")}
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
                                              {uiText("提交校验")}
                                            </button>
                                            <button
                                              onClick={() => setLocalDictationId(null)}
                                              className="px-3 py-1 bg-stone-100 text-stone-600 rounded-md text-[10.5px]"
                                            >
                                              {uiText("取消")}
                                            </button>
                                          </div>

                                          {localDictationChecked && localDictationScore !== null && (
                                            <div className="pt-2 border-t border-dashed border-stone-150">
                                              <span className="text-[10.5px] font-bold">
                                                {uiText("拼写正确率:")} <span className={localDictationScore >= 90 ? 'text-green-600 font-mono text-sm' : 'text-amber-600 font-mono text-sm'}>{localDictationScore}%</span>
                                              </span>
                                              <p className="text-[9.5px] text-stone-400 mt-1">
                                                {uiText("原句:")} <b className="font-mono text-stone-600 font-medium">"{sub.text}"</b>
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
                              <summary className="cursor-pointer text-xs font-bold text-stone-700">{uiText("📄 完整英文原文（已去除翻译和音乐标注）")}</summary>
                              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{activeMaterial.content}</p>
                            </details>
                          )}

                        </div>

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
                              <span className="font-semibold text-stone-800">{uiText("AI 原文朗读 / 跟读模式")}</span>
                            </div>
                            
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Voice select */}
                              <select
                                value={selectedTtsVoice}
                                onChange={(e) => setSelectedTtsVoice(e.target.value)}
                                className="p-1 bg-white border border-stone-200 rounded text-[10px] text-stone-600 focus:outline-hidden"
                                title={uiText("选择朗读发音人")}
                              >
                                <option value="">{uiText("默认系统发音")}</option>
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
                                title={uiText("设置阅读语速")}
                              >
                                <option value="0.75">{uiText("0.75x 慢速")}</option>
                                <option value="0.9">{uiText("0.9x 略慢")}</option>
                                <option value="1.0">{uiText("1.0x 标准")}</option>
                                <option value="1.15">{uiText("1.15x 略快")}</option>
                                <option value="1.3">{uiText("1.3x 快速")}</option>
                                <option value="1.5">{uiText("1.5x 挑战")}</option>
                              </select>

                              {/* Play/Pause/Stop triggers */}
                              <div className="flex items-center gap-1">
                                {!isTtsPlaying || isTtsPaused ? (
                                  <button
                                    onClick={handleResumeTts}
                                    className="px-2.5 py-1 bg-stone-950 text-white rounded hover:bg-stone-850 font-bold text-[10px] transition flex items-center gap-0.5 cursor-pointer shadow-xs"
                                  >
                                    <Play className="h-2.5 w-2.5 fill-white" />
                                    {uiText("朗读")}
                                  </button>
                                ) : (
                                  <button
                                    onClick={handlePauseTts}
                                    className="px-2.5 py-1 bg-white border border-stone-200 text-stone-800 rounded hover:bg-stone-50 font-bold text-[10px] transition flex items-center gap-0.5 cursor-pointer shadow-xs"
                                  >
                                    <Pause className="h-2.5 w-2.5 text-stone-700" />
                                    {uiText("暂停")}
                                  </button>
                                )}

                                {isTtsPlaying && (
                                  <button
                                    onClick={handleStopTts}
                                    className="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded hover:bg-rose-100 font-bold text-[10px] transition cursor-pointer"
                                  >
                                    {uiText("停止")}
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
                              <span className="font-semibold text-stone-500 mr-1 shrink-0">{uiText("阅读显示模式:")}</span>
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
                                  {uiText("📄 整段原文(不翻译)")}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (lineTranslationsMap[activeMaterial.id]) {
                                      setReadingMode('paragraph');
                                      setShowLineByLine(false);
                                    } else {
                                      setIsTranslatingByLine(true);
                                      try {
                                        const res = await apiFetch('/api/gemini/translate-by-line', {
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
                                      <span>{uiText("AI 断句翻译中...")}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>{uiText("📖 整段双语对照")}</span>
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
                                        const res = await apiFetch('/api/gemini/translate-by-line', {
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
                                      <span>{uiText("AI 翻译对照中...")}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>{uiText("📑 逐行单句对照")}</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>

                            <div className="text-[10px] text-stone-400">
                              {readingMode === 'sentence' ? (
                                <span className="text-amber-700 font-medium">{uiText("💡 选中单句中任何词句，均可划线高亮或查看 AI 考点释义")}</span>
                              ) : readingMode === 'paragraph' ? (
                                <span className="text-amber-700 font-medium">{uiText("💡 完整展现学术篇章段落结构！双语整段完美对照，选中任何词句均可划线高亮")}</span>
                              ) : (
                                <span className="text-stone-500">{uiText("💡 选中原文任何词句，可随时划线高亮或让 AI 深入释义")}</span>
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
                                <p className="text-xs font-bold text-stone-700">{uiText("AI 正在整理学习内容...")}</p>
                                <p className="text-[11px] text-stone-400">{uiText("整理完成后会在这里显示材料内容。")}</p>
                              </div>
                            </div>
                          ) : isTranslatingByLine ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center space-y-3.5">
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
                              <div className="space-y-1">
                                <p className="text-xs font-bold text-stone-700">{uiText("AI 正在进行智能断句与对照翻译中...")}</p>
                                <p className="text-[11px] text-stone-400">{uiText("我们将对篇章按语意拆分，并生成精准中英双语逐句对照，请耐心稍候")}</p>
                              </div>
                            </div>
                          ) : activeMaterial.type === 'audio' ? (
                            <div className="flex flex-col items-center justify-center py-16 px-6 bg-stone-50 border border-dashed border-stone-200 rounded-2xl text-center space-y-2">
                              <h4 className="text-xs font-bold text-stone-800">{uiText("暂无已发布的音频文字稿")}</h4>
                              <p className="text-[11px] text-stone-500">{uiText("学习文字稿由管理员整理后发布。")}</p>
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
                                          {uiText("段落")} {idx + 1}
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
                                      title={uiText("点击从此句开始朗读")}
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
                                    className="ui-reading-text text-stone-900 selection:bg-amber-200 cursor-text mb-4"
                                  >
                                    {renderAnnotatedText(block.text, getParagraphAnnotations(block.start, block.end))}
                                  </p>
                                ))}
                              </div>
                            )
                          ) : (
                            <p className="text-stone-400 italic py-10 text-center">{uiText("管理员尚未发布这份材料的学习文本。")}</p>
                          )}
                        </div>

                      </div>

                    </div>
                  )}

                </div>

                {/* Right Column: Study Notes, AI Summary and Quick Word Add (Col: 4) */}
                <div className="ui-study-tools md:col-span-4 space-y-2">
                  
                  {/* DYNAMIC ACTIVE SELECTION TOOL PANEL */}
                  {selectionState && (
                    <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-4 shadow-xs space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-amber-200/50 pb-2">
                        <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-amber-600 animate-pulse" />
                          {uiText("已选中文本 (Selected Text)")}
                        </span>
                        <button 
                          onClick={() => setSelectionState(null)} 
                          className="text-stone-400 hover:text-stone-600 text-xs cursor-pointer font-bold"
                        >
                          {uiText("✕ 取消")}
                        </button>
                      </div>
                      <div className="text-xs text-stone-700 bg-white/90 p-2.5 rounded-lg border border-amber-200/40 italic font-mono max-h-24 overflow-y-auto leading-relaxed">
                        "{selectionState.text}"
                      </div>

                      {/* Highlight color block selectors */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-mono text-stone-400 block font-semibold">{uiText("1. 划线/高亮类型:")}</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'yellow')}
                            className="px-2 py-1 bg-yellow-50 hover:bg-yellow-100 border border-yellow-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title={uiText("高亮黄")}
                          >
                            {uiText("🟡 黄高亮")}
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'green')}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title={uiText("高亮绿")}
                          >
                            {uiText("🟢 绿高亮")}
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'blue')}
                            className="px-2 py-1 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title={uiText("高亮蓝")}
                          >
                            {uiText("🔵 蓝高亮")}
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('highlight', 'pink')}
                            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title={uiText("高亮粉")}
                          >
                            {uiText("🔴 粉高亮")}
                          </button>
                          <button
                            onClick={() => handleAddAnnotation('underline')}
                            className="px-2 py-1 bg-white hover:bg-stone-50 border border-stone-300 text-[10px] rounded-lg font-bold flex items-center gap-1 cursor-pointer transition"
                            title={uiText("波浪下划线")}
                          >
                            {uiText("✍️ 划下划线")}
                          </button>
                        </div>
                      </div>

                      {/* AI Translation button */}
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-mono text-stone-400 block font-semibold">{uiText("2. 智能雅思学术语境翻译:")}</span>
                        <button
                          onClick={handleTranslateSelection}
                          disabled={isTranslating}
                          className="w-full py-2 bg-amber-400 hover:bg-amber-300 text-stone-950 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-55"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {isTranslating ? uiText('AI 正在深度释义其多维语境...') : uiText('AI 智能语境学术翻译')}
                        </button>
                      </div>

                      {/* Display context-aware translation card */}
                      {translationResult && (
                        <div className="bg-white border border-amber-200 rounded-xl p-3 text-xs space-y-2.5 animate-fade-in shadow-xs">
                          <div className="flex items-center justify-between border-b border-stone-100 pb-1.5">
                            <span className="font-bold text-stone-900 text-[11px] flex items-center gap-1">
                              {uiText("📖 AI 语境释义与考点")}
                            </span>
                            {translationResult.phonetic && (
                              <span className="text-[9.5px] font-mono text-stone-500 bg-stone-100 px-1 rounded">
                                {translationResult.phonetic} {translationResult.partOfSpeech}
                              </span>
                            )}
                          </div>

                          {/* Contextual spelling correction indicator */}
                          {translationResult.isCorrected && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-2.5 rounded-lg flex flex-col gap-1">
                              <span className="font-bold text-[10.5px] flex items-center gap-1">
                                {uiText("⚠️ 可能的拼写错误")}
                              </span>
                              <p className="text-[10px] leading-normal text-amber-850">
                                {translationResult.correctionExplanation || uiText(`检测到输入可能存在拼写错误。已结合上下文给出标准表达：`)}
                              </p>
                              <div className="text-[9.5px] text-stone-600 font-mono mt-0.5">
                                {uiText("划选原文:")} <span className="line-through text-red-500 font-sans">"{selectionState?.text}"</span> {uiText("➔ 修正后:")} <span className="font-bold text-emerald-700 font-sans">"{translationResult.word}"</span>
                              </div>
                            </div>
                          )}
                          
                          <div>
                            <span className="text-[9px] font-mono text-stone-400 uppercase tracking-wider block font-bold">{uiText("释义 (Translation):")}</span>
                            <p className="text-stone-850 font-semibold text-[11px]">{translationResult.translation}</p>
                          </div>

                          {translationResult.englishDefinition && (
                            <div>
                              <span className="text-[9px] font-mono text-stone-400 uppercase tracking-wider block font-bold">{uiText("英文定义 (English Definition):")}</span>
                              <p className="text-stone-800 font-medium text-[11px] font-mono">{translationResult.englishDefinition}</p>
                            </div>
                          )}
                          
                          {translationResult.contextualExplanation && (
                            <div>
                              <span className="text-[9px] font-mono text-stone-400 uppercase tracking-wider block font-bold">{uiText("学术语境与指代分析 (Contextual Match):")}</span>
                              <p className="text-stone-600 leading-normal text-[10.5px]">{translationResult.contextualExplanation}</p>
                            </div>
                          )}
                          
                          {translationResult.ieltsTips && (
                            <div className="bg-amber-50/60 p-2 rounded-lg border border-amber-200/20">
                              <span className="text-[9px] font-mono text-amber-800 font-bold block">{uiText("💡 雅思备考高分干货:")}</span>
                              <p className="text-stone-600 leading-relaxed text-[10.5px] whitespace-pre-line">{translationResult.ieltsTips}</p>
                            </div>
                          )}
                          
                          {translationResult.example && (
                            <div className="border-t border-dashed pt-2">
                              <span className="text-[9px] font-mono text-stone-400 block font-bold">{uiText("学术原创例句 (IELTS Academic Sample):")}</span>
                              <p className="text-stone-800 italic font-medium font-sans text-[10.5px] leading-normal">"{translationResult.example}"</p>
                              <p className="text-stone-500 text-[10px] mt-0.5">{translationResult.exampleTranslation}</p>
                            </div>
                          )}

                          <div className="pt-1.5 border-t border-stone-100 text-[9px] text-stone-400">
                            {uiText("💡 AI 已将本生词智能载入下方")} <b>{uiText("\"快捷收录生词\"")}</b> {uiText("表单，只需点击最下方")} <b>{uiText("\"一键收录到词本\"")}</b> {uiText("即可快速背诵。")}
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
                          <span>{uiText("📝 批注标注详情 (Annotation Note)")}</span>
                        </span>
                        <button 
                          onClick={() => setSelectedAnnotation(null)} 
                          className="text-stone-400 hover:text-stone-600 text-xs font-bold cursor-pointer"
                        >
                          {uiText("✕ 关闭")}
                        </button>
                      </div>
                      
                      <div className="text-xs text-stone-700 bg-white p-2.5 rounded-lg border border-stone-200 italic font-mono leading-relaxed">
                        "{selectedAnnotation.text}"
                      </div>

                      {/* Custom comments block */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono font-bold text-stone-400 block">{uiText("编辑我的精读批注笔记 (Comments):")}</label>
                        <textarea
                          placeholder={uiText("在此记录你的学练心得、熟词僻义、派生同义词词伙...")}
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
                            {uiText("🗑️ 删除划线/高亮")}
                          </button>
                          <button
                            onClick={handleSaveAnnotationComment}
                            className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-850 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                          >
                            {uiText("保存批注")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Study notes tab card */}
                  <details className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-2">
                    <summary className="cursor-pointer text-xs font-semibold text-stone-600">
                      <Edit3 className="mr-2 inline h-3.5 w-3.5" />
                      {uiText("我的笔记")}
                    </summary>
                    <textarea
                      placeholder={uiText("在这里写下你的高频词伙、特殊语法笔记，内容在退出时也会自动保存...")}
                      rows={5}
                      value={notes}
                      onChange={(e) => handleSaveNotes(e.target.value)}
                      className="w-full p-2.5 bg-stone-50 border border-stone-250 rounded-xl text-xs font-sans focus:outline-hidden focus:border-stone-900 leading-relaxed"
                    />
                  </details>

                  {/* MANUAL SEARCH DICTIONARY CARD */}
                  <details className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs space-y-3">
                    <summary className="cursor-pointer text-xs font-semibold text-stone-600">
                      <Search className="mr-2 inline h-3.5 w-3.5 text-amber-500" />
                      {uiText("查词工具")}
                    </summary>
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleTranslateManualWord(manualSearchWord);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        placeholder={uiText("输入你想查询的任何单词 (e.g. resilient)...")}
                        value={manualSearchWord}
                        onChange={(e) => setManualSearchWord(e.target.value)}
                        className="min-w-0 flex-1 px-3 py-1.5 bg-stone-50 border rounded-lg text-xs font-sans focus:outline-hidden focus:border-amber-500 text-stone-850"
                      />
                      <button
                        type="submit"
                        disabled={isTranslating || !manualSearchWord.trim()}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-xs flex items-center gap-1 cursor-pointer transition disabled:bg-stone-100 disabled:text-stone-400"
                      >
                        {isTranslating ? uiText('查询中...') : uiText('查询')}
                      </button>
                    </form>
                    <p className="text-[10px] text-stone-400 leading-normal">
                      {uiText("输入词汇查询用法；也可以直接在原文中划词。")}
                    </p>
                  </details>

                  {/* QUICK ADD VOCABULARY CARD */}
                  <details open={quickWord ? true : undefined} className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-3">
                    <summary className="cursor-pointer text-xs font-semibold text-stone-600">
                      <Plus className="mr-2 inline h-3.5 w-3.5" />
                      {uiText("收藏词汇")}
                    </summary>

                    <form onSubmit={handleQuickAddWord} className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("生词 Word")}</label>
                          <input
                            type="text"
                            required
                            placeholder={uiText("自动填入或手动输入")}
                            value={quickWord}
                            onChange={(e) => setQuickWord(e.target.value)}
                            className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("音标 Phonetic")}</label>
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
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("词性 POS")}</label>
                          <select
                            value={quickPos}
                            onChange={(e) => setQuickPos(e.target.value)}
                            className="w-full p-1.5 bg-stone-50 border rounded-lg text-xs"
                          >
                            <option value="v.">{uiText("v. 动词")}</option>
                            <option value="n.">{uiText("n. 名词")}</option>
                            <option value="adj.">{uiText("adj. 形容词")}</option>
                            <option value="adv.">{uiText("adv. 副词")}</option>
                            <option value="phrase">{uiText("phrase 词伙")}</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("中文释义 Chinese")}</label>
                          <input
                            type="text"
                            required
                            placeholder={uiText("如: 缓解，减轻")}
                            value={quickChinese}
                            onChange={(e) => setQuickChinese(e.target.value)}
                            className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("英文定义 Definition")}</label>
                        <input
                          type="text"
                          placeholder="English meaning..."
                          value={quickDef}
                          onChange={(e) => setQuickDef(e.target.value)}
                          className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs"
                        />
                      </div>

                      <div>
                          <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("语境例句 Example")}</label>
                        <textarea
                          placeholder="IELTS context example sentence..."
                          rows={1}
                          value={quickExample}
                          onChange={(e) => setQuickExample(e.target.value)}
                          className="w-full px-2 py-1.5 bg-stone-50 border rounded-lg text-xs font-sans"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] font-mono text-stone-400 block uppercase">{uiText("生词记忆笔记 My Notes")}</label>
                        <textarea
                          placeholder={uiText("输入你对该词的记忆法、联想或特别用法笔记...")}
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
                            {uiText("成功加入该模块词书！")}
                          </>
                        ) : uiText('收录生词')}
                      </button>
                    </form>
                  </details>

                  {/* DISPLAY AI KNOWLEDGE POINTS CARD */}
                  {aiSummary && (
                    <div className="bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-4 animate-fade-in">
                      <div className="flex items-center gap-1 text-amber-600 border-b border-stone-100 pb-2">
                        <Sparkles className="h-4 w-4 fill-amber-500 text-amber-500 animate-pulse" />
                        <span className="text-xs font-bold font-sans">{uiText("AI 核心考点总结提炼")}</span>
                      </div>

                      {/* Brief overview */}
                      <p className="text-xs text-stone-600 bg-amber-50/50 p-2.5 rounded-xl leading-relaxed border border-amber-100">
                        <b>{uiText("核心要点:")}</b> {aiSummary.summary}
                      </p>

                      {/* Vocabulary list */}
                      {aiSummary.keyVocabulary && aiSummary.keyVocabulary.length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">{uiText("🌟 高频学术词汇")}</h5>
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
                                          topic: activeMaterial?.scene?.primary || activeFolder?.name || '日常表达',
                                          sourceMaterialId: activeMaterial?.id,
                                          sourceMaterialName: activeMaterial?.name,
                                          sourceSentence: v.example || activeMaterial?.content?.slice(0, 150) + '...'
                                        });
                                        alert(`已将 "${v.word}" 收录到我的词书！`);
                                      }}
                                      className="text-[9px] bg-stone-900 text-white px-1.5 py-0.5 rounded hover:bg-stone-850"
                                    >
                                      {uiText("收录")}
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
                          <h5 className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">{uiText("✍️ 推荐学术句型")}</h5>
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
                          <h5 className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">{uiText("📖 高分词组/词伙搭配")}</h5>
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


    </div>
  );
}
