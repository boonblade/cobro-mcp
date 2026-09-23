import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/core/store.js';
import { createBridge, type Bridge } from '../../src/bridge.js';

let b: Bridge | null = null;
afterEach(async () => { await b?.close(); b = null; });
const page = { url: 'http://x/', title: 'X', viewport: { w: 1, h: 1 } };
const el = { selector: '#a', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {} };

describe('createBridge', () => {
  it('routes draft → send into wait with screenshot path and broadcasts done', async () => {
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't', screenshot: async (batch) => `/shots/${batch.id}.png` });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    const msgs: unknown[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'page', page, detected: 'none' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'b1', note: '줄여줘', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['b1'], page }));
    const r = await waiting;
    expect(r).toMatchObject({ status: 'sent', payload: { origin: 'human', refreshStrategy: 'none', batches: [{ id: 'b1', note: '줄여줘', screenshot: '/shots/b1.png' }] } });
    b.done({ summary: 'ok', selectors: ['#a'], changedFiles: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.some((m) => (m as { type: string }).type === 'done')).toBe(true);
    expect(b.core.session.batches[0]!.status).toBe('done');
    ws.close();
  });

  it('broadcasts done immediately when the current page only differs by hash from the batch page (B1, R163)', async () => {
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't', screenshot: async (batch) => `/shots/${batch.id}.png` });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    const msgs: Array<{ type: string }> = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'page', page: { ...page, url: page.url + '#a' }, detected: 'none' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'h1', note: 'n', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['h1'], page: { ...page, url: page.url + '#a' } }));
    await waiting;
    ws.send(JSON.stringify({ type: 'page', page: { ...page, url: page.url + '#b' }, detected: 'none' })); // 같은 페이지, hash만 이동
    await new Promise((r) => setTimeout(r, 30));

    msgs.length = 0;
    b.done({ summary: 'ok', selectors: [], changedFiles: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.filter((m) => m.type === 'done')).toHaveLength(1);
    ws.close();
  });

  it('replays a pending done once when the same page reconnects after a reload (R163)', async () => {
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't', screenshot: async (batch) => `/shots/${batch.id}.png` });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    const msgs: Array<{ type: string; strategy?: string }> = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'page', page, detected: 'reload' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'r1', note: 'n', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['r1'], page }));
    await waiting;

    msgs.length = 0;
    b.done({ summary: 'ok', selectors: [], changedFiles: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.filter((m) => m.type === 'done')).toHaveLength(1);

    msgs.length = 0;
    ws.send(JSON.stringify({ type: 'page', page: { ...page, url: page.url + '#x' }, detected: 'reload' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.filter((m) => m.type === 'done')).toHaveLength(1);
    expect(msgs.find((m) => m.type === 'done')).toMatchObject({ strategy: 'none' });

    msgs.length = 0;
    ws.send(JSON.stringify({ type: 'page', page: { ...page, url: page.url + '#y' }, detected: 'reload' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.filter((m) => m.type === 'done')).toHaveLength(0);
    ws.close();
  });

  it('a batch drafted on another page does not broadcast on done; it replays when that page reconnects (R163)', async () => {
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't', screenshot: async (batch) => `/shots/${batch.id}.png` });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    const msgs: Array<{ type: string }> = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    const otherPage = { url: 'http://x/other', title: 'Other', viewport: { w: 1, h: 1 } };
    ws.send(JSON.stringify({ type: 'page', page: otherPage, detected: 'none' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'o1', note: 'n', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['o1'], page: otherPage }));
    await waiting;
    ws.send(JSON.stringify({ type: 'page', page, detected: 'none' })); // 사용자가 http://x/로 이동
    await new Promise((r) => setTimeout(r, 30));

    msgs.length = 0;
    b.done({ summary: 'ok', selectors: [], changedFiles: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.some((m) => m.type === 'done')).toBe(false);

    msgs.length = 0;
    ws.send(JSON.stringify({ type: 'page', page: otherPage, detected: 'none' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.some((m) => m.type === 'done')).toBe(true);
    ws.close();
  });

  it('Send skips re-shooting a batch drafted on a different page and keeps its existing screenshot (R164)', async () => {
    const shotCalls: string[] = [];
    b = await createBridge({
      store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't',
      screenshot: async (batch) => { shotCalls.push(batch.id); return `/shots/${batch.id}.png`; },
    });
    const otherPage = { url: 'http://x/other', title: 'Other', viewport: { w: 1, h: 1 } };
    b.core.setPage(otherPage, 'none');
    b.core.setDrafts([{ id: 'd1', note: 'n', elements: [el], status: 'draft', createdAt: 't' }]);
    b.core.setScreenshot('d1', '/shots/d1-draft.png');
    b.core.setPage(page, 'none'); // 사용자가 http://x/로 이동
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    ws.on('message', () => {});
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['d1'], page }));
    const r = await waiting;
    expect(shotCalls).toEqual([]);
    expect(r).toMatchObject({ status: 'sent', payload: { batches: [{ id: 'd1', screenshot: '/shots/d1-draft.png' }] } });
    ws.close();
  });

  it('ignores a malformed draft and still delivers a later valid send', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't' });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'draft', batches: null })); // 형태가 깨진 메시지 — 무시되어야 한다
    ws.send(JSON.stringify({ type: 'send', batchIds: 'nope', page })); // 이것도
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'b1', note: '줄여줘', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['b1'], page }));
    await expect(waiting).resolves.toMatchObject({ status: 'sent', payload: { batches: [{ id: 'b1' }] } });
    err.mockRestore();
    ws.close();
  });

  it('resolves wait even when payload building throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    b = await createBridge({
      store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't',
      consoleEntries: () => { throw new Error('console boom'); },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'b2', note: 'n', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['b2'], page }));
    const r = await waiting;
    expect(r.status).toBe('sent');
    if (r.status !== 'sent') return;
    expect(r.payload.batches.map((x) => x.id)).toEqual(['b2']);
    expect(r.payload.console).toEqual([]);
    err.mockRestore();
    ws.close();
  });

  it('resolves wait even when state saving throws (D2)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new Store(mkdtempSync(join(tmpdir(), 'cobro-')));
    b = await createBridge({ store, token: 't' });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'b3', note: '줄여줘', elements: [el], status: 'draft', createdAt: 't' }] }));
    await new Promise((r) => setTimeout(r, 50));
    const waiting = b.core.wait(5000);
    vi.spyOn(store, 'save').mockImplementation(() => { throw new Error('EACCES'); });
    ws.send(JSON.stringify({ type: 'send', batchIds: ['b3'], page }));
    const r = await waiting;
    expect(r.status).toBe('sent');
    if (r.status !== 'sent') return;
    expect(r.payload.batches[0]!.note).toBe('줄여줘');
    expect(r.payload.console).toEqual([]);
    err.mockRestore();
    ws.close();
  });

  it('does not crash the process when recovery delivery also fails (D1)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't' });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'b4', note: 'n', elements: [el], status: 'draft', createdAt: 't' }] }));
    await new Promise((r) => setTimeout(r, 50));
    vi.spyOn(b.core, 'deliver').mockImplementation(() => { throw new Error('deliver boom'); });
    ws.send(JSON.stringify({ type: 'send', batchIds: ['b4'], page }));
    await new Promise((r) => setTimeout(r, 100));
    const calls = err.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => m.startsWith('[cobro] send 처리 실패'))).toBe(true);
    expect(calls.some((m) => m.startsWith('[cobro] send 복구 실패'))).toBe(true);
    err.mockRestore();
    ws.close();
  });

  it('settings 메시지가 파일에 저장되고 state.ui로 브로드캐스트된다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const settingsFile = join(dir, 'settings.json');
    b = await createBridge({ store: new Store(dir), token: 't', settingsFile });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    const msgs: { type: string; ui?: { theme: string; themeLocked: boolean } }[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    await new Promise((r) => setTimeout(r, 30));
    ws.send(JSON.stringify({ type: 'settings', patch: { theme: 'light' } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ theme: 'light' });
    expect(b.ui()).toEqual({ theme: 'light', themeLocked: false });
    expect(msgs.some((m) => m.type === 'state' && m.ui?.theme === 'light' && m.ui.themeLocked === false)).toBe(true);
    ws.close();
  });

  it('COBRO_THEME(envTheme)이 있으면 settings 메시지를 무시하고 잠긴 상태를 유지한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const settingsFile = join(dir, 'settings.json');
    b = await createBridge({ store: new Store(dir), token: 't', settingsFile, envTheme: 'dark' });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    await new Promise((r) => setTimeout(r, 30));
    ws.send(JSON.stringify({ type: 'settings', patch: { theme: 'light' } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(b.ui()).toEqual({ theme: 'dark', themeLocked: true });
    err.mockRestore();
    ws.close();
  });

  it('theme 값이 아니면 settings 메시지를 무시한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const settingsFile = join(dir, 'settings.json');
    b = await createBridge({ store: new Store(dir), token: 't', settingsFile });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    await new Promise((r) => setTimeout(r, 30));
    ws.send(JSON.stringify({ type: 'settings', patch: { theme: 'neon' } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(b.ui()).toEqual({ theme: 'auto', themeLocked: false });
    err.mockRestore();
    ws.close();
  });

  it('settingsFile 없이 만든 bridge는 settings 메시지를 무시한다(M5)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't' }); // settingsFile 미전달
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    await new Promise((r) => setTimeout(r, 30));
    ws.send(JSON.stringify({ type: 'settings', patch: { theme: 'light' } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(b.ui()).toEqual({ theme: 'auto', themeLocked: false });
    expect(err.mock.calls.some((c) => String(c[0]).includes('settingsFile 없음'))).toBe(true);
    err.mockRestore();
    ws.close();
  });

  it('shoots a draft with elements after a 500ms debounce; note-only changes do not reshoot, rect changes do (R164)', async () => {
    const shotCalls: string[] = [];
    b = await createBridge({
      store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't',
      screenshot: async (batch) => { shotCalls.push(batch.id); return `/shots/${batch.id}.png`; },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'page', page, detected: 'none' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'd1', note: '', elements: [el], status: 'draft', createdAt: 't' }] }));
    await new Promise((r) => setTimeout(r, 600));
    expect(shotCalls).toEqual(['d1']);
    expect(b!.core.session.batches[0]!.screenshot).toBe('/shots/d1.png');

    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'd1', note: '메모', elements: [el], status: 'draft', createdAt: 't' }] }));
    await new Promise((r) => setTimeout(r, 600));
    expect(shotCalls).toEqual(['d1']);

    const moved = { ...el, rect: { x: 5, y: 5, w: 1, h: 1 } };
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'd1', note: '메모', elements: [moved], status: 'draft', createdAt: 't' }] }));
    await new Promise((r) => setTimeout(r, 600));
    expect(shotCalls).toEqual(['d1', 'd1']);
    ws.close();
  });

  it('does not shoot a draft stamped on another page even while it is current (R164)', async () => {
    const shotCalls: string[] = [];
    b = await createBridge({
      store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't',
      screenshot: async (batch) => { shotCalls.push(batch.id); return `/shots/${batch.id}.png`; },
    });
    const otherPage = { url: 'http://x/other', title: 'Other', viewport: { w: 1, h: 1 } };
    b.core.setPage(otherPage, 'none');
    b.core.setDrafts([{ id: 'd2', note: '', elements: [el], status: 'draft', createdAt: 't' }]);
    b.core.setPage(page, 'none'); // 사용자가 http://x/로 이동, d2는 http://x/other에 찍힌 초안
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    const moved = { ...el, rect: { x: 9, y: 9, w: 1, h: 1 } };
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'd2', note: '', elements: [moved], status: 'draft', createdAt: 't', page: otherPage }] }));
    await new Promise((r) => setTimeout(r, 600));
    expect(shotCalls).toEqual([]);
    ws.close();
  });

  it('while busy, a socket that reports a different page pauses following; a same-page hash reconnect does not (R176)', async () => {
    b = await createBridge({ store: new Store(mkdtempSync(join(tmpdir(), 'cobro-'))), token: 't', screenshot: async (batch) => `/shots/${batch.id}.png` });
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: 't' }));
    ws.send(JSON.stringify({ type: 'page', page, detected: 'none' }));
    ws.send(JSON.stringify({ type: 'draft', batches: [{ id: 'b1', note: '줄여줘', elements: [el], status: 'draft', createdAt: 't' }] }));
    const waiting = b.core.wait(5000);
    ws.send(JSON.stringify({ type: 'send', batchIds: ['b1'], page }));
    await waiting;
    expect(b.core.session.followPaused).toBeFalsy();

    ws.send(JSON.stringify({ type: 'page', page: { ...page, url: 'http://x/#h' }, detected: 'none' })); // hash만 다름
    await new Promise((r) => setTimeout(r, 50));
    expect(b.core.session.followPaused).toBeFalsy();

    ws.send(JSON.stringify({ type: 'page', page: { ...page, url: 'http://x/c' }, detected: 'none' })); // 사용자가 직접 이동
    await new Promise((r) => setTimeout(r, 50));
    expect(b.core.session.followPaused).toBe(true);
    ws.close();
  });
});
