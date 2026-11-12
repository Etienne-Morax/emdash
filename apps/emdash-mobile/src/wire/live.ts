import { mobileWireContract } from '@core/features/mobile-remote/api/mobile-contract';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import { remote, type RemoteModel } from '@emdash/wire/state';
import { getLink } from './connection';

/** Keeps a replica briefly after its screen unmounts, so back-navigation is instant. */
const LINGER_MS = 30_000;

const contract = mobileWireContract;

function lazy<T>(create: () => T): () => Promise<T> {
  let value: T | undefined;
  return async () => (value ??= create());
}

const projectListModel = lazy(() =>
  remote(contract.projects.projectList, getLink().client.projects.projectList, {
    lingerMs: LINGER_MS,
  })
);
const taskListModel = lazy(() =>
  remote(contract.tasks.taskList, getLink().client.tasks.taskList, { lingerMs: LINGER_MS })
);
const availabilityModel = lazy(() =>
  remote(contract.hosts.availability, getLink().client.hosts.availability, {
    lingerMs: LINGER_MS,
  })
);
const refsModel = lazy(() =>
  remote(contract.sourceControl.repository.model, getLink().client.sourceControl.repository.model, {
    lingerMs: LINGER_MS,
  })
);

export function useProjects() {
  return useRemoteModelState(contract.projects.projectList, projectListModel, undefined, 'list');
}

export function useTaskList(projectId: string) {
  return useRemoteModelState(contract.tasks.taskList, taskListModel, { projectId }, 'list');
}

export function useHostAvailability(connectionId: string | null) {
  return useRemoteModelState(
    contract.hosts.availability,
    availabilityModel,
    { host: { type: 'remote', id: connectionId ?? 'none' } },
    'state',
    { enabled: connectionId !== null }
  );
}

export function useBranchRefs(projectId: string | null) {
  return useRemoteModelState(
    contract.sourceControl.repository.model,
    refsModel,
    { projectId: projectId ?? 'none' },
    'refs',
    { enabled: projectId !== null }
  );
}

export type ProjectListModel = RemoteModel<typeof contract.projects.projectList>;

const acpSessionModel = lazy(() =>
  remote(contract.conversations.acp.session, getLink().client.conversations.acp.session, {
    lingerMs: LINGER_MS,
  })
);

export function useAcpSession(conversationId: string) {
  return useRemoteModelState(
    contract.conversations.acp.session,
    acpSessionModel,
    { conversationId },
    'state'
  );
}

const checkoutModel = lazy(() =>
  remote(contract.sourceControl.checkout.model, getLink().client.sourceControl.checkout.model, {
    lingerMs: LINGER_MS,
  })
);

/** The task checkout's HEAD (branch, commit, upstream) while a review screen shows it. */
export function useCheckoutHead(workspaceId: string | null) {
  return useRemoteModelState(
    contract.sourceControl.checkout.model,
    checkoutModel,
    { workspaceId: workspaceId ?? 'none' },
    'head',
    { enabled: workspaceId !== null }
  );
}
