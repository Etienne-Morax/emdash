import type { GitChange } from '@emdash/core/runtimes/git/api';
import { useEffect, useMemo, useState } from 'react';
import { describeError } from '../model/errors';
import { headBranchName, mergeBaseFromLog, reviewBase, type ReviewBase } from '../model/review';
import { getLink } from '../wire/connection';
import { useBranchRefs, useCheckoutHead, useTaskList } from '../wire/live';
import { provisionTask } from '../wire/provision';
import { EmptyState, LinkBanner, ScreenHeader } from './components';
import { PullRequestPanel } from './pull-request-panel';
import { FileDiff } from './review-file';
import { routeHref } from './router';
import { useLinkState } from './use-link-state';

const LOG_LIMIT = 500;

type Changes = {
  committed: GitChange[];
  /** Merge base and branch tip: the two commits a committed file is compared between. */
  range: { from: string | null; to: string } | null;
  uncommitted: GitChange[];
};

/**
 * Read-only review of a task: what its branch changed since it left the base branch, file
 * by file, plus the files still uncommitted. Then open a pull request for it.
 */
export function ReviewScreen({ projectId, taskId }: { projectId: string; taskId: string }) {
  const link = useLinkState();
  const tasks = useTaskList(projectId);
  const task = tasks.value?.tasks.find((entry) => entry.id === taskId);
  const workspaceId = task?.workspaceId ?? null;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const head = useCheckoutHead(ready ? workspaceId : null);
  const refs = useBranchRefs(projectId);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
  const client = getLink().client;

  useEffect(() => {
    if (!workspaceId) return;
    void provisionTask(workspaceId, taskId).then((result) => {
      if (result.ok) setReady(true);
      else setError(result.message);
    });
  }, [workspaceId, taskId]);

  useEffect(() => {
    void client.sourceControl.repository
      .getDefaultBranch({ projectId, remote: 'origin' })
      .then((result) => {
        if (result.success) setDefaultBranch(result.data.branch);
      })
      .catch(() => undefined);
  }, [client, projectId]);

  const base = useMemo(() => reviewBase(refs.value, defaultBranch), [refs.value, defaultBranch]);
  const headState = head.value;
  const tip = headState && headState.kind !== 'unborn' ? headState.oid : null;
  const branch = headBranchName(headState);

  useEffect(() => {
    if (!workspaceId || !ready || !tip) return;
    let cancelled = false;
    void loadChanges(workspaceId, base, tip)
      .then((loaded) => {
        if (!cancelled) setChanges(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause, 'Could not read the changes.'));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, ready, base, tip]);

  return (
    <main className="screen review-screen">
      <ScreenHeader
        back={
          <a
            className="back-link"
            href={routeHref({ name: 'task', projectId, taskId })}
            aria-label="Back to the task"
          >
            ‹
          </a>
        }
        eyebrow={branch ? `${branch} → ${base?.label ?? '…'}` : 'Changes'}
        title={task?.name ?? 'Changes'}
      />
      <LinkBanner link={link} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!workspaceId ? (
        <EmptyState title={tasks.isLoading ? 'Loading…' : 'This task has no workspace'} />
      ) : !changes || !workspaceId ? (
        !error && <EmptyState title="Reading the changes…" />
      ) : (
        <>
          <section className="review-section">
            <h2 className="morax-eyebrow">
              Committed on this branch · {changes.committed.length} files
            </h2>
            {changes.committed.length === 0 && (
              <p className="morax-caption">No commit on this branch yet.</p>
            )}
            <ul className="review-files">
              {changes.committed.map((file) => (
                <FileDiff
                  key={file.path}
                  workspaceId={workspaceId}
                  file={file}
                  range={changes.range}
                />
              ))}
            </ul>
          </section>
          {changes.uncommitted.length > 0 && (
            <section className="review-section">
              <h2 className="morax-eyebrow">Uncommitted · {changes.uncommitted.length} files</h2>
              <p className="morax-caption">
                Not part of a pull request until the agent commits them.
              </p>
              <ul className="review-files">
                {changes.uncommitted.map((file) => (
                  <FileDiff key={file.path} workspaceId={workspaceId} file={file} range={null} />
                ))}
              </ul>
            </section>
          )}
          {branch && base && (
            <PullRequestPanel
              projectId={projectId}
              workspaceId={workspaceId}
              branch={branch}
              base={base}
              head={headState}
              defaultTitle={task?.name ?? branch}
              hasCommits={changes.committed.length > 0}
            />
          )}
        </>
      )}
    </main>
  );
}

async function loadChanges(
  workspaceId: string,
  base: ReviewBase | null,
  tip: string
): Promise<Changes> {
  const checkout = getLink().client.sourceControl.checkout;
  const tipRef = { kind: 'commit' as const, sha: tip };
  const [uncommitted, committed, log] = await Promise.all([
    checkout.getChangedFiles({ workspaceId, target: { kind: 'working-vs-head' } }),
    base
      ? checkout.getChangedFiles({
          workspaceId,
          target: { kind: 'merge-base', base: base.ref, head: tipRef },
        })
      : null,
    base
      ? checkout.getLog({
          workspaceId,
          options: { limit: LOG_LIMIT, base: base.ref, head: tipRef },
        })
      : null,
  ]);
  if (!uncommitted.success) throw uncommitted.error;
  if (committed && !committed.success) throw committed.error;
  const mergeBase = log?.success ? mergeBaseFromLog(log.data) : null;
  return {
    uncommitted: uncommitted.data.files,
    committed: committed?.data.files ?? [],
    range: { from: mergeBase, to: tip },
  };
}
