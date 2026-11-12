import type { MobileCreateTaskInput } from '@core/features/mobile-remote/api/mobile-contract';
import type { MobileTaskDefaults } from '@core/features/mobile-remote/api/schemas';
import { resolveTaskBranchName } from '@core/primitives/tasks/api/resolve-task-branch-name';
import type { GitBranch, GitRefsState } from '@emdash/core/runtimes/git/api';

export type BaseBranchOption = {
  /** Stable select value. */
  id: string;
  label: string;
  fromBranch: MobileCreateTaskInput['workspaceConfig']['git']['fromBranch'];
};

const LOCAL_PREFIX = 'refs/heads/';
const REMOTE_PREFIX = 'refs/remotes/';

/** Local branches first, then remote branches not already checked out locally. */
export function baseBranchOptions(refs: GitRefsState | undefined): BaseBranchOption[] {
  if (!refs) return [];
  const options: BaseBranchOption[] = [];
  const localNames = new Set<string>();
  for (const branch of refs.branches) {
    if (branch.type !== 'local') continue;
    const name = branch.ref.slice(LOCAL_PREFIX.length);
    localNames.add(name);
    options.push({ id: branch.ref, label: name, fromBranch: { type: 'local', branch: name } });
  }
  for (const branch of refs.branches) {
    if (branch.type !== 'remote') continue;
    const option = remoteOption(branch);
    if (option && !localNames.has(option.fromBranch.branch)) options.push(option);
  }
  return options;
}

function remoteOption(branch: Extract<GitBranch, { type: 'remote' }>): BaseBranchOption | null {
  const prefix = `${REMOTE_PREFIX}${branch.remote.name}/`;
  if (!branch.ref.startsWith(prefix)) return null;
  const name = branch.ref.slice(prefix.length);
  if (name === 'HEAD') return null;
  return {
    id: branch.ref,
    label: `${branch.remote.name}/${name}`,
    fromBranch: {
      type: 'remote',
      branch: name,
      remote: { name: branch.remote.name, url: branch.remote.url },
    },
  };
}

/** The default branch's option (local first), else the first option. */
export function defaultBaseBranch(
  options: readonly BaseBranchOption[],
  defaultBranch: string | null
): BaseBranchOption | undefined {
  if (defaultBranch) {
    const local = options.find(
      (option) => option.fromBranch.type === 'local' && option.fromBranch.branch === defaultBranch
    );
    if (local) return local;
    const remote = options.find((option) => option.fromBranch.branch === defaultBranch);
    if (remote) return remote;
  }
  return options[0];
}

/**
 * The exact `tasks.createTask` input the desktop's Create Task modal sends for "new worktree
 * on a new branch from <base>", with the same branch naming (prefix + random suffix).
 */
export function buildCreateTaskInput(input: {
  projectId: string;
  taskName: string;
  base: BaseBranchOption;
  provider: string;
  prompt: string;
  defaults: MobileTaskDefaults;
  suffix: string;
  ids: { task: string; conversation: string };
}): MobileCreateTaskInput {
  const prompt = input.prompt.trim();
  const branchName = resolveTaskBranchName({
    rawBranch: input.taskName,
    branchPrefix: input.defaults.branchPrefix,
    suffix: input.suffix,
    appendRandomSuffix: input.defaults.appendRandomBranchSuffix,
  });
  return {
    id: input.ids.task,
    projectId: input.projectId,
    taskConfig: {
      version: '1',
      name: input.taskName,
      initialConversation: {
        id: input.ids.conversation,
        provider: input.provider,
        ...(prompt ? { initialPrompt: prompt } : {}),
      },
    },
    workspaceConfig: {
      version: '2',
      git: { kind: 'create-branch', branchName, fromBranch: input.base.fromBranch },
      workspace: { kind: 'new-worktree' },
    },
  };
}

/** Slug the desktop would use as a task name when none is generated. */
export function fallbackTaskName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');
  return slug || 'mobile-task';
}
