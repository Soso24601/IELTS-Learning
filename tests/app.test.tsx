import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { StrictMode } from 'react';
import { act, create } from 'react-test-renderer';
import App from '../frontend/src/App';
import Flashcards from '../frontend/src/components/Flashcards';
import Dashboard from '../frontend/src/components/Dashboard';
import { presetVocabulary } from '../frontend/src/data/vocabulary';
import { localDateKey } from '../frontend/src/lib/study';

test('a starred new word is counted once when reviewed under StrictMode', async () => {
  const values = new Map<string, string>();
  const first = presetVocabulary[0];
  values.set('ielts_vocab_progress', JSON.stringify({ [first.id]: { wordId: first.id, box: 1, status: 'new', starred: true, timesReviewed: 0, nextReviewDate: new Date(0).toISOString() } }));
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) },
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  });
  let tree: any;
  await act(async () => { tree = create(<StrictMode><App user={{ id: 1, username: 'test', email: null, createdAt: '', llmConfigured: false, llmProvider: null, llmModel: null }} onLogout={() => {}} onUserChanged={() => {}} /></StrictMode>); });
  try {
    await act(async () => tree.root.findByType(Dashboard).props.onNavigate('flashcards'));
    await act(async () => tree.root.findByType(Flashcards).props.onRegisterReview(first.id, 'good'));
    const stats = JSON.parse(values.get('ielts_vocab_stats')!).find((s: any) => s.date === localDateKey());
    assert.equal(stats.wordsLearned, 1);
    assert.equal(stats.wordsReviewed, 1);
    assert.equal(JSON.parse(values.get('ielts_vocab_progress')!)[first.id].timesReviewed, 1);
  } finally { await act(async () => tree.unmount()); }
});
