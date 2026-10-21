import { uiText, useLanguage } from "../lib/language";
/**
 * 登录 / 注册页。首次登录空账号时，若浏览器里残留旧 ielts_* 数据会自动导入（由主入口处理）。
 */
import React, { useState } from 'react';
import { Lock, AtSign, User, Eye, EyeOff, Cloud } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiLogin, apiRegister, friendlyApiError, PublicUser } from '../lib/authApi';
import { countLocalEntries, getLastAccount } from '../lib/localData';
import LanguageSwitch from './LanguageSwitch';
import Brand, { SceneArt } from './Brand';
import WaveSubmitButton from './WaveSubmitButton';
import './AuthPage.css';


interface Props {
  onAuthed: (user: PublicUser) => void;
}

function AuthField({ id, label, icon: Icon, value, onChange, type = 'text', autoComplete, required = true, minLength, invalid = false, children }: {
  id: string; label: string; icon: LucideIcon; value: string; onChange: (value: string) => void;
  type?: string; autoComplete?: string; required?: boolean; minLength?: number; invalid?: boolean; children?: React.ReactNode;
}) {
  return <div className="auth-field"><div className="auth-input" data-filled={!!value} data-invalid={invalid || undefined}>
    <Icon size={19} strokeWidth={1.6} aria-hidden="true"/>
    <div className="auth-input-body"><input id={id} name={id} type={type} value={value} onChange={event=>onChange(event.target.value)} placeholder=" " autoComplete={autoComplete} required={required} minLength={minLength} aria-invalid={invalid} aria-describedby={invalid ? 'auth-error' : undefined}/><label htmlFor={id}>{label}</label></div>{children}
  </div></div>;
}

export default function AuthPage({ onAuthed }: Props) {
  useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<'identifier' | 'password' | 'confirm' | ''>('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const legacyCount = countLocalEntries();
  const hasLegacy = legacyCount > 0 && !getLastAccount();
  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
    setErrorField('');
    setShowPassword(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorField('');
    setInfo('');
    if (busy) return;
    const fail = (message: string, field: 'identifier' | 'password' | 'confirm') => { setError(message); setErrorField(field); };
    if (mode === 'register') {
      if (!username.trim() || username.trim().length < 2) return fail('用户名至少 2 个字符', 'identifier');
      if (password.length < 6) return fail('密码至少 6 位', 'password');
      if (password !== password2) return fail('两次输入的密码不一致', 'confirm');
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

  return <div className="learner-app auth-page">
    <header className="auth-header"><Brand/><LanguageSwitch/></header>
    <main className="auth-layout"><section className="auth-art-panel"><p className="ui-kicker">YOUR VOICE MATTERS</p><h1>{uiText('每一次开口，')}<br/>{uiText('都离自信更近。')}</h1><SceneArt eager/><div className="auth-art-footer"><span>SPEAK TODAY.<br/>A BRIGHTER YOU, TOMORROW.</span><p>{uiText('从真实场景出发，把英语带进生活里。')}</p></div></section>
    <section className="auth-form-panel" aria-label={uiText(mode === 'login' ? '登录账号' : '注册账号')}><div className="auth-form-inner"><p className="ui-kicker">LET’S MAKE IT A HABIT</p><h2>{uiText(mode === 'login' ? '欢迎回来。' : '从这里，开始。')}</h2><p className="ui-description">{uiText(mode === 'login' ? '继续你的英语练习。' : '创建账号，留下每一次积累。')}</p>
      <div className="auth-tabs" role="group" aria-label={uiText('账号操作')}><button type="button" aria-pressed={mode === 'login'} onClick={()=>switchMode('login')}>{uiText('登录')}</button><button type="button" aria-pressed={mode === 'register'} onClick={()=>switchMode('register')}>{uiText('注册新账号')}</button></div>
      {hasLegacy && <p className="auth-notice">{uiText('检测到本浏览器里有')} {legacyCount} {uiText('组旧学习数据。注册并登录新账号后，将自动把它们保存到云端（数据不丢失）。')}</p>}
      <form onSubmit={handleSubmit} className="auth-form">
        <AuthField id="auth-identifier" label={uiText(mode === 'login' ? '用户名或邮箱' : '用户名')} icon={User} value={mode === 'login' ? identifier : username} onChange={mode === 'login' ? setIdentifier : setUsername} autoComplete="username" minLength={mode === 'register' ? 2 : undefined} invalid={errorField === 'identifier'}/>
        {mode === 'register' && <AuthField id="auth-email" label={uiText('邮箱（可选）')} icon={AtSign} value={email} onChange={setEmail} type="email" autoComplete="email" required={false}/>}
        <AuthField id="auth-password" label={uiText(mode === 'login' ? '登录密码' : '设置密码（至少 6 位）')} icon={Lock} value={password} onChange={setPassword} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 6 : undefined} invalid={errorField === 'password'}><button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={uiText(showPassword ? '隐藏密码' : '显示密码')} aria-pressed={showPassword}>{showPassword ? <EyeOff size={19} strokeWidth={1.6}/> : <Eye size={19} strokeWidth={1.6}/>}</button></AuthField>
        {mode === 'register' && <AuthField id="auth-password-confirm" label={uiText('确认密码')} icon={Lock} value={password2} onChange={setPassword2} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} invalid={errorField === 'confirm'}/>}
        {error && <p id="auth-error" role="alert" className="auth-error">{uiText(error)}</p>}
        {info && <p role="status" className="auth-notice">{uiText(info)}</p>}
        <WaveSubmitButton busy={busy} label={uiText(mode === 'login' ? '登录，继续学习' : '创建账号并登录')} busyLabel={uiText('正在连接…')}/>
      </form><p className="auth-switch">{uiText(mode === 'login' ? '还没有账号？' : '已经有账号？')} <button type="button" onClick={()=>switchMode(mode === 'login' ? 'register' : 'login')}>{uiText(mode === 'login' ? '注册新账号 ↗' : '返回登录 ↗')}</button></p><p className="auth-data-note"><Cloud size={16} strokeWidth={1.5} aria-hidden="true"/><span>{uiText('数据按账号保存在云端，换设备登录即可继续学习。')}</span></p>
    </div></section></main><footer className="auth-footer">{uiText('开口 · 每天一点，自然表达。')}</footer>
  </div>;
}
