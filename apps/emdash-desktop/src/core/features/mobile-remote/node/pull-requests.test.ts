import { describe, expect, it, vi } from 'vitest';
import { createMobilePullRequestOperations, toMobilePullRequest } from './pull-requests';
import type { MobilePullRequestDesktop } from './pull-requests';

type PullRequest = Parameters<typeof toMobilePullRequest>[0];

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: 'https://github.com/o/r/pull/12',
    provider: 'github',
    repositoryUrl: 'https://github.com/o/r',
    baseRefName: 'main',
    baseRefOid: 'a',
    headRepositoryUrl: 'https://github.com/o/r',
    headRefName: 'emdash/fix',
    headRefOid: 'b',
    identifier: '#12',
    title: 'Fix the login page',
    description: null,
    status: 'open',
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: null,
    mergeStateStatus: null,
    reviewDecision: null,
    createdAt: '',
    updatedAt: '',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

function desktop(overrides: Partial<MobilePullRequestDesktop> = {}) {
  const value = {
    resolveProvider: vi.fn<MobilePullRequestDesktop['resolveProvider']>(async () => ({
      success: true,
      data: {
        provider: 'github',
        host: 'github.com',
        repositoryUrl: 'https://github.com/o/r',
        nameWithOwner: 'o/r',
        capabilities: { pullRequests: true, issues: true },
      },
    })),
    getPullRequestsForBranch: vi.fn<MobilePullRequestDesktop['getPullRequestsForBranch']>(
      async () => ({ success: true, data: { prs: [pullRequest()] } })
    ),
    createPullRequest: vi.fn<MobilePullRequestDesktop['createPullRequest']>(async () => ({
      success: true,
      data: { url: 'https://github.com/o/r/pull/13', number: 13 },
    })),
    ...overrides,
  };
  return value;
}

describe('mobile pull request operations', () => {
  it('creates the pull request in the repository the desktop resolves', async () => {
    const fake = desktop();
    const operations = createMobilePullRequestOperations(fake);

    const result = await operations.create({
      projectId: 'p1',
      head: 'emdash/fix',
      base: 'main',
      title: '  Fix it  ',
      body: '   ',
      draft: true,
    });

    expect(result).toEqual({
      success: true,
      data: { url: 'https://github.com/o/r/pull/13', number: 13 },
    });
    expect(fake.resolveProvider).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(fake.createPullRequest).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/o/r',
      head: 'emdash/fix',
      base: 'main',
      title: 'Fix it',
      body: undefined,
      draft: true,
    });
  });

  it('refuses when the repository host has no pull request integration', async () => {
    const fake = desktop({
      resolveProvider: async () => ({
        success: true,
        data: {
          provider: 'forgejo',
          host: 'git.example.com',
          repositoryUrl: 'https://git.example.com/o/r',
          nameWithOwner: 'o/r',
          capabilities: { pullRequests: false, issues: false },
        },
      }),
    });
    const operations = createMobilePullRequestOperations(fake);

    const result = await operations.create({
      projectId: 'p1',
      head: 'h',
      base: 'main',
      title: 't',
      draft: false,
    });

    expect(result.success).toBe(false);
    expect(fake.createPullRequest).not.toHaveBeenCalled();
  });

  it('explains a project without a remote', async () => {
    const operations = createMobilePullRequestOperations(
      desktop({ resolveProvider: async () => ({ success: false, error: { type: 'no_remote' } }) })
    );

    await expect(operations.forBranch({ projectId: 'p1', branch: 'b' })).resolves.toEqual({
      success: false,
      error: { message: 'This project has no git remote.' },
    });
  });

  it('lists pull requests for a branch with their numbers', async () => {
    const operations = createMobilePullRequestOperations(desktop());

    await expect(operations.forBranch({ projectId: 'p1', branch: 'emdash/fix' })).resolves.toEqual({
      success: true,
      data: {
        prs: [
          {
            number: 12,
            url: 'https://github.com/o/r/pull/12',
            title: 'Fix the login page',
            status: 'open',
            isDraft: false,
          },
        ],
      },
    });
  });

  it('reads GitLab merge request numbers and tolerates unknown URLs', () => {
    expect(
      toMobilePullRequest(pullRequest({ url: 'https://gitlab.com/o/r/-/merge_requests/4' })).number
    ).toBe(4);
    expect(toMobilePullRequest(pullRequest({ url: 'https://example.com/x' })).number).toBeNull();
  });
});
