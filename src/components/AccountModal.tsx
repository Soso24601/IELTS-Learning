/**
 * 账号与设置弹窗：账号信息 / AI 大模型(每用户自带 Key) / 每日目标 / 数据备份迁移。
 * 打开时通过 gear（学习设置）图标进入。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  User as UserIcon,
  Eye,
  EyeOff,
  Target,
  Database,
  LogOut,
  Loader2,
  CheckCircle2,
  Download,
  Upload,
  Sparkles,
  Bot,
  Save,
  PlugZap,
} from 'lucide-react';
import {
  apiGetLLM,
  apiImport,
  apiSaveLLM,
  apiSnapshot,
  apiTestLLM,
  friendlyApiError,
  LLMSummary,
  PublicUser,
} from '../lib/authApi';
import { LLM_PROVIDERS, LLMProvider, metaOf } from '../lib/llmPresets';
import { listLocalEntries, writeLocalEntries } from '../lib/localData';

interface Props {
  open: boolean;
  onClose: () => void;
  user: PublicUser;
  dailyGoal: number;
  onSaveGoal: (goal: number) => void;
  onLogout: () => void;
  onUserChanged: (u: PublicUser) => void;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-stone-200 rounded-2xl p-4">
      <h3 className="flex items-center gap-2 text-sm font-serif font-bold text-stone-800 mb-3">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputCls =
  'w-full px-3 py-2 bg-stone-50 border border-stone-300/70 rounded-lg text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400/50 placeholder:text-stone-400';

export default function AccountModal({ open, onClose, user, dailyGoal, onSaveGoal, onLogout, onUserChanged }: Props) {
  const [goal, setGoal] = useState(dailyGoal);
  const [provider, setProvider] = useState<LLMProvider>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LLMSummary | null>(null);

  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [importCandidates, setImportCandidates] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setGoal(dailyGoal);
    setMsg(null);
    setImportCandidates(0);
    // 读取已保存的 LLM 概要，预填 provider/model/baseUrl（不含 Key）
    apiGetLLM()
      .then((s) => {
        setLlmStatus(s);
        if (s.provider) {
          setProvider(s.provider as LLMProvider);
          setModel(s.model || metaOf(s.provider as LLMProvider).defaultModel);
          setBaseUrl(s.baseUrl || metaOf(s.provider as LLMProvider).defaultBaseUrl);
        } else {
          setProvider('deepseek');
          setModel(metaOf('deepseek').defaultModel);
          setBaseUrl(metaOf('deepseek').defaultBaseUrl);
        }
      })
      .catch(() => {});
    // 计算可导入的本地旧数据数量
    apiSnapshot()
      .then((snap) => {
        const serverKeys = new Set(Object.keys(snap.data));
        const local = listLocalEntries();
        const cand = Object.keys(local).filter((k) => !serverKeys.has(k)).length;
        setImportCandidates(cand);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chooseProvider = (p: LLMProvider) => {
    setProvider(p);
    const m = metaOf(p);
    setModel(m.defaultModel || model);
    setBaseUrl(m.defaultBaseUrl || baseUrl);
  };

  const currentCfg = () => ({
    provider,
    apiKey,
    baseUrl: baseUrl.trim() || metaOf(provider).defaultBaseUrl,
    model: model.trim() || metaOf(provider).defaultModel,
  });

  const flash = (kind: 'ok' | 'err', text: string) => setMsg({ kind, text });

  const handleTest = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const res = await apiTestLLM(currentCfg());
      flash('ok', res.reply?.slice(0, 80) ? `连接成功，模型回复：${res.reply.slice(0, 80)}` : '连接成功 ✔');
    } catch (e) {
      flash('err', friendlyApiError(e));
    } finally {
      setBusy('');
    }
  };

  const handleSave = async () => {
    setBusy('save');
    setMsg(null);
    try {
      const res = await apiSaveLLM(currentCfg());
      setLlmStatus({
        configured: true,
        provider,
        model: currentCfg().model,
        baseUrl: currentCfg().baseUrl,
      });
      setApiKey(''); // 避免回显
      flash('ok', '已保存。之后所有 AI 功能都会使用你填写的模型。');
      onUserChanged(res.user);
    } catch (e) {
      flash('err', friendlyApiError(e));
    } finally {
      setBusy('');
    }
  };

  const handleImportLocal = async () => {
    if (importCandidates === 0) return;
    setBusy('importLocal');
    setMsg(null);
    try {
      const local = listLocalEntries();
      const snap = await apiSnapshot();
      const serverKeys = new Set(Object.keys(snap.data));
      const subset: Record<string, string> = {};
      for (const [k, v] of Object.entries(local)) if (!serverKeys.has(k)) subset[k] = v;
      const res = await apiImport(subset);
      flash('ok', `已把 ${res.imported} 组本地数据并入云端。`);
      setImportCandidates(0);
    } catch (e) {
      flash('err', friendlyApiError(e));
    } finally {
      setBusy('');
    }
  };

  const handleExport = () => {
    const entries = listLocalEntries();
    if (Object.keys(entries).length === 0) {
      flash('err', '当前没有可导出的数据');
      return;
    }
    const blob = new Blob([JSON.stringify({ app: 'ielts-vocabulary-builder', version: 1, exportedAt: new Date().toISOString(), data: entries }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ielts-backup-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportFile = async (file: File) => {
    setBusy('importFile');
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const entries: Record<string, string> = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(entries)) {
        if (!k.startsWith('ielts_')) continue;
        cleaned[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      if (Object.keys(cleaned).length === 0) {
        flash('err', '备份文件里没有可识别的 ielts_ 数据');
        return;
      }
      await apiImport(cleaned); // 写入云端
      writeLocalEntries(cleaned); // 同步刷新当前浏览器数据（后续写入会自动再上传，幂等）
      flash('ok', `已恢复 ${Object.keys(cleaned).length} 组备份数据。`);
      setImportCandidates(0);
    } catch (e) {
      flash('err', '备份文件解析失败：' + friendlyApiError(e));
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (!open) return null; // 未打开时不再渲染，保证弹窗可正常关闭

  const modalInput = inputCls;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-6 max-h-[90vh] overflow-y-auto border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-stone-400" />
            账号与设置
          </h3>
          <button onClick={onClose} className="p-1 bg-stone-100 hover:bg-stone-200 rounded-lg text-stone-500 transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* 1. 账号 */}
          <Section icon={<UserIcon className="w-3.5 h-3.5 text-amber-500" />} title="我的账号">
            <div className="flex items-center justify-between text-xs">
              <div>
                <div className="font-semibold text-stone-800">@{user.username}</div>
                <div className="text-stone-400 mt-0.5">{user.email || '未绑定邮箱'}</div>
              </div>
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                退出登录
              </button>
            </div>
          </Section>

          {/* 2. AI 大模型 */}
          <Section
            icon={
              llmStatus?.configured ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Bot className="w-3.5 h-3.5 text-amber-500" />
              )
            }
            title={`AI 大模型${llmStatus?.configured ? '（已配置 ✔）' : ''}`}
          >
            <div className="space-y-2.5">
              <p className="text-[11px] leading-relaxed text-stone-500">
                在这里填写<b>你自己的</b> API Key，AI 助教、翻译、总结等功能即为你所用（费用记在你自己账号上）。
                DeepSeek 在 <span className="text-stone-700">platform.deepseek.com</span> 申请，充几块钱就能用很久。
              </p>

              <div>
                <label className="text-[11px] font-mono text-stone-500 block mb-1">选择模型</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {LLM_PROVIDERS.map((p) => (
                    <button
                      key={p.provider}
                      onClick={() => chooseProvider(p.provider)}
                      className={`px-3 py-2 rounded-xl border text-xs font-medium transition cursor-pointer text-left ${
                        provider === p.provider
                          ? 'border-amber-400 bg-amber-50 text-amber-900'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <span className="block font-semibold">{p.label}</span>
                      <span className="block text-[10px] font-normal mt-0.5 opacity-70">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-stone-500 block mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className={`${modalInput} pr-9`}
                    placeholder={llmStatus?.configured ? '已保存（留空则沿用）' : metaOf(provider).keyPlaceholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {provider === 'openai' && (
                <div>
                  <label className="text-[11px] font-mono text-stone-500 block mb-1">Base URL（自定义接口）</label>
                  <input className={modalInput} placeholder="https://api.moonshot.cn/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                </div>
              )}
              {provider === 'deepseek' && baseUrl === '' && (
                <p className="text-[10px] text-stone-400">接口地址：https://api.deepseek.com/v1</p>
              )}

              <div>
                <label className="text-[11px] font-mono text-stone-500 block mb-1">模型名</label>
                <input
                  className={modalInput}
                  placeholder={provider === 'deepseek' ? 'deepseek-chat' : '模型名，如 kimi-k2 / qwen-max'}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleTest}
                  disabled={busy === 'test' || busy === 'save'}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 transition cursor-pointer disabled:opacity-60"
                >
                  {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5 text-amber-500" />}
                  测试连接
                </button>
                <button
                  onClick={handleSave}
                  disabled={busy === 'test' || busy === 'save'}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-stone-900 text-white text-xs font-medium hover:bg-stone-800 transition cursor-pointer disabled:opacity-60"
                >
                  {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  保存配置
                </button>
              </div>
            </div>
          </Section>

          {/* 3. 学习目标 */}
          <Section icon={<Target className="w-3.5 h-3.5 text-amber-500" />} title="学习目标">
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min={5}
                max={100}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                className={modalInput}
              />
              <span className="text-stone-500 text-xs whitespace-nowrap">词 / 天</span>
              <button
                onClick={() => {
                  onSaveGoal(goal);
                  flash('ok', '每日目标已更新');
                }}
                className="px-3 py-2 bg-stone-900 text-white text-xs font-medium rounded-lg hover:bg-stone-800 transition cursor-pointer"
              >
                保存
              </button>
            </div>
            <p className="text-[10px] text-stone-400 mt-1.5 leading-relaxed">
              雅思官方推荐每日复习 15–30 词，高频低扰复习更能巩固记忆。
            </p>
          </Section>

          {/* 4. 数据 */}
          <Section icon={<Database className="w-3.5 h-3.5 text-amber-500" />} title="数据迁移与备份">
            <div className="space-y-2">
              {importCandidates > 0 ? (
                <button
                  onClick={handleImportLocal}
                  disabled={busy === 'importLocal'}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-medium hover:bg-amber-100 transition cursor-pointer disabled:opacity-60"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    把本浏览器的 {importCandidates} 组旧数据并入本账号
                  </span>
                  {busy === 'importLocal' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                </button>
              ) : (
                <p className="text-[11px] text-stone-400 px-1">本浏览器没有待并入的旧数据（词书 / 进度 / 材料均已在云端）。</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出备份
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 transition cursor-pointer"
                >
                  {busy === 'importFile' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  从备份恢复
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && void handleImportFile(e.target.files[0])}
                />
              </div>
              <p className="text-[10px] text-stone-400 px-1 leading-relaxed">
                共享学习材料由管理员管理；此备份包含你的个人笔记、词汇和学习进度。
              </p>
            </div>
          </Section>

          {msg && (
            <div
              className={`px-3 py-2 rounded-xl text-xs border ${
                msg.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'
              }`}
            >
              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
