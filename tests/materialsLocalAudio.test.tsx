import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import MaterialsLibrary from '../src/components/MaterialsLibrary';

test('local audio becomes an uploadable File and subtitles stay on the original video', async () => {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const url = 'https://www.youtube.com/watch?v=h2ou2A_-8JU';
  const material = { id: 'video-test', folderId: 'folder-test', category: 'reading', type: 'link', name: 'Test video', url, content: '', videoSubtitles: [] };
  const saved = new Map([
    ['ielts_material_folders', JSON.stringify([{ id: 'folder-test', name: 'Videos', category: 'reading' }])],
    ['ielts_material_files', JSON.stringify([material])],
  ]);
  const alerts: string[] = [];
  let uploaded: File | undefined;
  let healthTimeout = false;
  let tree: any;
  try {
    install('IS_REACT_ACT_ENVIRONMENT', true);
    install('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
    install('window', { YT: {}, speechSynthesis: { getVoices: () => [] }, setTimeout: (fn: () => void) => setTimeout(fn, 0) });
    install('document', { getElementById: () => null });
    install('alert', (message: string) => alerts.push(message));
    install('fetch', async (input: string, options?: RequestInit) => {
      if (input === 'http://127.0.0.1:18765/health') {
        assert.ok(options?.signal);
        if (healthTimeout) throw new DOMException('Timed out', 'TimeoutError');
        return Response.json({ ok: true });
      }
      if (input === 'http://127.0.0.1:18765/audio') {
        assert.deepEqual(JSON.parse(String(options?.body)), { videoId: 'h2ou2A_-8JU' });
        return new Response(new Blob(['test-audio'], { type: 'audio/webm' }), { headers: { 'Content-Type': 'audio/webm' } });
      }
      if (input === '/api/asr/transcribe-media') {
        assert.ok(options?.body instanceof File);
        uploaded = options.body;
        return Response.json({ jobId: 'test-job' });
      }
      assert.equal(input, '/api/asr/transcribe-media/test-job');
      return Response.json({ status: 'completed', result: { subtitles: [{ start: 0, end: 2, text: 'Hello there.' }] } });
    });
    await act(async () => { tree = create(<MaterialsLibrary vocabulary={[]} onAddCustomWord={() => {}} initialMaterialId="video-test" />); });
    const button = tree.root.findAllByType('button').find((node: any) => node.children.includes('本机快速提取音轨并识别（实验）'));
    assert.ok(button, 'local extraction button is available for the video');
    await act(async () => { await button.props.onClick(); });
    assert.ok(uploaded);
    assert.equal(uploaded.name, 'youtube-audio.webm');
    assert.equal(await uploaded.text(), 'test-audio');
    const result = JSON.parse(saved.get('ielts_material_files')!)[0];
    assert.equal(result.id, material.id);
    assert.equal(result.url, url);
    assert.equal(result.videoSubtitles[0].text, 'Hello there.');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /语音识别完成/);
    healthTimeout = true;
    uploaded = undefined;
    const retry = () => tree.root.findAllByType('button').find((node: any) => node.children.includes('本机快速提取音轨并识别（实验）'));
    await act(async () => { await retry().props.onClick(); });
    assert.equal(uploaded, undefined);
    assert.match(alerts[1], /请求超时/);
    assert.equal(retry().props.disabled, false, 'timeout must release the loading state');
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  }
});
