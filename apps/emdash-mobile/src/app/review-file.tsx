import type { GitChange } from '@emdash/core/runtimes/git/api';
import { useState } from 'react';
import { describeError } from '../model/errors';
import { computeLineDiff, type LineDiffResult } from '../model/line-diff';
import { getLink } from '../wire/connection';

type DiffState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'loaded'; diff: LineDiffResult }
  | { kind: 'failed'; message: string };

/**
 * One changed file: its counts, and on tap its line diff between two commits. Without a
 * commit range (uncommitted work) only the counts are shown: the phone never reads
 * working-tree files.
 */
export function FileDiff(props: {
  workspaceId: string;
  file: GitChange;
  range: { from: string | null; to: string } | null;
}) {
  const { workspaceId, file, range } = props;
  const [state, setState] = useState<DiffState>({ kind: 'closed' });
  const canOpen = range !== null && range.from !== null;

  const toggle = async () => {
    if (!canOpen || !range.from) return;
    if (state.kind !== 'closed') {
      setState({ kind: 'closed' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const [before, after] = await Promise.all([
        readAt(workspaceId, file.path, range.from),
        readAt(workspaceId, file.path, range.to),
      ]);
      setState({ kind: 'loaded', diff: computeLineDiff(before, after) });
    } catch (error) {
      setState({ kind: 'failed', message: describeError(error, 'Could not read this file.') });
    }
  };

  return (
    <li className="review-file morax-glass">
      <button
        type="button"
        className="review-file-header"
        onClick={() => void toggle()}
        disabled={!canOpen}
        aria-expanded={state.kind !== 'closed'}
      >
        <span className="review-file-path">{file.path}</span>
        <span className="review-file-counts">
          <span className="count-add">+{file.additions}</span>
          <span className="count-remove">−{file.deletions}</span>
        </span>
      </button>
      {state.kind === 'loading' && <p className="morax-caption">Loading…</p>}
      {state.kind === 'failed' && <p className="form-error">{state.message}</p>}
      {state.kind === 'loaded' && <DiffBody diff={state.diff} />}
    </li>
  );
}

function DiffBody({ diff }: { diff: LineDiffResult }) {
  if (diff.kind === 'too-large') {
    return <p className="morax-caption">Too large to show on the phone. Open it on the Mac.</p>;
  }
  if (diff.hunks.length === 0) return <p className="morax-caption">No text change.</p>;
  return (
    <div className="diff-body">
      {diff.hunks.map((hunk) => (
        <div key={`${hunk.oldStart}:${hunk.newStart}`} className="diff-hunk">
          <div className="diff-hunk-header">
            @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
          </div>
          {hunk.lines.map((line, index) => (
            <div key={index} className={`diff-line diff-${line.type}`}>
              <span className="diff-sign" aria-hidden="true">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
              </span>
              <span className="diff-text">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The file's committed content at `commit`; null when it does not exist there. */
async function readAt(
  workspaceId: string,
  path: GitChange['path'],
  commit: string
): Promise<string | null> {
  const result = await getLink().client.sourceControl.checkout.getFile({
    workspaceId,
    path,
    source: { kind: 'revision', revision: { kind: 'commit', sha: commit } },
  });
  if (!result.success) throw result.error;
  return result.data.content;
}
