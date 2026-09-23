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
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', screenshot: '/s/b.png', summary: 'leak?', refSeq: 4, elements: [] }],
    });
    expect(p.origin).toBe('human');
    expect(p.sentAt).toBe('2026-09-08T00:00:00.000Z');
    expect(p.batches[0]).toEqual({ id: 'b', note: 'n', elements: [], screenshot: '/s/b.png' });
    expect('summary' in p.batches[0]!).toBe(false);
    expect('refSeq' in p.batches[0]!).toBe(false);
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

  it('keeps page only when present on the batch (R161)', () => {
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [
        { id: 'b1', note: 'n', status: 'sent', createdAt: 't', elements: [], page: { url: 'http://y/', title: 'Y' } },
        { id: 'b2', note: 'n', status: 'sent', createdAt: 't', elements: [] },
      ],
    });
    expect(p.batches[0]).toEqual({ id: 'b1', note: 'n', elements: [], page: { url: 'http://y/', title: 'Y' } });
    expect('page' in p.batches[1]!).toBe(false);
  });

  it('strips react.frame, keeps component/source, and leaves elements without frame untouched', () => {
    const withFrame = { selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, react: { component: 'Cta', source: 'src/react.jsx:4', frame: { url: 'http://x/a.js', line: 1, col: 2 } } };
    const noFrame = { selector: '#b', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, react: { component: 'App' } };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [withFrame, noFrame] }],
    });
    expect(p.batches[0]!.elements[0]!.react).toEqual({ component: 'Cta', source: 'src/react.jsx:4' });
    expect(p.batches[0]!.elements[1]).toEqual(noFrame); // Task 64 M1: stripFrame이 항상 재구성하므로 참조는 더는 보존되지 않는다(값은 동일)
  });

  it('T1: passes ref through untouched on elements and regions, and refSeq is excluded (R127)', () => {
    const child = { selector: '#ba', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, ref: '1a' };
    const plain = { selector: '#c', tag: 'div', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {} };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', refSeq: 5, elements: [child, plain], regions: [{ ref: '1', rect: { x: 0, y: 0, w: 1, h: 1 } }] }],
    });
    expect(p.batches[0]!.elements[0]).toMatchObject({ selector: '#ba', ref: '1a' });
    expect('ref' in p.batches[0]!.elements[1]!).toBe(false);
    expect(p.batches[0]!.regions![0]).toEqual({ ref: '1', rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect('refSeq' in p.batches[0]!).toBe(false);
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

  it('R159 (a): clamps component/source to 200 chars and callers to the first 2, each clamped to 200 chars', () => {
    const el = {
      selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {},
      react: {
        component: 'C'.repeat(300), source: 'S'.repeat(300),
        callers: ['a'.repeat(250), 'b'.repeat(250), 'c'.repeat(250), 'd'.repeat(250)],
      },
    };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [el] }],
    });
    const react = p.batches[0]!.elements[0]!.react!;
    expect(react.component).toBe('C'.repeat(200));
    expect(react.source).toBe('S'.repeat(200));
    expect(react.callers).toEqual(['a'.repeat(200), 'b'.repeat(200)]);
  });

  it('R159 (b): drops a non-string source, keeps only string entries in callers', () => {
    const el = {
      selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {},
      react: { component: 'X', source: 42, callers: ['ok', 7, 'x'] },
    } as unknown as { selector: string; tag: string; classes: string[]; text: string; rect: { x: number; y: number; w: number; h: number }; styles: Record<string, string>; react: unknown };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [el as never] }],
    });
    const react = p.batches[0]!.elements[0]!.react!;
    expect('source' in react).toBe(false);
    expect(react.callers).toEqual(['ok', 'x']);
  });

  it('R159 (c): drops the whole react/vue key when component is not a string', () => {
    const el = {
      selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {},
      react: { component: 7 }, vue: {},
    } as unknown as { selector: string; tag: string; classes: string[]; text: string; rect: { x: number; y: number; w: number; h: number }; styles: Record<string, string>; react: unknown; vue: unknown };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [el as never] }],
    });
    expect('react' in p.batches[0]!.elements[0]!).toBe(false);
    expect('vue' in p.batches[0]!.elements[0]!).toBe(false);
  });

  it('R159 (M1): an empty callers array is omitted, not sent as "callers":[]', () => {
    const el = {
      selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {},
      react: { component: 'X', callers: [] },
    };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [el] }],
    });
    expect('callers' in p.batches[0]!.elements[0]!.react!).toBe(false);
  });

  it('R159 (M1): drops an old-shape callerFrames field and unknown extra keys from a restored session', () => {
    const el = {
      selector: '#a', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {},
      react: { component: 'X', callerFrames: [{ url: 'http://x/a.js', line: 1, col: 2 }], extra: 1 },
    } as unknown as { selector: string; tag: string; classes: string[]; text: string; rect: { x: number; y: number; w: number; h: number }; styles: Record<string, string>; react: unknown };
    const p = buildPayload({
      page, refreshStrategy: 'none', console: [], now: new Date('2026-09-08T00:00:00Z'),
      batches: [{ id: 'b', note: 'n', status: 'sent', createdAt: 't', elements: [el as never] }],
    });
    const react = p.batches[0]!.elements[0]!.react!;
    expect('callerFrames' in react).toBe(false);
    expect('extra' in react).toBe(false);
  });
});
