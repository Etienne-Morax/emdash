import type { AgentStatus } from '@core/primitives/agents/api';

/** Upper bound on simultaneously mounted tiles; each tile owns a live xterm surface. */
export const TASK_GRID_MAX_TILES = 16;

/** Preferred width / height ratio of one tile (a terminal reads best slightly wider than tall). */
export const TASK_GRID_TILE_ASPECT = 1.6;

export type TaskGridDimensions = { columns: number; rows: number };

/**
 * Picks the column/row count for `count` tiles so each tile is as close as possible to
 * {@link TASK_GRID_TILE_ASPECT} inside a container of `containerAspect` (width / height).
 * Yields the familiar 2×2, 3×2 and 4×3 layouts on a typical 16:10 window.
 */
export function computeTaskGridDimensions(
  count: number,
  containerAspect: number = TASK_GRID_TILE_ASPECT
): TaskGridDimensions {
  if (count <= 0) return { columns: 1, rows: 1 };
  const aspect =
    Number.isFinite(containerAspect) && containerAspect > 0
      ? containerAspect
      : TASK_GRID_TILE_ASPECT;
  const ideal = Math.ceil(Math.sqrt((count * aspect) / TASK_GRID_TILE_ASPECT));
  const columns = Math.min(count, Math.max(1, ideal));
  return { columns, rows: Math.ceil(count / columns) };
}

/** Status of a conversation as the grid sees it. */
export type TaskGridConversationCandidate = {
  id: string;
  status: AgentStatus;
  seen: boolean;
  lastInteractedAt: string | null;
  isInitialConversation: boolean;
};

function attentionRank(candidate: TaskGridConversationCandidate): number {
  if (candidate.status === 'awaiting-input' && !candidate.seen) return 0;
  if (candidate.status === 'working') return 1;
  if (candidate.status === 'error' && !candidate.seen) return 2;
  if (candidate.status === 'awaiting-input') return 3;
  return 4;
}

function interactionTime(candidate: TaskGridConversationCandidate): number {
  if (!candidate.lastInteractedAt) return 0;
  const time = Date.parse(candidate.lastInteractedAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Chooses which conversation a tile shows by default: the one that most needs attention,
 * then the most recently used, then the task's initial conversation.
 */
export function pickTaskGridConversation(
  candidates: readonly TaskGridConversationCandidate[]
): string | undefined {
  const sorted = [...candidates].sort(
    (a, b) =>
      attentionRank(a) - attentionRank(b) ||
      interactionTime(b) - interactionTime(a) ||
      Number(b.isInitialConversation) - Number(a.isInitialConversation)
  );
  return sorted[0]?.id;
}

export type TaskGridEntry = { projectId: string; taskId: string };

/** Stable tile identity across re-renders. */
export function taskGridEntryKey({ projectId, taskId }: TaskGridEntry): string {
  return `${projectId}:${taskId}`;
}

/**
 * Merges pinned and per-project task lists into one de-duplicated grid order and caps it.
 * Pinned tasks come first, then projects in sidebar order.
 */
export function buildTaskGridEntries(
  pinned: readonly TaskGridEntry[],
  byProject: readonly TaskGridEntry[],
  limit: number = TASK_GRID_MAX_TILES
): { entries: TaskGridEntry[]; overflow: number } {
  const seen = new Set<string>();
  const all: TaskGridEntry[] = [];
  for (const entry of [...pinned, ...byProject]) {
    const key = taskGridEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(entry);
  }
  return { entries: all.slice(0, limit), overflow: Math.max(0, all.length - limit) };
}
