import type {
  ColorCodeKey,
  LocalMachineIconRule,
  MachineIconKey,
  ProjectColorRule,
} from './color-coding';

/**
 * Fork-only: the Morax project palette, mirrored from ~/.claude/hooks/session_color.py so a
 * project has the same colour in Emdash as in its Claude session titles. Known repositories
 * get a fixed colour; others get the hook's SHA-256 pick over its fallback circles.
 */
const MORAX_PROJECT_COLORS: Record<string, ColorCodeKey> = {
  'morax-os': 'blue', // 🟦
  'morax-chat': 'purple', // 🟪
  'post-pilot': 'orange', // 🟧
  'post-pilot-ios': 'orange', // 🟧
  'super comptable': 'green', // 🟩
  'the game-morax super app': 'red', // 🟥
  'morax-business': 'yellow', // 🟨
  'morax-photography': 'brown', // 🟫
  'designers-penthouse': 'brown', // 🟫
  'cheri-social': 'brown', // 🟫
  'web-monitoring': 'slate', // ⬛
  'morax-control': 'slate', // ⬛
};

// 🔴🟠🟡🟢🔵🟣🟤⚫⚪, in the hook's order.
const MORAX_FALLBACK_COLORS: readonly ColorCodeKey[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'brown',
  'slate',
  'gray',
];

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/** SHA-256 of a UTF-8 string as a big integer (synchronous; inputs are short names). */
function sha256BigInt(text: string): bigint {
  const bytes = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  new DataView(data.buffer).setUint32(paddedLength - 4, bytes.length * 8);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const view = new DataView(data.buffer);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = words[i - 16] + s0 + words[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          SHA256_K[i] +
          words[i]) >>>
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    hash[0] += a;
    hash[1] += b;
    hash[2] += c;
    hash[3] += d;
    hash[4] += e;
    hash[5] += f;
    hash[6] += g;
    hash[7] += h;
  }
  return BigInt(`0x${Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')}`);
}

/** Matches session_color.py `color_for`: palette entry, else SHA-256 mod the fallback list. */
export const moraxProjectColor: ProjectColorRule = (repositoryName) => {
  const name = repositoryName.toLowerCase();
  const known = MORAX_PROJECT_COLORS[name];
  if (known) return known;
  const index = Number(sha256BigInt(name) % BigInt(MORAX_FALLBACK_COLORS.length));
  return MORAX_FALLBACK_COLORS[index];
};

/**
 * Fork-only: Etienne's machines, by hardware model. The M1 Max MacBook Pro
 * (MacBookPro18,x) is laptop “1”, the M5 Max MacBook Pro (Mac17,6) is laptop “5”; iMacs
 * fall back to the generic iMac icon.
 */
const MORAX_MACHINE_ICONS: readonly [RegExp, MachineIconKey][] = [
  [/^MacBookPro18,/i, 'laptop-1'],
  [/^Mac17,6$/i, 'laptop-5'],
];

export const moraxLocalMachineIcon: LocalMachineIconRule = (model) =>
  MORAX_MACHINE_ICONS.find(([pattern]) => pattern.test(model))?.[1];
