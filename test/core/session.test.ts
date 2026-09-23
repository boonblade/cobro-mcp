import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, emptySession } from '../../src/core/store.js';
import { SessionCore } from '../../src/core/session.js';
import { samePage } from '../../src/core/page.js';
import type { Batch, Payload, PageInfo } from '../../src/core/types.js';

const page: PageInfo = { url: 'http://x/', title: 'X', viewport: { w: 800, h: 600 } };
const el = { selector: '#a', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {} };
const draft = (id: string): Batch => ({ id, note: 'n' + id, elements: [el], status: 'draft', createdAt: 't' });
const payloadOf = (ids: string[]): Payload => ({ origin: 'human', sentAt: 't', page, batches: ids.map((id) => ({ id, note: '', elements: [] })), console: [], refreshStrategy: 'none' });

let core: SessionCore; let store: Store;
beforeEach(() => { store = new Store(mkdtempSync(join(tmpdir(), 'cobro-'))); core = new SessionCore(store); });

describe('SessionCore', () => {
  it('starts empty and restores from store', () => {
    core.setDrafts([draft('1')]);
    const again = new SessionCore(store);
    expect(again.session.batches.map((b) => b.id)).toEqual(['1']);
  });
  it('restart normalizes waiting to idle but keeps the done text (M1)', async () => {
    vi.useFakeTimers();
    store.save({ ...emptySession(), agent: { status: 'waiting', text: '요약' } });
    const restarted = new SessionCore(store);
    expect(restarted.session.agent.text).toBe('요약');
    const p = restarted.wait(1000);
    expect(restarted.session.agent).toEqual({ status: 'waiting', text: '요약' });
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    vi.useRealTimers();
  });
  it('setDrafts replaces only drafts', () => {
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1'], page);
    core.setDrafts([draft('3')]);
    expect(core.session.batches.map((b) => [b.id, b.status])).toEqual([['1', 'sent'], ['3', 'draft']]);
  });
  it('setDrafts drops empty drafts (no elements, no regions, blank note) but keeps sent untouched (R129)', () => {
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    core.setDrafts([
      { id: 'empty', note: '', elements: [], status: 'draft', createdAt: 't' },
      draft('2'),
      { id: 'noteOnly', note: '메모', elements: [], status: 'draft', createdAt: 't' },
      { id: 'regionOnly', note: '', elements: [], status: 'draft', createdAt: 't', regions: [{ rect: { x: 0, y: 0, w: 1, h: 1 } }] },
    ]);
    const drafts = core.session.batches.filter((b) => b.status === 'draft');
    expect(drafts.map((b) => b.id)).toEqual(['2', 'noteOnly', 'regionOnly']);
    expect(core.session.batches.find((b) => b.id === '1')?.status).toBe('sent');
  });
  it('markSent no longer downgrades earlier sent batches to unanswered (R160, R79 폐기)', () => {
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1'], page);
    core.markSent(['2'], page);
    const st = Object.fromEntries(core.session.batches.map((b) => [b.id, b.status]));
    expect(st).toEqual({ '1': 'sent', '2': 'sent' });
    expect(core.session.batches.filter((b) => b.status === 'unanswered')).toHaveLength(0);
    expect(core.session.agent.status).toBe('sent');
  });
  it('wait() unlocks: agent goes waiting even right after sent', async () => {
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    expect(core.session.agent.status).toBe('sent');
    const p = core.wait(1000);
    expect(core.session.agent.status).toBe('waiting');
    core.deliver(payloadOf(['1']));
    await expect(p).resolves.toMatchObject({ status: 'sent', payload: { batches: [{ id: '1' }] } });
    const doneBatches = core.done({ summary: 'ok', selectors: [], changedFiles: [] });
    expect(doneBatches.map((b) => b.id)).toEqual(['1']);
    expect(core.session.agent.status).toBe('done');
  });
  it('wait resolves with delivered payload, ticks, and sets waiting', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const p = core.wait(10_000, tick, { tickMs: 1000 });
    expect(core.session.agent.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2500);
    expect(tick).toHaveBeenCalledTimes(2);
    core.deliver(payloadOf(['1']));
    await expect(p).resolves.toMatchObject({ status: 'sent', payload: { batches: [{ id: '1' }] } });
    vi.useRealTimers();
  });
  it('wait returns pending on timeout and a payload delivered before wait is queued', async () => {
    vi.useFakeTimers();
    const p = core.wait(1000);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(p).resolves.toEqual({ status: 'pending' });
    core.deliver(payloadOf(['q']));
    await expect(core.wait(1000)).resolves.toMatchObject({ status: 'sent', payload: { batches: [{ id: 'q' }] } });
    vi.useRealTimers();
  });
  it('wait aborts via signal as pending', async () => {
    const ac = new AbortController();
    const p = core.wait(60_000, undefined, { signal: ac.signal });
    ac.abort();
    await expect(p).resolves.toEqual({ status: 'pending' });
  });
  it('done marks sent batches done with summary', () => {
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    core.setAgentText('수정 중');
    expect(core.session.agent).toEqual({ status: 'working', text: '수정 중' });
    const doneBatches = core.done({ summary: 'ok', selectors: ['#a'], changedFiles: ['a.tsx'] });
    expect(doneBatches.map((b) => b.id)).toEqual(['1']);
    expect(core.session.batches[0]).toMatchObject({ status: 'done', summary: 'ok' });
    expect(core.session.agent.status).toBe('done');
  });
  it('setDrafts stamps s.page onto a new draft; a later setDrafts with an overlay-sent page keeps the first value; no s.page → no page (R161)', () => {
    core.setDrafts([draft('1')]);
    expect(core.session.batches[0]!.page).toBeUndefined();

    core.setPage(page, 'none');
    core.setDrafts([draft('2')]);
    expect(core.session.batches.find((b) => b.id === '2')!.page).toEqual({ url: page.url, title: page.title });

    const other = { url: 'http://y/', title: 'Y' };
    core.setDrafts([{ ...draft('2'), page: other } as Batch]);
    expect(core.session.batches.find((b) => b.id === '2')!.page).toEqual({ url: page.url, title: page.title });
  });
  it('setAgentText(text, batchId) marks a sent/working batch as working; an unknown id only sets agent text (R162)', () => {
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1', '2'], page);
    core.setAgentText('x', '1');
    expect(core.session.batches.find((b) => b.id === '1')!.status).toBe('working');
    expect(core.session.batches.find((b) => b.id === '2')!.status).toBe('sent');
    expect(core.session.agent).toEqual({ status: 'working', text: 'x' });

    core.setAgentText('y', 'nope');
    expect(core.session.batches.find((b) => b.id === '1')!.status).toBe('working');
    expect(core.session.agent).toEqual({ status: 'working', text: 'y' });
  });
  it('done(info, batchId) closes only that batch; agent stays sent while another sent/working batch remains, then done once all close (R162)', () => {
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1', '2'], page);
    const out1 = core.done({ summary: 's1', selectors: [], changedFiles: [] }, '1');
    expect(out1.map((b) => b.id)).toEqual(['1']);
    expect(core.session.batches.find((b) => b.id === '1')!.status).toBe('done');
    expect(core.session.batches.find((b) => b.id === '2')!.status).toBe('sent');
    expect(core.session.agent).toEqual({ status: 'sent', text: 's1' });

    const out2 = core.done({ summary: 's2', selectors: [], changedFiles: [] }, '2');
    expect(out2.map((b) => b.id)).toEqual(['2']);
    expect(core.session.agent).toEqual({ status: 'done', text: 's2' });
  });
  it('done() with no batchId also closes working batches, not only sent (M2)', () => {
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    core.setAgentText('x', '1');
    expect(core.session.batches[0]!.status).toBe('working');
    const out = core.done({ summary: 'ok', selectors: [], changedFiles: [] });
    expect(out.map((b) => b.id)).toEqual(['1']);
    expect(core.session.batches[0]!.status).toBe('done');
  });
  it('restart normalizes a working batch back to sent (R160)', () => {
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    core.setAgentText('x', '1');
    expect(core.session.batches[0]!.status).toBe('working');
    const restarted = new SessionCore(store);
    expect(restarted.session.batches[0]!.status).toBe('sent');
  });
  it('pushPendingDone replaces an entry for the same url and keeps at most 20; takePendingDone matches by samePage (hash ignored) and drains; closeSession clears it (R163)', () => {
    core.pushPendingDone({ url: 'http://x/a', batchIds: ['1'], info: { summary: 'first', selectors: [], changedFiles: [] } });
    core.pushPendingDone({ url: 'http://x/a', batchIds: ['2'], info: { summary: 'second', selectors: [], changedFiles: [] } });
    expect(core.session.pendingDone).toEqual([{ url: 'http://x/a', batchIds: ['2'], info: { summary: 'second', selectors: [], changedFiles: [] } }]);

    for (let i = 0; i < 25; i++) core.pushPendingDone({ url: `http://x/${i}`, batchIds: [], info: { summary: 's', selectors: [], changedFiles: [] } });
    expect(core.session.pendingDone).toHaveLength(20);

    core.pushPendingDone({ url: 'http://z/', batchIds: ['z'], info: { summary: 'zed', selectors: [], changedFiles: [] } });
    const taken = core.takePendingDone('http://z/#foo');
    expect(taken.map((p) => p.batchIds)).toEqual([['z']]);
    expect(core.session.pendingDone!.some((p) => p.url === 'http://z/')).toBe(false);
    expect(core.takePendingDone('http://z/')).toEqual([]);

    core.pushPendingDone({ url: 'http://q/', batchIds: ['q'], info: { summary: 'q', selectors: [], changedFiles: [] } });
    core.closeSession();
    expect(core.session.pendingDone).toEqual([]);
  });
  it('samePage ignores hash, distinguishes search and origin, and falls back to string equality for non-URLs (B2)', () => {
    expect(samePage('http://x/a#foo', 'http://x/a#bar')).toBe(true);
    expect(samePage('http://x/a?x=1', 'http://x/a?x=2')).toBe(false);
    expect(samePage('http://x/a', 'http://y/a')).toBe(false);
    expect(samePage('a', 'a')).toBe(true);
    expect(samePage('a', 'b')).toBe(false);
  });
  it('setScreenshot persists the path so a fresh core sees it', () => {
    core.setDrafts([draft('1')]);
    core.setScreenshot('1', '/shots/1.png');
    expect(new SessionCore(store).session.batches[0]!.screenshot).toBe('/shots/1.png');
  });
  it('effectiveStrategy prefers fixed over detected over reload', () => {
    expect(core.effectiveStrategy()).toBe('reload');
    core.setPage(page, 'none');
    expect(core.effectiveStrategy()).toBe('none');
    core.setStrategy('event');
    expect(core.effectiveStrategy()).toBe('event');
  });
  it('emits change after every mutation', () => {
    const fn = vi.fn(); core.on('change', fn);
    core.setDrafts([draft('1')]); core.setAgentText('x');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('cancelWait resolves a pending wait as browserGone and resets agent to idle (R77)', async () => {
    const p = core.wait(5000);
    expect(core.cancelWait()).toBe(true);
    await expect(p).resolves.toEqual({ status: 'pending', browserGone: true });
    expect(core.session.agent.status).toBe('idle');
  });
  it('cancelWait returns false when nothing is waiting', () => {
    expect(core.cancelWait()).toBe(false);
  });
  it('cancelWait resets agent to idle even when nothing is waiting (M1)', () => {
    core.setAgentText('수정 중');
    expect(core.cancelWait()).toBe(false);
    expect(core.session.agent.status).toBe('idle');
  });
  it('a second wait supersedes the first: first resolves pending, second gets the payload', async () => {
    const first = core.wait(60_000);
    const second = core.wait(60_000);
    await expect(first).resolves.toEqual({ status: 'pending' });
    core.deliver(payloadOf(['z']));
    await expect(second).resolves.toMatchObject({ status: 'sent', payload: { batches: [{ id: 'z' }] } });
  });
  it('wait after done keeps the summary; wait after sent clears it (R98)', async () => {
    vi.useFakeTimers();
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    const p1 = core.wait(1000);
    core.deliver(payloadOf(['1']));
    await p1;
    core.done({ summary: '색 변경', selectors: [], changedFiles: [] });
    const p2 = core.wait(1000);
    expect(core.session.agent).toEqual({ status: 'waiting', text: '색 변경' });
    await vi.advanceTimersByTimeAsync(1000);
    await p2;

    const p2b = core.wait(50); // I1: pending으로 풀린 뒤 재wait해도 done 요약 유지
    expect(core.session.agent).toEqual({ status: 'waiting', text: '색 변경' });
    await vi.advanceTimersByTimeAsync(50);
    await expect(p2b).resolves.toEqual({ status: 'pending' });
    expect(core.session.agent).toEqual({ status: 'waiting', text: '색 변경' });

    const store2 = new Store(mkdtempSync(join(tmpdir(), 'cobro-')));
    const core2 = new SessionCore(store2);
    core2.setDrafts([draft('1')]);
    core2.markSent(['1'], page);
    const p3 = core2.wait(1000);
    expect(core2.session.agent).toEqual({ status: 'waiting', text: '' });
    await vi.advanceTimersByTimeAsync(1000);
    await p3;
    vi.useRealTimers();
  });
  it('closeSession clears screenshots of done batches only, keeping unfinished batches\' shots (R81)', () => {
    // Task 68 R174: 처리 중 묶음이 남아 있는 동안은(여기서는 '2') 새 done 정리가 끼어들지 않는다 — 같은 라운드에서 '1'만 done
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1', '2'], page);
    core.done({ summary: 'ok', selectors: [], changedFiles: [] }, '1');
    core.setScreenshot('1', store.shotPath('1'));
    core.setScreenshot('2', store.shotPath('2'));
    const spy = vi.spyOn(store, 'clearShots');
    core.closeSession();
    expect(spy).toHaveBeenCalledWith(['2']);
    expect(core.session.batches.find((b) => b.id === '1')!.screenshot).toBeUndefined();
    expect(core.session.batches.find((b) => b.id === '2')!.screenshot).toBe(store.shotPath('2'));
  });
  it('dropEmptyDrafts removes note-less drafts and closeSession applies it before clearing shots (R125)', () => {
    core.setDrafts([
      { ...draft('A'), note: '' },
      { ...draft('A2'), note: '  ' },
      { ...draft('B'), note: 'keep' },
      draft('C'),
    ]);
    core.markSent(['C'], page);
    core.setScreenshot('A', store.shotPath('A'));
    core.setScreenshot('B', store.shotPath('B'));
    const removed = core.dropEmptyDrafts();
    expect(removed).toBe(2);
    const spy = vi.spyOn(store, 'clearShots');
    core.closeSession();
    expect(spy).toHaveBeenCalledWith(expect.arrayContaining(['B', 'C']));
    expect(spy.mock.calls[0]![0]).toHaveLength(2);
    expect(core.session.batches.map((b) => b.id)).toEqual(['B', 'C']);
    expect(core.session.batches.find((b) => b.id === 'B')!.screenshot).toBe(store.shotPath('B'));
  });
  it('setDrafts clears the last round\'s done batches once a new content draft arrives and nothing is active; an empty draft never clears (R174)', () => {
    core.setDrafts([draft('x'), draft('y')]);
    core.markSent(['x', 'y'], page);
    core.done({ summary: 'x done', selectors: [], changedFiles: [] }, 'x');
    expect(core.session.batches.map((b) => [b.id, b.status])).toEqual([['x', 'done'], ['y', 'sent']]);

    // y가 여전히 처리 중 — 새 내용 초안이 와도 done을 치우지 않는다
    core.setDrafts([draft('new')]);
    expect(core.session.batches.find((b) => b.id === 'x')!.status).toBe('done');

    core.done({ summary: 'y done', selectors: [], changedFiles: [] }, 'y');
    expect(core.session.batches.some((b) => b.status === 'sent' || b.status === 'working')).toBe(false);

    // 빈 초안(요소·영역·메모 없음)은 새 내용으로 치지 않는다 — done이 그대로 남는다
    core.setDrafts([draft('new'), { ...draft('empty'), elements: [], note: '' }]);
    expect(core.session.batches.some((b) => b.status === 'done')).toBe(true);

    // 내용 있는 새 초안(브랜드뉴 id) + 처리 중 묶음 없음 → done 전부 제거
    core.setDrafts([draft('new'), draft('brand-new-2')]);
    expect(core.session.batches.some((b) => b.status === 'done')).toBe(false);
    expect(core.session.batches.map((b) => b.id).sort()).toEqual(['brand-new-2', 'new']);
  });
  it('an arrival matching the expected navigation does not pause following; an unexpected arrival while busy does; markSent/done clear it once nothing stays active; a restart also clears it (R176)', () => {
    core.setPage(page, 'reload');
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page);
    core.expectNavigation('http://x/a');
    core.noteArrival('http://x/a#h'); // 따라간 도착 — hash만 다름
    expect(core.session.followPaused).toBeFalsy();
    expect(core.expectedNavigation()).toBeNull();

    core.noteArrival('http://x/c'); // 처리 중인데 예상 밖 페이지로 이동
    expect(core.session.followPaused).toBe(true);

    core.done({ summary: 'done1', selectors: [], changedFiles: [] }); // 남은 처리 중 묶음 없음 → done()이 해제
    expect(core.session.followPaused).toBe(false);
    expect(core.expectedNavigation()).toBeNull();

    core.setDrafts([draft('2')]);
    core.markSent(['2'], page); // markSent도 처리 중 묶음이 없어지는 시점에는 해제한다(막 보낸 '2'가 있으니 여기선 유지)
    expect(core.session.followPaused).toBe(false); // 아직 일시정지된 적 없음 — 새 라운드 시작이 되살리지 않는다
    core.noteArrival('http://x/d');
    expect(core.session.followPaused).toBe(true);
    core.done({ summary: 'done2', selectors: [], changedFiles: [] });
    expect(core.session.followPaused).toBe(false);

    const restarted = new SessionCore(store);
    expect(restarted.session.followPaused).toBe(false);
  });
  it('an unexpected arrival while a navigation is expected clears expectedUrl too, so a later arrival at the original target is not mistaken for having followed (M6, Task 68 교정)', () => {
    core.setDrafts([draft('1')]);
    core.markSent(['1'], page); // busy — page는 core의 기본 page('http://x/')
    core.expectNavigation('http://x/a');
    core.noteArrival('http://x/c'); // 사용자가 예상 밖 페이지로 이동
    expect(core.session.followPaused).toBe(true);
    expect(core.expectedNavigation()).toBeNull();

    core.noteArrival('http://x/a'); // 원래 목적지에 뒤늦게 도착해도 '따라간 도착'으로 오판하지 않는다
    expect(core.session.followPaused).toBe(true); // 해제는 markSent/done만
  });
  it('setDrafts replaces drafts per page when a pageUrl is given (R177)', () => {
    const A = { url: 'http://x/a', title: 'A', viewport: { w: 1, h: 1 } };
    const B = { url: 'http://x/b', title: 'B', viewport: { w: 1, h: 1 } };
    const freshWithAB = () => {
      const c = new SessionCore(new Store(mkdtempSync(join(tmpdir(), 'cobro-'))));
      c.setPage(A, 'none'); c.setDrafts([draft('a1')]);
      c.setPage(B, 'none'); c.setDrafts([draft('a1'), draft('b1')]);
      return c;
    };
    // (a) 같은 페이지 초안 교체, 다른 페이지 초안 유지
    const c1 = freshWithAB();
    c1.setDrafts([draft('a2')], 'http://x/a');
    expect(c1.session.batches.map((b) => b.id).sort()).toEqual(['a2', 'b1']);

    // (b) 빈 배열 → 같은 페이지 초안만 삭제, 다른 페이지 유지
    const c2 = freshWithAB();
    c2.setDrafts([], 'http://x/a');
    expect(c2.session.batches.map((b) => b.id)).toEqual(['b1']);

    // (c) page 없는 옛 초안은 같은 페이지로 취급돼 교체됨
    const c3 = new SessionCore(new Store(mkdtempSync(join(tmpdir(), 'cobro-'))));
    c3.setDrafts([draft('legacy')]); // s.page가 없어 page 필드가 안 찍힌다
    expect(c3.session.batches[0]!.page).toBeUndefined();
    c3.setDrafts([draft('new')], 'http://x/a');
    expect(c3.session.batches.map((b) => b.id)).toEqual(['new']);

    // (d) pageUrl 없으면 전체 교체(기존 동작)
    const c4 = freshWithAB();
    c4.setDrafts([draft('only')]);
    expect(c4.session.batches.map((b) => b.id)).toEqual(['only']);

    // (e) hash만 다른 pageUrl은 같은 페이지
    const c5 = freshWithAB();
    c5.setDrafts([draft('a3')], 'http://x/a#zzz');
    expect(c5.session.batches.map((b) => b.id).sort()).toEqual(['a3', 'b1']);
  });
});
