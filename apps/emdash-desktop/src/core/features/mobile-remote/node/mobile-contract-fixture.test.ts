import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mobileWireContract } from '../api/mobile-contract';

/**
 * Contract fixture for the native iOS client (`apps/morax-code-ios`): the call paths and
 * live topic ids of the mobile contract the app uses. The Swift client reads the same file,
 * so a renamed endpoint fails here and in the Swift tests. Regenerate:
 * `UPDATE_WIRE_FIXTURES=1 pnpm exec vitest run --project node src/core/features/mobile-remote`.
 */

const FIXTURE_PATH = join(
  __dirname,
  '../../../../../../morax-code-ios/Fixtures/mobile-contract.json'
);

/** The mobile contract endpoints the iOS app calls, by kind. */
function mobileEndpoints() {
  const c = mobileWireContract;
  return {
    procedures: [
      'mobile.session',
      'mobile.machines',
      'mobile.appearance',
      'mobile.taskDefaults',
      'mobile.colors',
      'mobile.pullRequests.forBranch',
      'mobile.pullRequests.create',
      'tasks.createTask',
      'tasks.generateTaskName',
      'agents.listMetadata',
      'sourceControl.repository.getDefaultBranch',
      'sourceControl.checkout.getChangedFiles',
      'sourceControl.checkout.getFile',
      'sourceControl.checkout.getLog',
      'conversations.getConversationsForProject',
      'conversations.markConversationSeen',
      'conversations.hydrateConversation',
      'conversations.tui.sendInput',
      'conversations.tui.resize',
      'conversations.tui.stop',
      'conversations.acp.sendPrompt',
      'conversations.acp.cancelTurn',
      'conversations.acp.resolvePermission',
      'conversations.acp.loadHistory',
    ],
    liveStates: {
      projectList: c.projects.projectList.states.list.id,
      taskList: c.tasks.taskList.states.list.id,
      hostAvailability: c.hosts.availability.states.state.id,
      branchRefs: c.sourceControl.repository.model.states.refs.id,
      checkoutHead: c.sourceControl.checkout.model.states.head.id,
      acpSession: c.conversations.acp.session.states.state.id,
    },
    liveLogs: { terminalOutput: c.conversations.tui.output.id },
    eventStreams: { conversationEvents: c.conversations.events.id },
    liveJobs: {
      provision: { path: 'workspaces.provision', topic: c.workspaces.provision.id },
      publish: {
        path: 'sourceControl.checkout.publish',
        topic: c.sourceControl.checkout.publish.id,
      },
    },
  };
}

describe('mobile contract fixture for the native iOS client', () => {
  it('lists the endpoints the app calls, all present in the allowlist', () => {
    const endpoints = mobileEndpoints();
    for (const path of endpoints.procedures) {
      const def = path
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          mobileWireContract
        );
      expect(def, path).toBeDefined();
    }
    const text = `${JSON.stringify({ endpoints }, null, 2)}\n`;
    if (process.env.UPDATE_WIRE_FIXTURES === '1') writeFileSync(FIXTURE_PATH, text);
    expect(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))).toEqual(JSON.parse(text));
  });
});
