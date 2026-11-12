import type { TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import { chatLines } from './acp-transcript';

describe('chatLines', () => {
  it('keeps user and assistant messages in turn order and skips empty fragments', () => {
    const turns = [
      {
        id: 't2',
        seq: 2,
        initiator: 'user',
        items: [
          { kind: 'message', id: 'm3', seq: 0, role: 'user', text: 'Second question' },
          { kind: 'message', id: 'm4', seq: 1, role: 'assistant', text: '   ' },
        ],
      },
      {
        id: 't1',
        seq: 1,
        initiator: 'user',
        items: [
          { kind: 'message', id: 'm1', seq: 0, role: 'user', text: 'Hello' },
          { kind: 'message', id: 'm2', seq: 1, role: 'assistant', text: 'Hi!' },
        ],
      },
    ] as unknown as TranscriptTurn[];

    expect(
      chatLines(turns).map((line) => (line.kind === 'message' ? line.text : line.title))
    ).toEqual(['Hello', 'Hi!', 'Second question']);
  });
});
