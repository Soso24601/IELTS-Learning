/**
 * 登录 / 注册页。首次登录空账号时，若浏览器里残留旧 ielts_* 数据会自动导入（由主入口处理）。
 */
import React, { useState } from 'react';
import { Brain, LogIn, UserPlus, Lock, AtSign, User, Loader2, Sparkles } from 'lucide-react';
import { apiLogin, apiRegister, friendlyApiError, PublicUser } from '../lib/authApi';
import { countLocalEntries, getLastAccount } from '../lib/localData';

interface Props {
  onAuthed: (user: PublicUser) => void;
}

export default function AuthPage({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const legacyCount = countLocalEntries();
  const hasLegacy = legacyCount > 0 && !getLastAccount();
  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (busy) return;
    if (mode === 'register') {
      if (!username.trim() || username.trim().length < 2) return setError('用户名至少 2 个字符');
      if (password.length < 6) return setError('密码至少 6 位');
      if (password !== password2) return setError('两次输入的密码不一致');
    } else if (!identifier.trim() || !password) {
      return setError('请输入账号与密码');
    }
    setBusy(true);
    try {
      const { user } =
        mode === 'login'
          ? await apiLogin(identifier.trim(), password)
          : await apiRegister(username.trim(), email.trim(), password);
      onAuthed(user);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-300/70 rounded-xl text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400 transition placeholder:text-stone-400';

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-stone-900 text-amber-400 shadow-lg mb-3">
            <Brain className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-stone-900 tracking-tight">IELTS Vocabulary Builder</h1>
          <p className="text-xs font-mono text-stone-400 uppercase tracking-widest mt-1">雅思词汇记背伴侣</p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-6 sm:p-7">
          {/* Mode switch */}
          <div className="flex bg-stone-100 rounded-xl p-1 mb-5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 rounded-lg transition cursor-pointer ${
                mode === 'login' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <LogIn className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              登录
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 py-2 rounded-lg transition cursor-pointer ${
                mode === 'register' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              注册新账号
            </button>
          </div>

          {hasLegacy && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] leading-relaxed text-amber-800">
              <Sparkles className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              检测到本浏览器里有 {legacyCount} 组旧学习数据。注册并登录新账号后，将自动把它们保存到云端（数据不丢失）。
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' ? (
              <>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input className={inputCls} placeholder="用户名（如：ielts_learner）" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="relative">
                  <AtSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input className={inputCls} placeholder="邮箱（可选）" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input type="password" className={inputCls} placeholder="密码（至少 6 位）" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input type="password" className={inputCls} placeholder="再次输入密码" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input className={inputCls} placeholder="用户名或邮箱" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input type="password" className={inputCls} placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            )}

            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
            {info && <div className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">{info}</div>}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? '登录' : '创建账号并登录'}
            </button>
          </form>

          <p className="mt-4 text-[11px] leading-relaxed text-stone-400 text-center">
            数据按账号保存在云端，换设备登录即可继续学习。
            <br />
            AI 功能需在设置中填写你自己的大模型 API Key（如 DeepSeek）。
          </p>
        </div>
      </div>
    </div>
  );
}
