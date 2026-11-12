/**
 * Line diff for the phone's read-only review: Myers' shortest edit script, grouped into
 * unified-diff hunks. Bounded so a huge file cannot freeze the phone: past the limits the
 * caller shows "too large" instead. (Same algorithm as `@emdash/chat-ui`'s ACP diff rows,
 * which that package does not export.)
 */

export type DiffLine =
  | { type: 'context'; text: string; oldLine: number; newLine: number }
  | { type: 'remove'; text: string; oldLine: number }
  | { type: 'add'; text: string; newLine: number };

export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type LineDiffResult = { kind: 'hunks'; hunks: DiffHunk[] } | { kind: 'too-large' };

/** Most lines (old + new) diffed on the phone. */
export const MAX_DIFF_LINES = 6_000;
/** Most edits explored before giving up: bounds memory to MAX_EDITS × (2 × MAX_DIFF_LINES). */
export const MAX_DIFF_EDITS = 800;
const CONTEXT_LINES = 3;

export function splitLines(text: string | null): string[] {
  if (text === null || text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function computeLineDiff(oldText: string | null, newText: string | null): LineDiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length + b.length > MAX_DIFF_LINES) return { kind: 'too-large' };
  const script = editScript(a, b);
  if (!script) return { kind: 'too-large' };
  return { kind: 'hunks', hunks: groupHunks(script) };
}

/** Myers' algorithm; null when the edit distance exceeds MAX_DIFF_EDITS. */
function editScript(a: string[], b: string[]): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const width = 2 * max + 3;
  const v = new Int32Array(width);
  const trace: Int32Array[] = [];
  let found = false;

  for (let d = 0; d <= Math.min(max, MAX_DIFF_EDITS); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return null;

  const lines: DiffLine[] = [];
  let x = n;
  let y = m;
  // trace[d] holds the furthest x per diagonal before edit d was taken.
  for (let d = trace.length - 1; d > 0; d--) {
    const before = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && before[offset + k - 1]! < before[offset + k + 1]!);
    const previousK = down ? k + 1 : k - 1;
    const previousX = before[offset + previousK]!;
    const previousY = previousX - previousK;
    const snakeX = down ? previousX : previousX + 1;
    const snakeY = down ? previousY + 1 : previousY;
    while (x > snakeX && y > snakeY) {
      lines.push({ type: 'context', text: a[x - 1]!, oldLine: x, newLine: y });
      x--;
      y--;
    }
    if (down) {
      lines.push({ type: 'add', text: b[y - 1]!, newLine: y });
      y--;
    } else {
      lines.push({ type: 'remove', text: a[x - 1]!, oldLine: x });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    lines.push({ type: 'context', text: a[x - 1]!, oldLine: x, newLine: y });
    x--;
    y--;
  }
  return lines.reverse();
}

/** Unified-diff hunks: changes with up to CONTEXT_LINES of context around them. */
function groupHunks(script: DiffLine[]): DiffHunk[] {
  const changed = script.map((line) => line.type !== 'context');
  const keep = new Array<boolean>(script.length).fill(false);
  script.forEach((_, index) => {
    if (!changed[index]) return;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(script.length - 1, index + CONTEXT_LINES);
    for (let i = from; i <= to; i++) keep[i] = true;
  });

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  const flush = () => {
    if (current.length) hunks.push(toHunk(current));
    current = [];
  };
  script.forEach((line, index) => {
    if (keep[index]) current.push(line);
    else flush();
  });
  flush();
  return hunks;
}

function toHunk(lines: DiffLine[]): DiffHunk {
  let oldStart = 0;
  let newStart = 0;
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    if (line.type !== 'add') {
      oldCount++;
      if (!oldStart) oldStart = line.oldLine;
    }
    if (line.type !== 'remove') {
      newCount++;
      if (!newStart) newStart = line.newLine;
    }
  }
  return { oldStart, oldCount, newStart, newCount, lines };
}
