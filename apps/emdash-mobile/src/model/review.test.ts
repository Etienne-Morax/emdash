import type { CheckoutHeadState, Commit } from '@emdash/core/runtimes/git/api';
import { describe, expect, it } from 'vitest';
import { headBranchName, mergeBaseFromLog, publishPlan, reviewBase } from './review';

const origin = { name: 'origin', url: 'git@github.com:o/r.git' };

const refs = {
  branches: [
    { type: 'local', ref: 'refs/heads/main', branch: 'main' },
    { type: 'remote', ref: 'refs/remotes/origin/main', branch: 'main', remote: origin },
    { type: 'remote', ref: 'refs/remotes/origin/dev', branch: 'dev', remote: origin },
  ],
} as unknown as Parameters<typeof reviewBase>[0];

function branchHead(upstream: unknown): CheckoutHeadState {
  return {
    kind: 'branch',
    ref: 'refs/heads/emdash/fix',
    oid: 'abc',
    upstream,
  } as CheckoutHeadState;
}

function commit(hash: string, parents: string[]): Commit {
  return {
    hash,
    parents,
    subject: hash,
    body: '',
    author: 'a',
    date: 0,
    isPushed: false,
    tags: [],
  };
}

describe('reviewBase', () => {
  it('reviews against the remote-tracking default branch', () => {
    expect(reviewBase(refs, 'main')).toEqual({
      name: 'main',
      label: 'origin/main',
      ref: { kind: 'branch', branch: { type: 'remote', branch: 'main', remote: origin } },
      remote: 'origin',
    });
  });

  it('falls back to the local branch without a remote copy', () => {
    const localOnly = { branches: [{ type: 'local', ref: 'refs/heads/trunk', branch: 'trunk' }] };
    expect(reviewBase(localOnly as unknown as typeof refs, 'trunk')).toMatchObject({
      name: 'trunk',
      ref: { kind: 'branch', branch: { type: 'local', branch: 'trunk' } },
      remote: null,
    });
  });

  it('is null before refs load', () => {
    expect(reviewBase(undefined, 'main')).toBeNull();
  });
});

describe('mergeBaseFromLog', () => {
  it('is the first parent of the oldest branch commit', () => {
    const log = { commits: [commit('c3', ['c2']), commit('c2', ['b1'])], totalCount: 2 };
    expect(mergeBaseFromLog(log)).toBe('b1');
  });

  it('is unknown when the branch has no own commits or the log is cut short', () => {
    expect(mergeBaseFromLog({ commits: [], totalCount: 0 })).toBeNull();
    expect(mergeBaseFromLog({ commits: [commit('c2', ['b1'])], totalCount: 900 })).toBeNull();
  });
});

describe('publishPlan', () => {
  const base = reviewBase(refs, 'main');
  const resolved = (ahead: number) => ({
    kind: 'resolved',
    ref: 'refs/remotes/origin/emdash/fix',
    oid: 'x',
    ahead,
    behind: 0,
  });

  it('publishes an unpublished branch to the base remote', () => {
    expect(publishPlan(branchHead({ kind: 'none' }), base)).toEqual({
      needed: true,
      remote: 'origin',
    });
  });

  it('publishes a branch that tracks its base under another name', () => {
    const head = branchHead({
      kind: 'remote',
      remote: 'origin',
      mergeRef: 'refs/heads/main',
      tracking: resolved(0),
    });
    expect(publishPlan(head, base)).toEqual({ needed: true, remote: 'origin' });
  });

  it('publishes a branch ahead of its own upstream, and skips one up to date', () => {
    const upstream = (ahead: number) => ({
      kind: 'remote',
      remote: 'origin',
      mergeRef: 'refs/heads/emdash/fix',
      tracking: resolved(ahead),
    });
    expect(publishPlan(branchHead(upstream(2)), base)).toEqual({ needed: true, remote: 'origin' });
    expect(publishPlan(branchHead(upstream(0)), base)).toEqual({ needed: false });
  });

  it('never publishes a detached checkout', () => {
    const head = { kind: 'detached', shortHash: 'abc', oid: 'abc' } as CheckoutHeadState;
    expect(publishPlan(head, base)).toEqual({ needed: false });
    expect(headBranchName(head)).toBeNull();
    expect(headBranchName(branchHead({ kind: 'none' }))).toBe('emdash/fix');
  });
});
