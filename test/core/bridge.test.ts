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
});
