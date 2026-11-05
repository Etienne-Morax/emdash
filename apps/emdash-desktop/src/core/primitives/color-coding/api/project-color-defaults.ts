import type { LocalMachineIconRule, ProjectColorRule } from './color-coding';
import { moraxProjectColor } from './morax-palette';

/**
 * Default project colours applied before the hash fallback. Empty upstream; this fork maps
 * its repositories to the Morax palette (same colours as the Claude session titles).
 */
export const PROJECT_COLOR_DEFAULT_RULES: readonly ProjectColorRule[] = [moraxProjectColor];

/** Default icon rules for this computer, applied before the hardware-family default. */
export const LOCAL_MACHINE_ICON_RULES: readonly LocalMachineIconRule[] = [];
