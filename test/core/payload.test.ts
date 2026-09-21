import { describe, it, expect } from 'vitest';
import { buildPayload, dedupeConsole } from '../../src/core/payload.js';

const page = { url: 'http://x/', title: 'X', viewport: { w: 1, h: 1 } };

describe('dedupeConsole', () => {
  it('merges identical texts, counts them, keeps latest 10 by last time', () => {
    const raw = Array.from({ length: 14 }, (_, i) => ({ level: 'error' as const, text: 'e' + (i % 12), at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }));
    const out = dedupeConsole(raw);
    expect(out).toHaveLength(10);
    expect(out.find((e) => e.text === 'e0')).toMatchObject({ count: 2, last: '2026-01-01T00:00:12Z' });
    expect(out[0]!.last >= out[1]!.last).toBe(true);
  });
  it('truncates long text to 300 chars', () => {
    const out = dedupeConsole([{ level: 'error', text: 'x'.repeat(500), at: 't' }]);
    expect(out[0]!.text).toHaveLength(300);
  });
});

describe('buildPayload', () => {
  it('forces origin human, strips non-payload batch fields, keeps screenshot path', () => {
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', screenshot: '/s/b.png', summary: 'leak?', elements: [] }],
    });
    expect(p.origin).toBe('human');
    expect(p.sentAt).toBe('2026-09-08T00:00:00.000Z');
    expect(p.batches[0]).toEqual({ id: 'b', note: 'n', elements: [], screenshot: '/s/b.png' });
    expect('summary' in p.batches[0]!).toBe(false);
  });

  it('keeps regions only when present', () => {
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [
        { id: 'b1', note: 'n', status: 'sent', createdAt: 't', elements: [], regions: [{ rect: { x: 1, y: 2, w: 3, h: 4 }, within: '#g' }] },
        { id: 'b2', note: 'n', status: 'sent', createdAt: 't', elements: [], regions: [] },
        { id: 'b3', note: 'n', status: 'sent', createdAt: 't', elements: [] },
      ],
    });
    expect(p.batches[0]).toEqual({ id: 'b1', note: 'n', elements: [], regions: [{ rect: { x: 1, y: 2, w: 3, h: 4 }, within: '#g' }] });
    expect('regions' in p.batches[1]!).toBe(false);
    expect('regions' in p.batches[2]!).toBe(false);
  });

  it('strips react.frame, keeps component/source, and leaves elements without frame untouched', () => {
    const withFrame = { selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, react: { component: 'Cta', source: 'src/react.jsx:4', frame: { url: 'http://x/a.js', line: 1, col: 2 } } };
    const noFrame = { selector: '#b', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, react: { component: 'App' } };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [withFrame, noFrame] }],
    });
    expect(p.batches[0]!.elements[0]!.react).toEqual({ component: 'Cta', source: 'src/react.jsx:4' });
    expect(p.batches[0]!.elements[1]).toBe(noFrame);
  });

  it('T1: passes ref/parent through untouched, and omits the keys when absent (R123)', () => {
    const withGroup = { selector: '#a', tag: 'section', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, ref: '1' };
    const child = { selector: '#ba', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, ref: '1a', parent: '#a' };
    const plain = { selector: '#c', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {} };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [withGroup, child, plain] }],
    });
    expect(p.batches[0]!.elements[0]).toMatchObject({ selector: '#a', ref: '1' });
    expect(p.batches[0]!.elements[1]).toMatchObject({ selector: '#ba', ref: '1a', parent: '#a' });
    expect('ref' in p.batches[0]!.elements[2]!).toBe(false);
    expect('parent' in p.batches[0]!.elements[2]!).toBe(false);
    expect('parent' in p.batches[0]!.elements[0]!).toBe(false);
  });

  it('strips vue.frame too (same contract as react)', () => {
    const withFrame = { selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, vue: { component: 'Cta', source: 'src/Cta.vue', frame: { url: 'http://x/a.js', line: 1, col: 2 } } };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [withFrame] }],
    });
    expect(p.batches[0]!.elements[0]!.vue).toEqual({ component: 'Cta', source: 'src/Cta.vue' });
    expect(JSON.stringify(p)).not.toContain('"frame"');
  });
});
