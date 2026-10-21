import { useSyncExternalStore } from 'react';
import { UI_MESSAGES } from './uiMessages';

export type Language = 'zh' | 'en';
// Device preference: deliberately outside ielts_* so account hydration cannot reset it.
export const LANGUAGE_STORAGE_KEY = 'app_ui_language';
let fallbackLanguage: Language = 'zh';
let inMemoryOverride: Language | null = null;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  if (inMemoryOverride) return inMemoryOverride;
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === 'en' ? 'en' : saved === 'zh' ? 'zh' : fallbackLanguage;
  } catch { return fallbackLanguage; }
}

function notifyLanguage() {
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
  listeners.forEach(listener => listener());
}

export function setLanguage(language: Language) {
  fallbackLanguage = language;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); inMemoryOverride = null; }
  catch { inMemoryOverride = language; }
  notifyLanguage();
}

function subscribe(listener: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) { inMemoryOverride = null; notifyLanguage(); } };
  listeners.add(listener);
  if (typeof window !== 'undefined') window.addEventListener?.('storage', changed);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener?.('storage', changed);
  };
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(UI_MESSAGES).filter(([key]) => /\{\d+\}/.test(key)).map(([key, english]) => ({
  pattern: new RegExp('^' + key.split(/\{\d+\}/).map(escapeRegex).join('(.+?)') + '$'), english,
}));

export function translateUI(source: string, language: Language): string {
  if (language === 'zh' || !source || !/[\u3400-\u9fff]/.test(source)) return source;
  const normalized = source.trim().replace(/\s+/g, ' ');
  const exact = UI_MESSAGES[normalized];
  if (exact) return exact;
  for (const { pattern, english } of templates) {
    const match = normalized.match(pattern);
    if (match) return english.replace(/\{(\d+)\}/g, (_token, index) => match[Number(index) + 1] || '');
  }
  return source;
}

/** For interface text only. Never pass learning transcripts, user notes or dictionary content. */
export function uiText(source: string): string {
  return translateUI(source, getLanguage());
}

export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getLanguage, () => 'zh' as Language);
  return { language, setLanguage, t: uiText };
}
