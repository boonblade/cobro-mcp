import { test, expect, HOST, selectAt } from './helpers.js';
import type { Page } from '@playwright/test';

// selectAt는 매번 Ctrl+Shift+F로 선택 모드를 토글한다 — 이미 선택 모드인 상태에서 두 번째
// 요소를 고를 때는 토글 없이 클릭만 한다.
async function pickAt(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
}

test('select → note → Send arrives in core.wait with selector, then done flashes and dispatches event', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none'); // done이 페이지를 reload하면 __doneEvents가 사라진다
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .toolbar`)).toBeVisible();
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .els`)).toContainText('#target');
  await page.locator(`${HOST} textarea`).fill('버튼 작게');
  const waiting = bridge.core.wait(10_000);
  await expect(page.locator(`${HOST} .dot`)).toHaveClass(/waiting/);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status !== 'sent') return;
  expect(r.payload.batches[0]).toMatchObject({ note: '버튼 작게', elements: [{ selector: '#target', tag: 'button' }] });
  expect(r.payload.page.url).toContain('basic.html');
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('전송됨');
  await expect(page.locator(`${HOST} .status`)).toContainText('에이전트 응답 대기');
  await expect(page.locator(`${HOST} .dot`)).toHaveClass(/sent/);
  await expect(page.locator(`${HOST} .els`)).toHaveCount(0); // 보낸 배치가 좀비 draft로 되살아나면 안 된다
  bridge.done({ summary: '폰트 12px', selectors: ['#target'], changedFiles: ['x.tsx'] });
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('완료');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __doneEvents: unknown[] }).__doneEvents.length)).toBe(1);
});

test('textarea keeps focus and input under document focusin + window capture focus traps', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/modal-trap.html');
  await page.click('#open');
  await selectAt(page, '#dlgText');
  await page.keyboard.type('hello');
  await expect(page.locator(`${HOST} textarea`)).toHaveValue('hello');
  await expect(page.locator('#dlgInput')).toHaveValue('');
});

test('typing keeps focus and caret across the debounced draft round trip', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.keyboard.type('앞');
  await page.waitForTimeout(600); // 디바운스(300ms) 후 draft 전송 → 서버 state 브로드캐스트 → render
  await page.keyboard.type('뒤');
  await expect(page.locator(`${HOST} textarea`)).toHaveValue('앞뒤');
});

test('clicking through the glass does not close a click-outside dropdown', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/click-outside.html');
  await page.click('#toggle');
  await expect(page.locator('#menu')).toBeVisible();
  await selectAt(page, '#item1');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator(`${HOST} .els`)).toContainText('#item1');
});

test('overlay stays above max z-index header and survives a later native dialog', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/high-z.html');
  const tb = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  const topIsHost = () => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.hasAttribute('data-cobro-host') === true, [tb.x + tb.width / 2, tb.y + tb.height / 2] as [number, number]);
  expect(await topIsHost()).toBe(true); // z-index 2147483647 고정 헤더 위
  await page.click('#openDialog');
  await expect(page.locator('#nativeDlg')).toBeVisible();
  // Chromium은 modal <dialog>와 그 ::backdrop을 top layer 삽입 순서와 무관하게 popover 위에 그린다
  // (dialog가 열린 뒤 새로 showPopover()한 popover도 아래에 깔린다 — 보고서의 실험 참조).
  // 그 동안에도 우리 popover는 열린 채 유지되고, dialog가 닫히면 즉시 최상단으로 복귀한다.
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-cobro-host]')!.matches(':popover-open'))).toBe(true);
  await page.evaluate(() => (document.getElementById('nativeDlg') as HTMLDialogElement).close());
  await expect.poll(topIsHost).toBe(true);
});

test('works on a strict-CSP page (bypassCSP context)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/csp.html');
  await expect(page.locator(`${HOST} .status`)).toContainText('요소를 고르세요');
  await expect.poll(() => bridge.channel.clientCount()).toBe(1);
});

test('drafts survive reload and missing elements are marked', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('임시');
  await expect.poll(() => bridge.core.session.batches[0]?.note).toBe('임시'); // 디바운스된 draft 반영까지 대기
  // reload는 고정 페이지 HTML을 그대로 다시 준다 → 재주입 후에도 요소가 없으려면 로드 시점에 지워야 한다
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => document.getElementById('target')?.remove()); });
  await page.reload();
  await expect(page.locator(`${HOST} textarea`)).toHaveValue('임시');
  await expect(page.locator(`${HOST} .els .missing`)).toContainText('요소 없음');
});

test('reload strategy reloads the page on done', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect.poll(() => bridge.core.session.detected).toBe('reload');
  await page.evaluate(() => { (window as unknown as { __cobroPreReload: boolean }).__cobroPreReload = true; });
  bridge.done({ summary: 'x', selectors: [], changedFiles: [] });
  // load 이벤트를 제때 못 붙잡는 경쟁을 피한다 — 마커는 새 문서가 이전 문서를 대체할 때만 사라진다.
  // 내비게이션 중 실행 컨텍스트 파괴 오류는 .catch로 흡수한다.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cobroPreReload?: boolean }).__cobroPreReload === undefined).catch(() => false), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation').length > 0 && (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('reload');
});

test('drag-select picks only the top-most fully contained element', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .toolbar`)).toBeVisible();
  await page.keyboard.press('Control+Shift+F');
  const b = (await page.locator('#card').boundingBox())!;
  const pad = 4; // #card를 완전히 감싸도록 바깥으로 조금 더
  await page.mouse.move(b.x - pad, b.y - pad);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width + pad, b.y + b.height + pad, { steps: 5 });
  await page.mouse.up();
  // 밴드에 완전히 들어온 것 중 최상위만 — 자식 p.desc·#target은 제외된다
  await expect(page.locator(`${HOST} .els div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els`)).toContainText('#card');
});

test('toolbar hint guides the next action', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .status`)).toContainText('Ctrl+Shift+F 또는 Select로 요소를 고르세요');
  await page.locator(`${HOST} button`, { hasText: 'Select' }).click();
  await expect(page.locator(`${HOST} .status`)).toContainText('페이지에서 요소를 클릭하세요');
  const b = (await page.locator('#target').boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
  await expect(page.locator(`${HOST} .status`)).toContainText('요소 1개 선택');
  await page.keyboard.press('Escape');
  await expect(page.locator(`${HOST} .status`)).toContainText('메모를 적고 Send');
  await page.keyboard.type('x');
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요');
});

test.describe('en locale', () => {
  test.use({ locale: 'en-US' });
  test('shows English hints and labels', async ({ cobroPage: page, bridge }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await expect(page.locator(`${HOST} .status`)).toContainText('Press Ctrl+Shift+F');
    const waiting = bridge.core.wait(10_000);
    void waiting; // 이 테스트는 응답을 기다리지 않는다 — 칩 라벨만 확인
    await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('Waiting');
    await selectAt(page, '#target');
    await expect(page.locator(`${HOST} .status`)).toContainText('selected');
    await expect(page.locator(`${HOST} .panel h4`)).toContainText('element');
    await expect(page.locator(`${HOST} textarea`)).toHaveAttribute('placeholder', /Describe the change/);
    await expect(page.locator(`${HOST} button.send`)).toBeVisible();
  });
});

test('status scrolls on hover only when it overflows', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.locator(`${HOST} .status`).hover();
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/scroll/);
  bridge.core.setAgentText('x'.repeat(200));
  await expect.poll(() => page.locator(`${HOST} .status`).textContent()).toContain('x'.repeat(200));
  await page.locator(`${HOST} .status`).hover();
  const inner = page.locator(`${HOST} .status-in`);
  await expect(inner).toHaveClass(/scroll/);
  await expect.poll(() => inner.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  await page.mouse.move(0, 0);
  await expect(inner).not.toHaveClass(/scroll/, { timeout: 300 });
});

test('scroll state clears when the hint shortens while still hovering', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none'); // done이 페이지를 reload하면 아래 evaluate가 실행 컨텍스트 파괴와 경합한다
  await page.goto('http://127.0.0.1:4173/basic.html');
  bridge.core.setAgentText('x'.repeat(200));
  await expect.poll(() => page.locator(`${HOST} .status`).textContent()).toContain('x'.repeat(200));
  await page.locator(`${HOST} .status`).hover();
  const inner = page.locator(`${HOST} .status-in`);
  await expect(inner).toHaveClass(/scroll/);
  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .status`)).toContainText('ok');
  await expect(page.locator(`${HOST} .status`)).not.toContainText('완료:');
  await expect(inner).not.toHaveClass(/scroll/);
  await expect.poll(() => inner.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
});

test('re-hovering within 200ms keeps the scroll state applied', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  bridge.core.setAgentText('x'.repeat(200));
  await expect.poll(() => page.locator(`${HOST} .status`).textContent()).toContain('x'.repeat(200));
  const inner = page.locator(`${HOST} .status-in`);
  const box = (await page.locator(`${HOST} .status`).boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await expect(inner).toHaveClass(/scroll/);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(50);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(300);
  await expect(inner).toHaveClass(/scroll/);
});

test('panel has no batch tabs, Add batch, or history (R64)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel`)).toBeVisible();
  const buttonTexts = await page.locator(`${HOST} .panel button`).allTextContents();
  expect(buttonTexts).not.toContain('Add batch');
  expect(buttonTexts).not.toContain('Redo');
  await expect(page.locator(`${HOST} .tabs`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .hist`)).toHaveCount(0);
  await page.locator(`${HOST} textarea`).fill('x');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status === 'sent') expect(r.payload.batches.length).toBe(1);
  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('완료');
  await expect(page.locator(`${HOST} .hist`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .panel`)).not.toBeVisible();
});

test('handshake: Send disabled while agent works, enabled after done, no Unlock', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('a');
  const waiting1 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r1 = await waiting1;
  expect(r1.status).toBe('sent');
  if (r1.status === 'sent') expect(r1.payload.batches[0]?.note).toBe('a');

  const buttonTexts = await page.locator(`${HOST} .panel button`).allTextContents();
  expect(buttonTexts).not.toContain('Unlock');
  await selectAt(page, '#card');
  await expect(page.locator(`${HOST} button.send`)).toBeDisabled();
  await expect(page.locator(`${HOST} button.send`)).toHaveAttribute('title', /작업 중/);

  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} button.send`)).toBeEnabled();

  await page.locator(`${HOST} textarea`).fill('b');
  const waiting2 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r2 = await waiting2;
  expect(r2.status).toBe('sent');
  if (r2.status === 'sent') expect(r2.payload.batches[0]?.note).toBe('b');

  expect(bridge.core.session.batches.filter((b) => b.status === 'unanswered')).toHaveLength(0);
});

test('toolbar chip and detail are separate — no duplicated label', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html'); // strategy 미지정 — 자동 감지된 실제 값(reload)이 칩에 뜬다
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting = bridge.core.wait(10_000);
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('대기 중');
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요'); // 디바운스된 draft가 반영된 뒤(M1)
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/); // 슬라이드인 애니메이션이 끝난 뒤 촬영(M2)
  const waitingBox = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  await page.screenshot({ path: 'screenshots/toolbar-waiting.png', clip: { x: waitingBox.x - 8, y: waitingBox.y - 8, width: waitingBox.width + 16, height: waitingBox.height + 16 } });
  await page.locator(`${HOST} button.send`).click();
  await waiting;
  bridge.core.setAgentText('수정 중: collab.py + page.tsx');
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toHaveText(/수정 중/);
  await expect(page.locator(`${HOST} .status`)).toContainText('collab.py + page.tsx');
  await expect(page.locator(`${HOST} .status`)).not.toContainText('수정 중');
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/); // 슬라이드인 애니메이션이 끝난 뒤 촬영(M2)
  const workingBox = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  await page.screenshot({ path: 'screenshots/toolbar-working.png', clip: { x: workingBox.x - 8, y: workingBox.y - 8, width: workingBox.width + 16, height: workingBox.height + 16 } });
  bridge.core.setStrategy('none'); // done의 reload가 이후 단언을 끊지 않도록
  bridge.done({ summary: '완료: ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toHaveText(/완료/);
  await expect(page.locator(`${HOST} .status`)).toContainText('ok');
});

test('done summary stays in the detail while waiting, until a new draft starts (R98)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('색 변경');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  await waiting;
  bridge.done({ summary: '완료: 색 변경', selectors: ['#target'], changedFiles: ['x.tsx'] });
  bridge.core.wait(10_000);
  await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('대기 중');
  await expect(page.locator(`${HOST} .status`)).toContainText('✓ 완료: 색 변경');
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/); // 슬라이드인 애니메이션이 끝난 뒤 촬영(M2)
  const box = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  await page.screenshot({ path: 'screenshots/toolbar-done-waiting.png', clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
  await selectAt(page, '#card');
  await expect(page.locator(`${HOST} .status`)).not.toContainText('완료');
});

test('toolbar drags by the handle', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .status`)).toContainText('Ctrl+Shift+F'); // 연결 완료 후 폭이 안정된 뒤 측정(칩 텍스트가 붙기 전 측정하면 -50% 중심 정렬이 흔들린다)
  await expect(page.locator(`${HOST} .chip.strategy`)).toBeVisible(); // 전략 칩도 뜬 뒤라야 폭이 안정된다
  const before = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  const grip = (await page.locator(`${HOST} button.grip`).boundingBox())!;
  const gx = grip.x + grip.width / 2;
  const gy = grip.y + grip.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 200, gy - 120, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y + 120)).toBeLessThanOrEqual(2);
});

test('drag is clamped to the viewport', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .status`)).toContainText('Ctrl+Shift+F');
  await expect(page.locator(`${HOST} .chip.strategy`)).toBeVisible();
  const grip = (await page.locator(`${HOST} button.grip`).boundingBox())!;
  const gx = grip.x + grip.width / 2;
  const gy = grip.y + grip.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 5000, gy + 5000, { steps: 5 });
  await page.mouse.up();
  const rect = await page.locator(`${HOST} .toolbar`).evaluate((el) => { const r = el.getBoundingClientRect(); return { right: r.right, bottom: r.bottom }; });
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(rect.right).toBeLessThanOrEqual(viewport.width - 4);
  expect(rect.right).toBeGreaterThan(viewport.width - 8); // 클램프 상한에 닿았음을 확인 — 드래그가 죽어도 통과하지 않도록(M1)
  expect(rect.bottom).toBeLessThanOrEqual(viewport.height - 4);
});

test('position resets on reload', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .status`)).toContainText('Ctrl+Shift+F');
  await expect(page.locator(`${HOST} .chip.strategy`)).toBeVisible();
  const before = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  const grip = (await page.locator(`${HOST} button.grip`).boundingBox())!;
  const gx = grip.x + grip.width / 2;
  const gy = grip.y + grip.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 200, gy - 120, { steps: 5 });
  await page.mouse.up();
  await page.reload();
  await expect(page.locator(`${HOST} .status`)).toContainText('Ctrl+Shift+F');
  await expect(page.locator(`${HOST} .chip.strategy`)).toBeVisible();
  const after = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test('picked elements get numbered markers that renumber on remove', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText('1');
  await pickAt(page, '#title');
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(2);
  await expect(page.locator(`${HOST} .marker .n`).nth(1)).toHaveText('2');
  await page.locator(`${HOST} .els button`).first().click();
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText('1');
  const markerBox = (await page.locator(`${HOST} .marker`).boundingBox())!;
  const titleBox = (await page.locator('#title').boundingBox())!;
  expect(Math.abs(markerBox.x - titleBox.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(markerBox.y - titleBox.y)).toBeLessThanOrEqual(3);
});

test('markers follow scroll', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/markers.html');
  await page.locator('#bottom').scrollIntoViewIfNeeded();
  await selectAt(page, '#bottom');
  const before = (await page.locator('#bottom').boundingBox())!;
  const markerBefore = (await page.locator(`${HOST} .marker`).boundingBox())!;
  expect(Math.abs(markerBefore.x - before.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(markerBefore.y - before.y)).toBeLessThanOrEqual(3);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(150);
  const after = (await page.locator('#bottom').boundingBox())!;
  const markerAfter = (await page.locator(`${HOST} .marker`).boundingBox())!;
  expect(Math.abs(markerAfter.x - after.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(markerAfter.y - after.y)).toBeLessThanOrEqual(3);
});

test('markers clear on Send', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('버튼 작게');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  await waiting;
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(0);
});

test('placeholder switches to numbering hint with 2+ elements', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} textarea`)).toHaveAttribute('placeholder', '수정 요청 메모…');
  await pickAt(page, '#title');
  await expect(page.locator(`${HOST} textarea`)).toHaveAttribute('placeholder', '번호로 구분해 적을 수 있어요 — 1: … 2: …');
});

test.describe('region with screenshot capture', () => {
  test.use({ shotEnabled: true });

  test('a band over empty space becomes a region with within', async ({ cobroPage: page, bridge }) => {
    await page.goto('http://127.0.0.1:4173/region.html');
    await page.keyboard.press('Control+Shift+F');
    const a = (await page.locator('#a').boundingBox())!;
    const b = (await page.locator('#b').boundingBox())!;
    const left = a.x + a.width + 10;
    const right = b.x - 10;
    const midY = a.y + a.height / 2;
    await page.mouse.move(left, midY - 20);
    await page.mouse.down();
    await page.mouse.move((left + right) / 2, midY, { steps: 5 });
    await page.mouse.move(right, midY + 20, { steps: 5 });
    await page.mouse.up();
    const lastRow = page.locator(`${HOST} .els div`).last();
    await expect(lastRow).toContainText('▭');
    await expect(lastRow).toContainText('#grid');
    await expect(page.locator(`${HOST} .marker.region`)).toHaveCount(1);
    await expect(page.locator(`${HOST} .marker .n`)).toHaveText('1');
    // I1: a region-only draft still guides to note → Send (hasElements counts regions too)
    await page.keyboard.press('Escape');
    await expect(page.locator(`${HOST} .status`)).toContainText('메모를 적고 Send를 누르세요');
    await page.locator(`${HOST} textarea`).fill('여백 줄여줘');
    await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요');
    const waiting = bridge.core.wait(10_000);
    await page.locator(`${HOST} button.send`).click();
    const r = await waiting;
    expect(r.status).toBe('sent');
    if (r.status === 'sent') {
      const region = r.payload.batches[0]?.regions?.[0];
      expect(region).toBeDefined();
      expect(Math.abs(region!.rect.w - 100)).toBeLessThanOrEqual(3);
      expect(region!.within).toBe('#grid');
      expect(r.payload.batches[0]?.elements.length).toBe(0);
      expect(r.payload.batches[0]?.screenshot).toBeTruthy();
    }

    // M2: page rect.y must include scrollY — the #a/#b gap (208px page-y) can't survive a
    // 300px scroll (grid total height ~208px), so this second region is drawn on the
    // 1500px spacer added below the grid, which stays in view after scrolling.
    await page.keyboard.press('Control+Shift+F');
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
    const scrollY = await page.evaluate(() => window.scrollY);
    const bandLeft = 100, bandTop = 100, bandRight = 200, bandBottom = 140;
    await page.mouse.move(bandLeft, bandTop);
    await page.mouse.down();
    await page.mouse.move((bandLeft + bandRight) / 2, (bandTop + bandBottom) / 2, { steps: 5 });
    await page.mouse.move(bandRight, bandBottom, { steps: 5 });
    await page.mouse.up();
    await page.locator(`${HOST} textarea`).fill('스크롤 확인');
    const waiting2 = bridge.core.wait(10_000);
    await page.locator(`${HOST} button.send`).click();
    const r2 = await waiting2;
    expect(r2.status).toBe('sent');
    if (r2.status === 'sent') {
      const region2 = r2.payload.batches[0]?.regions?.[0];
      expect(region2).toBeDefined();
      expect(Math.abs(region2!.rect.y - (bandTop + scrollY))).toBeLessThanOrEqual(3);
    }
  });
});

test('a band that contains an element yields elements, no region', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await page.keyboard.press('Control+Shift+F');
  const b = (await page.locator('#ba').boundingBox())!;
  const pad = 4;
  await page.mouse.move(b.x - pad, b.y - pad);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width + pad, b.y + b.height + pad, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(`${HOST} .els div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els`)).toContainText('#ba');
  await page.locator(`${HOST} textarea`).fill('x');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status === 'sent') {
    expect(r.payload.batches[0]?.elements[0]?.selector).toBe('#ba');
    expect('regions' in r.payload.batches[0]!).toBe(false);
  }
});

test('region marker numbers continue after elements', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await selectAt(page, '#ba');
  const a = (await page.locator('#a').boundingBox())!;
  const b = (await page.locator('#b').boundingBox())!;
  const left = a.x + a.width + 10;
  const right = b.x - 10;
  const midY = a.y + a.height / 2;
  await page.mouse.move(left, midY - 20);
  await page.mouse.down();
  await page.mouse.move((left + right) / 2, midY, { steps: 5 });
  await page.mouse.move(right, midY + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText(['1', '2']);
  await expect(page.locator(`${HOST} .marker`).nth(1)).toHaveClass(/region/);
});

test('header ✕ collapses the panel and keeps the selection', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} .panel h4 .close`).click();
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
  await page.locator(`${HOST} button.collapse`).click();
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  await expect(page.locator(`${HOST} .els`)).toContainText('#target');
});

test('rows carry a type chip; region chip is marked', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await selectAt(page, '#ba');
  const a = (await page.locator('#a').boundingBox())!;
  const b = (await page.locator('#b').boundingBox())!;
  const left = a.x + a.width + 10;
  const right = b.x - 10;
  const midY = a.y + a.height / 2;
  await page.mouse.move(left, midY - 20);
  await page.mouse.down();
  await page.mouse.move((left + right) / 2, midY, { steps: 5 });
  await page.mouse.move(right, midY + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(`${HOST} .els div:nth-child(1) .kind`)).toHaveText('button');
  await expect(page.locator(`${HOST} .els div:nth-child(2) .kind`)).toHaveClass(/region/);
  await expect(page.locator(`${HOST} .els div:nth-child(1) .num`)).toHaveText('1.');
});

test('panel drags by its header and stays put across re-render', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel h4 .close`)).toBeVisible();
  const before = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const h4 = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  const hx = h4.x + 20;
  const hy = h4.y + h4.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 300, hy - 200, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator(`${HOST} .panel`).boundingBox())!;
  expect(Math.abs(after.x - before.x + 300)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y + 200)).toBeLessThanOrEqual(2);
  await page.locator(`${HOST} textarea`).click();
  await page.keyboard.type('abc');
  await page.waitForTimeout(600);
  const after2 = (await page.locator(`${HOST} .panel`).boundingBox())!;
  expect(Math.abs(after2.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after2.y - after.y)).toBeLessThanOrEqual(1);
});

test('header ✕ still collapses (click on button does not start a drag)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel h4 .close`)).toBeVisible();
  const h4 = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  const hx = h4.x + 20;
  const hy = h4.y + h4.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 300, hy - 200, { steps: 5 });
  await page.mouse.up();
  const moved = (await page.locator(`${HOST} .panel`).boundingBox())!;
  await page.locator(`${HOST} .panel h4 .close`).click();
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
  await page.locator(`${HOST} button.collapse`).click();
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  const after = (await page.locator(`${HOST} .panel`).boundingBox())!;
  expect(Math.abs(after.x - moved.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - moved.y)).toBeLessThanOrEqual(1);
});

test('dragging the panel twice moves it by the same amount each time (no duplicated drag listeners)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel h4 .close`)).toBeVisible();
  await page.locator(`${HOST} textarea`).click();
  await page.keyboard.type('12345678901234567890'); // 20자 — 디바운스 재렌더를 여러 번 유발
  await page.waitForTimeout(600);
  const before = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const h4a = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  await page.mouse.move(h4a.x + 20, h4a.y + h4a.height / 2);
  await page.mouse.down();
  await page.mouse.move(h4a.x + 20 - 80, h4a.y + h4a.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const mid = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const delta1 = { x: mid.x - before.x, y: mid.y - before.y };
  expect(Math.abs(delta1.x + 80)).toBeLessThanOrEqual(2); // 절대 이동량 — 드래그가 죽어도(delta1=0) 통과하지 않도록(M1)
  expect(Math.abs(delta1.y + 40)).toBeLessThanOrEqual(2);
  const h4b = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  await page.mouse.move(h4b.x + 20, h4b.y + h4b.height / 2);
  await page.mouse.down();
  await page.mouse.move(h4b.x + 20 - 80, h4b.y + h4b.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const after2 = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const delta2 = { x: after2.x - mid.x, y: after2.y - mid.y };
  expect(Math.abs(delta2.x - delta1.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(delta2.y - delta1.y)).toBeLessThanOrEqual(2);
});
