import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import MaterialsLibrary from '../src/components/MaterialsLibrary';

test('YouTube playback time highlights the matching imported cue after seeking', async () => {
  const old = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const material = { id: 'video', folderId: 'folder', category: 'reading', type: 'link', name: 'Video', url: 'https://www.youtube.com/watch?v=h2ou2A_-8JU', content: '', videoSubtitles: [
    { id: 'first', start: 1, end: 3, text: 'First.', translation: '第一句。' },
    { id: 'second', start: 4, end: 6, text: 'Second.', translation: '第二句。' },
  ] };
  const values = new Map([
    ['ielts_material_folders', JSON.stringify([{ id: 'folder', name: 'Videos', category: 'reading' }])],
    ['ielts_material_files', JSON.stringify([material])],
  ]);
  let mediaTime = 0;
  let tree: any;
  try {
    set('IS_REACT_ACT_ENVIRONMENT', true);
    set('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    set('window', { location: { origin: 'https://ielts.grincaq.info' }, speechSynthesis: { getVoices: () => [] }, YT: { Player: class {
      constructor(_id: string, options: any) { setTimeout(() => options.events.onReady(), 0); }
      getCurrentTime() { return mediaTime; }
    } } });
    set('document', { getElementById: () => ({}) });
    await act(async () => { tree = create(<MaterialsLibrary vocabulary={[]} onAddCustomWord={() => {}} initialMaterialId="video" />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1150)); });
    assert.ok(tree.root.findAllByProps({ role: 'status' }).some((node: any) => node.children.join('').includes('字幕已连接视频时间轴')));
    const card = (id: string) => tree.root.findByProps({ id: `sub-${id}` });
    mediaTime = 1.5;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    assert.match(card('first').props.className, /border-amber-500/);
    mediaTime = 4.5;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    assert.match(card('second').props.className, /border-amber-500/);
    assert.doesNotMatch(card('first').props.className, /border-amber-500/);
  } finally {
    if (tree) await act(async () => tree.unmount());
    for (const [key, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
