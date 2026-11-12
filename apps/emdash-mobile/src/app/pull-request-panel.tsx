import type { MobilePullRequest } from '@core/features/mobile-remote/api/schemas';
import type { CheckoutHeadState } from '@emdash/core/runtimes/git/api';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { describeError } from '../model/errors';
import { publishPlan, type ReviewBase } from '../model/review';
import { getLink } from '../wire/connection';
import { publishBranch } from '../wire/publish';

type Lookup =
  | { kind: 'loading' }
  | { kind: 'loaded'; prs: MobilePullRequest[] }
  | { kind: 'failed'; message: string };

/**
 * The task's pull request: a link when one is open, else the desktop's "Create PR" flow —
 * publish the branch if the remote lacks it, then open the pull request against the base.
 */
export function PullRequestPanel(props: {
  projectId: string;
  workspaceId: string;
  branch: string;
  base: ReviewBase;
  head: CheckoutHeadState | undefined;
  defaultTitle: string;
  hasCommits: boolean;
}) {
  const { projectId, workspaceId, branch, base, head } = props;
  const [lookup, setLookup] = useState<Lookup>({ kind: 'loading' });
  const [title, setTitle] = useState(props.defaultTitle);
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [step, setStep] = useState<'idle' | 'publishing' | 'creating'>('idle');
  const [error, setError] = useState<string>();
  const plan = publishPlan(head, base);
  const client = getLink().client;

  const refresh = useCallback(async () => {
    const result = await client.mobile.pullRequests
      .forBranch({ projectId, branch })
      .catch((cause: unknown) => ({
        success: false as const,
        error: { message: describeError(cause, 'Emdash is out of reach.') },
      }));
    setLookup(
      result.success
        ? { kind: 'loaded', prs: result.data.prs }
        : { kind: 'failed', message: result.error.message }
    );
  }, [client, projectId, branch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== 'idle' || !title.trim()) return;
    setError(undefined);
    if (plan.needed) {
      setStep('publishing');
      const published = await publishBranch(workspaceId, plan.remote);
      if (!published.ok) {
        setStep('idle');
        setError(published.message);
        return;
      }
    }
    setStep('creating');
    const result = await client.mobile.pullRequests
      .create({ projectId, head: branch, base: base.name, title, body, draft })
      .catch((cause: unknown) => ({
        success: false as const,
        error: { message: describeError(cause, 'Emdash is out of reach.') },
      }));
    setStep('idle');
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    await refresh();
  };

  const open = lookup.kind === 'loaded' ? lookup.prs.filter((pr) => pr.status === 'open') : [];
  const action =
    step === 'publishing'
      ? 'Pushing…'
      : step === 'creating'
        ? 'Creating…'
        : `${plan.needed ? 'Push & create' : 'Create'} ${draft ? 'draft PR' : 'pull request'}`;

  return (
    <section className="review-section">
      <h2 className="morax-eyebrow">Pull request</h2>
      {lookup.kind === 'loading' && <p className="morax-caption">Looking for a pull request…</p>}
      {lookup.kind === 'failed' && <p className="form-error">{lookup.message}</p>}
      {open.map((pr) => (
        <a
          key={pr.url}
          className="pr-link morax-glass"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className="morax-headline">
            {pr.number ? `#${pr.number} ` : ''}
            {pr.title}
          </span>
          <span className="morax-caption">
            {pr.isDraft ? 'Draft · open' : 'Open'} — view on the web
          </span>
        </a>
      ))}
      {lookup.kind === 'loaded' && open.length === 0 && (
        <form className="morax-glass new-task-form" onSubmit={(event) => void submit(event)}>
          <p className="morax-caption">
            {branch} into {base.label}
            {plan.needed ? ' · the branch will be pushed first' : ''}
          </p>
          <label className="field">
            <span className="morax-eyebrow">Title</span>
            <input
              className="text-input"
              value={title}
              maxLength={256}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="morax-eyebrow">Description</span>
            <textarea
              className="composer-input prompt-input"
              rows={4}
              value={body}
              maxLength={20_000}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <label className="field-inline">
            <input
              type="checkbox"
              checked={draft}
              onChange={(event) => setDraft(event.target.checked)}
            />
            <span>Draft</span>
          </label>
          {!props.hasCommits && (
            <p className="morax-caption">
              The branch has no commit yet: there is nothing to merge.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="button-accent"
            disabled={step !== 'idle' || !title.trim() || !props.hasCommits}
          >
            {action}
          </button>
        </form>
      )}
    </section>
  );
}
