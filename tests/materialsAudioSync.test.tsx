import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import MaterialsLibrary from '../frontend/src/components/MaterialsLibrary';

test('audio published without a folder plays with timed subtitles and appears in type filters', async () => {
  const old = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); };
  const material = { id: 'audio', category: 'speaking', type: 'audio', name: 'Science lecture', url: 'https://example.com/lesson.mp3', content: 'First. Second.', tags: ['科技'], videoSubtitles: [
    { id: 'a', start: 1, end: 3, text: 'First.', translation: '' },
    { id: 'b', start: 4, end: 6, text: 'Second.', translation: '' },
  ] };
  const values = new Map<string,string>();
  const audio = { currentTime: 0 };
  let tree: any;
  try {
    set('IS_REACT_ACT_ENVIRONMENT', true);
    set('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    set('window', { speechSynthesis: { getVoices: () => [] } });
    set('document', { getElementById: () => null });
    set('fetch', async () => Response.json({ folders: [], materials: [material] }));
    await act(async () => { tree = create(<MaterialsLibrary vocabulary={[]} onAddCustomWord={() => {}} initialMaterialId="audio" />, { createNodeMock: node => node.type === 'audio' ? audio : null }); });
    assert.equal(tree.root.findByType('audio').props.src, material.url);
    audio.currentTime = 1.5;
    await act(async () => tree.root.findByType('audio').props.onTimeUpdate());
    assert.match(tree.root.findByProps({id:'sub-a'}).props.className, /border-amber-500/);
    audio.currentTime = 4.5;
    await act(async () => tree.root.findByType('audio').props.onTimeUpdate());
    assert.match(tree.root.findByProps({id:'sub-b'}).props.className, /border-amber-500/);
    assert.doesNotMatch(tree.root.findByProps({id:'sub-a'}).props.className, /border-amber-500/);
    assert.deepEqual(JSON.parse(values.get('ielts_recent_material_ids')!), ['audio']);
    await act(async () => tree.root.findByProps({'aria-label':'搜索学习材料'}).props.onChange({target:{value:'科技'}}));
    assert.ok(tree.root.findAllByType('p').some((node: any) => node.children.includes('Science lecture')));
  } finally {
    if (tree) await act(async () => tree.unmount());
    for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
  }
});
