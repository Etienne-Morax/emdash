import { isWireMessage, type WireMessage } from '../protocol';

/**
 * Binary framing shared by every byte-oriented transport (Node streams, WebSockets).
 *
 * JSON frame:   [0x00][u32 header length][JSON header]
 * Binary frame: [0x01][u32 header length][JSON header][u32 body length][raw body]
 *
 * Binary frames carry `blob-chunk` payloads without base64 inflation.
 */

type Bytes = Uint8Array<ArrayBufferLike>;

const FRAME_JSON = 0x00;
const FRAME_BINARY = 0x01;
const HEADER_BYTES = 5;
const BODY_LENGTH_BYTES = 4;
/** Upper bound on one frame's header or body; larger lengths mean a corrupt or hostile peer. */
export const MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024;

export class WireFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireFrameError';
  }
}

export function encodeWireFrame(message: WireMessage): Uint8Array {
  if (message.kind === 'blob-chunk') {
    const header = encodeJson({
      kind: message.kind,
      channel: message.channel,
      seq: message.seq,
    });
    const body = message.data;
    const frame = new Uint8Array(
      HEADER_BYTES + header.byteLength + BODY_LENGTH_BYTES + body.byteLength
    );
    frame[0] = FRAME_BINARY;
    writeU32(frame, 1, header.byteLength);
    frame.set(header, HEADER_BYTES);
    writeU32(frame, HEADER_BYTES + header.byteLength, body.byteLength);
    frame.set(body, HEADER_BYTES + header.byteLength + BODY_LENGTH_BYTES);
    return frame;
  }

  const header = encodeJson(message);
  const frame = new Uint8Array(HEADER_BYTES + header.byteLength);
  frame[0] = FRAME_JSON;
  writeU32(frame, 1, header.byteLength);
  frame.set(header, HEADER_BYTES);
  return frame;
}

export type WireFrameDecoder = {
  /**
   * Appends bytes and returns every complete message they finish. Throws
   * {@link WireFrameError} on a corrupt frame; the decoder is unusable afterwards.
   * Frames whose JSON is not a Wire message are skipped.
   */
  push(chunk: Uint8Array | string): WireMessage[];
  /** Bytes buffered for an incomplete trailing frame. */
  pendingBytes(): number;
  reset(): void;
};

export function createWireFrameDecoder(): WireFrameDecoder {
  let buffer: Bytes = new Uint8Array(0);
  return {
    push(chunk) {
      buffer = concat(buffer, normalizeChunk(chunk));
      const messages: WireMessage[] = [];
      try {
        buffer = parseFrames(buffer, messages);
      } catch (error) {
        buffer = new Uint8Array(0);
        throw error instanceof WireFrameError ? error : new WireFrameError(String(error));
      }
      return messages;
    },
    pendingBytes: () => buffer.byteLength,
    reset() {
      buffer = new Uint8Array(0);
    },
  };
}

function parseFrames(input: Bytes, out: WireMessage[]): Bytes {
  let offset = 0;
  while (input.byteLength - offset >= HEADER_BYTES) {
    const kind = input[offset];
    const headerLength = readU32(input, offset + 1);
    if (headerLength > MAX_WIRE_FRAME_BYTES) throw new WireFrameError('Frame header too large');
    const headerStart = offset + HEADER_BYTES;
    const headerEnd = headerStart + headerLength;

    if (kind !== FRAME_JSON && kind !== FRAME_BINARY) {
      throw new WireFrameError(`Unknown frame kind ${String(kind)}`);
    }
    if (input.byteLength < headerEnd) break;

    if (kind === FRAME_JSON) {
      pushParsedMessage(input.subarray(headerStart, headerEnd), undefined, out);
      offset = headerEnd;
      continue;
    }

    if (input.byteLength - headerEnd < BODY_LENGTH_BYTES) break;
    const bodyLength = readU32(input, headerEnd);
    if (bodyLength > MAX_WIRE_FRAME_BYTES) throw new WireFrameError('Frame body too large');
    const bodyStart = headerEnd + BODY_LENGTH_BYTES;
    const bodyEnd = bodyStart + bodyLength;
    if (input.byteLength < bodyEnd) break;
    pushParsedMessage(
      input.subarray(headerStart, headerEnd),
      input.subarray(bodyStart, bodyEnd),
      out
    );
    offset = bodyEnd;
  }
  return input.subarray(offset);
}

function pushParsedMessage(headerBytes: Uint8Array, body: Bytes | undefined, out: WireMessage[]) {
  const parsed: unknown = JSON.parse(decodeText(headerBytes));
  const message = body
    ? { ...(parsed as Record<string, unknown>), data: new Uint8Array(body) }
    : parsed;
  if (isWireMessage(message)) out.push(message);
}

function encodeJson(value: unknown): Uint8Array {
  return new globalThis.TextEncoder().encode(JSON.stringify(value));
}

function decodeText(value: Uint8Array): string {
  return new globalThis.TextDecoder().decode(value);
}

function concat(left: Bytes, right: Bytes): Bytes {
  if (left.byteLength === 0) return new Uint8Array(right);
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function normalizeChunk(chunk: Uint8Array | string): Bytes {
  return typeof chunk === 'string'
    ? new Uint8Array(new globalThis.TextEncoder().encode(chunk))
    : new Uint8Array(chunk);
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU32(source: Uint8Array, offset: number): number {
  return (
    source[offset]! * 0x1000000 +
    ((source[offset + 1]! << 16) | (source[offset + 2]! << 8) | source[offset + 3]!)
  );
}
