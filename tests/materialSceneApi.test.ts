import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';

test('admin material routes validate scenes, persist them, expose them to learners and preserve legacy records', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ielts-scene-test-'));
  const oldDirectory = process.env.DATA_DIR;
  const oldAdmin = process.env.ADMIN_USERNAME;
  process.env.DATA_DIR = directory;
  process.env.ADMIN_USERNAME = 'scene-admin';
  const storage = await import('../backend/server/lib/db');
  try {
    const { installUserSystem } = await import('../backend/server/lib/routes');
    const admin = storage.insertUser({ username: 'scene-admin', email: null, passSalt: 'test', passHash: 'test' });
    const learner = storage.insertUser({ username: 'learner', email: null, passSalt: 'test', passHash: 'test' });
    const app = express();
    installUserSystem(app);
    const routers = (app as any)._router.stack.filter((layer: any) => layer.name === 'router');
    const adminRouter = routers.at(-1).handle;
    const catalogRouter = routers.at(-2).handle;
    // Exercise the real mounted routers without opening a network port.
    const request = (router: any, method: string, url: string, body: any = {}, userId = admin) => new Promise<any>((resolve, reject) => {
      let status = 200;
      const req = { method, url, originalUrl: url, userId, body, headers: {} };
      const res = { status(value: number) { status = value; return this; }, json(data: any) { resolve({ status, data }); } };
      router.handle(req, res, (error: any) => reject(error || new Error('Route not found')));
    });
    const scene = { domain: '饮食与做饭', primary: '自己做一顿饭', related: ['睡眠与作息'], practice: ['经历讲述'], uses: ['讲述经过'] };
    const material = { id: 'scene-material', name: 'Cooking', type: 'document', content: 'I cooked dinner.', scene };
    assert.equal((await request(adminRouter, 'PUT', '/', { material }, learner)).status, 403);
    assert.equal((await request(adminRouter, 'PUT', '/', { material: { ...material, scene: undefined } })).status, 400);
    assert.equal((await request(adminRouter, 'PUT', '/', { material: { ...material, scene: { ...scene, primary: '日常通勤' } } })).status, 400);
    assert.equal((await request(adminRouter, 'PUT', '/', { material })).status, 200);
    assert.deepEqual(storage.getSharedMaterial(material.id).scene, scene);
    assert.deepEqual((await request(catalogRouter, 'GET', '/materials')).data.materials[0].scene, scene);
    // A stale client can change publication status without erasing saved classification.
    assert.equal((await request(adminRouter, 'PUT', '/', { material: { ...material, scene: undefined, isPublished: false } })).status, 200);
    assert.deepEqual(storage.getSharedMaterial(material.id).scene, scene);
    assert.equal((await request(catalogRouter, 'GET', '/materials')).data.materials.length, 0);
    assert.equal((await request(adminRouter, 'PUT', '/', { material: { ...material, scene: null } })).status, 400);
    storage.upsertSharedMaterial('legacy', { id: 'legacy', name: 'Legacy', type: 'document', content: 'Legacy.' });
    assert.equal((await request(adminRouter, 'PUT', '/', { material: { id: 'legacy', name: 'Legacy', type: 'document', isPublished: false } })).status, 200);
    assert.equal((await request(adminRouter, 'POST', '/import', { materials: [{ id: 'migrated', name: 'Old article', type: 'document' }] })).status, 200);
  } finally {
    storage.db.close();
    if (oldDirectory === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDirectory;
    if (oldAdmin === undefined) delete process.env.ADMIN_USERNAME; else process.env.ADMIN_USERNAME = oldAdmin;
    rmSync(directory, { recursive: true, force: true });
  }
});
