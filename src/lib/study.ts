import type { IELTSWord, WordProgress } from '../types';

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function reviewQueue(vocabulary: IELTSWord[], progress: Record<string, WordProgress>, now = Date.now()): IELTSWord[] {
  const due = vocabulary.filter(word => {
    const p = progress[word.id];
    return p && p.timesReviewed > 0 && new Date(p.nextReviewDate).getTime() <= now;
  });
  return due.length ? due : vocabulary.filter(word => !progress[word.id]?.timesReviewed);
}

/** Visible interaction remains active for at most one minute; background/sleep gaps do not count. */
export function activeElapsed(previous: number, now: number, lastInteraction: number, visible: boolean): number {
  if (!visible || now - previous > 15000) return 0;
  return Math.max(0, Math.min(now, lastInteraction + 60000) - previous);
}
