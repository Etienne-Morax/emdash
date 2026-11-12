import { describe, expect, it } from 'vitest';
import { composerWrites, SPECIAL_KEYS } from './terminal-keys';

describe('composerWrites', () => {
  it('sends the text, then Enter on its own so agent TUIs submit it', () => {
    expect(composerWrites('run the tests', true)).toEqual(['run the tests', '\r']);
  });

  it('normalizes iOS smart punctuation and line breaks', () => {
    expect(composerWrites('git commit -m “fix”\nit’s done', false)).toEqual([
      'git commit -m "fix"\rit\'s done',
    ]);
  });

  it('sends a bare Enter for an empty submit', () => {
    expect(composerWrites('', true)).toEqual(['\r']);
  });

  it('maps special keys to terminal bytes', () => {
    const bytes = Object.fromEntries(SPECIAL_KEYS.map((key) => [key.id, key.data]));
    expect(bytes['esc']).toBe('\x1b');
    expect(bytes['ctrl-c']).toBe('\x03');
    expect(bytes['up']).toBe('\x1b[A');
  });
});
