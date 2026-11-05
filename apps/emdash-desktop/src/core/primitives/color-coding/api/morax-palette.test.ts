import { describe, expect, it } from 'vitest';
import { defaultLocalMachineIcon, resolveProjectColor } from './color-coding';
import { moraxLocalMachineIcon, moraxProjectColor } from './morax-palette';

// Expected values computed with ~/.claude/hooks/session_color.py `color_for`.
describe('moraxProjectColor', () => {
  it('maps known Morax repositories case-insensitively', () => {
    expect(moraxProjectColor('morax-os')).toBe('blue');
    expect(moraxProjectColor('Morax-OS')).toBe('blue');
    expect(moraxProjectColor('morax-chat')).toBe('purple');
    expect(moraxProjectColor('the game-morax super app')).toBe('red');
    expect(moraxProjectColor('web-monitoring')).toBe('slate');
  });

  it('matches the hook SHA-256 fallback for other repositories', () => {
    expect(moraxProjectColor('emdash')).toBe('orange'); // 🟠
    expect(moraxProjectColor('alpha')).toBe('blue'); // 🔵
    expect(moraxProjectColor('beta')).toBe('orange'); // 🟠
    expect(moraxProjectColor('Plants Manager')).toBe('yellow'); // 🟡
    expect(moraxProjectColor('DJ-Morax')).toBe('purple'); // 🟣
    expect(moraxProjectColor('victoria')).toBe('green'); // 🟢
    expect(moraxProjectColor('nas-homelab')).toBe('brown'); // 🟤
  });

  it('is the fork default, still behind an explicit user choice', () => {
    expect(resolveProjectColor({ projectId: 'p', path: '/srv/morax-os' })).toBe('blue');
    expect(resolveProjectColor({ projectId: 'p', path: '/srv/morax-os', override: 'gray' })).toBe(
      'gray'
    );
  });
});

describe('moraxLocalMachineIcon', () => {
  it('shows the M1 Max MacBook Pro as laptop 1 and leaves the iMac to the default', () => {
    expect(moraxLocalMachineIcon('MacBookPro18,2')).toBe('laptop-1');
    expect(defaultLocalMachineIcon('MacBookPro18,2')).toBe('laptop-1');
    expect(defaultLocalMachineIcon('iMac17,1')).toBe('imac');
  });
});
