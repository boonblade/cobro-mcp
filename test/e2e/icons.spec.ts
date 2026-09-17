import { test, expect, HOST } from './helpers.js';

test('toolbar buttons are icon buttons whose labels unfold on hover', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const ibs = page.locator(`${HOST} .ib`);
  await expect(ibs).toHaveCount(3);
  await expect(ibs.locator('svg')).toHaveCount(3);
  for (const label of ['Select', 'Collapse', '설정']) await expect(page.locator(`${HOST} .ib[aria-label="${label}"]`)).toHaveCount(1);
  const collapseBtn = page.locator(`${HOST} .ib[aria-label="Collapse"]`);
  await expect(collapseBtn.locator('.lbl')).toHaveCSS('opacity', '0');
  await collapseBtn.hover();
  await expect(collapseBtn.locator('.lbl')).toHaveCSS('opacity', '1');
  const beforePath = await collapseBtn.locator('svg path').getAttribute('d');
  await collapseBtn.click();
  const expandBtn = page.locator(`${HOST} .ib[aria-label="Expand"]`);
  await expect(expandBtn).toHaveCount(1);
  const afterPath = await expandBtn.locator('svg path').getAttribute('d');
  expect(afterPath).not.toBe(beforePath);
});
