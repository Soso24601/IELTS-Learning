import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import AdminMaterials from '../frontend/src/components/AdminMaterials';

test('admin preview blocks bad rows and failed publishes keep the draft for retry', async () => {
  const previousFetch = globalThis.fetch;
  const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let saved: any = null;
  let fail = false;
  let writes = 0;
  globalThis.fetch = async (input: any, init: any) => {
    if (String(input) === '/api/admin/materials' && init?.method !== 'PUT') return Response.json({ folders: [], materials: saved ? [saved] : [] });
    if (String(input) === '/api/admin/materials') {
      writes++;
      if (fail) return Response.json({ error: '测试保存失败' }, { status: 500 });
      saved = JSON.parse(init.body).material;
    }
    return Response.json({ ok: true });
  };
  let tree: any;
  try {
    await act(async () => { tree = create(<AdminMaterials />); });
    const change = async (node: any, value: string) => act(async () => node.props.onChange({ target: { value } }));
    const submit = async () => act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await change(tree.root.findByProps({ placeholder: '例如：Nanotechnology and Its Applications' }), 'Lesson');
    await change(tree.root.findByType('select'), 'document');
    await act(async () => tree.root.findAllByType('label').find((node: any) => node.children.includes('科技')).findByType('input').props.onChange({ target: { checked: true } }));
    await change(tree.root.findAllByType('textarea')[0], '[0-2] Hello.\nbad row');
    await submit();
    await submit();
    assert.equal(writes, 0);
    assert.ok(tree.root.findAllByProps({ role: 'alert' }).length);
    await change(tree.root.findAllByType('textarea')[0], '[0-2] >> Hello [music]. | 你好\n[2-4] [music]\n[4-6] Welcome back.');
    fail = true;
    await submit();
    assert.match(tree.root.findAllByType('textarea')[0].props.value, /Welcome back/);
    assert.equal(saved, null);
    fail = false;
    await submit();
    assert.equal(saved.content, 'Hello. Welcome back.');
    assert.equal(saved.videoSubtitles.length, 2);
    assert.deepEqual(saved.tags, ['科技']);
    assert.equal(tree.root.findAllByType('textarea')[0].props.value, '');
    assert.ok(tree.root.findAllByProps({ role: 'status' }).some((node: any) => node.children.join('').includes('已发布')));
    await act(async () => tree.root.findAllByType('button').find((node: any) => node.children.join('') === '下架').props.onClick());
    assert.equal(saved.isPublished, false);
    assert.ok(tree.root.findAllByType('button').some((node: any) => node.children.join('') === '上架'));
  } finally {
    if (tree) await act(async () => tree.unmount());
    globalThis.fetch = previousFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
