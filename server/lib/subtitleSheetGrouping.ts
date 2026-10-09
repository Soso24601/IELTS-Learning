export type SubtitleSheetCue = { time: number; text: string; translation: string };

const TARGET_MIN_WORDS = 5;
const TARGET_MAX_WORDS = 18;
const MAX_SPAN_SECONDS = 9;
const MAX_GAP_SECONDS = 5;

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function groupWords(group: number[], cues: SubtitleSheetCue[]): number {
  return group.reduce((total, index) => total + wordCount(cues[index].text), 0);
}

function canJoin(left: number[], right: number[], cues: SubtitleSheetCue[]): boolean {
  if (!left.length || !right.length) return false;
  const first = cues[left[0]], last = cues[right[right.length - 1]];
  const leftLast = cues[left[left.length - 1]];
  return groupWords([...left, ...right], cues) <= TARGET_MAX_WORDS
    && last.time - first.time <= MAX_SPAN_SECONDS
    && cues[right[0]].time - leftLast.time <= MAX_GAP_SECONDS;
}

/**
 * Treat model groups as suggestions, then enforce steady caption size and pace.
 * Every source cue remains in exactly one contiguous group.
 */
export function balanceSubtitleCueGroups(groups: number[][], cues: SubtitleSheetCue[]): number[][] {
  const ordered = groups.flat();
  if (ordered.length !== cues.length || ordered.some((index, i) => index !== i)) {
    throw new Error('字幕分组未按顺序完整覆盖源字幕。');
  }

  const split: number[][] = [];
  let current: number[] = [];
  for (const cueIndex of ordered) {
    const cue = cues[cueIndex];
    const previous = current.length ? cues[current[current.length - 1]] : null;
    const count = current.reduce((sum, index) => sum + wordCount(cues[index].text), 0);
    const nextCount = wordCount(cue.text);
    const sentenceEnded = previous && /[.!?]["'”’)]*$/.test(previous.text.trim()) && count >= 7;
    const mustSplit = current.length > 0 && (
      count + nextCount > TARGET_MAX_WORDS
      || cue.time - cues[current[0]].time > MAX_SPAN_SECONDS
      || (previous !== null && cue.time - previous.time > MAX_GAP_SECONDS)
      || sentenceEnded
    );
    if (mustSplit) {
      split.push(current);
      current = [];
    }
    current.push(cueIndex);
  }
  if (current.length) split.push(current);

  // Tiny acknowledgements and fragments should travel with a nearby phrase,
  // unless a pause or maximum-size boundary makes that misleading.
  const balanced: number[][] = [];
  for (let i = 0; i < split.length; i++) {
    const group = split[i];
    if (groupWords(group, cues) >= TARGET_MIN_WORDS) {
      balanced.push(group);
      continue;
    }
    const previous = balanced[balanced.length - 1];
    const next = split[i + 1];
    const canJoinPrevious = previous && canJoin(previous, group, cues);
    const canJoinNext = next && canJoin(group, next, cues);
    if (canJoinPrevious && (!canJoinNext || groupWords(previous, cues) <= groupWords(next!, cues))) {
      balanced[balanced.length - 1] = [...previous, ...group];
    } else if (canJoinNext) {
      balanced.push([...group, ...next!]);
      i++;
    } else {
      balanced.push(group);
    }
  }
  return balanced;
}
