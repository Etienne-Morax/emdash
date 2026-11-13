import { createInProcessWire, WireError, type Controller } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileWireContract } from '../api/mobile-contract';
import type { MobileAuditEntry } from '../api/schemas';
import type { MobileAuditLog } from './audit-log';
import { createMobileSessionController } from './session-controller';

const device = { id: 'device-1', label: 'phone', createdAt: 0, lastSeenAt: null };

/** Stands in for the desktop routing controller: records every forwarded call. */
function fakeDesktop() {
  const calls: Array<{ path: string; input: unknown }> = [];
  const controller: Controller = {
    call: async (path, input) => {
      calls.push({ path, input });
      return { success: true, data: undefined };
    },
    resolveLive: () => null,
    acquireLive: () => null,
  };
  return { controller, calls };
}

function memoryAudit() {
  const entries: Array<Omit<MobileAuditEntry, 'ts'>> = [];
  const audit: MobileAuditLog = {
    record: (entry) => entries.push(entry),
    recent: async () => [],
    flush: async () => {},
  };
  return { audit, entries };
}

const validCreateTask = {
  id: '6f1c1c9e-6a5e-4f4e-9a52-8b0b3f7c1a11',
  projectId: 'project-1',
  taskConfig: {
    version: '1' as const,
    name: 'Fix the login page',
    initialConversation: {
      id: '0b8f3a4e-2b52-4d1b-9c0d-6c1f7a9e5b22',
      provider: 'claude',
      initialPrompt: 'Fix it',
    },
  },
  workspaceConfig: {
    version: '2' as const,
    git: {
      kind: 'create-branch' as const,
      branchName: 'emdash/fix-login',
      fromBranch: { type: 'local' as const, branch: 'main' },
    },
    workspace: { kind: 'new-worktree' as const },
  },
};

describe('mobile session controller', () => {
  const disposers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  function setup() {
    const desktop = fakeDesktop();
    const upstream = createInProcessWire(mobileWireContract, desktop.controller);
    disposers.push(() => upstream.dispose());
    const { audit, entries } = memoryAudit();
    const controller = createMobileSessionController({
      upstream: upstream.client,
      device,
      audit,
      local: {
        desktopName: () => 'MacBook Pro',
        machines: async () => [{ id: 'local', kind: 'local', name: 'MacBook Pro' }],
        appearance: async () => ({ projectColors: {}, machineColors: {}, localMachineName: 'x' }),
        taskDefaults: async () => ({
          defaultAgent: 'claude',
          branchPrefix: '',
          appendRandomBranchSuffix: true,
        }),
        colors: async () => ({ projects: {}, machines: {}, localMachine: '#000' }),
        pullRequests: {
          forBranch: async () => ({ success: true, data: { prs: [] } }),
          create: async () => ({ success: true, data: { url: 'u', number: 1 } }),
        },
        push: {
          publicKey: async () => 'k',
          subscribe: async () => {},
          unsubscribe: async () => {},
        },
      },
    });
    return { controller, calls: desktop.calls, entries };
  }

  it('forwards allowlisted calls unchanged and audits them', async () => {
    const { controller, calls, entries } = setup();

    await controller.call('conversations.tui.sendInput', { conversationId: 'c1', data: 'yes\r' });
    await controller.call('tasks.createTask', validCreateTask);

    expect(calls.map((call) => call.path)).toEqual([
      'conversations.tui.sendInput',
      'tasks.createTask',
    ]);
    expect(entries).toEqual([
      expect.objectContaining({ action: 'call conversations.tui.sendInput', outcome: 'ok' }),
      expect.objectContaining({ action: 'call tasks.createTask', outcome: 'ok' }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('yes');
  });

  it('answers gateway-local calls with the device identity', async () => {
    const { controller, calls } = setup();

    await expect(controller.call('mobile.session', undefined)).resolves.toEqual({
      deviceId: 'device-1',
      label: 'phone',
      desktopName: 'MacBook Pro',
    });
    expect(calls).toEqual([]);
  });

  it.each([
    ['appSettings.get', { key: 'mobileRemote' }],
    ['mobileRemote.startPairing', undefined],
    ['ssh.getSshConnections', undefined],
    ['files.writeFile', { path: '/etc/hosts', content: '' }],
    ['tasks.deleteTask', { projectId: 'p', taskId: 't' }],
    ['conversations.tui.startSession', { conversationId: 'c', cwd: '/', providerId: 'x' }],
    ['conversations.tui.kill', { conversationId: 'c' }],
    ['updates.install', undefined],
    ['mcp.saveServer', {}],
    ['pullRequests.createPullRequest', { repositoryUrl: 'https://github.com/x/y' }],
    ['pullRequests.mergePullRequest', { repositoryUrl: 'https://github.com/x/y', number: 1 }],
    ['sourceControl.checkout.blame', { workspaceId: 'w', path: 'a' }],
    ['sourceControl.repository.listWorktrees', { projectId: 'p' }],
    ['files.fs.readText', { uri: 'file:///etc/passwd' }],
  ])('refuses %s, which is outside the allowlist', async (path, input) => {
    const { controller, calls, entries } = setup();

    await expect(controller.call(path, input)).rejects.toMatchObject({
      code: 'UNKNOWN_PROCEDURE',
    });
    expect(calls).toEqual([]);
    expect(entries).toEqual([
      expect.objectContaining({ action: `call ${path}`, outcome: 'denied' }),
    ]);
  });

  it('refuses live topics and mutations outside the allowlist', () => {
    const { controller } = setup();

    for (const topic of [
      'appSettings.settings.current',
      'mobileRemote.status.current',
      'tasks.taskList.rename',
      'agents.loginOutput|{"id":"x"}',
      'sourceControl.checkout.model.commit',
      'sourceControl.checkout.model.discardChanges',
    ]) {
      expect(() => controller.acquireLive(topic) ?? raise(topic)).toThrow();
    }
  });

  it.each([
    ['a branch that reads as an option', { branchName: '--upload-pack=evil' }],
    ['a branch walking up refs', { branchName: 'a/../../b' }],
  ])('rejects createTask with %s before it reaches the desktop', async (_name, git) => {
    const { controller, calls } = setup();
    const input = {
      ...validCreateTask,
      workspaceConfig: {
        ...validCreateTask.workspaceConfig,
        git: { ...validCreateTask.workspaceConfig.git, ...git },
      },
    };

    await expect(controller.call('tasks.createTask', input)).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it('rejects createTask targeting an existing workspace or a path', async () => {
    const { controller, calls } = setup();
    const input = {
      ...validCreateTask,
      workspaceConfig: {
        ...validCreateTask.workspaceConfig,
        workspace: { kind: 'repository-instance', workspaceId: 'w' },
      },
    };

    await expect(controller.call('tasks.createTask', input)).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it('rejects an initial prompt an agent CLI would read as an option', async () => {
    const { controller, calls } = setup();
    const input = {
      ...validCreateTask,
      taskConfig: {
        ...validCreateTask.taskConfig,
        initialConversation: {
          ...validCreateTask.taskConfig.initialConversation,
          initialPrompt: '  --dangerously-skip-permissions',
        },
      },
    };

    await expect(controller.call('tasks.createTask', input)).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it('bounds terminal sizes and history pages', async () => {
    const { controller, calls } = setup();
    const location = { projectId: 'p', taskId: 't', conversationId: 'c' };

    await expect(
      controller.call('conversations.hydrateConversation', {
        ...location,
        initialSize: { cols: 1_000_000, rows: 40 },
      })
    ).rejects.toBeDefined();
    await expect(
      controller.call('conversations.acp.loadHistory', { conversationId: 'c', limit: 1_000_000 })
    ).rejects.toBeDefined();
    expect(calls).toEqual([]);

    await controller.call('conversations.hydrateConversation', {
      ...location,
      initialSize: { cols: 80, rows: 40 },
    });
    expect(calls.map((call) => call.path)).toEqual(['conversations.hydrateConversation']);
  });

  it('caps terminal input size', async () => {
    const { controller, calls } = setup();

    await expect(
      controller.call('conversations.tui.sendInput', {
        conversationId: 'c1',
        data: 'x'.repeat(64 * 1024 + 1),
      })
    ).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it('keeps unexpected failures as errors, not refusals', async () => {
    const desktop = fakeDesktop();
    desktop.controller.call = vi.fn(async () => {
      throw new WireError('HANDLER_ERROR', 'boom');
    });
    const upstream = createInProcessWire(mobileWireContract, desktop.controller);
    disposers.push(() => upstream.dispose());
    const { audit, entries } = memoryAudit();
    const controller = createMobileSessionController({
      upstream: upstream.client,
      device,
      audit,
      local: {
        desktopName: () => 'x',
        machines: async () => [],
        appearance: async () => ({ projectColors: {}, machineColors: {}, localMachineName: 'x' }),
        taskDefaults: async () => ({
          defaultAgent: 'claude',
          branchPrefix: '',
          appendRandomBranchSuffix: true,
        }),
        colors: async () => ({ projects: {}, machines: {}, localMachine: '#000' }),
        pullRequests: {
          forBranch: async () => ({ success: true, data: { prs: [] } }),
          create: async () => ({ success: true, data: { url: 'u', number: 1 } }),
        },
        push: {
          publicKey: async () => 'k',
          subscribe: async () => {},
          unsubscribe: async () => {},
        },
      },
    });

    await expect(
      controller.call('conversations.markConversationSeen', { conversationId: 'c' })
    ).rejects.toBeDefined();
    expect(entries).toEqual([expect.objectContaining({ outcome: 'error' })]);
  });
});

function raise(topic: string): never {
  throw new Error(`no lease for ${topic}`);
}

describe('mobile review endpoints', () => {
  const disposers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  function setup() {
    const desktop = fakeDesktop();
    const upstream = createInProcessWire(mobileWireContract, desktop.controller);
    disposers.push(() => upstream.dispose());
    const { audit } = memoryAudit();
    const create = vi.fn(async () => ({
      success: true as const,
      data: { url: 'https://github.com/o/r/pull/7', number: 7 },
    }));
    const controller = createMobileSessionController({
      upstream: upstream.client,
      device,
      audit,
      local: {
        desktopName: () => 'Mac',
        machines: async () => [],
        appearance: async () => ({ projectColors: {}, machineColors: {}, localMachineName: 'x' }),
        taskDefaults: async () => ({
          defaultAgent: 'claude',
          branchPrefix: '',
          appendRandomBranchSuffix: true,
        }),
        colors: async () => ({ projects: {}, machines: {}, localMachine: '#000' }),
        pullRequests: {
          forBranch: async () => ({ success: true, data: { prs: [] } }),
          create,
        },
        push: {
          publicKey: async () => 'k',
          subscribe: async () => {},
          unsubscribe: async () => {},
        },
      },
    });
    return { controller, calls: desktop.calls, create };
  }

  const mainBranch = {
    kind: 'branch',
    branch: { type: 'remote', branch: 'main', remote: { name: 'origin', url: 'git@x:o/r' } },
  };

  it('forwards read-only checkout calls', async () => {
    const { controller, calls } = setup();

    await controller.call('sourceControl.checkout.getChangedFiles', {
      workspaceId: 'w1',
      target: { kind: 'merge-base', base: mainBranch, head: { kind: 'commit', sha: 'abc1234' } },
    });
    await controller.call('sourceControl.checkout.getFile', {
      workspaceId: 'w1',
      path: 'src/app.ts',
      source: { kind: 'revision', revision: { kind: 'commit', sha: 'abc1234' } },
    });

    expect(calls.map((call) => call.path)).toEqual([
      'sourceControl.checkout.getChangedFiles',
      'sourceControl.checkout.getFile',
    ]);
  });

  it.each([
    ['a path leaving the checkout', { path: '../../etc/passwd', source: { kind: 'head' } }],
    ['an absolute path', { path: '/etc/passwd', source: { kind: 'head' } }],
    [
      'a revision that reads as an option',
      {
        path: 'a.ts',
        source: { kind: 'revision', revision: { kind: 'commit', sha: '--output=x' } },
      },
    ],
    [
      'a full ref as a branch',
      {
        path: 'a.ts',
        source: {
          kind: 'revision',
          revision: { kind: 'branch', branch: { type: 'local', branch: 'refs/stash' } },
        },
      },
    ],
    [
      'a symbolic ref as a branch',
      {
        path: 'a.ts',
        source: {
          kind: 'revision',
          revision: { kind: 'branch', branch: { type: 'local', branch: 'FETCH_HEAD' } },
        },
      },
    ],
    [
      'a tag revision',
      { path: 'a.ts', source: { kind: 'revision', revision: { kind: 'tag', name: 'v1' } } },
    ],
  ])('rejects getFile with %s before it reaches the desktop', async (_name, input) => {
    const { controller, calls } = setup();

    await expect(
      controller.call('sourceControl.checkout.getFile', { workspaceId: 'w1', ...input })
    ).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it('rejects a working-tree diff against an arbitrary ref', async () => {
    const { controller, calls } = setup();

    await expect(
      controller.call('sourceControl.checkout.getChangedFiles', {
        workspaceId: 'w1',
        target: { kind: 'working-vs-ref', ref: mainBranch },
      })
    ).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it('never lets the phone force a push or pass credentials', () => {
    const input = mobileWireContract.sourceControl.checkout.publish.input;

    expect(input.safeParse({ workspaceId: 'w1', remote: 'origin' }).success).toBe(true);
    for (const remote of ['--mirror', '/tmp/x', './x', '.', 'a/b', '../r', 'host:path']) {
      expect(input.safeParse({ workspaceId: 'w1', remote }).success).toBe(false);
    }
    expect(input.safeParse({ workspaceId: 'w1', remote: 'origin', force: true }).success).toBe(
      false
    );
    expect(
      input.safeParse({ workspaceId: 'w1', remote: 'origin', credentialAccount: { id: 'a' } })
        .success
    ).toBe(false);
    expect('push' in mobileWireContract.sourceControl.checkout).toBe(false);
  });

  it('serves pull request creation locally, never forwarding a repository URL', async () => {
    const { controller, calls, create } = setup();
    const input = {
      projectId: 'p1',
      head: 'emdash/fix',
      base: 'main',
      title: 'Fix',
      draft: false,
      repositoryUrl: 'https://github.com/attacker/repo',
    };

    await expect(controller.call('mobile.pullRequests.create', input)).resolves.toEqual({
      success: true,
      data: { url: 'https://github.com/o/r/pull/7', number: 7 },
    });
    expect(create).toHaveBeenCalledWith({
      projectId: 'p1',
      head: 'emdash/fix',
      base: 'main',
      title: 'Fix',
      draft: false,
    });
    expect(calls).toEqual([]);
  });

  it('rejects a pull request head that reads as an option', async () => {
    const { controller, create } = setup();

    await expect(
      controller.call('mobile.pullRequests.create', {
        projectId: 'p1',
        head: '--force',
        base: 'main',
        title: 'Fix',
        draft: false,
      })
    ).rejects.toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });
});
