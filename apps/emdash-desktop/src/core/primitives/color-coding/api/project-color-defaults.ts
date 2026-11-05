import type { ProjectColorRule } from './color-coding';

/**
 * Default project colours applied before the hash fallback. Empty upstream; forks can map
 * their own repositories here without touching the resolver.
 */
export const PROJECT_COLOR_DEFAULT_RULES: readonly ProjectColorRule[] = [];
