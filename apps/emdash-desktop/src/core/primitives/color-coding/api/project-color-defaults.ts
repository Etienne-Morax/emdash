import type { ProjectColorRule } from './color-coding';
import { moraxProjectColor } from './morax-palette';

/**
 * Default project colours applied before the hash fallback. Empty upstream; this fork maps
 * its repositories to the Morax palette (same colours as the Claude session titles).
 */
export const PROJECT_COLOR_DEFAULT_RULES: readonly ProjectColorRule[] = [moraxProjectColor];
