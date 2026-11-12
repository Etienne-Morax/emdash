import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { client } from '../../rpc/client';
import { createController } from '../../rpc/controller';
import { connect } from '../connect';
import { defineContract, procedure } from '../define';
import type { WireMessage } from '../protocol';
import { serve } from '../serve';
import { reconnectingTransport } from './reconnecting';
import { openWebSocketTransport, webSocketTransport, type WebSocketLike } from './websocket';

type Listener = (event: never) => void;

/** In-memory WHATWG-style WebSocket; `link()` connects two ends with async delivery. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  peer: FakeSocket | undefined;
  readonly sent: Array<Uint8Array | string> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, cb: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(cb);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners.get(type)?.delete(cb);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  emit(type: string, event: unknown = {}): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) (cb as (e: unknown) => void)(event);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  send(data: Uint8Array | string): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data);
    const peer = this.peer;
    const copy =
      typeof data === 'string'
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    queueMicrotask(() => peer?.receive(copy));
  }

  receive(data: unknown): void {
    if (this.readyState !== 1) return;
    this.emit('message', { data });
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const peer = this.peer;
    queueMicrotask(() => {
      this.emit('close');
      peer?.close();
    });
  }
}

function link(): { left: FakeSocket; right: FakeSocket } {
  const left = new FakeSocket();
  const right = new FakeSocket();
  left.peer = right;
  right.peer = left;
  left.open();
  right.open();
  return { left, right };
}

const api = defineContract({
  echo: procedure({ input: z.object({ text: z.string() }), output: z.string() }),
});

function serveEcho(socket: FakeSocket) {
  return serve(webSocketTransport(socket), createController(api, { echo: ({ text }) => text }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('webSocketTransport', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('round-trips procedure calls in binary frames', async () => {
    const { left, right } = link();
    cleanups.push(serveEcho(right));
    const connection = connect(webSocketTransport(left));
    cleanups.push(() => connection.dispose());

    await expect(client(api, connection).echo({ text: 'hello' })).resolves.toBe('hello');
    expect(left.binaryType).toBe('arraybuffer');
    expect(left.sent.every((frame) => frame instanceof Uint8Array)).toBe(true);
  });

  it('carries multi-megabyte messages', async () => {
    const { left, right } = link();
    cleanups.push(serveEcho(right));
    const connection = connect(webSocketTransport(left));
    cleanups.push(() => connection.dispose());
    const big = 'x'.repeat(4 * 1024 * 1024);

    await expect(client(api, connection).echo({ text: big })).resolves.toHaveLength(big.length);
  });

  it('round-trips blob chunks with raw bytes', async () => {
    const { left, right } = link();
    const sender = webSocketTransport(left);
    const receiver = webSocketTransport(right);
    const received: WireMessage[] = [];
    receiver.onMessage((message) => received.push(message));
    const payload = new Uint8Array([0, 10, 255, 42]);

    sender.post({ kind: 'blob-chunk', channel: 'blob', seq: 3, data: payload });
    await flush();

    expect(received).toEqual([{ kind: 'blob-chunk', channel: 'blob', seq: 3, data: payload }]);
  });

  it('reports disconnects on both ends and refuses posts afterwards', async () => {
    const { left, right } = link();
    const a = webSocketTransport(left);
    const b = webSocketTransport(right);
    const events: string[] = [];
    a.onDisconnect(() => events.push('a'));
    b.onDisconnect(() => events.push('b'));

    a.close?.();
    await flush();

    expect(events.sort()).toEqual(['a', 'b']);
    expect(() => b.post({ kind: 'cancel', id: '1' })).toThrow(/disconnected/);
  });

  it('closes the socket on a text message or a corrupt frame', async () => {
    for (const bad of ['{"kind":"cancel","id":"1"}', new Uint8Array([0xff, 0, 0, 0, 0]).buffer]) {
      const { left, right } = link();
      const transport = webSocketTransport(right);
      let disconnected = false;
      transport.onDisconnect(() => {
        disconnected = true;
      });

      right.receive(bad);
      await flush();

      expect(disconnected).toBe(true);
      expect(left.readyState).toBe(3);
    }
  });

  it('keeps an error listener after disconnecting so late socket errors stay handled', async () => {
    const { left } = link();
    const transport = webSocketTransport(left);
    transport.close?.();
    await flush();

    expect(() => left.emit('error')).not.toThrow();
    expect(left.listenerCount('error')).toBeGreaterThan(0);
  });

  it('drops a peer that cannot keep up instead of buffering without bound', () => {
    const { left } = link();
    const transport = webSocketTransport(left, { maxBufferedBytes: 10 });
    left.bufferedAmount = 11;

    expect(() => transport.post({ kind: 'cancel', id: '1' })).toThrow(/too slow/);
    expect(left.readyState).toBe(3);
  });
});

describe('openWebSocketTransport', () => {
  it('rejects when the socket fails to open', async () => {
    class FailingSocket extends FakeSocket {
      constructor() {
        super();
        queueMicrotask(() => this.emit('error'));
      }
    }
    await expect(
      openWebSocketTransport('wss://x.test/wire', { WebSocket: FailingSocket })
    ).rejects.toThrow(/failed to open/);
  });

  it('rejects after the open timeout', async () => {
    class SilentSocket extends FakeSocket {}
    await expect(
      openWebSocketTransport('wss://x.test/wire', { WebSocket: SilentSocket, timeoutMs: 5 })
    ).rejects.toThrow(/timed out/);
  });

  it('works under reconnectingTransport across a dropped connection', async () => {
    const servers: FakeSocket[] = [];
    const stops: Array<() => void> = [];
    class DialingSocket extends FakeSocket {
      constructor() {
        super();
        const server = new FakeSocket();
        this.peer = server;
        server.peer = this;
        servers.push(server);
        queueMicrotask(() => {
          server.open();
          stops.push(serveEcho(server));
          this.open();
        });
      }
    }
    const transport = reconnectingTransport(
      () => openWebSocketTransport('wss://x.test/wire', { WebSocket: DialingSocket }),
      { backoffMs: [0] }
    );
    const connection = connect(transport);
    const echo = client(api, connection).echo;
    try {
      await transport.ready();
      await expect(echo({ text: 'one' })).resolves.toBe('one');

      servers[0]!.close();
      await flush();
      await expect(echo({ text: 'two' })).resolves.toBe('two');
      expect(servers).toHaveLength(2);
    } finally {
      connection.dispose();
      transport.close?.();
      for (const stop of stops) stop();
    }
  });
});
