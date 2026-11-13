import { LOCAL_MACHINE_ICON_RULES, PROJECT_COLOR_DEFAULT_RULES } from './project-color-defaults';

/**
 * Named colours used to tell projects and machines apart. Each key has a light and a dark
 * value that keeps at least 3:1 contrast (WCAG 1.4.11, non-text) against the app's light and
 * dark surfaces. The hues stay away from the agent status colours (amber, coral, mint) so a
 * project stripe is never read as a status.
 */
export const COLOR_CODE_KEYS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'brown',
  'slate',
  'gray',
] as const;

export type ColorCodeKey = (typeof COLOR_CODE_KEYS)[number];

export const COLOR_CODE_LABELS: Record<ColorCodeKey, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  slate: 'Slate',
  gray: 'Gray',
};

export const COLOR_CODE_VALUES: Record<ColorCodeKey, { light: string; dark: string }> = {
  red: { light: '#B4183C', dark: '#F06292' },
  orange: { light: '#B9470B', dark: '#F08A4B' },
  yellow: { light: '#8A6A00', dark: '#E2C541' },
  green: { light: '#17803D', dark: '#3FBF6A' },
  blue: { light: '#2457D6', dark: '#6C9EFF' },
  purple: { light: '#7A3FD8', dark: '#B39AFF' },
  brown: { light: '#8A5A2E', dark: '#C99A6B' },
  slate: { light: '#3D4A5C', dark: '#9AA8BC' },
  gray: { light: '#737B87', dark: '#D0D4DA' },
};

export function isColorCodeKey(value: unknown): value is ColorCodeKey {
  return typeof value === 'string' && (COLOR_CODE_KEYS as readonly string[]).includes(value);
}

/** FNV-1a (32-bit): stable across runs and platforms, no dependencies. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashedColor(key: string): ColorCodeKey {
  return COLOR_CODE_KEYS[stableHash(key.toLowerCase()) % COLOR_CODE_KEYS.length];
}

/** A default for a project identified by its repository directory name (case-insensitive). */
export type ProjectColorRule = (repositoryName: string) => ColorCodeKey | undefined;

/** Last path segment of a local or remote path, without trailing separators. */
export function repositoryNameFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1);
}

/**
 * Project colour, in order: the user's explicit choice, the first matching default rule,
 * then a stable hash of the repository name (or the project id when there is no path).
 */
export function resolveProjectColor(input: {
  projectId: string;
  path?: string;
  override?: unknown;
  rules?: readonly ProjectColorRule[];
}): ColorCodeKey {
  if (isColorCodeKey(input.override)) return input.override;
  const repositoryName = repositoryNameFromPath(input.path);
  if (repositoryName) {
    for (const rule of input.rules ?? PROJECT_COLOR_DEFAULT_RULES) {
      const color = rule(repositoryName.toLowerCase());
      if (color) return color;
    }
  }
  return hashedColor(repositoryName ?? input.projectId);
}

/** Machine colour for an SSH connection: the user's choice, else a stable hash of its id. */
export function resolveMachineColor(input: {
  connectionId: string;
  override?: unknown;
}): ColorCodeKey {
  return isColorCodeKey(input.override) ? input.override : hashedColor(input.connectionId);
}

/**
 * Short label for the local computer: "Etienne’s MacBook Pro" → "MacBook Pro",
 * "MacBook Pro de Etienne" → "MacBook Pro", "imac.local" → "imac".
 */
export function shortComputerName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'This computer';
  const possessive = /^.+?[’']s\s+(.+)$/u.exec(trimmed);
  if (possessive?.[1]) return possessive[1].trim();
  const french = /^(.+?)\s+(?:de|d’|d')\s*\S+$/u.exec(trimmed);
  if (french?.[1]) return french[1].trim();
  return trimmed.replace(/\.local$/i, '').split('.')[0] || trimmed;
}

/** Icons a machine chip can show. Numbered laptops tell several laptops apart. */
export const MACHINE_ICON_KEYS = ['laptop', 'laptop-1', 'laptop-5', 'imac', 'server'] as const;

export type MachineIconKey = (typeof MACHINE_ICON_KEYS)[number];

export const MACHINE_ICON_LABELS: Record<MachineIconKey, string> = {
  laptop: 'Laptop',
  'laptop-1': 'Laptop “1”',
  'laptop-5': 'Laptop “5”',
  imac: 'iMac',
  server: 'Server',
};

/** Settings key under which this computer's icon is stored in `machineIcons`. */
export const LOCAL_MACHINE_ICON_ID = 'local';

export function isMachineIconKey(value: unknown): value is MachineIconKey {
  return typeof value === 'string' && (MACHINE_ICON_KEYS as readonly string[]).includes(value);
}

/** A default icon for this computer from its hardware model id (e.g. "MacBookPro18,2"). */
export type LocalMachineIconRule = (model: string) => MachineIconKey | undefined;

/** Default icon for this computer: fork rules first, then the hardware family. */
export function defaultLocalMachineIcon(
  model: string | undefined,
  rules: readonly LocalMachineIconRule[] = LOCAL_MACHINE_ICON_RULES
): MachineIconKey {
  const id = (model ?? '').trim();
  for (const rule of rules) {
    const icon = rule(id);
    if (icon) return icon;
  }
  return /^imac/i.test(id) ? 'imac' : 'laptop';
}

export type MachineMarker =
  | { kind: 'local'; label: string; icon: MachineIconKey }
  | {
      kind: 'remote';
      connectionId: string;
      label: string;
      color: ColorCodeKey;
      icon: MachineIconKey;
    };

/** Describes where a project's sessions run, for the machine chip. */
export function describeMachine(input: {
  connectionId: string | undefined;
  connectionName: string | undefined;
  computerName: string | undefined;
  computerModel?: string;
  machineColors?: Record<string, unknown>;
  machineIcons?: Record<string, unknown>;
}): MachineMarker {
  if (!input.connectionId) {
    const chosen = input.machineIcons?.[LOCAL_MACHINE_ICON_ID];
    return {
      kind: 'local',
      label: shortComputerName(input.computerName),
      icon: isMachineIconKey(chosen) ? chosen : defaultLocalMachineIcon(input.computerModel),
    };
  }
  const chosen = input.machineIcons?.[input.connectionId];
  return {
    kind: 'remote',
    connectionId: input.connectionId,
    label: input.connectionName?.trim() || 'Remote machine',
    color: resolveMachineColor({
      connectionId: input.connectionId,
      override: input.machineColors?.[input.connectionId],
    }),
    icon: isMachineIconKey(chosen) ? chosen : 'server',
  };
}
