import { describe, it, expect } from 'vitest';
import { currentDraft, roundOf, queueCards, lastRoundDone, pageLoc, pendingElsewhere } from '../../../src/overlay/cart.js';
import type { Batch, Session } from '../../../src/core/types.js';

const el = { selector: '#a', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, styles: {} };
const b = (id: string, patch: Partial<Batch> = {}): Batch => ({
  id, note: 'n' + id, elements: [el], status: 'draft', createdAt: 't', ...patch,
});

describe('currentDraft', () => {
  it('finds the draft whose page matches href (hash ignored)', () => {
    const drafts = [
      b('1', { page: { url: 'http://x/other', title: 'Other' } }),
      b('2', { page: { url: 'http://x/here#foo', title: 'Here' } }),
    ];
    expect(currentDraft(drafts, 'http://x/here#bar')?.id).toBe('2');
  });
  it('treats a draft with no page as the current page (old draft)', () => {
    const drafts = [b('1', { page: { url: 'http://x/other', title: 'Other' } }), b('2')];
    expect(currentDraft(drafts, 'http://x/here')?.id).toBe('2');
  });
  it('returns null when nothing matches', () => {
    const drafts = [b('1', { page: { url: 'http://x/other', title: 'Other' } })];
    expect(currentDraft(drafts, 'http://x/here')).toBeNull();
  });
});

describe('roundOf', () => {
  it('counts sent+working as queue, in-round done as done, excludes an older done from before the round', () => {
    const batches = [
      b('s1', { status: 'sent', sentAt: '2026-01-01T00:00:10.000Z' }),
      b('s2', { status: 'sent', sentAt: '2026-01-01T00:00:20.000Z' }),
      b('w1', { status: 'working', sentAt: '2026-01-01T00:00:05.000Z' }),
      b('d1', { status: 'done', sentAt: '2026-01-01T00:00:00.000Z', doneAt: '2026-01-01T00:00:30.000Z' }), // 라운드 안
      b('old', { status: 'done', sentAt: '2025-12-31T00:00:00.000Z', doneAt: '2025-12-31T00:00:01.000Z' }), // 라운드 전
    ];
    expect(roundOf(batches)).toEqual({ queue: 3, done: 1, total: 4 });
  });
  it('returns all zero when there is no active (sent/working) batch, even with leftover done batches', () => {
    const batches = [b('old', { status: 'done', sentAt: 't1', doneAt: 't2' })];
    expect(roundOf(batches)).toEqual({ queue: 0, done: 0, total: 0 });
  });
  it('an active batch with no sentAt treats the round minimum as Infinity, so an old done never joins it (M4)', () => {
    const batches = [
      b('s1', { status: 'sent', sentAt: undefined }),
      b('old', { status: 'done', sentAt: '2025-01-01T00:00:00.000Z', doneAt: '2025-01-01T00:00:01.000Z' }),
    ];
    expect(roundOf(batches)).toEqual({ queue: 1, done: 0, total: 1 });
  });
});

describe('pageLoc', () => {
  it('same origin: pathname + search only', () => {
    expect(pageLoc('http://x/path?x=1', 'http://x/here')).toBe('/path?x=1');
  });
  it('different origin: host + pathname + search', () => {
    expect(pageLoc('http://other.example/path', 'http://x/here')).toBe('other.example/path');
  });
});

describe('pendingElsewhere', () => {
  const session = (patch: Partial<Session> = {}): Session => ({
    version: 1, page: null, batches: [], agent: { status: 'idle', text: '' }, strategy: null, detected: null, ...patch,
  });
  it('returns the first other-page pendingDone entry as {url, path}', () => {
    const s = session({ pendingDone: [{ url: 'http://x/region.html', batchIds: ['b'], info: { summary: 'ok', selectors: [], changedFiles: [] } }] });
    expect(pendingElsewhere(s, 'http://x/here')).toEqual({ url: 'http://x/region.html', path: '/region.html' });
  });
  it('returns null when the only entry is the current page (hash only differs)', () => {
    const s = session({ pendingDone: [{ url: 'http://x/here#foo', batchIds: ['b'], info: { summary: 'ok', selectors: [], changedFiles: [] } }] });
    expect(pendingElsewhere(s, 'http://x/here#bar')).toBeNull();
  });
  it('returns null when there is no entry, or the session is null', () => {
    expect(pendingElsewhere(session(), 'http://x/here')).toBeNull();
    expect(pendingElsewhere(null, 'http://x/here')).toBeNull();
  });
  it('returns null instead of throwing when the entry url is malformed (M2)', () => {
    const s = session({ pendingDone: [{ url: 'not a url', batchIds: ['b'], info: { summary: 'ok', selectors: [], changedFiles: [] } }] });
    expect(() => pendingElsewhere(s, 'http://x/here')).not.toThrow();
    expect(pendingElsewhere(s, 'http://x/here')).toBeNull();
  });
});

describe('queueCards', () => {
  const labels = { noNote: 'No note', count: (n: number) => `${n}x` };
  it('orders drafts (insertion order, current page included) before progress batches (sentAt order)', () => {
    const drafts = [
      b('cur', { page: { url: 'http://x/here', title: 'Here' }, note: 'current note' }),
      b('o1', { page: { url: 'http://x/one', title: 'One' }, note: 'note one' }),
    ];
    const batches = [
      b('s2', { status: 'sent', sentAt: '2026-01-01T00:00:20.000Z', page: { url: 'http://x/here', title: 'Here' } }),
      b('s1', { status: 'sent', sentAt: '2026-01-01T00:00:10.000Z', page: { url: 'http://x/one', title: 'One' } }),
    ];
    const cards = queueCards(drafts, batches, 'http://x/here', true, labels);
    expect(cards.map((c) => c.kind)).toEqual(['draft', 'draft', 'sent', 'sent']);
    expect(cards[0]?.isCurrent).toBe(true); // cur
    expect(cards[1]?.isCurrent).toBe(false);
    expect(cards[2]?.url).toContain('/one'); // s1 — 더 이른 sentAt
    expect(cards[3]?.url).toContain('/here'); // s2
  });
  it('excludes done batches when not busy; includes round-scoped done cards when busy', () => {
    const doneOnly = [b('d1', { status: 'done', sentAt: '2026-01-01T00:00:00.000Z', doneAt: '2026-01-01T00:00:05.000Z', page: { url: 'http://x/here', title: 'Here' } })];
    expect(queueCards([], doneOnly, 'http://x/here', false, labels)).toEqual([]);
    const active = [
      b('s1', { status: 'sent', sentAt: '2026-01-01T00:00:00.000Z', page: { url: 'http://x/here', title: 'Here' } }),
      b('d2', { status: 'done', sentAt: '2026-01-01T00:00:00.000Z', doneAt: '2026-01-01T00:00:03.000Z', page: { url: 'http://x/here', title: 'Here' } }),
    ];
    const cards = queueCards([], active, 'http://x/here', true, labels);
    expect(cards.map((c) => c.kind).sort()).toEqual(['done', 'sent']);
  });
  it('meta is "count · note" for draft/active cards and "✓ summary" for done; no note falls back to labels.noNote', () => {
    const drafts = [b('a', { page: { url: 'http://x/here', title: 'Here' }, note: '' })];
    const [card] = queueCards(drafts, [], 'http://x/here', false, labels);
    expect(card?.meta).toBe('1x · No note');
    const t1 = '2026-01-01T00:00:00.000Z'; const t2 = '2026-01-01T00:00:01.000Z';
    const done = [b('d', { status: 'done', sentAt: t1, doneAt: t2, summary: '완료 요약', page: { url: 'http://x/here', title: 'Here' } })];
    const active = [b('s', { status: 'sent', sentAt: t1, page: { url: 'http://x/here', title: 'Here' } }), ...done];
    const [, doneCard] = queueCards([], active, 'http://x/here', true, labels);
    expect(doneCard?.meta).toBe('✓ 완료 요약');
  });
});

describe('lastRoundDone', () => {
  it('returns every done batch, regardless of round scoping', () => {
    const batches = [b('d1', { status: 'done' }), b('s1', { status: 'sent' }), b('d2', { status: 'done' })];
    expect(lastRoundDone(batches).map((x) => x.id)).toEqual(['d1', 'd2']);
  });
});
