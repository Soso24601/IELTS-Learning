import React, { useEffect } from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '../lib/language';

export default function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }, [language]);
  return <label className="language-switch inline-flex shrink-0 items-center gap-1 rounded-xl border border-stone-200 bg-white px-2 py-2 text-xs text-stone-600">
    <Languages className="hidden h-4 w-4 sm:block" aria-hidden="true" />
    <select aria-label="界面语言 / Interface language" value={language} onChange={event => setLanguage(event.target.value === 'en' ? 'en' : 'zh')} className="max-w-20 cursor-pointer bg-transparent text-xs outline-none">
      <option value="zh">中文</option><option value="en">English</option>
    </select>
  </label>;
}
