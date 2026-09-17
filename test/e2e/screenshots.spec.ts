import { test, expect, HOST } from './helpers.js';

type Box = { x: number; y: number; width: number; height: number };
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

test('toolbar and settings popover screenshots for each theme', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html'); // 흰 배경 페이지 — frost 반투명 확인용
  const gear = page.locator(`${HOST} .ib[aria-label="설정"]`);
  const toolbar = page.locator(`${HOST} .toolbar`);
  const pop = page.locator(`${HOST} .pop`);
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/);

  const setTheme = async (key: 'dark' | 'light' | 'frost') => {
    await gear.click();
    await page.locator(`${HOST} .seg button[data-theme="${key}"]`).click();
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', key);
    await page.keyboard.press('Escape');
    await expect(pop).not.toHaveClass(/show/);
  };

  const shootToolbar = async (name: string) => {
    const box = (await toolbar.boundingBox())!;
    await page.screenshot({ path: `screenshots/${name}.png`, clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
  };

  await setTheme('dark');
  await shootToolbar('toolbar-dark');

  await setTheme('light');
  await shootToolbar('toolbar-light');

  await setTheme('frost');
  await shootToolbar('toolbar-frost');

  const selectBtn = page.locator(`${HOST} .ib[aria-label="Select"]`);
  await selectBtn.hover();
  await page.waitForTimeout(200); // 라벨 펼침 전환(150ms) 종료 대기(Task 29 M2 교훈)
  await shootToolbar('toolbar-hover-select');
  await page.mouse.move(0, 0);

  await setTheme('dark');
  await gear.click();
  await expect(pop).toHaveClass(/show/);
  {
    const tBox = (await toolbar.boundingBox())!;
    const pBox = (await pop.boundingBox())!;
    const u = union(tBox, pBox);
    await page.screenshot({ path: 'screenshots/settings-pop-dark.png', clip: { x: u.x - 8, y: u.y - 8, width: u.width + 16, height: u.height + 16 } });
  }
  await page.keyboard.press('Escape');

  await setTheme('light');
  await gear.click();
  await expect(pop).toHaveClass(/show/);
  {
    const tBox = (await toolbar.boundingBox())!;
    const pBox = (await pop.boundingBox())!;
    const u = union(tBox, pBox);
    await page.screenshot({ path: 'screenshots/settings-pop-light.png', clip: { x: u.x - 8, y: u.y - 8, width: u.width + 16, height: u.height + 16 } });
  }
});
