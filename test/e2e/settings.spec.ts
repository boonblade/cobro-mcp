import { test, expect, HOST, selectAt } from './helpers.js';

test('settings popover selects a theme and the server persists it', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const gear = page.locator(`${HOST} .ib.gear`);
  const pop = page.locator(`${HOST} .pop`);
  await gear.click();
  await expect(pop).toHaveClass(/show/);
  await expect(page.locator(`${HOST} .seg button`)).toHaveCount(4);
  await expect(page.locator(`${HOST} .seg button[data-theme="auto"]`)).toHaveClass(/on/);
  await page.locator(`${HOST} .seg button[data-theme="light"]`).click();
  await expect.poll(() => bridge.ui().theme).toBe('light');
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
  await expect(pop).toHaveClass(/show/); // 선택 후에도 팝오버는 열린 채
  await page.keyboard.press('Escape');
  await expect(pop).not.toHaveClass(/show/);
  await gear.click();
  await expect(pop).toHaveClass(/show/);
  await page.mouse.click(10, 10); // 바깥 클릭
  await expect(pop).not.toHaveClass(/show/);
  await page.reload();
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
});

test('Ctrl+Shift+F closes an open popover so a stray click cannot leak into page selection (B1)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const gear = page.locator(`${HOST} .ib.gear`);
  const pop = page.locator(`${HOST} .pop`);
  await gear.click();
  await expect(pop).toHaveClass(/show/);
  const segBox = (await page.locator(`${HOST} .seg button[data-theme="light"]`).boundingBox())!;
  await page.keyboard.press('Control+Shift+F');
  await expect(pop).not.toHaveClass(/show/);
  await page.mouse.click(segBox.x + segBox.width / 2, segBox.y + segBox.height / 2);
  await expect.poll(() => bridge.core.session.batches.flatMap((b) => b.elements).length).toBe(0);
});

test('light theme hover text stays readable against the light hover background (B2)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.locator(`${HOST} .ib.gear`).click();
  await page.locator(`${HOST} .seg button[data-theme="light"]`).click();
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  const collapseBtn = page.locator(`${HOST} .ib.collapse`);
  await collapseBtn.hover();
  await expect(collapseBtn).toHaveCSS('color', 'rgb(23, 27, 40)');
});

test('auto follows prefers-color-scheme', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'dark');
});

test('segment labels are readable in dark and light', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator(`${HOST} .ib.gear`).click();
  const onBtn = page.locator(`${HOST} .seg button[data-theme="auto"]`);
  const offBtn = page.locator(`${HOST} .seg button[data-theme="dark"]`);
  await expect(offBtn).toHaveCSS('color', 'rgb(170, 182, 208)');
  await expect(onBtn).toHaveCSS('color', 'rgb(232, 236, 245)');
  await page.locator(`${HOST} .seg button[data-theme="light"]`).click();
  await expect(offBtn).toHaveCSS('color', 'rgb(75, 86, 112)');
  const lightOnBtn = page.locator(`${HOST} .seg button[data-theme="light"]`);
  await expect(lightOnBtn).toHaveCSS('color', 'rgb(23, 27, 40)');
});

test('layers share one radius', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} .ib.gear`).click();
  await expect(page.locator(`${HOST} .pop`)).toHaveCSS('border-radius', '12px');
  await expect(page.locator(`${HOST} .panel`)).toHaveCSS('border-radius', '12px');
  await expect(page.locator(`${HOST} textarea`)).toHaveCSS('border-radius', '6px');
  await expect(page.locator(`${HOST} .toolbar`)).toHaveCSS('border-radius', '999px');
});

test.describe('COBRO_THEME pins the theme', () => {
  test.use({ envTheme: 'frost' });
  test('COBRO_THEME pins the theme', async ({ cobroPage: page }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await page.locator(`${HOST} .ib.gear`).click();
    await expect(page.locator(`${HOST} .seg button`).first()).toBeDisabled();
    const count = await page.locator(`${HOST} .seg button`).count();
    for (let i = 0; i < count; i++) await expect(page.locator(`${HOST} .seg button`).nth(i)).toBeDisabled();
    await expect(page.locator(`${HOST} .pop-note`)).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'frost');
  });
});

test.describe('light theme hover badge (부채 #5)', () => {
  test.use({ envTheme: 'light' });
  test('light theme hover badge text is readable', async ({ cobroPage: page }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await page.keyboard.press('Control+Shift+F');
    const b = (await page.locator('#target').boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const badge = page.locator(`${HOST} .hover-badge`);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('#target');
    await page.screenshot({ path: 'screenshots/badge-light.png' });
    const { color, background } = await badge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, background: cs.backgroundColor };
    });
    expect(color).not.toBe(background);
    expect(color).toBe('rgb(23, 27, 40)');
  });
});
