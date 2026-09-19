import { test, expect, HOST } from './helpers.js';

test('toolbar buttons are icon buttons whose labels unfold on hover', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const ibs = page.locator(`${HOST} .ib`);
  await expect(ibs).toHaveCount(4);
  await expect(ibs.locator('svg')).toHaveCount(4);
  for (const cls of ['select', 'collapse', 'gear', 'grip']) await expect(page.locator(`${HOST} .ib.${cls}`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .ib.gear`)).toHaveAttribute('aria-label', '설정');
  await expect(page.locator(`${HOST} .ib.gear .lbl`)).toHaveCount(0);
  const selectBtn = page.locator(`${HOST} .ib.select`);
  await expect(selectBtn.locator('.lbl')).toHaveCSS('opacity', '0');
  await selectBtn.hover();
  await expect(selectBtn.locator('.lbl')).toHaveCSS('opacity', '1');
  const collapseBtn = page.locator(`${HOST} .ib.collapse`);
  await expect(collapseBtn).toHaveAttribute('aria-label', 'Collapse');
  await expect(collapseBtn.locator('.lbl')).toHaveCount(0);
  const beforePath = await collapseBtn.locator('svg path').getAttribute('d');
  await collapseBtn.click();
  await expect(collapseBtn).toHaveAttribute('aria-label', 'Expand');
  const afterPath = await collapseBtn.locator('svg path').getAttribute('d');
  expect(afterPath).not.toBe(beforePath);
});
