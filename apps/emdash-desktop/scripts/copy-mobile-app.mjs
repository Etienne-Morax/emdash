// Copies the built phone app (apps/emdash-mobile/dist) into out/mobile, where the Mobile
// access gateway serves it from in packaged builds. A missing build is a warning, not an
// error: the gateway then answers with a short "not built" page.
import { cp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(appDir, '..', 'emdash-mobile', 'dist');
const target = join(appDir, 'out', 'mobile');

try {
  await stat(join(source, 'index.html'));
} catch {
  console.warn(`[copy-mobile-app] ${source} is not built; skipping.`);
  process.exit(0);
}
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log(`[copy-mobile-app] copied the phone app to ${target}`);
