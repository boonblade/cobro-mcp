import { test, expect } from './helpers.js';
import { spawn, execSync, type ChildProcess } from 'node:child_process';

let vite: ChildProcess;

async function waitForVite(url: string, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 아직 안 뜸 — 계속 폴링
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite dev server did not become ready at ${url} within ${timeoutMs}ms`);
}

test.beforeAll(async () => {
  // --host 127.0.0.1: vite 기본값은 'localhost'를 ::1(IPv6)로만 바인딩해 4173 픽스처(127.0.0.1)와 어긋난다
  vite = spawn('npx', ['vite', '--port', '4174', '--strictPort', '--host', '127.0.0.1'], { cwd: 'test/fixtures/vite-app', shell: true, stdio: 'ignore' });
  vite.on('error', () => {}); // 비동기 spawn 오류가 러너를 죽이지 않도록 — 실패는 waitForVite의 타임아웃으로 드러난다
  await waitForVite('http://127.0.0.1:4174/');
});

test.afterAll(() => {
  if (!vite.pid) return;
  if (process.platform === 'win32') {
    // shell: true라서 vite.pid는 셸 프로세스의 pid다 — /T로 자식(esbuild 등)까지 정리
    try { execSync(`taskkill /pid ${vite.pid} /T /F`); } catch { /* 이미 종료됨 */ }
  } else {
    vite.kill();
  }
});

test('detects none on Vite dev and reload on static', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.locator('#h')).toHaveAttribute('data-ready', '1');
  await expect.poll(() => bridge.core.session.detected).toBe('none');
  await expect(page.locator('[data-cobro-host] .chip.strategy')).toHaveText('none');
  await expect(page.locator('[data-cobro-host] .status')).not.toContainText('갱신');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect.poll(() => bridge.core.session.detected).toBe('reload');
});

test('refresh strategy is a chip, not hint text', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.locator('#h')).toHaveAttribute('data-ready', '1');
  const chip2 = page.locator('[data-cobro-host] .chip.strategy');
  await expect(chip2).toBeVisible();
  await expect(chip2).toHaveText(/^(none|reload|event)$/);
  await expect(chip2).toHaveAttribute('title', /(none|reload|event)/);
  bridge.core.setStrategy('event');
  await expect(chip2).toHaveText('event');
  await expect(page.locator('[data-cobro-host] .status')).not.toContainText('갱신');
  await expect(page.locator('[data-cobro-host] .status')).not.toContainText('refresh');
});
