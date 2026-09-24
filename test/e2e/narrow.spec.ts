import { test, expect, HOST, selectAt } from './helpers.js';

test.describe('390px viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('T1 390px: toolbar spans the width and status wraps to its own row', async ({ cobroPage: page, bridge }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await expect.poll(() => bridge.core.session.detected).toBe('reload');
    const toolbar = page.locator(`${HOST} .toolbar`);
    await expect(toolbar).toBeVisible();
    const tb = (await toolbar.boundingBox())!;
    expect(tb.x).toBeGreaterThanOrEqual(8);
    expect(tb.x + tb.width).toBeLessThanOrEqual(382);
    const statusBox = (await page.locator(`${HOST} .status`).boundingBox())!;
    const selectBox = (await page.locator(`${HOST} button.select`).boundingBox())!;
    expect(statusBox.y).toBeGreaterThan(selectBox.y + selectBox.height);
  });

  test('T2 390px: panel fills the width and stays above the toolbar', async ({ cobroPage: page }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await selectAt(page, '#target');
    const panel = page.locator(`${HOST} .panel`);
    await expect(panel).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    const toolbarBox = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
    expect(panelBox.width).toBeGreaterThanOrEqual(360);
    expect(panelBox.x).toBeGreaterThanOrEqual(8);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(toolbarBox.y - 8);
    await page.screenshot({ path: 'screenshots/narrow-390.png' });
  });

  test('T3 390px: settings popover fits', async ({ cobroPage: page }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await page.locator(`${HOST} .ib.gear`).click();
    const pop = page.locator(`${HOST} .pop`);
    await expect(pop).toBeVisible();
    const popBox = (await pop.boundingBox())!;
    expect(popBox.x).toBeGreaterThanOrEqual(8);
    expect(popBox.x + popBox.width).toBeLessThanOrEqual(382);
  });
});

test.describe('700px viewport', () => {
  test.use({ viewport: { width: 700, height: 600 } });

  test('T4 700px: status 180px, desktop layout otherwise', async ({ cobroPage: page, bridge }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await expect.poll(() => bridge.core.session.detected).toBe('reload');
    const statusBox = (await page.locator(`${HOST} .status`).boundingBox())!;
    expect(statusBox.width).toBeGreaterThanOrEqual(179);
    expect(statusBox.width).toBeLessThanOrEqual(181);
    const toolbarBox = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
    expect(toolbarBox.x + toolbarBox.width / 2).toBeGreaterThanOrEqual(346);
    expect(toolbarBox.x + toolbarBox.width / 2).toBeLessThanOrEqual(354);
    await page.locator(`${HOST} button.select`).hover();
    await page.waitForTimeout(200); // 라벨 펼침 전환(150ms) 종료 대기
    const toolbarBoxHover = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
    expect(toolbarBoxHover.width).toBe(toolbarBox.width);
    await page.screenshot({ path: 'screenshots/narrow-700.png' });
  });
});
