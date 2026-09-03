/**
 * 根门卫：
 * 1. 启动时询问 /api/auth/me；
 * 2. 未登录 → AuthPage；已登录 → 按规则把云端快照水合到 localStorage 后挂载 App，
 *    并启用 localStorage→云端 同步引擎。
 * 3. 登出 / 切号：先 flush，再卸载 App。
 *
 * 数据隔离要点：切到不同账号时先清空本地 ielts_* 再灌新账号快照，
 * 杜绝上一个账号的残留数据串到当前账号。
 */
import React, { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AuthPage from './components/AuthPage';
import { apiMe, apiSnapshot, PublicUser } from './lib/authApi';
import { clearLocalEntries, countLocalEntries, getLastAccount, setLastAccount, writeLocalEntries } from './lib/localData';
import { disableSync, enableSync, pushLocalAllToServer, setHydrating } from './lib/sync';
import './index.css';

function Splash({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center gap-3 font-sans">
      <div className="w-12 h-12 rounded-2xl bg-stone-900 text-amber-400 flex items-center justify-center animate-pulse">
        <span className="text-xl">🎓</span>
      </div>
      <p className="text-xs text-stone-500">{message}</p>
    </div>
  );
}

function accountKey(u: PublicUser): string {
  return `${u.username}:${u.id}`;
}

function Root() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined); // undefined = 启动中
  const [fatal, setFatal] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const runningRef = useRef(false);
  const authLostRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleAuthLost = () => {
    if (authLostRef.current) return;
    authLostRef.current = true;
    void disableSync(false).then(() => {
      if (!mountedRef.current) return;
      setUser(null);
      authLostRef.current = false;
    });
  };

  /** 登录成功 / me() 已有会话：水合本地 → 挂载 App → 启用同步 →（必要时）自动导入旧数据。 */
  const enter = async (nextUser: PublicUser) => {
    setFatal('');
    try {
      const snap = await apiSnapshot();
      const serverHas = Object.keys(snap.data || {}).length > 0;
      const marker = getLastAccount();
      const ak = accountKey(nextUser);
      const localCount = countLocalEntries();
      // 仅当「云端为空 + 本浏览器有数据 + 之前没用别的账号登录过此浏览器」才把本地当旧数据保留导入
      const importLegacy = !serverHas && localCount > 0 && (marker === null || marker === ak);

      setHydrating(true);
      if (serverHas) {
        clearLocalEntries();
        writeLocalEntries(snap.data);
      } else if (!importLegacy) {
        clearLocalEntries();
      }
      // importLegacy 为真：保留本地原样，稍后整体上推
      setLastAccount(ak);
      setHydrating(false);

      if (!mountedRef.current) return;
      setUser(nextUser);
      enableSync({
        onAuthLost: handleAuthLost,
        onError: (m) => console.warn('[sync] 数据同步提示：', m),
      });
      if (importLegacy) {
        await pushLocalAllToServer((m) => console.warn('[sync]', m));
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      setFatal(e?.message || '启动失败，请检查服务器是否可访问');
      setUser(null);
    }
  };

  const handleLogout = async () => {
    await disableSync(true);
    if (mountedRef.current) setUser(null);
  };

  const bootstrap = async () => {
    setFatal('');
    try {
      const { user: me } = await apiMe();
      if (!mountedRef.current) return;
      if (me) {
        await enter(me);
      } else {
        setUser(null);
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      if (e?.status === 401) {
        setUser(null);
      } else {
        setFatal(e?.message || '无法连接服务器');
      }
    }
  };

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  if (fatal) {
    return (
      <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center gap-3 font-sans">
        <p className="text-sm text-stone-600">⚠️ {fatal}</p>
        <button
          onClick={() => {
            runningRef.current = false;
            setFatal('');
            setRetryTick((t) => t + 1);
          }}
          className="px-4 py-2 bg-stone-900 text-white text-xs rounded-xl cursor-pointer"
        >
          重试
        </button>
      </div>
    );
  }

  if (user === undefined) {
    return <Splash message="正在连接服务器…" />;
  }

  if (user === null) {
    return <AuthPage onAuthed={(u) => void enter(u)} />;
  }

  return (
    <App
      user={user}
      onLogout={() => void handleLogout()}
      onUserChanged={(u) => setUser(u)}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
