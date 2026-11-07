import { Badge, RelativeTime } from '@emdash/ui/react/primitives';
import { MachineIcon } from '@core/features/workbench/contributions/browser/color-coding/machine-icons';
import { cn } from '@core/primitives/styling/browser/cn';
import type { FleetJob, FleetMachine } from '../api/schemas';
import {
  describeFleetJob,
  describeMachineAvailability,
  fleetMachineIcon,
  jobStateLabel,
  jobStateTone,
  machineModeLabel,
  splitFleetJobs,
} from './fleet-model';

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-sm font-medium text-foreground">
      {title}
      <span className="text-xs text-foreground-muted tabular-nums">{count}</span>
    </h2>
  );
}

function MachineRow({ machine }: { machine: FleetMachine }) {
  const heartbeat = machine.lastHeartbeatAt;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="relative shrink-0">
        <MachineIcon icon={fleetMachineIcon(machine.name)} className="size-5 text-foreground" />
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background',
            machine.isAlive ? 'bg-foreground-success' : 'bg-foreground-error'
          )}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{machine.name}</span>
          <Badge tone={machine.mode === 'claim' ? 'info' : 'neutral'} variant="outline">
            {machineModeLabel(machine.mode)}
          </Badge>
          {machine.activeJobs > 0 && (
            <Badge tone="info">
              {machine.activeJobs} {machine.activeJobs === 1 ? 'job' : 'jobs'}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-foreground-muted">
          {machine.isAlive ? 'Alive' : 'Silent'}
          {heartbeat ? (
            <>
              {' · heartbeat '}
              <RelativeTime value={heartbeat} />
            </>
          ) : (
            ' · never seen'
          )}
          {' · '}
          {describeMachineAvailability(machine)}
          {machine.capabilities.length > 0 && ` · ${machine.capabilities.join(', ')}`}
        </p>
      </div>
    </li>
  );
}

export function FleetMachinesSection({ machines }: { machines: readonly FleetMachine[] }) {
  return (
    <section aria-label="Machines" className="flex flex-col gap-2">
      <SectionHeading title="Machines" count={machines.length} />
      {machines.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No executor has registered yet. Install one with deploy/mac-fleet/install.sh.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {machines.map((machine) => (
            <MachineRow key={machine.name} machine={machine} />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRow({ job, now }: { job: FleetJob; now: number }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Badge tone={jobStateTone(job.state)} className="mt-0.5 shrink-0">
        {jobStateLabel(job.state)}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{job.repo}</span>
          <span className="shrink-0 text-xs text-foreground-muted tabular-nums">#{job.id}</span>
          {job.priority !== null && job.priority <= 2 && (
            <Badge tone="warning" variant="outline">
              P{job.priority}
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-xs text-foreground-muted">
            <RelativeTime value={job.updatedAt} />
          </span>
        </div>
        <p className="truncate text-xs text-foreground-muted">
          {describeFleetJob(job, now)}
          {job.provider && ` · ${job.provider}`}
          {job.approvalActionId !== null && ` · gate card #${job.approvalActionId}`}
        </p>
        {job.specExcerpt && (
          <p className="line-clamp-2 text-xs text-foreground-muted/80">{job.specExcerpt}</p>
        )}
      </div>
    </li>
  );
}

function JobList({ jobs, now }: { jobs: readonly FleetJob[]; now: number }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} now={now} />
      ))}
    </ul>
  );
}

export function FleetJobsSection({ jobs, now }: { jobs: readonly FleetJob[]; now: number }) {
  const { open, ended } = splitFleetJobs(jobs);
  return (
    <>
      <section aria-label="Open jobs" className="flex flex-col gap-2">
        <SectionHeading title="Open jobs" count={open.length} />
        {open.length === 0 ? (
          <p className="text-sm text-foreground-muted">Nothing queued or running.</p>
        ) : (
          <JobList jobs={open} now={now} />
        )}
      </section>
      {ended.length > 0 && (
        <section aria-label="Ended in the last 24 hours" className="flex flex-col gap-2">
          <SectionHeading title="Ended in the last 24 hours" count={ended.length} />
          <JobList jobs={ended} now={now} />
        </section>
      )}
    </>
  );
}
