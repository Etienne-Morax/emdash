/** Keys a phone keyboard lacks, as the bytes a terminal expects. */
export const SPECIAL_KEYS = [
  { id: 'esc', label: 'Esc', data: '\x1b' },
  { id: 'tab', label: 'Tab', data: '\t' },
  { id: 'shift-tab', label: '⇧Tab', data: '\x1b[Z' },
  { id: 'up', label: '↑', data: '\x1b[A' },
  { id: 'down', label: '↓', data: '\x1b[B' },
  { id: 'left', label: '←', data: '\x1b[D' },
  { id: 'right', label: '→', data: '\x1b[C' },
  { id: 'ctrl-c', label: '^C', data: '\x03' },
  { id: 'enter', label: '⏎', data: '\r' },
] as const;

export type SpecialKeyId = (typeof SPECIAL_KEYS)[number]['id'];

/**
 * Turns composer text into PTY writes. The text goes first, Enter separately: agent TUIs treat
 * a write ending in "\r" as a paste and would not submit it. iOS dictation and smart
 * punctuation produce curly quotes and non-breaking spaces; they are normalized so shell
 * commands typed by voice still run. Line breaks become "\r" (the terminal's Enter).
 */
export function composerWrites(text: string, submit: boolean): string[] {
  const normalized = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\r\n|\n/g, '\r');
  const writes: string[] = [];
  if (normalized.length > 0) writes.push(normalized);
  if (submit) writes.push('\r');
  return writes;
}
