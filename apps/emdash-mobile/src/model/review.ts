import type { CheckoutHeadState, Commit } from '@emdash/core/runtimes/git/api';
import { baseBranchOptions, defaultBaseBranch } from './new-task';

type RefsState = Parameters<typeof baseBranchOptions>[0];

/** A branch or commit as the phone names it to the checkout endpoints. */
export type ReviewRef =
  | {
      kind: 'branch';
      branch:
        | { type: 'local'; branch: string }
        | { type: 'remote'; branch: string; remote: { name: string; url: string } };
    }
  | { kind: 'commit'; sha: string };

export type ReviewBase = {
  /** Branch name the pull request targets, e.g. `main`. */
  name: string;
  /** Shown to the user, e.g. `origin/main`. */
  label: string;
  ref: ReviewRef;
  /** Remote the task branch is pushed to when it has no upstream yet. */
  remote: string | null;
};

const DEFAULT_REMOTE = 'origin';

/**
 * The branch a task is reviewed against: the project's default branch, preferring its
 * remote-tracking ref (what a pull request merges into) over the local branch.
 */
export function reviewBase(refs: RefsState, defaultBranch: string | null): ReviewBase | null {
  const chosen = defaultBaseBranch(baseBranchOptions(refs), defaultBranch);
  if (!chosen) return null;
  const name = chosen.fromBranch.branch;
  const preferredRemote = chosen.fromBranch.remote?.name ?? DEFAULT_REMOTE;
  const remotes = (refs?.branches ?? []).flatMap((branch) =>
    branch.type === 'remote' && branch.ref === `refs/remotes/${branch.remote.name}/${name}`
      ? [branch.remote]
      : []
  );
  const remote = remotes.find((entry) => entry.name === preferredRemote) ?? remotes[0];
  if (remote) {
    return {
      name,
      label: `${remote.name}/${name}`,
      ref: {
        kind: 'branch',
        branch: { type: 'remote', branch: name, remote: { name: remote.name, url: remote.url } },
      },
      remote: remote.name,
    };
  }
  return {
    name,
    label: name,
    ref: { kind: 'branch', branch: { type: 'local', branch: name } },
    remote: null,
  };
}

/** The task branch name, or null for a detached checkout. */
export function headBranchName(head: CheckoutHeadState | undefined): string | null {
  if (!head || head.kind === 'detached') return null;
  return head.ref.replace(/^refs\/heads\//, '');
}

/**
 * Where the branch left its base: the first parent of the oldest commit unique to the
 * branch (`git log base..head`, newest first). Null when the branch has no own commits or
 * the log was cut short.
 */
export function mergeBaseFromLog(log: { commits: Commit[]; totalCount: number }): string | null {
  if (log.commits.length === 0 || log.totalCount > log.commits.length) return null;
  return log.commits[log.commits.length - 1]!.parents[0] ?? null;
}

export type PublishPlan = { needed: false } | { needed: true; remote: string };

/**
 * Publish the task branch before opening a pull request when the remote does not have it
 * yet, or has an older copy. Publishing pushes the branch under its own name and tracks
 * it, which also repairs a branch that tracks its base (e.g. `origin/main`).
 */
export function publishPlan(
  head: CheckoutHeadState | undefined,
  base: ReviewBase | null
): PublishPlan {
  if (!head || head.kind !== 'branch') return { needed: false };
  const upstream = head.upstream;
  const fallbackRemote = base?.remote ?? DEFAULT_REMOTE;
  if (upstream.kind !== 'remote') return { needed: true, remote: fallbackRemote };
  const sameName = upstream.mergeRef === head.ref;
  if (!sameName || upstream.tracking.kind === 'unresolved') {
    return { needed: true, remote: upstream.remote };
  }
  if (upstream.tracking.ahead > 0) return { needed: true, remote: upstream.remote };
  return { needed: false };
}
