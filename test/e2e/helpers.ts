import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../../src/core/store.js';
import { createBridge, type Bridge } from '../../src/bridge.js';
import { fetchTextGuarded } from '../../src/browser/launcher.js';
import { resolveElementSources } from '../../src/core/sourcemap.js';
import type { Theme } from '../../src/core/types.js';

const overlaySrc = readFileSync('dist/overlay.js', 'utf8');
export const injected = (port: number, token: string, root = process.cwd()) => overlaySrc.replace(/__COBRO_PORT__/g, String(port)).replace(/__COBRO_TOKEN__/g, JSON.stringify(token)).replace(/__COBRO_ROOT__/g, JSON.stringify(root));

export const test = base.extend<{ ctx: BrowserContext; bridge: Bridge; cobroPage: Page; envTheme: Theme | undefined; shotEnabled: boolean }>({
  envTheme: [undefined, { option: true }],
  shotEnabled: [false, { option: true }],
  ctx: async ({ browser, locale }, use) => {
    const ctx = await browser.newContext({ bypassCSP: true, locale });
    await use(ctx); await ctx.close();
  },
  bridge: async ({ ctx, envTheme, shotEnabled }, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const bridge = await createBridge({
      store: new Store(dir), token: randomBytes(16).toString('hex'), settingsFile: join(dir, 'settings.json'), envTheme,
      screenshot: shotEnabled ? async (b) => `/tmp/cobro-shot-${b.id}.png` : undefined,
      resolveSource: (b, page) => resolveElementSources(b, page, (url) => fetchTextGuarded(ctx.request, url)),
    });
    await use(bridge); await bridge.close();
  },
  cobroPage: async ({ ctx, bridge }, use) => {
    await ctx.addInitScript(injected(bridge.port, bridge.token));
    const page = await ctx.newPage();
    await use(page);
  },
});
export { expect };
export const HOST = '[data-cobro-host]';
// webkit에서 Ctrl+Shift+F 직후 선택 레이어(glass)가 켜지기 전에 마우스 이벤트가 나가면 간헐 실패한다(부채 #3)
export async function startSelect(page: Page) {
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} .ib.select`)).toHaveClass(/on/);
}
export async function selectAt(page: Page, selector: string) {
  await startSelect(page);
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
}
