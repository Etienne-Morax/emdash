import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEventStreamHost } from '../../live/event-stream';
import { LiveLogSource } from '../../live/log/source';
import { LiveStateSource } from '../../live/state/source';
import { client } from '../../rpc/client';
import { createController } from '../../rpc/controller';
import { connect } from '../connect';
import { defineContract, eventStream, liveLog, liveModel, liveState, procedure } from '../define';
import type { WireMessage, WireTransport } from '../protocol';
import { serve } from '../serve';
import { encodeWireFrame } from './frame-codec';
import { memoryTransportPair } from './memory';

/**
 * Protocol fixtures for the native iOS client (`apps/morax-code-ios`, fork-only).
 *
 * The Swift client reimplements Wire (frames, calls, live states with Immer patches, live
 * logs, event streams). This test records a scripted session from the real implementation —
 * every message with its exact binary frame — and the Swift tests replay it, so both sides
 * stay in sync. Regenerate after a protocol change:
 * `UPDATE_WIRE_FIXTURES=1 pnpm exec vitest run src/api/transports/ios-fixtures.test.ts`.
 */

const FIXTURE_PATH = join(
  __dirname,
  '../../../../../apps/morax-code-ios/Fixtures/wire-protocol.json'
);

type Recorded = { from: 'client' | 'server'; message: unknown; frame: string };

const demoContract = defineContract({
  greet: procedure({ input: z.object({ name: z.string() }), output: z.string() }),
  board: liveModel({
    key: z.object({ id: z.string() }),
    states: {
      list: liveState({
        data: z.object({
          items: z.array(z.object({ id: z.string(), title: z.string(), done: z.boolean() })),
        }),
      }),
    },
  }),
  output: liveLog({ key: z.object({ id: z.string() }) }),
  events: eventStream({
    key: z.void().optional(),
    event: z.object({ type: z.string(), id: z.string() }),
  }),
});

/** Records every message crossing a transport, normalized for stable fixtures. */
function tap(transport: WireTransport, from: Recorded['from'], log: Recorded[]): WireTransport {
  return {
    ...transport,
    post(message) {
      log.push(record(from, message));
      transport.post(message);
    },
  };
}

const ids = new Map<string, string>();
function stableId(id: string): string {
  if (!ids.has(id)) ids.set(id, `id-${ids.size + 1}`);
  return ids.get(id)!;
}

function record(from: Recorded['from'], message: WireMessage): Recorded {
  // Request ids are random and clocks vary: map both to stable values.
  const normalized = JSON.parse(
    JSON.stringify(message, (key, value: unknown) =>
      (key === 'timestamp' || key === 'generation') && typeof value === 'number' ? 0 : value
    )
  ) as WireMessage & { id?: unknown };
  if (typeof normalized.id === 'string') normalized.id = stableId(normalized.id);
  return {
    from,
    message: normalized,
    frame: Buffer.from(encodeWireFrame(normalized)).toString('hex'),
  };
}

async function recordSession(): Promise<{ session: Recorded[]; final: unknown }> {
  const log: Recorded[] = [];
  const board = new LiveStateSource(
    { items: [{ id: 'a', title: 'Read the plan', done: false }] },
    0
  );
  const output = new LiveLogSource({ generation: 0 });
  const events = createEventStreamHost(demoContract.events);
  const controller = createController(demoContract, {
    greet: ({ name }) => `hello ${name}`,
    board: {
      kind: 'liveModelProvider' as const,
      contract: demoContract.board,
      resolveState: () => board,
      runMutation: async (): Promise<never> => {
        throw new Error('no mutations');
      },
    },
    output: () => output,
    events,
  });
  const pair = memoryTransportPair();
  const stop = serve(tap(pair.right, 'server', log), controller);
  const connection = connect(tap(pair.left, 'client', log));
  const api = client(demoContract, connection);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  await api.greet({ name: 'phone' });
  await api.greet({ name: '' }).catch(() => undefined);

  const listHandle = api.board.state({ id: 'b1' }, 'list');
  await listHandle.snapshot();
  const detachList = await listHandle.attach(() => undefined);
  board.produce((draft) => {
    draft.items.push({ id: 'b', title: 'Ship it', done: false });
  });
  board.produce((draft) => {
    draft.items[0]!.done = true;
    draft.items[1]!.title = 'Ship it — émoji 🚀';
  });
  board.produce((draft) => {
    draft.items.splice(0, 1);
  });
  await settle();

  output.append('$ claude\r\n');
  const outputHandle = api.output.handle({ id: 't1' });
  await outputHandle.snapshot();
  const detachOutput = await outputHandle.attach(() => undefined);
  output.append('\u001b[32mready\u001b[0m\r\n');
  await settle();

  const unsubscribe = await api.events.subscribe(undefined, { onEvent: () => undefined });
  await settle();
  events.emit(undefined, { type: 'agent-status', id: 'c1' });
  await settle();

  await detachList();
  await detachOutput();
  unsubscribe();
  await settle();
  connection.dispose();
  stop();
  const final = { board: board.snapshot().data, output: output.snapshot().data.text };
  return { session: log, final };
}

describe('wire protocol fixtures for the native iOS client', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    ids.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('match a session recorded from the TypeScript implementation', async () => {
    const text = `${JSON.stringify(await recordSession(), null, 2)}\n`;
    if (process.env.UPDATE_WIRE_FIXTURES === '1') writeFileSync(FIXTURE_PATH, text);
    expect(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))).toEqual(JSON.parse(text));
  });
});
