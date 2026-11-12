import type { PullRequest } from '@emdash/plugins/pull-requests/schemas';
import { err, ok, type Result } from '@emdash/shared';
import type { ProviderRepositoryResult } from '@core/features/repository/api/contract';
import {
  providerRepositoryErrorMessage,
  type ProviderRepositoryError,
} from '@core/primitives/repository/api/provider-repository';
import {
  pullRequestErrorMessage,
  type PullRequestError,
} from '@core/services/pull-requests/api/errors';
import type { CreatePullRequestInput } from '@core/services/pull-requests/api/schemas';
import type { MobileCreatePullRequestInput } from '../api/mobile-contract';
import type { MobilePullRequest, MobilePullRequestError } from '../api/schemas';
import type { MobileLocalOperations } from './session-controller';

/** The desktop endpoints behind the phone's pull request operations. */
export type MobilePullRequestDesktop = {
  resolveProvider(input: { projectId: string }): Promise<ProviderRepositoryResult>;
  getPullRequestsForBranch(input: {
    repositoryUrl: string;
    branch: string;
  }): Promise<Result<{ prs: PullRequest[] }, PullRequestError>>;
  createPullRequest(
    input: CreatePullRequestInput
  ): Promise<Result<{ url: string; number: number }, PullRequestError>>;
};

const PROVIDER_REPOSITORY_ERRORS = new Set<string>([
  'no_remote',
  'invalid_remote',
  'no_integration_for_host',
  'ambiguous_host',
  'host_unreachable',
  'host_error',
]);
const PROJECT_UNAVAILABLE = 'The project is not available on its machine right now.';
const NO_PULL_REQUESTS = 'Emdash cannot open pull requests for this repository host.';

/**
 * Pull request operations for the phone. The phone names a project and branches only: the
 * repository URL always comes from the desktop's resolution of the project's remote, so a
 * phone can never aim a pull request at another repository.
 */
export function createMobilePullRequestOperations(
  desktop: MobilePullRequestDesktop
): MobileLocalOperations['pullRequests'] {
  async function repositoryUrlFor(
    projectId: string
  ): Promise<Result<string, MobilePullRequestError>> {
    const resolved = await desktop.resolveProvider({ projectId });
    if (!resolved.success) return err({ message: repositoryErrorMessage(resolved.error) });
    if (!resolved.data.capabilities.pullRequests) return err({ message: NO_PULL_REQUESTS });
    return ok(resolved.data.repositoryUrl);
  }

  return {
    async forBranch({ projectId, branch }: { projectId: string; branch: string }) {
      const repository = await repositoryUrlFor(projectId);
      if (!repository.success) return repository;
      const result = await desktop.getPullRequestsForBranch({
        repositoryUrl: repository.data,
        branch,
      });
      if (!result.success) return err({ message: pullRequestErrorMessage(result.error) });
      return ok({ prs: result.data.prs.map(toMobilePullRequest) });
    },
    async create(input: MobileCreatePullRequestInput) {
      const repository = await repositoryUrlFor(input.projectId);
      if (!repository.success) return repository;
      const body = input.body?.trim();
      const result = await desktop.createPullRequest({
        repositoryUrl: repository.data,
        head: input.head,
        base: input.base,
        title: input.title.trim(),
        body: body || undefined,
        draft: input.draft,
      });
      if (!result.success) return err({ message: pullRequestErrorMessage(result.error) });
      return ok(result.data);
    },
  };
}

function repositoryErrorMessage(error: { type?: unknown }): string {
  if (typeof error.type === 'string' && PROVIDER_REPOSITORY_ERRORS.has(error.type)) {
    return providerRepositoryErrorMessage(error as ProviderRepositoryError);
  }
  return PROJECT_UNAVAILABLE;
}

/** GitHub `/pull/<n>`, GitLab `/merge_requests/<n>`. */
const PULL_REQUEST_NUMBER = /\/(?:pull|merge_requests)\/(\d+)(?:[/?#]|$)/;

export function toMobilePullRequest(pr: PullRequest): MobilePullRequest {
  const match = PULL_REQUEST_NUMBER.exec(pr.url);
  return {
    number: match ? Number(match[1]) : null,
    url: pr.url,
    title: pr.title,
    status: pr.status,
    isDraft: pr.isDraft,
  };
}
