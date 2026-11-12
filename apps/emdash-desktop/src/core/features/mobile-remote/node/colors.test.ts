import { describe, expect, it } from 'vitest';
import {
  COLOR_CODE_VALUES,
  resolveMachineColor,
  resolveProjectColor,
} from '@core/primitives/color-coding/api/color-coding';
import { resolveMobileColors } from './colors';

describe('resolveMobileColors', () => {
  it('resolves colours with the desktop rules and honours Settings overrides', () => {
    const colors = resolveMobileColors({
      request: {
        projects: [
          { id: 'p1', path: '/Users/me/code/emdash' },
          { id: 'p2', path: '/srv/api' },
        ],
      },
      machineIds: ['ssh-1', 'ssh-2'],
      overrides: { projectColors: { p2: 'green' }, machineColors: { 'ssh-2': 'red' } },
    });

    const expectedP1 = resolveProjectColor({ projectId: 'p1', path: '/Users/me/code/emdash' });
    expect(colors.projects).toEqual({
      p1: COLOR_CODE_VALUES[expectedP1].dark,
      p2: COLOR_CODE_VALUES.green.dark,
    });
    expect(colors.machines).toEqual({
      'ssh-1': COLOR_CODE_VALUES[resolveMachineColor({ connectionId: 'ssh-1' })].dark,
      'ssh-2': COLOR_CODE_VALUES.red.dark,
    });
    expect(colors.localMachine).toBe(COLOR_CODE_VALUES.slate.dark);
  });

  it('ignores an override that is not a known colour', () => {
    const colors = resolveMobileColors({
      request: { projects: [{ id: 'p1' }] },
      machineIds: [],
      overrides: { projectColors: { p1: 'not-a-colour' }, machineColors: {} },
    });
    expect(colors.projects.p1).toBe(
      COLOR_CODE_VALUES[resolveProjectColor({ projectId: 'p1' })].dark
    );
  });
});
