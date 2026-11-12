import { mobileCreateTaskInputSchema } from '@core/features/mobile-remote/api/mobile-contract';
import type { GitRefsState } from '@emdash/core/runtimes/git/api';
import { describe, expect, it } from 'vitest';
import {
  baseBranchOptions,
  buildCreateTaskInput,
  defaultBaseBranch,
  fallbackTaskName,
} from './new-task';

const remote = { name: 'origin', url: 'git@github.com:me/repo.git' };
const refs = {
  branches: [
    { type: 'local', ref: 'refs/heads/main', oid: 'a' },
    { type: 'local', ref: 'refs/heads/feature/x', oid: 'b' },
    { type: 'remote', ref: 'refs/remotes/origin/main', remote, oid: 'a' },
    { type: 'remote', ref: 'refs/remotes/origin/release', remote, oid: 'c' },
    { type: 'remote', ref: 'refs/remotes/origin/HEAD', remote, oid: 'a' },
  ],
  tags: [],
  remoteHeads: [],
} as unknown as GitRefsState;

describe('new task model', () => {
  it('lists local branches, then remote-only ones', () => {
    expect(baseBranchOptions(refs).map((option) => option.label)).toEqual([
      'main',
      'feature/x',
      'origin/release',
    ]);
  });

  it('picks the default branch, local first', () => {
    const options = baseBranchOptions(refs);
    expect(defaultBaseBranch(options, 'main')?.fromBranch).toEqual({
      type: 'local',
      branch: 'main',
    });
    expect(defaultBaseBranch(options, 'release')?.fromBranch).toMatchObject({
      type: 'remote',
      branch: 'release',
    });
  });

  it('builds a createTask input the gateway accepts, named like the desktop names branches', () => {
    const input = buildCreateTaskInput({
      projectId: 'p1',
      taskName: 'fix-login-page',
      base: defaultBaseBranch(baseBranchOptions(refs), 'main')!,
      provider: 'claude',
      prompt: '  Fix the login page  ',
      defaults: { defaultAgent: 'claude', branchPrefix: 'emdash', appendRandomBranchSuffix: true },
      suffix: 'ab12c',
      ids: {
        task: '6f1c1c9e-6a5e-4f4e-9a52-8b0b3f7c1a11',
        conversation: '0b8f3a4e-2b52-4d1b-9c0d-6c1f7a9e5b22',
      },
    });

    expect(input.workspaceConfig.git).toEqual({
      kind: 'create-branch',
      branchName: 'emdash/fix-login-page-ab12c',
      fromBranch: { type: 'local', branch: 'main' },
    });
    expect(input.taskConfig.initialConversation.initialPrompt).toBe('Fix the login page');
    expect(mobileCreateTaskInputSchema.safeParse(input).success).toBe(true);
  });

  it('derives a readable fallback name from the prompt', () => {
    expect(fallbackTaskName('Fix the login page, please!')).toBe('fix-the-login-page-please');
    expect(fallbackTaskName('???')).toBe('mobile-task');
  });
});
