import { test, expect } from '@playwright/test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserLauncher } from '../../src/browser/launcher.js';

test('launches, injects overlay, buffers console errors, takes clipped screenshot, restarts after close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobro-prof-'));
  const overlay = 'window.__injected = __COBRO_PORT__;';
  const l = new BrowserLauncher({ overlaySource: overlay, port: 4242, token: 't', root: dir, profileDir: dir, headless: true, channel: process.env.COBRO_TEST_CHANNEL });
  try {
    const first = await l.open('http://127.0.0.1:4173/basic.html');
    expect(first).toMatchObject({ title: 'Basic', restarted: false });
    expect(await l.page!.evaluate(() => (window as unknown as { __injected: number }).__injected)).toBe(4242);
    await l.page!.evaluate(() => { console.error('boom'); console.error('boom'); });
    await expect.poll(() => l.consoleEntries()).toEqual([expect.objectContaining({ level: 'error', text: 'boom', count: 2 })]);
    const out = join(dir, 'shot.png');
    expect(await l.screenshot({ rect: { x: 0, y: 0, w: 120, h: 40 }, outPath: out })).toBe(out);
    expect(existsSync(out)).toBe(true);
    const bySel = join(dir, 'shot-sel.png');
    expect(await l.screenshot({ selector: '#target', outPath: bySel })).toBe(bySel);
    expect(existsSync(bySel)).toBe(true);
    const noSel = join(dir, 'shot-nosel.png'); // 못 찾으면 뷰포트로 폴백
    expect(await l.screenshot({ selector: '#nope-not-here', outPath: noSel })).toBe(noSel);
    expect(existsSync(noSel)).toBe(true);
    expect(l.wasLaunched()).toBe(true);
    await l.close();
    expect(l.isAlive()).toBe(false);
    const again = await l.open('http://127.0.0.1:4173/basic.html');
    expect(again.restarted).toBe(true);
  } finally { await l.close(); }
});

test('launches webkit engine and injects overlay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobro-prof-wk-'));
  const l = new BrowserLauncher({ overlaySource: 'window.__injected = __COBRO_PORT__;', port: 4343, token: 't', root: dir, profileDir: dir, headless: true, engine: 'webkit' });
  try {
    const r = await l.open('http://127.0.0.1:4173/basic.html');
    expect(r.title).toBe('Basic');
    expect(await l.page!.evaluate(() => (window as unknown as { __injected: number }).__injected)).toBe(4343);
    expect(await l.page!.evaluate(() => navigator.vendor)).toBe('Apple Computer, Inc.');
    expect(await l.page!.evaluate(() => navigator.userAgent)).not.toMatch(/Chrome\//);
  } finally { await l.close(); }
});
