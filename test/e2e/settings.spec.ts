import { test, expect, HOST } from './helpers.js';

test('settings popover selects a theme and the server persists it', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const gear = page.locator(`${HOST} .toolbar button:text("⚙")`);
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

test('auto follows prefers-color-scheme', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'dark');
});

test.describe('COBRO_THEME pins the theme', () => {
  test.use({ envTheme: 'frost' });
  test('COBRO_THEME pins the theme', async ({ cobroPage: page }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await page.locator(`${HOST} .toolbar button:text("⚙")`).click();
    await expect(page.locator(`${HOST} .seg button`).first()).toBeDisabled();
    const count = await page.locator(`${HOST} .seg button`).count();
    for (let i = 0; i < count; i++) await expect(page.locator(`${HOST} .seg button`).nth(i)).toBeDisabled();
    await expect(page.locator(`${HOST} .pop-note`)).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'frost');
  });
});
