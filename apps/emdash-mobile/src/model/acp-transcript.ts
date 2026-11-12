import type { TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';

export type ChatLine =
  | { kind: 'message'; key: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; key: string; title: string };

/**
 * Flattens ACP turns into the lines a phone shows: user and assistant messages, and one line
 * per tool call. Thinking and notifications are left out. Consecutive assistant fragments of
 * one turn are already merged by the reducer.
 */
export function chatLines(turns: readonly TranscriptTurn[]): ChatLine[] {
  const lines: ChatLine[] = [];
  const ordered = [...turns].sort((a, b) => a.seq - b.seq);
  for (const turn of ordered) {
    for (const [index, item] of turn.items.entries()) {
      if ('kind' in item && item.kind === 'message') {
        if (item.text.trim().length === 0) continue;
        lines.push({
          kind: 'message',
          key: `${turn.id}:${item.id}`,
          role: item.role,
          text: item.text,
        });
        continue;
      }
      const title = toolTitle(item);
      if (title) lines.push({ kind: 'tool', key: `${turn.id}:${itemKey(item, index)}`, title });
    }
  }
  return lines;
}

function toolTitle(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const call = (record['toolCall'] ?? record) as Record<string, unknown>;
  const title = call['title'];
  return typeof title === 'string' && title.length > 0 ? title : null;
}

function itemKey(item: unknown, index: number): string {
  const record = item as Record<string, unknown>;
  const id = record['id'] ?? (record['toolCall'] as Record<string, unknown> | undefined)?.['id'];
  return typeof id === 'string' ? id : `item-${index}`;
}
