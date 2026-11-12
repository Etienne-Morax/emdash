import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_ID,
  INTERNAL_APP_NAME,
  PRODUCT_NAME,
  USER_DATA_DIR_NAME,
} from '@core/primitives/app-identity/api/app-identity';
import * as canaryIdentity from '@core/primitives/app-identity/api/app-identity.canary';
import { loadAppConfig } from '../../core/config';

const mocks = vi.hoisted(() => ({
  setName: vi.fn(),
  setAboutPanelOptions: vi.fn(),
  setPath: vi.fn(),
  getPath: vi.fn(() => '/Users/test/Library/Application Support'),
}));

vi.mock('electron', () => ({ app: mocks }));

const { applyIdentity } = await import('./apply-identity');

describe('applyIdentity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the pre-rebrand app name so the safeStorage keychain item still resolves', () => {
    applyIdentity(loadAppConfig({}));

    // Electron derives "<name> Safe Storage" from app.getName(); the existing item is
    // "Emdash Safe Storage", so the name passed to setName must stay "Emdash".
    expect(mocks.setName).toHaveBeenCalledWith('Emdash');
    expect(INTERNAL_APP_NAME).toBe('Emdash');
    expect(INTERNAL_APP_NAME).not.toBe(PRODUCT_NAME);
  });

  it('shows the product name in the About panel', () => {
    applyIdentity(loadAppConfig({}));

    expect(PRODUCT_NAME).toBe('Morax Code');
    expect(mocks.setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: 'Morax Code' });
  });

  it('keeps the existing app id and user data directory', () => {
    applyIdentity(loadAppConfig({}));

    expect(APP_ID).toBe('com.emdash.stable');
    expect(USER_DATA_DIR_NAME).toMatch(/^emdash(-dev)?$/);
    expect(mocks.setPath).toHaveBeenCalledWith(
      'userData',
      join('/Users/test/Library/Application Support', USER_DATA_DIR_NAME)
    );
  });

  it('keeps the canary internal name and id stable', () => {
    expect(canaryIdentity.INTERNAL_APP_NAME).toBe('Emdash Canary');
    expect(canaryIdentity.APP_ID).toBe('com.emdash.canary');
    expect(canaryIdentity.PRODUCT_NAME).toBe('Morax Code Canary');
  });
});
