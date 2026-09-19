import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../../src/core/store.js';
import { createBridge, type Bridge } from '../../src/bridge.js';
import type { Theme } from '../../src/core/types.js';

const overlaySrc = readFileSync('dist/overlay.js', 'utf8');
export const injected = (port: number, token: string) => overlaySrc.replace(/__COBRO_PORT__/g, String(port)).replace(/__COBRO_TOKEN__/g, JSON.stringify(token));

export const test = base.extend<{ bridge: Bridge; cobroPage: Page; envTheme: Theme | undefined; shotEnabled: boolean }>({
  envTheme: [undefined, { option: true }],
  shotEnabled: [false, { option: true }],
  bridge: async ({ envTheme, shotEnabled }, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const bridge = await createBridge({
      store: new Store(dir), token: randomBytes(16).toString('hex'), settingsFile: join(dir, 'settings.json'), envTheme,
      screenshot: shotEnabled ? async (b) => `/tmp/cobro-shot-${b.id}.png` : undefined,
    });
    await use(bridge); await bridge.close();
  },
  cobroPage: async ({ browser, bridge, locale }, use) => {
    const ctx = await browser.newContext({ bypassCSP: true, locale });
    await ctx.addInitScript(injected(bridge.port, bridge.token));
    const page = await ctx.newPage();
    await use(page); await ctx.close();
  },
});
export { expect };
export const HOST = '[data-cobro-host]';
export async function selectAt(page: Page, selector: string) {
  await page.keyboard.press('Control+Shift+F');
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
}
