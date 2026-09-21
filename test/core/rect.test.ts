import { describe, it, expect } from 'vitest';
import { union } from '../../src/core/rect.js';

describe('union', () => {
  it('returns undefined for an empty array', () => {
    expect(union([])).toBeUndefined();
  });

  it('returns the rect unchanged for a single rect', () => {
    expect(union([{ x: 10, y: 20, w: 30, h: 40 }])).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('returns the union of two overlapping rects', () => {
    const rects = [{ x: 0, y: 0, w: 50, h: 50 }, { x: 25, y: 25, w: 50, h: 50 }];
    expect(union(rects)).toEqual({ x: 0, y: 0, w: 75, h: 75 });
  });

  it('returns the smallest rect enclosing two disjoint rects', () => {
    const rects = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 200, w: 10, h: 10 }];
    expect(union(rects)).toEqual({ x: 0, y: 0, w: 110, h: 210 });
  });
});
