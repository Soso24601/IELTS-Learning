import React, { FormEvent, useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, KeyRound, LoaderCircle, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import AdminMaterials from './AdminMaterials';
import { apiLogin, apiLogout, apiMe, PublicUser } from '../lib/authApi';
import { apiUrl } from '../lib/apiUrl';

type Phase = 'checking' | 'guest' | 'admin' | 'denied' | 'offline';

export default function AdminPortal() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiMe().then(({ user: current }) => {
      if (!active) return;
      if (current?.isAdmin) {
        setUser(current);
        setPhase('admin');
      } else if (current) {
        setUser(current);
        setPhase('denied');
      } else {
        setPhase('guest');
      }
    }).catch((reason: any) => {
      if (!active) return;
      if (reason?.status === 401) setPhase('guest');
      else {
        setError(reason?.message || '无法连接材料服务');
        setPhase('offline');
      }
    });
    return () => { active = false; };
  }, []);

  const logout = async () => {
    try { await apiLogout(); } finally {
      setUser(null);
      setPassword('');
      setError('');
      setPhase('guest');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiLogin(identifier.trim(), password);
      setPassword('');
      if (!response.user.isAdmin) {
        await apiLogout();
        setUser(response.user);
        setPhase('denied');
        return;
      }
      setUser(response.user);
      setPhase('admin');
    } catch (reason: any) {
      setError(reason?.message || '登录失败，请检查账号密码');
    } finally { setBusy(false); }
  };

  if (phase === 'checking') {
    return <div className="min-h-screen bg-[#f5f1e8] flex items-center justify-center gap-2 text-sm text-stone-600"><LoaderCircle className="h-4 w-4 animate-spin" />正在检查管理员会话…</div>;
  }

  return (
    <div className="min-h-screen bg-[#f5f1e8] text-stone-900">
      <div className="pointer-events-none fixed inset-0 opacity-[0.22]" style={{ backgroundImage: 'radial-gradient(#b8a98b 0.65px, transparent 0.65px)', backgroundSize: '18px 18px' }} />
      <header className="relative border-b border-stone-300/80 bg-[#fbf9f4]/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-900 text-amber-300"><ShieldCheck className="h-5 w-5" /></div>
            <div><p className="font-serif text-lg font-bold leading-tight">IELTS · 材料工作台</p><p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-stone-500">Administrator access</p></div>
          </div>
          <a href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 transition hover:text-amber-800">学习者网站 <ArrowUpRight className="h-3.5 w-3.5" /></a>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        {phase === 'admin' ? (
          <>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-stone-300 pb-5">
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">内容运营 / CONTENT</p><h1 className="font-serif text-3xl font-bold">材料管理</h1><p className="mt-2 text-sm text-stone-600">发布视频、音频与文章，学习者网站会自动读取已发布内容。</p></div>
              <div className="flex items-center gap-3 rounded-full border border-stone-300 bg-[#fbf9f4] px-3 py-2 text-xs text-stone-600"><span className="h-2 w-2 rounded-full bg-emerald-600" />{user?.username}<button onClick={() => void logout()} className="ml-1 rounded-full p-1.5 transition hover:bg-stone-200" title="退出管理员账号"><LogOut className="h-4 w-4" /></button></div>
            </div>
            <AdminMaterials />
          </>
        ) : phase === 'denied' ? (
          <section className="mx-auto mt-12 max-w-lg rounded-3xl border border-amber-300 bg-[#fbf9f4] p-8 shadow-[0_20px_60px_-40px_rgba(60,45,20,.45)]">
            <ShieldCheck className="h-8 w-8 text-amber-700" /><h1 className="mt-5 font-serif text-2xl font-bold">此账号没有管理员权限</h1><p className="mt-2 text-sm leading-6 text-stone-600">请使用后端环境变量 ADMIN_USERNAME 指定的账号登录。当前账号：{user?.username}</p><button onClick={() => void logout()} className="mt-6 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white">切换账号</button>
          </section>
        ) : phase === 'offline' ? (
          <section className="mx-auto mt-12 max-w-lg rounded-3xl border border-rose-200 bg-[#fbf9f4] p-8"><h1 className="font-serif text-2xl font-bold">暂时无法连接材料服务</h1><p className="mt-3 text-sm text-rose-700">{error === 'Failed to fetch' ? '浏览器未能连接服务，请检查网络后重试。' : error}</p><p className="mt-3 break-all text-xs leading-6 text-stone-500">服务检查地址：{apiUrl('/api/health')}</p><div className="mt-5 flex flex-wrap items-center gap-4"><button onClick={() => window.location.reload()} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white">重新检查</button><a href={apiUrl('/api/health')} target="_blank" rel="noopener noreferrer" className="text-sm text-amber-800 underline">打开服务健康检查</a></div></section>
        ) : (
          <div className="grid min-h-[calc(100vh-9rem)] items-center gap-10 lg:grid-cols-[1.1fr_.9fr]">
            <section className="max-w-xl py-8 lg:py-0">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-800">PRIVATE CONTENT DESK</p>
              <h1 className="mt-5 font-serif text-4xl font-bold leading-tight sm:text-5xl">把好材料，<br /><span className="text-amber-800">送进每一次练习。</span></h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-stone-600">管理员在这里维护视频、音频、文章和时间轴字幕。发布后，学习者可以在独立的网站中观看与练习。</p>
              <div className="mt-10 flex items-center gap-3 border-t border-stone-300 pt-5 text-xs text-stone-500"><BookOpen className="h-4 w-4 text-amber-800" />管理员专用入口 · 学习者页面不提供材料上传</div>
            </section>
            <form onSubmit={submit} className="mx-auto w-full max-w-md rounded-[1.75rem] border border-stone-300 bg-[#fbf9f4] p-7 shadow-[0_24px_70px_-40px_rgba(42,32,18,.5)] sm:p-9">
              <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-900"><KeyRound className="h-5 w-5" /></div>
              <h2 className="font-serif text-2xl font-bold">管理员登录</h2><p className="mt-2 text-xs leading-5 text-stone-500">使用已配置为管理员的账号继续。</p>
              <label className="mt-7 block text-xs font-semibold text-stone-600">用户名或邮箱<input autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-amber-700 focus:ring-2 focus:ring-amber-700/15" placeholder="管理员账号" /></label>
              <label className="mt-4 block text-xs font-semibold text-stone-600">密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-amber-700 focus:ring-2 focus:ring-amber-700/15" placeholder="输入密码" /></label>
              {error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
              <button disabled={busy || !identifier || !password} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}登录工作台</button>
              <p className="mt-5 text-center text-[11px] leading-5 text-stone-400">账号在学习者网站注册，再由后端 ADMIN_USERNAME 授权。</p>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
