import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { getLanguage, setLanguage, translateUI, LANGUAGE_STORAGE_KEY } from '../frontend/src/lib/language';
import LanguageSwitch from '../frontend/src/components/LanguageSwitch';
import { clearLocalEntries } from '../frontend/src/lib/localData';

test('language preference updates mounted controls, survives account cleanup and handles blocked storage', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  const entries = new Map<string, string>();
  let blocked = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { if (blocked) throw new Error('Quota'); entries.set(key, value); },
    removeItem: (key: string) => entries.delete(key),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  } });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: any;
  try {
    setLanguage('zh');
    await act(async () => { tree = create(<><LanguageSwitch /><LanguageSwitch /></>); });
    await act(async () => tree.root.findAllByType('select')[0].props.onChange({ target: { value: 'en' } }));
    assert.equal(getLanguage(), 'en');
    assert.ok(tree.root.findAllByType('select').every((node: any) => node.props.value === 'en'));
    entries.set('ielts_vocab_progress', '{}');
    clearLocalEntries();
    assert.equal(entries.get(LANGUAGE_STORAGE_KEY), 'en');
    assert.equal(entries.has('ielts_vocab_progress'), false);
    blocked = true;
    await act(async () => setLanguage('zh'));
    assert.equal(getLanguage(), 'zh');
    assert.ok(tree.root.findAllByType('select').every((node: any) => node.props.value === 'zh'));
  } finally {
    if (tree) await act(async () => tree.unmount());
    blocked = false;
    setLanguage('zh');
    if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete (globalThis as any).localStorage;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  }
});

test('UI translation covers fixed scenes and dynamic counts without rewriting arbitrary learning content', () => {
  assert.equal(translateUI('今日口语', 'en'), 'Speaking today');
  assert.equal(translateUI('饮食与做饭', 'en'), 'Food & cooking');
  assert.equal(translateUI('自己做一顿饭', 'en'), 'Cooking a meal');
  assert.equal(translateUI('3 份可学材料', 'en'), '3 materials available');
  assert.equal(translateUI('已收集 12 条词汇，回到来源再看一次用法。', 'en'), '12 words collected. Revisit their original context.');
  assert.equal(translateUI('有 2 项更改正在等待同步，请暂时保留本机数据。', 'en'), '2 changes are waiting to sync. Keep your local data for now.');
  assert.equal(translateUI('My personal example.', 'en'), 'My personal example.');
  assert.equal(translateUI('我的个人笔记，保持原样。', 'en'), '我的个人笔记，保持原样。');
  assert.equal(translateUI('自己做一顿饭', 'zh'), '自己做一顿饭');
});
