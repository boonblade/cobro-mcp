import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/core/store.js';
import { SessionCore } from '../../src/core/session.js';
import { createMcpServer } from '../../src/mcp/server.js';
import type { Rect } from '../../src/core/types.js';

const HANGUL = /[가-힣]/;
const page = { url: 'http://x/', title: 'X', viewport: { w: 1, h: 1 } };
type Shot = { rect?: Rect; selector?: string; outPath: string };
let core: SessionCore; let client: Client; let calls: string[]; let closeAll: () => Promise<void>;
let state: { alive: boolean; launched: boolean }; let shots: Shot[];

beforeEach(async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'cobro-')));
  core = new SessionCore(store); calls = []; shots = [];
  state = { alive: false, launched: false };
  let openCount = 0;
  const browser = {
    open: async (u: string) => { calls.push('open:' + u); openCount++; state.alive = true; state.launched = true; return { title: 'T', restarted: openCount > 1 }; },
    screenshot: async (o: Shot) => { calls.push('shot'); shots.push(o); return o.outPath; },
    close: async () => { calls.push('close'); state.alive = false; },
    isAlive: () => state.alive,
    wasLaunched: () => state.launched,
  };
  const server = createMcpServer({ core, browser, manualShotPath: (n) => `/s/manual/${n}.png`, done: (info) => core.done(info), defaultWaitSec: 1, version: 'test-1.2.3' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 't', version: '0' });
  await server.connect(st); await client.connect(ct);
  closeAll = async () => { await client.close(); await server.close(); };
});
afterEach(() => closeAll());

describe('mcp server version', () => {
  it('deps로 넘긴 version이 서버 정보에 나온다', () => {
    expect(client.getServerVersion()?.version).toBe('test-1.2.3');
  });

  it('instructions에 운용 규약이 실린다', () => {
    expect(client.getInstructions()).toContain('open(url)');
    expect(client.getInstructions()).toContain('done(summary');
    expect(client.getInstructions()).not.toMatch(HANGUL);
  });
});
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
};

describe('mcp tools', () => {
  it('exposes exactly six tools', async () => {
    const t = (await client.listTools()).tools.map((x) => x.name).sort();
    expect(t).toEqual(['close', 'done', 'open', 'screenshot', 'status', 'wait']);
  });
  it('declares safety annotations for every tool', async () => {
    const tools = (await client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName).toEqual({
      open: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      wait: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      status: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      done: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      screenshot: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      close: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    });
  });
  it('tool descriptions are English', async () => {
    const tools = (await client.listTools()).tools;
    for (const t of tools) {
      expect(t.description).not.toMatch(HANGUL);
      expect(JSON.stringify(t.inputSchema)).not.toMatch(HANGUL);
    }
  });
  it('open returns title, strategy and restored batches; strategy arg fixes it', async () => {
    expect(await call('open', { url: 'http://a/', strategy: 'event' })).toEqual({ title: 'T', strategy: 'event', restoredBatches: 0, restarted: false });
    expect(core.session.strategy).toBe('event');
    expect(calls).toEqual(['open:http://a/']);
  });
  it('wait returns pending on timeout and sent when delivered; rejects timeoutSec below 5', async () => {
    expect(await call('wait', { timeoutSec: 5 })).toEqual({ status: 'pending' });
    setTimeout(() => core.deliver({ origin: 'human', sentAt: 't', page, batches: [], console: [], refreshStrategy: 'none' }), 50);
    expect(await call('wait', { timeoutSec: 5 })).toMatchObject({ status: 'sent', payload: { origin: 'human' } });
    // 설치된 SDK(v1.30.0)는 zod 검증 실패를 reject가 아니라 isError:true 응답으로 돌려준다.
    const bad = await client.callTool({ name: 'wait', arguments: { timeoutSec: 1 } });
    expect(bad.isError).toBe(true);
  }, 15_000);
  it('wait attaches browserRestarted once right after a restart, then clears it', async () => {
    await call('open', { url: 'http://a/' });
    const second = await call('open', { url: 'http://a/' });
    expect(second.restarted).toBe(true);
    setTimeout(() => core.deliver({ origin: 'human', sentAt: 't', page, batches: [], console: [], refreshStrategy: 'none' }), 50);
    expect(await call('wait', { timeoutSec: 5 })).toMatchObject({ status: 'sent', browserRestarted: true });
    setTimeout(() => core.deliver({ origin: 'human', sentAt: 't', page, batches: [], console: [], refreshStrategy: 'none' }), 50);
    const r2 = await call('wait', { timeoutSec: 5 });
    expect(r2.status).toBe('sent');
    expect(r2.browserRestarted).toBeUndefined();
  }, 15_000);
  it('wait/status/done report browserGone when the user closed the browser', async () => {
    await call('open', { url: 'http://a/' });
    core.setDrafts([{ id: 'b', note: 'n', elements: [], status: 'draft', createdAt: 't' }]);
    core.markSent(['b'], page);
    state.alive = false; // 사용자가 창을 닫았다
    const t0 = Date.now();
    expect(await call('wait', { timeoutSec: 5 })).toEqual({ status: 'pending', browserGone: true });
    expect(Date.now() - t0).toBeLessThan(1500); // 기다리지 않고 즉시 돌아온다
    expect(await call('status', { text: '수정 중' })).toEqual({ ok: true, browserGone: true });
    expect(core.session.agent).toEqual({ status: 'working', text: '수정 중' }); // 상태는 그래도 갱신한다
    expect(await call('done', { summary: '완료' })).toEqual({ ok: true, doneBatches: 1, browserGone: true });
    expect(core.session.batches[0]!.status).toBe('done');
  }, 15_000);
  it('status sets working text; done marks sent batches and returns count', async () => {
    core.setDrafts([{ id: 'b', note: 'n', elements: [], status: 'draft', createdAt: 't' }]);
    core.markSent(['b'], page);
    expect(await call('status', { text: '수정 중' })).toEqual({ ok: true });
    expect(core.session.agent).toEqual({ status: 'working', text: '수정 중' });
    expect(await call('done', { summary: '완료', selectors: ['#a'] })).toEqual({ ok: true, doneBatches: 1 });
    expect(core.session.batches[0]!.status).toBe('done');
  });
  it('screenshot returns path and passes selector through; close closes browser', async () => {
    const r = await call('screenshot');
    expect(r.path).toMatch(/^\/s\/manual\/manual-\d+\.png$/); // 배치 샷과 분리된 폴더

    expect(shots.at(-1)!.selector).toBeUndefined();
    const r2 = await call('screenshot', { selector: '#target' });
    expect(r2.path).toMatch(/\.png$/);
    expect(shots.at(-1)!.selector).toBe('#target');
    expect(await call('close')).toEqual({ ok: true });
    expect(calls).toContain('close');
  });
  it('open drops empty-note drafts only when it relaunches the browser, not on a live navigation (R125)', async () => {
    // note가 비어도 elements가 있으면 R129(setDrafts)는 저장한다 — 여기서 지워지는 건 R125(dropEmptyDrafts, 브라우저 재시작)의 몫
    const el = { selector: '#e', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {} };
    core.setDrafts([
      { id: 'e', note: '', elements: [el], status: 'draft', createdAt: 't' },
      { id: 'k', note: 'keep', elements: [], status: 'draft', createdAt: 't' },
    ]);
    // 브라우저 닫힘 상태(기존 82행 테스트와 같은 방법) — 첫 open은 새로 띄워야 한다
    expect(state.alive).toBe(false);
    const r1 = await call('open', { url: 'http://a/' });
    expect(r1.restoredBatches).toBe(1);
    expect(core.session.batches.map((b) => b.id)).toEqual(['k']);

    core.setDrafts([
      { id: 'k', note: 'keep', elements: [], status: 'draft', createdAt: 't' },
      { id: 'e2', note: '', elements: [el], status: 'draft', createdAt: 't' },
    ]);
    // 브라우저가 이미 떠 있다 → URL만 바꾸는 open은 초안을 건드리지 않는다(Task 48)
    const r2 = await call('open', { url: 'http://b/' });
    expect(r2.restoredBatches).toBe(2);
    expect(core.session.batches.map((b) => b.id)).toEqual(['k', 'e2']);
  });
  it('close resolves a pending wait immediately as browserGone (R77)', async () => {
    const waitP = call('wait', { timeoutSec: 10 });
    await new Promise((r) => setTimeout(r, 50)); // wait 도구가 core.wait를 건 뒤 close
    expect(await call('close')).toEqual({ ok: true });
    await expect(waitP).resolves.toEqual({ status: 'pending', browserGone: true });
  });
});
