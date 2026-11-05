import { Tooltip } from '@emdash/ui/react/primitives';
import { Laptop, Server } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { COLOR_CODE_LABELS } from '@core/primitives/color-coding/api/color-coding';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  machineMarkerFor,
  projectColorFor,
  useColorCodingSettings,
  useColorValue,
  useComputerName,
} from './use-color-coding';

/** Small round project colour mark. Renders nothing while colour coding is off. */
export const ProjectColorDot = observer(function ProjectColorDot({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const { enabled, projectColors } = useColorCodingSettings();
  const colorValue = useColorValue();
  if (!enabled) return null;
  const color = projectColorFor(projectId, projectColors);
  return (
    <span
      role="img"
      aria-label={`Project colour: ${COLOR_CODE_LABELS[color]}`}
      data-project-color={color}
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: colorValue(color) }}
    />
  );
});

/**
 * Thin vertical project stripe along the left edge of its positioned parent.
 * Decorative: the dot or the project name carries the information.
 */
export const ProjectColorStripe = observer(function ProjectColorStripe({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const { enabled, projectColors } = useColorCodingSettings();
  const colorValue = useColorValue();
  if (!enabled) return null;
  const color = projectColorFor(projectId, projectColors);
  return (
    <span
      aria-hidden
      data-project-stripe={color}
      className={cn('pointer-events-none absolute inset-y-0 left-0 w-[3px]', className)}
      style={{ backgroundColor: colorValue(color) }}
    />
  );
});

/**
 * Where the project's sessions run: the local computer (neutral, laptop icon) or an SSH
 * machine (its name, server icon and its own colour).
 */
export const MachineChip = observer(function MachineChip({
  projectId,
  compact = false,
  className,
}: {
  projectId: string;
  /** Icon only, with the machine name in a tooltip (sidebar rows). */
  compact?: boolean;
  className?: string;
}) {
  const { enabled, machineColors } = useColorCodingSettings();
  const computerName = useComputerName();
  const colorValue = useColorValue();
  if (!enabled) return null;
  const marker = machineMarkerFor(projectId, computerName, machineColors);
  const isLocal = marker.kind === 'local';
  const Icon = isLocal ? Laptop : Server;
  const accent = isLocal ? undefined : colorValue(marker.color);
  const description = isLocal ? `Runs on ${marker.label}` : `Runs on ${marker.label} (SSH)`;

  const chip = (
    <span
      data-machine-chip={marker.kind}
      aria-label={description}
      className={cn(
        'inline-flex h-5 max-w-[10rem] shrink-0 items-center gap-1 rounded-full border text-xs leading-none',
        compact ? 'w-5 justify-center px-0' : 'px-1.5',
        isLocal
          ? 'border-border bg-background text-foreground-muted'
          : 'bg-background text-foreground',
        className
      )}
      style={accent ? { borderColor: accent } : undefined}
    >
      <Icon className="size-3 shrink-0" style={accent ? { color: accent } : undefined} />
      {!compact && <span className="truncate">{marker.label}</span>}
    </span>
  );

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={chip} />
      <Tooltip.Content>{description}</Tooltip.Content>
    </Tooltip.Root>
  );
});
