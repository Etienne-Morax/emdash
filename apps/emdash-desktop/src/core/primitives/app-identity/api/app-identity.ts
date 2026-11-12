type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.emdash.canary' : 'com.emdash.stable';
/** User-facing product name: bundle name, window title, menus, tray and UI copy. */
export const PRODUCT_NAME = isCanary ? 'Morax Code Canary' : 'Morax Code';
/**
 * Name passed to `app.setName()`. Electron derives the macOS keychain item that holds the
 * `safeStorage` key from it ("<name> Safe Storage" / "<name> Key"), and the logs directory.
 * It must stay on the pre-rebrand value, or every stored secret becomes unreadable.
 */
export const INTERNAL_APP_NAME = isCanary ? 'Emdash Canary' : 'Emdash';
export const APP_NAME_LOWER = isCanary ? 'emdash-canary' : 'emdash';
export const LINUX_DESKTOP_ID = isCanary ? 'emdash-canary' : 'Emdash';
export const USER_DATA_DIR_NAME = isDev ? 'emdash-dev' : isCanary ? 'emdash-canary' : 'emdash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'emdash-canary' : 'emdash';
export const R2_BASE_URL = 'https://releases.emdash.sh';
export const IS_CANARY = isCanary;
