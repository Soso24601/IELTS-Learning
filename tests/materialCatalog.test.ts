import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogType, filterCatalog, materialTags, materialDuration } from '../frontend/src/lib/materialCatalog';
import { decodeMediaUpload, MEDIA_PATH } from '../backend/server/lib/mediaUpload';

test('catalog groups old and new materials by format regardless of IELTS category or folder', () => {
  const materials = [
    { id: 'video', name: 'Campus vlog', type: 'link', category: 'reading', url: 'https://youtu.be/dQw4w9WgXcQ', tags: ['校园'] },
    { id: 'audio', name: 'Lecture', type: 'audio', category: 'speaking', url: 'https://example.com/a.mp3', tags: ['科技'] },
    { id: 'article', name: 'Technology', type: 'document', category: 'writing' },
    { id: 'web', name: 'News article', type: 'link', url: 'https://example.com/article' },
  ];
  assert.deepEqual(filterCatalog(materials, 'video').map(item => item.id), ['video']);
  assert.deepEqual(filterCatalog(materials, 'document').map(item => item.id), ['article', 'web']);
  assert.deepEqual(filterCatalog(materials, 'all', '科技').map(item => item.id), ['audio']);
  assert.equal(catalogType({ type: 'link', url: 'https://youtube.com.fake.example/article' }), 'document');
  assert.deepEqual(materialTags('日常生活，科技, 科技'), ['日常生活', '科技']);
  assert.equal(materialDuration({ duration: 90, videoSubtitles: [{ end: 50 }] }), 90);
});

test('media uploads enforce format and size and reject disguised files', () => {
  const mp3 = Buffer.from('ID3sample audio').toString('base64');
  assert.equal(decodeMediaUpload('lesson.mp3', mp3, 'audio').extension, 'mp3');
  assert.throws(() => decodeMediaUpload('lesson.mp3', Buffer.from('<html>bad</html>').toString('base64'), 'audio'), /不一致/);
  assert.throws(() => decodeMediaUpload('lesson.mp3', mp3, 'video'), /类型一致/);
  assert.throws(() => decodeMediaUpload('lesson.mp3', '', 'audio'), /文件无效/);
  assert.equal(MEDIA_PATH.test('/api/media/12345678-abcd-abcd-abcd-123456789abc.mp3'), true);
  assert.equal(MEDIA_PATH.test('/api/media/../../app.db'), false);
});
