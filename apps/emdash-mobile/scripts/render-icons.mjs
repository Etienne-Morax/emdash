// Renders public/icon.svg to the PNG sizes iOS and the web manifest need.
// Run after editing the SVG: `node scripts/render-icons.mjs` (uses the repo's Playwright).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = await readFile(join(publicDir, 'icon.svg'), 'utf8');
const outputs = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-512-maskable.png', 512],
];

const browser = await chromium.launch();
try {
  for (const [name, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
    );
    await page.screenshot({ path: join(publicDir, name), omitBackground: false });
    await page.close();
  }
} finally {
  await browser.close();
}
