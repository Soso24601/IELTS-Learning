import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SCENE_DOMAINS, matchesScene, validateSceneClassification } from '../frontend/src/lib/sceneCatalog';
import { validateSceneClassification as validateBackend } from '../backend/server/lib/sceneCatalog';
import { filterCatalog } from '../frontend/src/lib/materialCatalog';

const scene = { domain: '饮食与做饭', primary: '自己做一顿饭', related: ['睡眠与作息', '挑选和比较商品'], practice: ['经历讲述'], uses: ['讲述经过'] };

test('scene catalogs remain identical across independently deployed services with 72 unique scenes', () => {
  assert.equal(readFileSync('frontend/src/lib/sceneCatalog.ts', 'utf8'), readFileSync('backend/server/lib/sceneCatalog.ts', 'utf8'));
  assert.equal(SCENE_DOMAINS.length, 12);
  assert.equal(new Set(SCENE_DOMAINS.flatMap(item => item.scenes)).size, 72);
});

test('both validators reject tampered fields and preserve legacy materials without classification', () => {
  for (const validate of [validateSceneClassification, validateBackend]) {
    assert.deepEqual(validate(scene), scene);
    assert.equal(validate(undefined), undefined);
    assert.throws(() => validate({ ...scene, domain: '自定义领域' }), /领域/);
    assert.throws(() => validate({ ...scene, primary: '日常通勤' }), /属于/);
    assert.throws(() => validate({ ...scene, related: [...scene.related, '日常通勤'] }), /数量/);
    assert.throws(() => validate({ ...scene, related: [scene.primary] }), /重复/);
    assert.throws(() => validate({ ...scene, uses: ['未知用途'] }), /选项/);
    assert.throws(() => validate({ ...scene, practice: '经历讲述' }), /选项/);
    assert.throws(() => validate([]), /格式/);
  }
});

test('scene filters intersect media, search, legacy topics, practice and expression use including cross-domain associations', () => {
  const materials = [
    { name: 'Cooking vlog', type: 'video', tags: ['日常生活'], scene },
    { name: 'Cooking article', type: 'document', scene: { ...scene, related: [] } },
    { name: 'Legacy lecture', type: 'audio' },
  ];
  assert.equal(matchesScene(scene, '健康与生活习惯', '睡眠与作息'), true);
  assert.equal(matchesScene(scene, '饮食与做饭', '睡眠与作息'), true);
  assert.equal(matchesScene(undefined, '饮食与做饭'), false);
  assert.equal(filterCatalog(materials, 'all').length, 3);
  assert.deepEqual(filterCatalog(materials, 'all', '', '', { domain: 'unclassified' }).map(item => item.name), ['Legacy lecture']);
  assert.deepEqual(filterCatalog(materials, 'video', '做一顿饭', '日常生活', { domain: '健康与生活习惯', scene: '睡眠与作息', practice: '经历讲述', use: '讲述经过' }).map(item => item.name), ['Cooking vlog']);
  assert.equal(filterCatalog(materials, 'all', '', '', { practice: '深入讨论' }).length, 0);
  assert.equal(filterCatalog(materials, 'all', '未知场景').length, 0);
});
