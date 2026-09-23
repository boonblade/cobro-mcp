import { describe, it, expect } from 'vitest';
import { currentDraft, roundOf, pageLabel, cartItems } from '../../../src/overlay/cart.js';
import type { Batch } from '../../../src/core/types.js';

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

describe('pageLabel', () => {
  it('same origin with a title: "title · /path?search"', () => {
    expect(pageLabel({ url: 'http://x/path?x=1', title: 'My Page' }, 'http://x/here')).toBe('My Page · /path?x=1');
  });
  it('same origin without a title: just the path, not duplicated', () => {
    expect(pageLabel({ url: 'http://x/path', title: '' }, 'http://x/here')).toBe('/path');
  });
  it('different origin includes the host', () => {
    expect(pageLabel({ url: 'http://other.example/path', title: 'Ext' }, 'http://x/here')).toBe('Ext · other.example/path');
  });
});

describe('cartItems', () => {
  it('lists other-page drafts first (in drafts order), then progress batches (sentAt order); current-page drafts are excluded', () => {
    const drafts = [
      b('cur', { page: { url: 'http://x/here', title: 'Here' }, note: 'current note' }),
      b('o1', { page: { url: 'http://x/one', title: 'One' }, note: 'note one' }),
      b('o2', { page: { url: 'http://x/two', title: 'Two' }, note: 'note two' }),
    ];
    const batches = [
      b('s2', { status: 'sent', sentAt: '2026-01-01T00:00:20.000Z', page: { url: 'http://x/here', title: 'Here' } }),
      b('s1', { status: 'sent', sentAt: '2026-01-01T00:00:10.000Z', page: { url: 'http://x/one', title: 'One' } }),
    ];
    const items = cartItems(drafts, batches, 'http://x/here');
    expect(items.map((i) => i.kind)).toEqual(['other', 'other', 'sent', 'sent']);
    expect(items[0]?.page).toBe('One · /one');
    expect(items[1]?.page).toBe('Two · /two');
    expect(items[2]?.page).toBe('One · /one'); // s1, 더 이른 sentAt
    expect(items[3]?.page).toBe('Here · /here'); // s2
  });
});
