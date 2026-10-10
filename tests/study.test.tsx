import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { StrictMode, useState } from 'react';
import { act, create } from 'react-test-renderer';
import Flashcards from '../frontend/src/components/Flashcards';
import { activeElapsed, localDateKey, reviewQueue } from '../frontend/src/lib/study';
import type { IELTSWord, WordProgress } from '../frontend/src/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const words = ['alpha', 'beta', 'gamma'].map(id => ({ id, word: id, category: 'reading', chinese: id, definition: id, example: '', exampleTranslation: '', phonetic: '', partOfSpeech: 'n.', topic: 'test' } as IELTSWord));
const progress = (id: string, box = 1, timesReviewed = 1): WordProgress => ({ wordId: id, box, timesReviewed, status: 'learning', starred: false, nextReviewDate: new Date(0).toISOString() });

test('mastered words return when due and deleted words never enter the queue', () => {
  assert.deepEqual(reviewQueue(words, { alpha: progress('alpha', 5), removed: progress('removed') }).map(w => w.id), ['alpha']);
});
test('starring a new word does not remove it from new-word learning', () => {
  assert.deepEqual(reviewQueue(words, { alpha: { ...progress('alpha', 1, 0), starred: true } }).map(w => w.id), ['alpha', 'beta', 'gamma']);
});
test('learning clock ignores hidden, idle and suspended time', () => {
  assert.equal(activeElapsed(0, 5000, 0, true), 5000);
  assert.equal(activeElapsed(0, 5000, 0, false), 0);
  assert.equal(activeElapsed(65000, 70000, 0, true), 0);
  assert.equal(activeElapsed(58000, 63000, 0, true), 2000);
  assert.equal(activeElapsed(0, 3600000, 0, true), 0);
});
test('calendar dates use the local day near midnight', () => {
  const original = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try { assert.equal(localDateKey(new Date('2026-09-28T16:30:00Z')), '2026-09-29'); }
  finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
test('answer every flashcard exactly once as parent progress changes', async () => {
  const reviewed: string[] = [];
  function Harness() {
    const [state, setState] = useState<Record<string, WordProgress>>({});
    return <Flashcards vocabulary={words} progress={state} onRegisterReview={id => {
      reviewed.push(id);
      setState(prev => ({ ...prev, [id]: { ...progress(id), nextReviewDate: new Date(Date.now() + 86400000).toISOString() } }));
    }} onToggleStar={() => {}} onNavigate={() => {}} />;
  }
  let tree: any;
  await act(async () => { tree = create(<StrictMode><Harness /></StrictMode>); });
  try {
    for (const word of words) {
      assert.equal(tree.root.findAllByProps({ id: `interactive-flashcard-${word.id}` }).length, 1);
      await act(async () => tree.root.findByProps({ id: 'btn-reveal-back' }).props.onClick());
      await act(async () => tree.root.findByProps({ id: 'btn-review-good' }).props.onClick());
    }
    assert.deepEqual(reviewed, words.map(w => w.id));
    assert.equal(tree.root.findAllByProps({ id: 'btn-reveal-back' }).length, 0);
    await act(async () => tree.root.findByProps({ id: 'btn-restart-session' }).props.onClick());
    assert.equal(tree.root.findAllByProps({ id: 'btn-reveal-back' }).length, 0);
  } finally { await act(async () => tree.unmount()); }
});
