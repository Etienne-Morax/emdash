import { describe, expect, it } from 'vitest';
import { computeLineDiff, MAX_DIFF_LINES, splitLines } from './line-diff';

function render(oldText: string | null, newText: string | null): string[] {
  const result = computeLineDiff(oldText, newText);
  if (result.kind !== 'hunks') return [result.kind];
  return result.hunks.flatMap((hunk) => [
    `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    ...hunk.lines.map(
      (line) => `${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}${line.text}`
    ),
  ]);
}

const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n') + '\n';

describe('computeLineDiff', () => {
  it('returns no hunks for identical text', () => {
    expect(render('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('shows a new file as additions', () => {
    expect(render(null, 'one\ntwo\n')).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two']);
  });

  it('shows a deleted file as removals', () => {
    expect(render('one\ntwo\n', null)).toEqual(['@@ -1,2 +0,0 @@', '-one', '-two']);
  });

  it('keeps three lines of context and splits distant changes into hunks', () => {
    const before = numbered(20);
    const after = before.replace('line 2\n', 'line two\n').replace('line 18\n', 'line 18b\n');

    expect(render(before, after)).toEqual([
      '@@ -1,5 +1,5 @@',
      ' line 1',
      '-line 2',
      '+line two',
      ' line 3',
      ' line 4',
      ' line 5',
      '@@ -15,6 +15,6 @@',
      ' line 15',
      ' line 16',
      ' line 17',
      '-line 18',
      '+line 18b',
      ' line 19',
      ' line 20',
    ]);
  });

  it('produces a minimal script for an insertion in the middle', () => {
    expect(render('a\nb\nc\n', 'a\nb\nx\nc\n')).toEqual([
      '@@ -1,3 +1,4 @@',
      ' a',
      ' b',
      '+x',
      ' c',
    ]);
  });

  it('refuses files too large for the phone', () => {
    expect(render(numbered(MAX_DIFF_LINES), 'x\n')).toEqual(['too-large']);
  });

  it('refuses rewrites with too many edits', () => {
    const before = Array.from({ length: 1_000 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 1_000 }, (_, i) => `b${i}`).join('\n');
    expect(render(before, after)).toEqual(['too-large']);
  });

  it('ignores the trailing newline when splitting', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
  });
});
