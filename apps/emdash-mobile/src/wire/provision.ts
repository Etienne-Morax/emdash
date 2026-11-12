import { mobileWireContract } from '@core/features/mobile-remote/api/mobile-contract';
import { createLiveJobReplicaCache } from '@emdash/wire/live';
import { getLink } from './connection';

export type ProvisionResult = { ok: true } | { ok: false; message: string };

const inFlight = new Map<string, Promise<ProvisionResult>>();

/**
 * Activates a task's workspace and session on its machine, exactly as the desktop's
 * `TaskManagerStore.provisionTask` does (the `workspaces.provision` job). Idempotent: an
 * already active task resolves at once. Concurrent calls for one task share the job.
 */
export function provisionTask(workspaceId: string, taskId: string): Promise<ProvisionResult> {
  const key = `${workspaceId}:${taskId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = run(workspaceId, taskId).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function run(workspaceId: string, taskId: string): Promise<ProvisionResult> {
  const client = getLink().client;
  const jobs = createLiveJobReplicaCache(
    mobileWireContract.workspaces.provision,
    client.workspaces.provision
  );
  try {
    const lease = await jobs.start({ workspaceId, taskId });
    try {
      const job = await lease.ready();
      await job.result;
      return { ok: true };
    } finally {
      await lease.release();
    }
  } catch (error) {
    return { ok: false, message: describe(error) };
  } finally {
    await jobs.dispose();
  }
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'Could not prepare the task workspace.';
}
