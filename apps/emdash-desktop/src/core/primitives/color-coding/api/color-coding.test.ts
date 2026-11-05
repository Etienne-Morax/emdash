import { describe, expect, it } from 'vitest';
import {
  COLOR_CODE_KEYS,
  defaultLocalMachineIcon,
  COLOR_CODE_VALUES,
  describeMachine,
  hashedColor,
  repositoryNameFromPath,
  resolveMachineColor,
  resolveProjectColor,
  shortComputerName,
  stableHash,
} from './color-coding';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// Surfaces the stripe, dot and chip sit on: app chrome, sidebar, Morax grid tiles.
const LIGHT_SURFACES = ['#FFFFFF', '#F5F5F5', '#EDEDED', '#E5E5E5', '#EDF0FF'];
const DARK_SURFACES = ['#0A0A0A', '#171717', '#262626', '#2E2E2E', '#1E2040', '#080A24'];
const MIN_NON_TEXT_CONTRAST = 3;

describe('colour palette', () => {
  it.each(COLOR_CODE_KEYS)('keeps %s at 3:1 or more on light and dark surfaces', (key) => {
    for (const surface of LIGHT_SURFACES) {
      expect(contrast(COLOR_CODE_VALUES[key].light, surface)).toBeGreaterThanOrEqual(
        MIN_NON_TEXT_CONTRAST
      );
    }
    for (const surface of DARK_SURFACES) {
      expect(contrast(COLOR_CODE_VALUES[key].dark, surface)).toBeGreaterThanOrEqual(
        MIN_NON_TEXT_CONTRAST
      );
    }
  });
});

describe('stableHash', () => {
  it('is deterministic and spreads names over the palette', () => {
    expect(stableHash('emdash')).toBe(stableHash('emdash'));
    expect(hashedColor('Emdash')).toBe(hashedColor('emdash'));
    const colors = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map(hashedColor));
    expect(colors.size).toBeGreaterThan(2);
  });
});

describe('repositoryNameFromPath', () => {
  it('takes the last segment of POSIX and Windows paths', () => {
    expect(repositoryNameFromPath('/Users/me/Projects/morax-os/')).toBe('morax-os');
    expect(repositoryNameFromPath('C:\\code\\emdash')).toBe('emdash');
    expect(repositoryNameFromPath(undefined)).toBeUndefined();
  });
});

describe('resolveProjectColor', () => {
  const rules = [(name: string) => (name === 'morax-os' ? ('blue' as const) : undefined)];

  it('prefers the user setting over rules and hash', () => {
    expect(
      resolveProjectColor({ projectId: 'p', path: '/x/morax-os', override: 'purple', rules })
    ).toBe('purple');
  });

  it('falls back to a matching rule, case-insensitively', () => {
    expect(resolveProjectColor({ projectId: 'p', path: '/x/Morax-OS', rules })).toBe('blue');
  });

  it('ignores an unknown stored value and hashes the repository name', () => {
    expect(
      resolveProjectColor({ projectId: 'p', path: '/x/other', override: 'magenta', rules })
    ).toBe(hashedColor('other'));
  });

  it('hashes the project id when the project has no path', () => {
    expect(resolveProjectColor({ projectId: 'project-42', rules })).toBe(hashedColor('project-42'));
  });
});

describe('shortComputerName', () => {
  it('drops the owner from macOS computer names', () => {
    expect(shortComputerName('Etienne’s MacBook Pro')).toBe('MacBook Pro');
    expect(shortComputerName("Etienne's iMac")).toBe('iMac');
    expect(shortComputerName('MacBook Pro de Etienne')).toBe('MacBook Pro');
  });

  it('shortens host names and falls back when unknown', () => {
    expect(shortComputerName('imac.local')).toBe('imac');
    expect(shortComputerName('Etienne-MBP.tail1234.ts.net')).toBe('Etienne-MBP');
    expect(shortComputerName('')).toBe('This computer');
  });
});

describe('describeMachine', () => {
  it('labels local projects with the computer name', () => {
    expect(
      describeMachine({
        connectionId: undefined,
        connectionName: undefined,
        computerName: 'Etienne’s MacBook Pro',
      })
    ).toEqual({ kind: 'local', label: 'MacBook Pro', icon: 'laptop' });
  });

  it('labels SSH projects with the connection name and its colour', () => {
    expect(
      describeMachine({
        connectionId: 'c1',
        connectionName: 'NAS VM',
        computerName: 'whatever',
        machineColors: { c1: 'slate' },
      })
    ).toEqual({
      kind: 'remote',
      connectionId: 'c1',
      label: 'NAS VM',
      color: 'slate',
      icon: 'server',
    });
    expect(resolveMachineColor({ connectionId: 'c2' })).toBe(hashedColor('c2'));
  });
});

describe('machine icons', () => {
  it('detects the hardware family when no rule matches', () => {
    expect(defaultLocalMachineIcon('iMac17,1', [])).toBe('imac');
    expect(defaultLocalMachineIcon('MacBookAir10,1', [])).toBe('laptop');
    expect(defaultLocalMachineIcon(undefined, [])).toBe('laptop');
  });

  it('lets a rule pick the icon first', () => {
    expect(defaultLocalMachineIcon('MacBookPro18,2', [() => 'laptop-1'])).toBe('laptop-1');
  });

  it('prefers the user choice for local and remote machines', () => {
    expect(
      describeMachine({
        connectionId: undefined,
        connectionName: undefined,
        computerName: 'iMac',
        computerModel: 'iMac17,1',
        machineIcons: { local: 'laptop-5' },
      })
    ).toMatchObject({ kind: 'local', icon: 'laptop-5' });
    expect(
      describeMachine({
        connectionId: 'c1',
        connectionName: 'NAS VM',
        computerName: undefined,
        machineIcons: { c1: 'imac' },
      })
    ).toMatchObject({ kind: 'remote', icon: 'imac' });
  });
});
