import type { AgentStatus } from '@core/primitives/agents/api/agent-events';
import type { ReactNode } from 'react';
import { STATUS_LABEL, type MachineChip as MachineChipModel } from '../model/task-board';
import type { LinkState } from '../wire/connection';
import { useHostAvailability } from '../wire/live';

const STATUS_TONE: Record<AgentStatus, string> = {
  'awaiting-input': 'accent',
  working: 'calm',
  error: 'danger',
  completed: 'success',
  idle: 'quiet',
};

export function StatusPill({ status }: { status: AgentStatus | null }) {
  const tone = status ? STATUS_TONE[status] : 'quiet';
  return (
    <span className={`status-pill tone-${tone}`} data-status={status ?? 'none'}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[status ?? 'none']}
    </span>
  );
}

export function MachineChip({ machine }: { machine: MachineChipModel }) {
  return (
    <span className="machine-chip" style={{ ['--chip-color' as string]: machine.color }}>
      <span className="machine-chip-dot" aria-hidden="true" />
      {machine.name}
    </span>
  );
}

/** Online state of one machine: this computer is online whenever the link is. */
export function MachineAvailability({
  machine,
  link,
}: {
  machine: MachineChipModel;
  link: LinkState;
}) {
  const availability = useHostAvailability(machine.kind === 'remote' ? machine.id : null);
  const state =
    link !== 'online'
      ? 'unknown'
      : machine.kind === 'local'
        ? 'online'
        : availability.value?.kind === 'ready'
          ? 'online'
          : availability.value?.kind === 'preparing'
            ? 'connecting'
            : availability.value
              ? 'offline'
              : 'unknown';
  const label: Record<typeof state, string> = {
    online: 'Online',
    connecting: 'Connecting',
    offline: 'Offline',
    unknown: '…',
  };
  return (
    <li className="machine-card morax-glass" data-state={state}>
      <MachineChip machine={machine} />
      <span className={`availability availability-${state}`}>{label[state]}</span>
    </li>
  );
}

export function LinkBanner({ link }: { link: LinkState }) {
  if (link === 'online') return null;
  const text =
    link === 'connecting'
      ? 'Connecting to Emdash…'
      : 'Emdash is out of reach. Is the Mac awake with Emdash open, and is Tailscale on?';
  return (
    <p className="link-banner" role="status">
      {text}
    </p>
  );
}

export function ScreenHeader(props: {
  eyebrow: string;
  title: string;
  back?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="screen-header">
      <div className="screen-header-row">
        {props.back}
        <span className="morax-eyebrow">{props.eyebrow}</span>
        <span className="screen-header-action">{props.action}</span>
      </div>
      <h1 className="morax-hero screen-title">{props.title}</h1>
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state morax-glass">
      <p className="morax-headline">{title}</p>
      {children && <p className="morax-caption">{children}</p>}
    </div>
  );
}
