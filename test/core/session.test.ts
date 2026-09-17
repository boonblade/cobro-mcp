import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/core/store.js';
import { SessionCore } from '../../src/core/session.js';
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
  it('setDrafts replaces only drafts', () => {
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1'], page);
    core.setDrafts([draft('3')]);
    expect(core.session.batches.map((b) => [b.id, b.status])).toEqual([['1', 'sent'], ['3', 'draft']]);
  });
  it('markSent moves earlier sent to unanswered and sets agent sent (R79)', () => {
    core.setDrafts([draft('1'), draft('2')]);
    core.markSent(['1'], page);
    core.markSent(['2'], page);
    const st = Object.fromEntries(core.session.batches.map((b) => [b.id, b.status]));
    expect(st).toEqual({ '1': 'unanswered', '2': 'sent' });
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
});
