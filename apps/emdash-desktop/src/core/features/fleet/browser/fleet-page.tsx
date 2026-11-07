import { PageLayout } from '@emdash/ui/react/patterns';
import { Alert, Button, Icon, RelativeTime, Spinner } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { getFleetClient } from '../api/browser/client';
import type { FleetOverview } from '../api/schemas';
import { FleetConnectionForm } from './fleet-connection-form';
import { summarizeFleet } from './fleet-model';
import { FleetJobsSection, FleetMachinesSection } from './fleet-sections';
import { useFleetOverview } from './use-fleet-overview';

const REFRESH_TIMEOUT_MS = 15_000;

function FleetSummary({ overview }: { overview: FleetOverview }) {
  const snapshot = overview.snapshot;
  if (!snapshot) return <span />;
  const summary = summarizeFleet(snapshot.machines, snapshot.jobs);
  return (
    <p className="text-sm text-foreground-muted">
      {summary.aliveMachines}/{summary.machines} machines alive · {summary.runningJobs} running ·{' '}
      {summary.blockedJobs} blocked · {summary.queuedJobs} queued
      {overview.fetchedAt !== null && (
        <>
          {' · read '}
          <RelativeTime value={overview.fetchedAt} compact ago />
        </>
      )}
    </p>
  );
}

function FleetBody({ overview, now }: { overview: FleetOverview; now: number }) {
  const snapshot = overview.snapshot;
  return (
    <>
      {snapshot?.isKillSwitchEngaged && (
        <Alert.Root status="destructive">
          <Alert.Title>Kill switch engaged</Alert.Title>
          <Alert.Description>
            No new work starts until /reprise is sent in Telegram.
          </Alert.Description>
        </Alert.Root>
      )}
      {overview.status === 'error' && overview.error && (
        <Alert.Root status="warning">
          <Alert.Title>
            {snapshot ? 'Showing the last reading' : 'Could not read the fleet'}
          </Alert.Title>
          <Alert.Description>{overview.error.message}</Alert.Description>
        </Alert.Root>
      )}
      {overview.status === 'loading' && !snapshot && (
        <p className="flex items-center gap-2 text-sm text-foreground-muted">
          <Spinner size="sm" /> Reading the fleet…
        </p>
      )}
      {snapshot && (
        <>
          <FleetMachinesSection machines={snapshot.machines} />
          <FleetJobsSection jobs={snapshot.jobs} now={now} />
        </>
      )}
    </>
  );
}

export function FleetPage() {
  const state = useFleetOverview();
  const overview = state.value;
  const [isEditingConnection, setEditingConnection] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();

  async function refresh() {
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      if (state.error) await state.refresh();
      await (await getFleetClient()).refresh(undefined, { timeoutMs: REFRESH_TIMEOUT_MS });
    } catch {
      setRefreshError('Could not refresh the fleet. Try again.');
    } finally {
      setRefreshing(false);
    }
  }

  const isConfigured = overview !== undefined && overview.status !== 'unconfigured';
  const showForm = overview !== undefined && (!isConfigured || isEditingConnection);
  const pageError =
    refreshError ?? (state.error ? 'Could not load the fleet view. Try refreshing.' : undefined);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 py-8">
          <PageLayout.Header
            title="Fleet"
            description="Machines, heartbeats and jobs of the Morax fleet. Read only."
          />
          {isConfigured && (
            <div className="flex items-center justify-between gap-4">
              <FleetSummary overview={overview} />
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="text"
                  onClick={() => void refresh()}
                  disabled={isRefreshing}
                  aria-label="Refresh the fleet"
                >
                  <Icon name="rotate-cw" size="sm" />
                  {isRefreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
                <Button
                  variant="text"
                  onClick={() => setEditingConnection((editing) => !editing)}
                  aria-expanded={isEditingConnection}
                >
                  Connection
                </Button>
              </div>
            </div>
          )}
          {pageError && (
            <p role="alert" className="text-sm text-foreground-destructive">
              {pageError}
            </p>
          )}
          {overview === undefined && !state.error && (
            <p className="flex items-center gap-2 text-sm text-foreground-muted">
              <Spinner size="sm" /> Loading…
            </p>
          )}
          {showForm && (
            <FleetConnectionForm
              key={`${overview.endpoint}:${overview.hasApiKey}`}
              endpoint={overview.endpoint}
              hasApiKey={overview.hasApiKey}
              onCancel={isConfigured ? () => setEditingConnection(false) : undefined}
              onSaved={() => setEditingConnection(false)}
            />
          )}
          {isConfigured && <FleetBody overview={overview} now={Date.now()} />}
        </div>
      </div>
    </div>
  );
}
