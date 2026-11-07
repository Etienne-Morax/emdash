import type { BadgeTone } from '@emdash/ui/react/primitives';
import type { MachineIconKey } from '@core/primitives/color-coding/api/color-coding';
import { FLEET_TERMINAL_JOB_STATES, type FleetJob, type FleetMachine } from '../api/schemas';

const TERMINAL_STATES: ReadonlySet<string> = new Set(FLEET_TERMINAL_JOB_STATES);

/** Open jobs that need a look come first: a blocked job waits for Etienne. */
const OPEN_STATE_ORDER = ['blocked', 'running', 'leased', 'queued'];
const LOWEST_PRIORITY = 5;

const JOB_STATE_LABELS: Record<string, string> = {
  queued: 'Queued',
  leased: 'Starting',
  running: 'Running',
  blocked: 'Blocked',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  dead: 'Dead letter',
  expired: 'Expired',
};

const JOB_STATE_TONES: Record<string, BadgeTone> = {
  queued: 'neutral',
  leased: 'info',
  running: 'info',
  blocked: 'warning',
  done: 'success',
  failed: 'error',
  cancelled: 'neutral',
  dead: 'error',
  expired: 'warning',
};

const MACHINE_MODE_LABELS: Record<string, string> = {
  claim: 'Takes jobs',
  observe: 'Observe only',
  off: 'Off',
};

/** Morax machine names (`mbp-m1`, `mbp-m5`, `imac`, `vm`) to the machine chip icons. */
const FLEET_MACHINE_ICONS: readonly [RegExp, MachineIconKey][] = [
  [/imac/i, 'imac'],
  [/(^|[-_.])m1([-_.]|$)/i, 'laptop-1'],
  [/(^|[-_.])m5([-_.]|$)/i, 'laptop-5'],
  [/(^|[-_.])(vm|nas|linux|server)([-_.]|$)/i, 'server'],
];

export function isTerminalJobState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

export function jobStateLabel(state: string): string {
  return JOB_STATE_LABELS[state] ?? state;
}

export function jobStateTone(state: string): BadgeTone {
  return JOB_STATE_TONES[state] ?? 'neutral';
}

export function machineModeLabel(mode: string): string {
  return MACHINE_MODE_LABELS[mode] ?? mode;
}

export function fleetMachineIcon(name: string): MachineIconKey {
  return FLEET_MACHINE_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? 'laptop';
}

function timeOf(value: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function openRank(job: FleetJob): number {
  const index = OPEN_STATE_ORDER.indexOf(job.state);
  return index === -1 ? OPEN_STATE_ORDER.length : index;
}

/**
 * Open jobs (blocked, running, starting, queued; then urgent first, oldest first) and jobs
 * that ended in the snapshot window (most recent first). Returns new arrays.
 */
export function splitFleetJobs(jobs: readonly FleetJob[]): { open: FleetJob[]; ended: FleetJob[] } {
  const open = jobs
    .filter((job) => !isTerminalJobState(job.state))
    .sort(
      (a, b) =>
        openRank(a) - openRank(b) ||
        (a.priority ?? LOWEST_PRIORITY) - (b.priority ?? LOWEST_PRIORITY) ||
        timeOf(a.createdAt) - timeOf(b.createdAt)
    );
  const ended = jobs
    .filter((job) => isTerminalJobState(job.state))
    .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
  return { open, ended };
}

/** One line on where a job runs or what it waits for. */
export function describeFleetJob(job: FleetJob, now: number): string {
  const machine = job.machine ?? 'a machine';
  const attempts = `attempt ${job.attempt}/${job.maxAttempts}`;
  switch (job.state) {
    case 'blocked':
      return `Waiting for a permission or an answer at the gate · ${machine}`;
    case 'leased':
    case 'running':
      return job.leaseUntil !== null && timeOf(job.leaseUntil) < now
        ? `${machine} went silent; the job goes back to the queue`
        : `On ${machine} · ${attempts}`;
    case 'queued':
      if (job.notBefore !== null && timeOf(job.notBefore) > now) {
        return `Held until the quota resets`;
      }
      return job.pinnedMachine
        ? `Waiting for ${job.pinnedMachine}`
        : `Waiting for a free machine on ${job.queue}`;
    case 'done':
      return `Finished on ${machine}`;
    case 'failed':
      return `Failed on ${machine} · ${attempts}`;
    case 'dead':
      return `Lost its lease ${job.maxAttempts} times`;
    case 'expired':
      return 'Time to live passed before it finished';
    case 'cancelled':
      return 'Cancelled';
    default:
      return job.machine ? `On ${job.machine}` : `On ${job.queue}`;
  }
}

/** Plain-language availability, e.g. "Available" or "user present, on battery". */
export function describeMachineAvailability(machine: FleetMachine): string {
  if (machine.isAvailable === true) return 'Available';
  if (machine.isAvailable === false) {
    return machine.unavailableReasons.length > 0
      ? machine.unavailableReasons.join(', ')
      : 'Unavailable';
  }
  return 'Availability unknown';
}

/** Counts shown in the view header. */
export function summarizeFleet(machines: readonly FleetMachine[], jobs: readonly FleetJob[]) {
  return {
    aliveMachines: machines.filter((machine) => machine.isAlive).length,
    machines: machines.length,
    runningJobs: jobs.filter((job) => job.state === 'running' || job.state === 'leased').length,
    blockedJobs: jobs.filter((job) => job.state === 'blocked').length,
    queuedJobs: jobs.filter((job) => job.state === 'queued').length,
  };
}
