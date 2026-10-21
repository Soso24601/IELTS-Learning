import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import Dashboard from '../frontend/src/components/Dashboard';

test('learning home resumes a real recent material and passes scene selection to the library', async () => {
  const oldFetch = globalThis.fetch;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '["removed","recent"]' } });
  const materials = [
    { id: 'first', name: 'Cooking', type: 'document', scene: { domain: '饮食与做饭', primary: '自己做一顿饭', related: [], practice: [], uses: [] } },
    { id: 'recent', name: 'Journey', type: 'document', scene: { domain: '出行与旅行', primary: '日常通勤', related: [], practice: ['日常问答'], uses: [] } },
    { id: 'hidden', name: 'Hidden', type: 'document', isPublished: false },
  ];
  globalThis.fetch = async () => Response.json({ materials });
  let tree: any;
  let opened = '', domain = '', navigation = '';
  try {
    await act(async () => { tree = create(<Dashboard vocabulary={[]} progress={{}} stats={[]} dailyGoal={15} streak={0} onNavigate={value => navigation = value} onOpenMaterial={id => opened = id} onBrowseScene={value => domain = value} />); });
    assert.ok(tree.root.findAllByType('h2').some((node: any) => node.children.includes('日常通勤')));
    await act(async () => tree.root.findByProps({ id: 'btn-start-scene' }).props.onClick());
    assert.equal(opened, 'recent');
    const sceneButtons = tree.root.findByProps({ 'aria-label': '场景学习入口' }).findAllByType('button');
    await act(async () => sceneButtons.find((button: any) => button.findAllByType('h3').some((node: any) => node.children.includes('饮食与做饭'))).props.onClick());
    assert.equal(domain, '饮食与做饭');
    await act(async () => tree.root.findByProps({ id: 'btn-quick-learn' }).props.onClick());
    assert.equal(navigation, 'flashcards');
    assert.equal(tree.root.findAllByProps({ id: 'btn-quick-ai' }).length, 0);
  } finally {
    if (tree) await act(async () => tree.unmount());
    globalThis.fetch = oldFetch;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  }
});

test('home distinguishes a catalog failure from an empty collection and retries safely', async () => {
  const oldFetch = globalThis.fetch;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  const oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let fail = true, destination = '';
  globalThis.fetch = async () => fail ? Response.json({ error: '材料服务暂不可用' }, { status: 503 }) : Response.json({ materials: [] });
  let tree: any;
  try {
    await act(async () => { tree = create(<Dashboard vocabulary={[]} progress={{}} stats={[]} dailyGoal={0} streak={0} onNavigate={value => destination = value} />); });
    assert.equal(tree.root.findByProps({ id: 'btn-start-scene' }).props.disabled, true);
    assert.ok(tree.root.findByProps({ role: 'alert' }));
    fail = false;
    await act(async () => tree.root.findAllByType('button').find((button: any) => button.children.includes('重新读取')).props.onClick());
    assert.equal(tree.root.findByProps({ id: 'btn-start-scene' }).props.disabled, false);
    await act(async () => tree.root.findByProps({ id: 'btn-start-scene' }).props.onClick());
    assert.equal(destination, 'materials');
    assert.ok(tree.root.findAllByType('p').some((node: any) => node.children.includes('材料待更新')));
  } finally {
    if (tree) await act(async () => tree.unmount());
    globalThis.fetch = oldFetch;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
  }
});
