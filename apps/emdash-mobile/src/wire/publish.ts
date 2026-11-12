import { mobileWireContract } from '@core/features/mobile-remote/api/mobile-contract';
import { createLiveJobReplicaCache } from '@emdash/wire/live';
import { describeError } from '../model/errors';
import { getLink } from './connection';

export type PublishResult = { ok: true } | { ok: false; message: string };

/**
 * Publishes a task branch to `remote` under its own name (the desktop's "Publish branch"):
 * the `sourceControl.checkout.publish` job, never a forced push.
 */
export async function publishBranch(workspaceId: string, remote: string): Promise<PublishResult> {
  const jobs = createLiveJobReplicaCache(
    mobileWireContract.sourceControl.checkout.publish,
    getLink().client.sourceControl.checkout.publish
  );
  try {
    const lease = await jobs.start({ workspaceId, remote });
    try {
      const job = await lease.ready();
      await job.result;
      return { ok: true };
    } finally {
      await lease.release();
    }
  } catch (error) {
    return { ok: false, message: describeError(error, 'Could not push the branch.') };
  } finally {
    await jobs.dispose();
  }
}
