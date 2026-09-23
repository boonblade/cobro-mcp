import { test, expect, HOST, selectAt, startSelect } from './helpers.js';
import type { Page } from '@playwright/test';

// selectAt는 매번 Ctrl+Shift+F로 선택 모드를 토글한다 — 이미 선택 모드인 상태에서 두 번째
// 요소를 고를 때는 토글 없이 클릭만 한다.
async function pickAt(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
}

// R126: 자식까지 잡으려면 컨테이너와 자식이 모두 밴드에 완전히 들어가야 한다(R130) — 상자 전체를 덮는다
async function dragBand(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 5 });
  await page.mouse.up();
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
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('전송됨');
  await expect(page.locator(`${HOST} .status`)).toContainText('에이전트 응답 대기');
  await expect(page.locator(`${HOST} .dot`)).toHaveClass(/sent/);
  await expect(page.locator(`${HOST} .els`)).toHaveCount(0); // 보낸 배치가 좀비 draft로 되살아나면 안 된다
  bridge.done({ summary: '폰트 12px', selectors: ['#target'], changedFiles: ['x.tsx'] });
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('완료');
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
  // 힌트는 선택 모드와 무관하게 note가 있으면 'Send로 전송하세요' — state로 초안이 복구됐다는 신호
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요');
  await page.keyboard.press('Control+Shift+F'); // 재주입 뒤 선택 모드는 꺼진 채 시작 — 패널을 다시 열어 초안을 확인
  await expect(page.locator(`${HOST} textarea`)).toHaveValue('임시');
  await expect(page.locator(`${HOST} .els .missing`)).toContainText('요소 없음');
});

test('an emptied draft is not kept on the server, so a refresh does not restore an empty panel (T2, R129)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.keyboard.press('Control+Shift+F');
  await page.locator(`${HOST} textarea`).fill('abc');
  await page.locator(`${HOST} textarea`).fill('');
  await page.waitForTimeout(600); // 디바운스된 draft가 서버에 반영될 시간
  expect(bridge.core.session.batches.filter((b) => b.status === 'draft')).toHaveLength(0);
  await page.reload();
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/); // 선택 모드는 꺼진 채 시작 — 서버에 초안이 없다
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/); // 빈 패널 — 로컬 초안일 뿐 서버엔 없다
  await pickAt(page, '#target'); // 선택 모드가 이미 켜져 있으므로 재클릭 없이 바로 픽
  await page.waitForTimeout(600);
  const drafts = bridge.core.session.batches.filter((b) => b.status === 'draft');
  expect(drafts).toHaveLength(1);
  expect(drafts[0]!.elements).toHaveLength(1);
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

test('T1: drag-select picks only elements fully inside the band, or a region if none is (R130)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .toolbar`)).toBeVisible();
  await startSelect(page);
  const b = (await page.locator('#card').boundingBox())!;
  // #card의 60%(좌상단)만 덮으면 어떤 요소도 밴드에 완전히 포함되지 않는다(R130) → 영역
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3, { steps: 5 });
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els > div.group`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .els`)).toContainText('▭');
  await page.locator(`${HOST} .els > div button`).click(); // 지우고 다시(선택 모드는 그대로 켜져 있다)
  // #card 전체 + 여백 밴드 — #card와 그 안에 완전히 포함된 자식(p.desc, #target)이 모두 잡힌다.
  // 오른쪽은 뷰포트 경계(1280px)와 #card 우측이 8px밖에 안 떨어져 있어 +8이면 mouseup이 glass 밖으로
  // 나가 드래그가 씹힌다(실측) — 뷰포트 안에 머물도록 +5로 제한.
  await page.mouse.move(b.x - 8, b.y - 8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width + 5, b.y + b.height + 8, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els > div.group .cnt`)).toContainText('3'); // #card + p.desc + #target
  await page.locator(`${HOST} .els > div.group`).click();
  await expect(page.locator(`${HOST} .els .child`)).toContainText(['#card', 'p.desc', '#target']);
  await page.locator(`${HOST} .els > div.group button`).click(); // 지우고 다시(선택 모드는 그대로 켜져 있다)
  // #card 왼쪽 위 모서리를 10px만 스치는 밴드 — 완전히 포함되는 요소가 없다
  await page.mouse.move(b.x - 8, b.y - 8);
  await page.mouse.down();
  await page.mouse.move(b.x - 4, b.y - 4, { steps: 5 });
  await page.mouse.move(b.x + 2, b.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(`${HOST} .els div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els`)).toContainText('▭');
});

test('toolbar hint guides the next action', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .status`)).toContainText('요소를 고르세요');
  await page.locator(`${HOST} button`, { hasText: 'Select' }).click();
  await expect(page.locator(`${HOST} .status`)).toContainText('페이지에서 요소를 클릭하세요');
  const b = (await page.locator('#target').boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
  await expect(page.locator(`${HOST} .status`)).toContainText('1개 선택');
  await page.keyboard.press('Escape');
  await expect(page.locator(`${HOST} .status`)).toContainText('메모를 적고 Send');
  await page.locator(`${HOST} button.select`).click(); // 패널을 다시 열어야 메모를 칠 수 있다(R121)
  await page.keyboard.type('x');
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요');
});

test.describe('en locale', () => {
  test.use({ locale: 'en-US' });
  test('shows English hints and labels', async ({ cobroPage: page, bridge }) => {
    await page.goto('http://127.0.0.1:4173/basic.html');
    await expect(page.locator(`${HOST} .status`)).toContainText('pick an element');
    const waiting = bridge.core.wait(10_000);
    void waiting; // 이 테스트는 응답을 기다리지 않는다 — 칩 라벨만 확인
    await expect(page.locator(`${HOST} .chip:not(.strategy)`)).toContainText('Waiting');
    await selectAt(page, '#target');
    await expect(page.locator(`${HOST} .status`)).toContainText('selected');
    await expect(page.locator(`${HOST} .panel .sub`)).toContainText('element');
    await expect(page.locator(`${HOST} textarea`)).toHaveAttribute('placeholder', /Describe the change/);
    await page.locator(`${HOST} textarea`).fill('note'); // R173: Send는 메모가 있어야 뜬다
    await expect(page.locator(`${HOST} button.send`)).toBeVisible();
  });
});

test('toolbar width does not change between hints', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const toolbar = page.locator(`${HOST} .toolbar`);
  await expect(page.locator(`${HOST} .status`)).toContainText('Ctrl+Shift+F'); // 연결 완료 후 폭이 안정된 뒤 측정
  await expect(page.locator(`${HOST} .chip.strategy`)).toBeVisible(); // 전략 칩도 뜬 뒤라야 폭이 안정된다
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/marquee/); // 짧은 힌트는 marquee 없음
  const before = (await toolbar.boundingBox())!;
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .status`)).toContainText('1개 선택');
  const afterSelect = (await toolbar.boundingBox())!;
  expect(Math.abs(afterSelect.width - before.width)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(page.locator(`${HOST} .status`)).toContainText('메모를 적고 Send');
  const afterEsc = (await toolbar.boundingBox())!;
  expect(Math.abs(afterEsc.width - before.width)).toBeLessThanOrEqual(1);
});

test('status scrolls on hover only when it overflows', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.locator(`${HOST} .status`).hover();
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/scroll/);
  bridge.core.setAgentText('x'.repeat(200));
  await expect.poll(() => page.locator(`${HOST} .status`).textContent()).toContain('x'.repeat(160)); // 표시는 160자로 절단(R117)
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
  await expect.poll(() => page.locator(`${HOST} .status`).textContent()).toContain('x'.repeat(160)); // 표시는 160자로 절단(R117)
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
  await expect.poll(() => page.locator(`${HOST} .status`).textContent()).toContain('x'.repeat(160)); // 표시는 160자로 절단(R117)
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

test('long status text is truncated to 160 chars, full text kept in the title', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  const longText = 'x'.repeat(300);
  bridge.core.setAgentText(longText);
  const inner = page.locator(`${HOST} .status-in`);
  await expect.poll(() => inner.evaluate((el) => el.textContent?.length)).toBe(161);
  await expect(inner).toHaveText(/…$/);
  expect(await inner.getAttribute('title')).toBe(longText);
});

test('panel has no batch tabs, Add batch, or history (R64)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel`)).toBeVisible();
  const buttonTexts = await page.locator(`${HOST} .panel button`).allTextContents();
  expect(buttonTexts).not.toContain('Add batch');
  expect(buttonTexts).not.toContain('Redo');
  // Task 68: `.tabs`는 R172의 이 페이지/큐 탭으로 재사용됐다(R64가 막던 "batch 탭"과는 다른 개념) — Add batch/Redo/history가 없는 것만 확인
  await expect(page.locator(`${HOST} .tabs .tab`)).toHaveCount(2);
  await expect(page.locator(`${HOST} .hist`)).toHaveCount(0);
  await page.locator(`${HOST} textarea`).fill('x');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status === 'sent') expect(r.payload.batches.length).toBe(1);
  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('완료');
  await expect(page.locator(`${HOST} .hist`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .panel`)).toBeVisible(); // Task 68 R172: Send 뒤에는 패널이 큐 탭으로 열린 채 남는다(R64가 막던 batch 탭/이력과는 무관)
});

test('Select stays clickable while the agent works — it opens the queue instead of picking, and unlocks picking on the next wait() (R175, Task 68 교정 B2)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('a');
  const waiting1 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r1 = await waiting1;
  expect(r1.status).toBe('sent');

  await page.keyboard.press('Escape'); // 잠겨도 닫기는 언제나 된다
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);

  await expect(page.locator(`${HOST} .ib.select`)).toBeEnabled(); // B2: 잠겨도 클릭은 된다 — 흐린 스타일만
  await expect(page.locator(`${HOST} .ib.select`)).toHaveClass(/locked/);
  await expect(page.locator(`${HOST} .ib.select`)).toHaveAttribute('title', /수정 중/);
  await page.locator(`${HOST} .ib.select`).hover();
  await page.screenshot({ path: 'screenshots/queue-locked.png' });

  await page.locator(`${HOST} .ib.select`).click(); // 패널을 열되 큐 탭으로 — 선택 모드는 켜지 않는다
  await expect(page.locator(`${HOST} .tab.queue`)).toHaveClass(/on/);
  await expect(page.locator(`${HOST} .ib.select`)).not.toHaveClass(/on/);
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(0); // 새 마커가 추가되지 않는다(선택 모드가 아니다)

  await page.keyboard.press('Control+Shift+F'); // 잠긴 동안은 Ctrl+Shift+F도 같은 동작 — 이번엔 닫는다
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);

  bridge.core.wait(1000); // R74: 에이전트가 done 없이 wait를 다시 부르면 agent가 waiting으로 풀린다
  await expect(page.locator(`${HOST} .ib.select`)).not.toHaveClass(/locked/);
  await page.keyboard.press('Control+Shift+F'); // 잠금이 풀리면 선택 모드를 켠다
  await expect(page.locator(`${HOST} .ib.select`)).toHaveClass(/on/);

  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
});

test('toolbar chip and detail are separate — no duplicated label', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html'); // strategy 미지정 — 자동 감지된 실제 값(reload)이 칩에 뜬다
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting = bridge.core.wait(10_000);
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('대기 중');
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요'); // 디바운스된 draft가 반영된 뒤(M1)
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/); // 슬라이드인 애니메이션이 끝난 뒤 촬영(M2)
  const waitingBox = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  await page.screenshot({ path: 'screenshots/toolbar-waiting.png', clip: { x: waitingBox.x - 8, y: waitingBox.y - 8, width: waitingBox.width + 16, height: waitingBox.height + 16 } });
  await page.locator(`${HOST} button.send`).click();
  await waiting;
  bridge.core.setAgentText('수정 중: collab.py + page.tsx');
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toHaveText(/수정 중/);
  await expect(page.locator(`${HOST} .status`)).toContainText('collab.py + page.tsx');
  await expect(page.locator(`${HOST} .status`)).not.toContainText('수정 중');
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/); // 슬라이드인 애니메이션이 끝난 뒤 촬영(M2)
  const workingBox = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  await page.screenshot({ path: 'screenshots/toolbar-working.png', clip: { x: workingBox.x - 8, y: workingBox.y - 8, width: workingBox.width + 16, height: workingBox.height + 16 } });
  bridge.core.setStrategy('none'); // done의 reload가 이후 단언을 끊지 않도록
  bridge.done({ summary: '완료: ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toHaveText(/완료/);
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
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('대기 중');
  await expect(page.locator(`${HOST} .status`)).toContainText('✓ 완료: 색 변경');
  await expect(page.locator(`${HOST} .status-in`)).not.toHaveClass(/enter/); // 슬라이드인 애니메이션이 끝난 뒤 촬영(M2)
  const box = (await page.locator(`${HOST} .toolbar`).boundingBox())!;
  await page.screenshot({ path: 'screenshots/toolbar-done-waiting.png', clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
  await selectAt(page, '#card');
  await expect(page.locator(`${HOST} .status`)).not.toContainText('완료');
});

// T3(재현, R125): done 뒤 메모 잔존 관찰 재현. 지휘자 관찰과 달리 코드상 남는 경로가
// 보이지 않는다(미확인) — master에서 먼저 돌려 통과/실패를 확인한다.
test('done clears the note, leaving no leftover draft across reload (T3, R125)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none'); // done이 reload하면 확인 전에 문서가 바뀐다
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('fix me');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  await waiting;
  bridge.done({ summary: 'ok', selectors: ['#target'], changedFiles: [] });
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} textarea`)).toHaveValue('');
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .panel .sub`)).toContainText('요소 없음');
  await page.reload();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} textarea`)).toHaveValue('');
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .panel .sub`)).toContainText('요소 없음');
  expect(bridge.core.session.batches.filter((b) => b.status === 'draft')).toHaveLength(0);
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

test('picked elements get numbered markers with a stable ref that does not renumber on remove (R127)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText('1');
  await pickAt(page, '#title');
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(2);
  await expect(page.locator(`${HOST} .marker .n`).nth(1)).toHaveText('2');
  await page.locator(`${HOST} .els button`).first().click();
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText('2'); // R127: 안정 ref — 1이 지워져도 2로 당겨지지 않는다
  const markerBox = (await page.locator(`${HOST} .marker`).boundingBox())!;
  const titleBox = (await page.locator('#title').boundingBox())!;
  expect(Math.abs(markerBox.x - titleBox.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(markerBox.y - titleBox.y)).toBeLessThanOrEqual(3);
});

test('markers follow scroll', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/markers.html');
  await page.locator('#bottom').scrollIntoViewIfNeeded();
  await selectAt(page, '#bottom');
  // R139: 고정 대기 대신 조건 대기 — boundingBox null이면 Infinity로 취급해 재시도한다.
  await expect.poll(async () => {
    const a = await page.locator('#bottom').boundingBox();
    const m = await page.locator(`${HOST} .marker`).boundingBox();
    return a && m ? Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y)) : Infinity;
  }).toBeLessThanOrEqual(3);
  const before = (await page.locator('#bottom').boundingBox())!;
  await page.mouse.wheel(0, -600);
  // 스크롤 반영 전 첫 poll이 통과하는 공허 단언 방지(I1)
  await expect.poll(async () => (await page.locator('#bottom').boundingBox())?.y ?? before.y).not.toBe(before.y);
  await expect.poll(async () => {
    const a = await page.locator('#bottom').boundingBox();
    const m = await page.locator(`${HOST} .marker`).boundingBox();
    return a && m ? Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y)) : Infinity;
  }).toBeLessThanOrEqual(3);
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
  await expect(page.locator(`${HOST} textarea`)).toHaveAttribute('placeholder', '번호로 구분해 적을 수 있어요 — 1: … 1b: … 2: …');
});

test.describe('region with screenshot capture', () => {
  test.use({ shotEnabled: true });

  test('a band over empty space becomes a region with within', async ({ cobroPage: page, bridge }) => {
    await page.goto('http://127.0.0.1:4173/region.html');
    await startSelect(page);
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
    await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
    await expect(page.locator(`${HOST} .status`)).toContainText('메모를 적고 Send를 누르세요');
    await expect(page.locator(`${HOST} .marker.region`)).toHaveCount(1); // 패널이 닫혀도 마커는 유지(R121)
    await page.keyboard.press('Control+Shift+F');
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

    bridge.core.wait(1000); // R175: 다시 고르려면 에이전트가 wait()로 풀어줘야 한다
    await expect(page.locator(`${HOST} .ib.select`)).toBeEnabled(); // 클라이언트가 해제를 받을 때까지
    // M2: page rect.y must include scrollY — the #a/#b gap (208px page-y) can't survive a
    // 300px scroll (grid total height ~208px), so this second region is drawn on the
    // 1500px spacer added below the grid, which stays in view after scrolling.
    await startSelect(page);
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
  await startSelect(page);
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

test('T2: Select opens the panel, Esc closes it but keeps the marker, Select reopens with the same list (R121)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  await expect(page.locator(`${HOST} textarea`)).toBeVisible(); // 첫 state 수신 전이면 초안 생성이 미뤄진다(I1) — textarea 등장을 기다린다
  expect(await focusedTag(page)).toBe('TEXTAREA');
  await expect(page.locator(`${HOST} .els div`)).toHaveCount(0);
  const b = (await page.locator('#target').boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 3);
  await page.mouse.click(b.x + 3, b.y + 3);
  await expect(page.locator(`${HOST} .els div`)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
  await expect(page.locator(`${HOST} button.select`)).not.toHaveClass(/on/);
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1);
  await page.locator(`${HOST} button.select`).click();
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  await expect(page.locator(`${HOST} .els div`)).toHaveCount(1);
});

test('T4: reload then immediate Select+typing does not lose the server-restored draft (I1)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.keyboard.type('keep me');
  await page.waitForTimeout(600); // 디바운스된 draft가 서버에 저장될 시간
  await page.reload();
  await page.keyboard.press('Control+Shift+F'); // 대기 없이 즉시 — state 도착 전 레이스를 노린다
  await page.keyboard.type(' more');
  await page.waitForTimeout(800);
  await expect(page.locator(`${HOST} .els`)).toContainText('#target');
  await expect(page.locator(`${HOST} textarea`)).toHaveValue(/keep me/);
  const serverBatch = bridge.core.session.batches.find((b) => b.status === 'draft');
  expect(serverBatch?.elements.some((e) => e.selector === '#target')).toBe(true);
});

test('T3a: header ✕ closes the panel and turns off select mode, keeping the marker (R121)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} .panel h4 .close`).click();
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
  await expect(page.locator(`${HOST} button.select`)).not.toHaveClass(/on/);
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1);
});

test('T3b: a note-only Send delivers an empty elements list and switches the panel to the queue tab (R121, Task 68 R172)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  await expect(page.locator(`${HOST} textarea`)).toBeVisible(); // 첫 state 수신 전이면 초안 생성이 미뤄진다(I1) — 포커스 갈 곳이 생길 때까지 대기
  await page.keyboard.type('메모만 보냅니다');
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status === 'sent') {
    expect(r.payload.batches[0]!.elements.length).toBe(0);
    expect(r.payload.batches[0]).not.toHaveProperty('regions');
    expect(r.payload.batches[0]!.note).toBe('메모만 보냅니다');
  }
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/); // Task 68 R172: Send 직후 패널은 큐 탭으로 열린 채 남는다
  await expect(page.locator(`${HOST} .tab.queue`)).toHaveClass(/on/);
  await expect(page.locator(`${HOST} button.select`)).not.toHaveClass(/on/);
});

test('M1: panel keeps its dragged position across header ✕ close and Select reopen', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel h4 .close`)).toBeVisible();
  const h4 = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  const hx = h4.x + 8;
  const hy = h4.y + h4.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 300, hy - 200, { steps: 5 });
  await page.mouse.up();
  const moved = (await page.locator(`${HOST} .panel`).boundingBox())!;
  await page.locator(`${HOST} .panel h4 .close`).click(); // 버튼 클릭은 드래그를 시작하지 않는다
  await expect(page.locator(`${HOST} .panel`)).not.toHaveClass(/show/);
  await page.locator(`${HOST} button.select`).click();
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  const after = (await page.locator(`${HOST} .panel`).boundingBox())!;
  expect(Math.abs(after.x - moved.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - moved.y)).toBeLessThanOrEqual(1);
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
  await page.locator(`${HOST} textarea`).fill('x'); // R173: 메모가 있어야 Send 행이 뜬다 — 타이핑 전후로 행 높이를 고정해 둔다
  await expect(page.locator(`${HOST} button.send`)).toBeVisible();
  await expect(page.locator(`${HOST} .panel h4 .grip svg`)).toBeVisible();
  await expect(page.locator(`${HOST} .panel h4 .close`)).toBeVisible();
  const before = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const h4 = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  const hx = h4.x + 8;
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

test('dragging the panel twice moves it by the same amount each time (no duplicated drag listeners)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel h4 .close`)).toBeVisible();
  await page.locator(`${HOST} textarea`).click();
  await page.keyboard.type('12345678901234567890'); // 20자 — 디바운스 재렌더를 여러 번 유발
  await page.waitForTimeout(600);
  const before = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const h4a = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  await page.mouse.move(h4a.x + 8, h4a.y + h4a.height / 2);
  await page.mouse.down();
  await page.mouse.move(h4a.x + 8 - 80, h4a.y + h4a.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const mid = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const delta1 = { x: mid.x - before.x, y: mid.y - before.y };
  expect(Math.abs(delta1.x + 80)).toBeLessThanOrEqual(2); // 절대 이동량 — 드래그가 죽어도(delta1=0) 통과하지 않도록(M1)
  expect(Math.abs(delta1.y + 40)).toBeLessThanOrEqual(2);
  const h4b = (await page.locator(`${HOST} .panel h4`).boundingBox())!;
  await page.mouse.move(h4b.x + 8, h4b.y + h4b.height / 2);
  await page.mouse.down();
  await page.mouse.move(h4b.x + 8 - 80, h4b.y + h4b.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const after2 = (await page.locator(`${HOST} .panel`).boundingBox())!;
  const delta2 = { x: after2.x - mid.x, y: after2.y - mid.y };
  expect(Math.abs(delta2.x - delta1.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(delta2.y - delta1.y)).toBeLessThanOrEqual(2);
});

test('footer sits 8px under the textarea', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await expect(page.locator(`${HOST} .panel textarea`)).toBeVisible(); // 렌더 잠깐의 재구성 뒤 DOM이 안정될 때까지 대기
  const textarea = (await page.locator(`${HOST} .panel textarea`).boundingBox())!;
  const row = (await page.locator(`${HOST} .panel .row`).boundingBox())!;
  expect(row.y - (textarea.y + textarea.height)).toBeGreaterThanOrEqual(7);
  expect(row.y - (textarea.y + textarea.height)).toBeLessThanOrEqual(9);
});

test('T2: dragging over two elements makes one group — the band is the head; expand shows its children and their markers (R126)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await startSelect(page);
  const a = (await page.locator('#a').boundingBox())!;
  const b = (await page.locator('#b').boundingBox())!;
  const combined = { x: a.x, y: Math.min(a.y, b.y), width: b.x + b.width - a.x, height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) };
  await dragBand(page, combined);
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  const group = page.locator(`${HOST} .els > div.group`);
  await expect(group).toHaveCount(1);
  await expect(group.locator('.cnt')).toContainText('4'); // M2: .cnt로 한정
  await expect(page.locator(`${HOST} .els .child`)).toHaveCount(0); // 초기 접힘
  await expect(page.locator(`${HOST} .marker.region`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText(['1']);
  await expect(page.locator(`${HOST} .marker.child`)).toHaveCount(0);
  await group.click();
  const children = page.locator(`${HOST} .els .child`);
  await expect(children).toHaveCount(4);
  await expect(children.nth(0)).toContainText('#a');
  await expect(children.nth(1)).toContainText('#ba');
  await expect(children.nth(2)).toContainText('#b');
  await expect(children.nth(3)).toContainText('#bb');
  await expect(page.locator(`${HOST} .marker.child`)).toHaveCount(4);
  await group.click();
  await expect(page.locator(`${HOST} .els .child`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .marker.child`)).toHaveCount(0);
});

test('T3: expanding a second group collapses the first (accordion, R126)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await startSelect(page);
  const a = (await page.locator('#a').boundingBox())!;
  await dragBand(page, a);
  const b = (await page.locator('#b').boundingBox())!;
  await dragBand(page, b);
  const groups = page.locator(`${HOST} .els > div.group`);
  await expect(groups).toHaveCount(2);
  await groups.nth(0).click();
  let children = page.locator(`${HOST} .els .child`);
  await expect(children).toHaveCount(2);
  await expect(children.nth(0)).toContainText('#a');
  await expect(children.nth(1)).toContainText('#ba');
  await groups.nth(1).click();
  children = page.locator(`${HOST} .els .child`);
  await expect(children).toHaveCount(2);
  await expect(children.nth(0)).toContainText('#b');
  await expect(children.nth(1)).toContainText('#bb');
});

test('T4: Send carries a stable ref for every element/region, no parent key; refs never shift on removal (R127)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/region.html');
  await startSelect(page);
  const a = (await page.locator('#a').boundingBox())!;
  const b = (await page.locator('#b').boundingBox())!;
  const combined = { x: a.x, y: Math.min(a.y, b.y), width: b.x + b.width - a.x, height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) };
  await dragBand(page, combined);
  await page.locator(`${HOST} textarea`).fill('1: 여백  1b: 색상');
  const waiting1 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r1 = await waiting1;
  expect(r1.status).toBe('sent');
  if (r1.status === 'sent') {
    expect(r1.payload.batches[0]!.regions).toMatchObject([{ ref: '1' }]);
    expect(r1.payload.batches[0]!.elements.map((e) => e.ref)).toEqual(['1a', '1b', '1c', '1d']);
    for (const e of r1.payload.batches[0]!.elements) expect('parent' in e).toBe(false);
  }
  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });

  await startSelect(page);
  await dragBand(page, combined);
  await page.locator(`${HOST} .els > div.group`).click();
  await page.locator(`${HOST} .els .child`).nth(1).locator('button').click(); // "1b" 제거
  const remaining = page.locator(`${HOST} .els .child`);
  await expect(remaining).toHaveCount(3);
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting2 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r2 = await waiting2;
  expect(r2.status).toBe('sent');
  if (r2.status === 'sent') expect(r2.payload.batches[0]!.elements.map((e) => e.ref)).toEqual(['1a', '1c', '1d']);
  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });

  await startSelect(page);
  await dragBand(page, combined); // 새 배치 — 요소 0·영역 0에서 다시 그룹 하나
  await page.locator(`${HOST} .els > div.group button`).click(); // 그룹째 제거 → 요소 0·영역 0
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(0);
  await dragBand(page, combined);
  await expect(page.locator(`${HOST} .els > div.group`)).toContainText('1.'); // 카운터 리셋 — 다시 밴드해도 ref '1'부터
});

test('T5: a band around one element is a lone pick, not a group; ref stays stable after a removal (R126)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await startSelect(page);
  const ba = (await page.locator('#ba').boundingBox())!;
  const pad = 4;
  await dragBand(page, { x: ba.x - pad, y: ba.y - pad, width: ba.width + pad * 2, height: ba.height + pad * 2 });
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els`)).toContainText('#ba');
  await expect(page.locator(`${HOST} .els .chev`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .els .cnt`)).toHaveCount(0);
  await pickAt(page, '#bb');
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(2);
  await page.locator(`${HOST} .els > div`).nth(0).locator('button').click(); // ref "1"(#ba) 제거
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els`)).toContainText('2.');
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText(['2']);
});

test('T6: an empty band is a region with no chevron/cnt (R126)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} .ib.select`)).toHaveClass(/on/); // 선택 모드 활성화를 기다린 뒤 드래그(webkit 경쟁 방지)
  // 밑의 1500px 여백 — 어떤 요소도 들어가지 않는 빈 공간
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(340, 420, { steps: 5 });
  await page.mouse.move(360, 440, { steps: 5 });
  await page.mouse.up();
  const row = page.locator(`${HOST} .els > div`);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('1.');
  await expect(row).toContainText('▭');
  await expect(page.locator(`${HOST} .els .chev`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .els .cnt`)).toHaveCount(0);
});

test('T7: clicking a group child on the page toggles just that child (R126)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/region.html');
  await startSelect(page);
  const a = (await page.locator('#a').boundingBox())!;
  const b = (await page.locator('#b').boundingBox())!;
  const combined = { x: a.x, y: Math.min(a.y, b.y), width: b.x + b.width - a.x, height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) };
  await dragBand(page, combined);
  await pickAt(page, '#ba'); // 이미 그룹 안에 있는 요소를 페이지에서 다시 클릭 — 토글로 그 자식만 제거
  const group = page.locator(`${HOST} .els > div.group`);
  await expect(group.locator('.cnt')).toContainText('3'); // M2: .cnt로 한정
  await group.click();
  const children = page.locator(`${HOST} .els .child`);
  await expect(children).toHaveCount(3);
  await expect(children.nth(0)).toContainText('#a');
  await expect(children.nth(1)).toContainText('#b');
  await expect(children.nth(2)).toContainText('#bb');
});

test('T8: an old draft without refs gets them assigned in order on reload (elements first, then regions)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/region.html');
  bridge.core.setDrafts([{
    id: 'legacy', note: '', status: 'draft', createdAt: new Date().toISOString(),
    elements: [
      { selector: '#a', tag: 'section', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {} },
      { selector: '#b', tag: 'section', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {} },
    ],
    regions: [{ rect: { x: 0, y: 0, w: 10, h: 10 } }],
  }]);
  await page.reload();
  await page.keyboard.press('Control+Shift+F');
  const rows = page.locator(`${HOST} .els > div`);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('1.');
  await expect(rows.nth(1)).toContainText('2.');
  await expect(rows.nth(2)).toContainText('3.');
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status === 'sent') {
    expect(r.payload.batches[0]!.elements.every((e) => !!e.ref)).toBe(true);
    expect(r.payload.batches[0]!.regions!.every((rg) => !!rg.ref)).toBe(true);
  }
  bridge.core.wait(1000); // R175: 다시 고르려면 에이전트가 wait()로 풀어줘야 한다(서버 상태라 reload에도 남는다)
  // M1(리뷰): ref는 있는데 refSeq가 없는 초안 — 다음 발급이 기존 숫자와 겹치면 안 된다
  bridge.core.setDrafts([{
    id: 'legacy2', note: '', status: 'draft', createdAt: new Date().toISOString(),
    elements: [
      { selector: '#a', tag: 'section', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {}, ref: '1' },
      { selector: '#ba', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {}, ref: '1a' },
    ],
    regions: [{ ref: '1', rect: { x: 0, y: 0, w: 10, h: 10 } }],
  }]);
  await page.reload();
  await startSelect(page);
  await pickAt(page, '#bb');
  await expect(page.locator(`${HOST} .marker:not(.region):not(.child) .n`).last()).toHaveText('2'); // 새 낱개 요소의 마커(영역 마커는 DOM 순서상 항상 뒤에 붙는다)
});

test('T9: a group child ref like "1a" is never confused with a lone element ref like "10" (R127 I1)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/region.html');
  bridge.core.setDrafts([{
    id: 'many', note: '', status: 'draft', createdAt: new Date().toISOString(), refSeq: 10,
    regions: [{ ref: '1', rect: { x: 0, y: 0, w: 10, h: 10 } }],
    elements: [
      { selector: '#ba', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {}, ref: '1a' },
      { selector: '#bb', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {}, ref: '10' },
    ],
  }]);
  await page.reload();
  await page.keyboard.press('Control+Shift+F');
  const group = page.locator(`${HOST} .els > div.group`);
  await expect(group).toHaveCount(1);
  await expect(group.locator('.cnt')).toContainText('1'); // "10"은 "1"의 자식이 아니다
  const rows = page.locator(`${HOST} .els > div`);
  await expect(rows).toHaveCount(2); // 그룹 "1" + 낱개 "10"
  await expect(rows.last()).toContainText('10.');
  await group.locator('button').click(); // 그룹째 제거 — "1a"만 지워져야 한다
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .els > div`)).toContainText('#bb'); // "10"(#bb)은 살아남는다
});

test('T10: redragging a band whose hits already belong to the draft changes nothing; brand-new hits still group (R126 I2)', async ({ cobroPage: page }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await startSelect(page);
  const a = (await page.locator('#a').boundingBox())!;
  await dragBand(page, a);
  const group1 = page.locator(`${HOST} .els > div.group`).first();
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(group1.locator('.num')).toHaveText('1.');
  await expect(group1.locator('.cnt')).toContainText('2');
  await dragBand(page, a); // 재드래그 — #a·#ba 전부 이미 목록에 있음(fresh 0)
  await expect(page.locator(`${HOST} .els > div`)).toHaveCount(1);
  await expect(group1.locator('.cnt')).toContainText('2'); // 그대로 — 자식 0개짜리 그룹이 새로 생기지 않는다
  const b = (await page.locator('#b').boundingBox())!;
  await dragBand(page, b); // #b·#bb는 아직 없음 — fresh 2 → 새 그룹, ref는 재드래그로 낭비되지 않은 '2'
  const groups = page.locator(`${HOST} .els > div.group`);
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(1).locator('.num')).toHaveText('2.');
});

test.describe('R131 working indicator', () => {
  test.use({ envTheme: 'dark' });

  test('working boxes appear on Send and clear on done (R131)', async ({ cobroPage: page, bridge }) => {
    bridge.core.setStrategy('none');
    await page.goto('http://127.0.0.1:4173/basic.html');
    await selectAt(page, '#target');
    await page.locator(`${HOST} textarea`).fill('메모');
    const waiting = bridge.core.wait(10_000);
    await page.locator(`${HOST} button.send`).click();
    const r = await waiting;
    expect(r.status).toBe('sent');

    await expect(page.locator(`${HOST} .wbox`)).toHaveCount(1);
    const targetBox = (await page.locator('#target').boundingBox())!;
    const wboxBox = (await page.locator(`${HOST} .wbox`).boundingBox())!;
    expect(Math.abs(wboxBox.x - targetBox.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(wboxBox.y - targetBox.y)).toBeLessThanOrEqual(3);
    expect(Math.abs(wboxBox.width - targetBox.width)).toBeLessThanOrEqual(5);
    expect(Math.abs(wboxBox.height - targetBox.height)).toBeLessThanOrEqual(5);
    await expect(page.locator(`${HOST} .wbox .n`)).toHaveText('1');
    await expect(page.locator(`${HOST} .toolbar .line`)).toBeVisible();
    await page.screenshot({ path: 'screenshots/working-dark.png' });

    bridge.core.setAgentText('Editing: x');
    await expect(page.locator(`${HOST} .wbox`)).toHaveCount(1);

    bridge.done({ summary: 'ok', selectors: ['#target'], changedFiles: [] });
    await expect(page.locator(`${HOST} .wbox`)).toHaveCount(0);
    await expect(page.locator(`${HOST} .toolbar .line`)).toBeHidden();
    await expect(page.locator(`${HOST} .flash`)).toHaveCount(1);
  });
});

test('note-only Send shows only the toolbar line (R131)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/basic.html');
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator(`${HOST} .panel`)).toHaveClass(/show/);
  await expect(page.locator(`${HOST} textarea`)).toBeVisible();
  await page.keyboard.type('메모만 보냅니다');
  await expect(page.locator(`${HOST} .status`)).toContainText('Send로 전송하세요');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');

  await expect(page.locator(`${HOST} .wbox`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .toolbar .line`)).toBeVisible();

  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .toolbar .line`)).toBeHidden();
});

test('working effect is static under prefers-reduced-motion (R131)', async ({ cobroPage: page, bridge }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');

  await expect(page.locator(`${HOST} .wbox`)).toHaveCount(1);
  const wboxAnim = await page.locator(`${HOST} .wbox`).evaluate((el) => getComputedStyle(el).animationName);
  expect(wboxAnim).toBe('none');
  const sweepDisplay = await page.locator(`${HOST} .wbox .sweep`).evaluate((el) => getComputedStyle(el).display);
  expect(sweepDisplay).toBe('none');
  const lineAnim = await page.locator(`${HOST} .toolbar .line`).evaluate((el) => getComputedStyle(el).animationName);
  expect(lineAnim).toBe('none');
  await expect(page.locator(`${HOST} .wbox`)).toHaveCount(1);
});

test('queue: drafts from two pages show as cards; Send delivers both in order (R172)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await selectAt(page, '#a');
  await page.locator(`${HOST} textarea`).fill('r');
  await expect.poll(() => bridge.core.session.batches.length).toBe(1); // 디바운스된 draft가 서버에 반영될 때까지

  await page.goto('http://127.0.0.1:4173/basic.html');
  await startSelect(page);
  await pickAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('b');
  // B3(Task 68 교정, 검토 M2 원 단언 복원): 마커가 vm.current(basic 초안)의 것인지 좌표·ref로 확인 — 다른 페이지(region) 초안이 renderMarkers로 새지 않는다
  await expect(page.locator(`${HOST} .marker`)).toHaveCount(1); // basic 페이지 마커만 — region 초안은 마커에 안 나온다
  await expect(page.locator(`${HOST} .marker .n`)).toHaveText('1');
  const markerBox = (await page.locator(`${HOST} .marker`).boundingBox())!;
  const targetBox = (await page.locator('#target').boundingBox())!;
  expect(Math.abs(markerBox.x - targetBox.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(markerBox.y - targetBox.y)).toBeLessThanOrEqual(3);

  await page.locator(`${HOST} .tab.queue`).click();
  await expect(page.locator(`${HOST} .queue .card`)).toHaveCount(2);
  await expect(page.locator(`${HOST} .queue .card`).nth(0).locator('.path')).toContainText('/region.html');
  await expect(page.locator(`${HOST} .queue .card`).nth(1).locator('.path')).toContainText('/basic.html');
  await expect(page.locator(`${HOST} .queue .card`).nth(1)).toHaveClass(/here/);
  await page.screenshot({ path: 'screenshots/queue-cards.png' });

  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status !== 'sent') return;
  expect(r.payload.batches).toHaveLength(2);
  expect(r.payload.batches[0]?.page?.url).toContain('/region.html');
  expect(r.payload.batches[1]?.page?.url).toContain('/basic.html');
  await expect(page.locator(`${HOST} .tab.queue`)).toHaveClass(/on/); // R172: Send 직후 자동으로 큐 탭
});

test('queue: Send hides when nothing to send; the round ends with a collapsed done row that clears on the next pick (R173·R174)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('a');
  const waiting1 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r1 = await waiting1;
  expect(r1.status).toBe('sent');
  if (r1.status !== 'sent') return;
  const firstId = r1.payload.batches[0]!.id;

  bridge.core.wait(1000); // R175: 두 번째를 고르려면 에이전트가 먼저 wait()로 풀어줘야 한다
  await expect(page.locator(`${HOST} .ib.select`)).toBeEnabled(); // 클라이언트가 해제를 받을 때까지
  await selectAt(page, '#card');
  await page.locator(`${HOST} textarea`).fill('b');
  const waiting2 = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r2 = await waiting2;
  expect(r2.status).toBe('sent');

  await expect(page.locator(`${HOST} .row button.send`)).toHaveCount(0);
  await expect(page.locator(`${HOST} .row .foot`)).toContainText('처리 중 0/2');

  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] }, firstId);
  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('1/2');

  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] });
  await expect(page.locator(`${HOST} .done-row`)).toHaveCount(1);
  await expect(page.locator(`${HOST} .done-row`)).toContainText('완료 2');
  await expect(page.locator(`${HOST} .row .foot`)).toHaveClass(/ok/);
  await page.screenshot({ path: 'screenshots/queue-done-row.png' }); // 접힘 상태

  await page.locator(`${HOST} .done-row`).click(); // M1(Task 68 교정): 펼침 분기
  await expect(page.locator(`${HOST} .done-item`)).toHaveCount(2);
  await expect(page.locator(`${HOST} .done-item`).nth(0)).toContainText('✓ ');
  await expect(page.locator(`${HOST} .done-item`).nth(1)).toContainText('✓ ');

  bridge.core.wait(1000); // 잠금 해제
  await expect(page.locator(`${HOST} .ib.select`)).toBeEnabled(); // 클라이언트가 해제를 받을 때까지
  await selectAt(page, '#title');
  await page.locator(`${HOST} .tab.queue`).click(); // ensureCurrent가 새 초안을 만들며 「이 페이지」 탭으로 돌아간다 — 큐 탭에서 정리를 확인
  await expect(page.locator(`${HOST} .done-row`)).toHaveCount(0);
  await expect.poll(() => bridge.core.session.batches.filter((b) => b.status === 'done').length).toBe(0);
});

test('queue card click moves to that page (R172)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await selectAt(page, '#a');
  await page.locator(`${HOST} textarea`).fill('r');
  await expect.poll(() => bridge.core.session.batches.length).toBe(1);

  await page.goto('http://127.0.0.1:4173/basic.html');
  await startSelect(page);
  await page.locator(`${HOST} .tab.queue`).click();
  await expect(page.locator(`${HOST} .queue .card`)).toHaveCount(1);
  await page.locator(`${HOST} .queue .card`).first().click();
  await expect(page).toHaveURL(/region\.html/);
});

test('user navigation during work pauses following (R176)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('a');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status !== 'sent') return;
  const id = r.payload.batches[0]!.id;

  bridge.core.setAgentText('x', id); // status(text, batchId) — 묶음을 working으로
  await page.goto('http://127.0.0.1:4173/region.html'); // 사용자가 직접 다른 페이지로 이동

  await expect.poll(() => bridge.core.session.followPaused).toBe(true);
  await expect(page.locator(`${HOST} .status`)).toContainText('따라가기'); // R176: 툴바 힌트(페이지 이동으로 패널은 새로 뜬 오버레이라 닫혀 있다)

  bridge.done({ summary: 'ok', selectors: [], changedFiles: [] }, id);
  await expect.poll(() => (bridge.core.session.pendingDone ?? []).some((p) => p.url.includes('basic.html'))).toBe(true);
  expect(page.url()).toContain('region.html'); // 자동 이동하지 않는다
  await expect(page.locator(`${HOST} .status-in a.goto`)).toHaveCount(1);
});

test('working boxes are drawn only for batches of the current page (R168)', async ({ cobroPage: page, bridge }) => {
  bridge.core.setStrategy('none');
  await page.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(page, '#target');
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');

  await expect(page.locator(`${HOST} .wbox`)).toHaveCount(1);

  await page.goto('http://127.0.0.1:4173/region.html');
  await expect(page.locator(`${HOST} .wbox`)).toHaveCount(0); // M3: 다른 페이지에서는 유령 스캔 박스가 없어야 한다
  await expect(page.locator(`${HOST} .toolbar .line`)).toBeVisible(); // busy는 페이지 무관 — 흐름선은 그대로

  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect(page.locator(`${HOST} .wbox`)).toHaveCount(1); // 원래 페이지로 돌아오면 다시 보인다
});

test('done for another page shows a view link; clicking it lands there and replays the highlight (R171)', async ({ cobroPage: page, bridge }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await selectAt(page, '#a');
  await page.locator(`${HOST} textarea`).fill('메모');
  const waiting = bridge.core.wait(10_000);
  await page.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status !== 'sent') return;
  const batchId = r.payload.batches[0]!.id;

  await page.goto('http://127.0.0.1:4173/basic.html');
  await expect.poll(() => bridge.core.session.page?.url).toContain('basic.html'); // Task 66 T1 관례: 서버 반영을 기다린다
  bridge.done({ summary: 'ok', selectors: ['#a'], changedFiles: [] }, batchId);

  await expect(page.locator(`${HOST} .status`)).toContainText('/region.html');
  await expect(page.locator(`${HOST} .status-in a.goto`)).toHaveCount(1);
  await page.screenshot({ path: 'screenshots/cart-view-link.png' });

  await page.locator(`${HOST} .status-in a.goto`).click();
  await expect(page).toHaveURL(/region\.html/);
  await expect(page.locator(`${HOST} .flash`)).toHaveCount(1); // pendingDone 재생
  await expect(page.locator(`${HOST} .status-in a.goto`)).toHaveCount(0);
});

async function focusedTag(page: Page): Promise<string | undefined> {
  return page.evaluate((host) => {
    const h = document.querySelector(host);
    return (h as (Element & { shadowRoot: ShadowRoot }) | null)?.shadowRoot?.activeElement?.tagName;
  }, HOST);
}

test('two tabs on different pages keep each other\'s drafts; Send from either delivers both (R177)', async ({ cobroPage: page, bridge, ctx }) => {
  await page.goto('http://127.0.0.1:4173/region.html');
  await selectAt(page, '#a');
  await page.locator(`${HOST} textarea`).fill('r');
  await page.keyboard.press('Escape');
  await expect.poll(() => bridge.core.session.batches.length).toBe(1); // Task 66 T1 관례: 다음 탭을 열기 전 서버 반영을 기다린다

  const p2 = await ctx.newPage();
  await p2.goto('http://127.0.0.1:4173/basic.html');
  await selectAt(p2, '#target');
  await p2.locator(`${HOST} textarea`).fill('b');
  await expect.poll(() => bridge.core.session.batches.length).toBe(2);

  // 첫 탭에서 패널을 열어 메모를 고쳐도 다른 페이지(region) 초안은 서버에 그대로 남는다
  await startSelect(page);
  await page.locator(`${HOST} textarea`).fill('r2');
  await page.waitForTimeout(800);
  expect(bridge.core.session.batches.length).toBe(2);

  // 두 번째 탭에서 메모를 고쳐도 마찬가지
  await p2.locator(`${HOST} textarea`).fill('b2');
  await p2.waitForTimeout(800);
  expect(bridge.core.session.batches.length).toBe(2);

  await p2.locator(`${HOST} .tab.queue`).click();
  await expect(p2.locator(`${HOST} .queue .card`)).toHaveCount(2);
  await expect(p2.locator(`${HOST} .queue .card`).nth(0).locator('.path')).toContainText('/region.html');

  const waiting = bridge.core.wait(10_000);
  await p2.locator(`${HOST} button.send`).click();
  const r = await waiting;
  expect(r.status).toBe('sent');
  if (r.status !== 'sent') return;
  expect(r.payload.batches).toHaveLength(2);
  expect(r.payload.batches[0]?.page?.url).toContain('/region.html');
  expect(r.payload.batches[1]?.page?.url).toContain('/basic.html');

  await expect(page.locator(`${HOST} .toolbar .chip:not(.strategy)`)).toContainText('0/2');
});
