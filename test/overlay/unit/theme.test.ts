import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../../../src/overlay/theme.js';

describe('resolveTheme', () => {
  it('auto + prefersDark → dark', () => {
    expect(resolveTheme('auto', { prefersDark: true, backdropOk: true, reduceTransparency: false })).toBe('dark');
  });
  it('auto + light → light', () => {
    expect(resolveTheme('auto', { prefersDark: false, backdropOk: true, reduceTransparency: false })).toBe('light');
  });
  it('dark → dark', () => {
    expect(resolveTheme('dark', { prefersDark: false, backdropOk: true, reduceTransparency: false })).toBe('dark');
  });
  it('frost + 지원 → frost', () => {
    expect(resolveTheme('frost', { prefersDark: false, backdropOk: true, reduceTransparency: false })).toBe('frost');
  });
  it('frost + backdropOk:false → dark', () => {
    expect(resolveTheme('frost', { prefersDark: false, backdropOk: false, reduceTransparency: false })).toBe('dark');
  });
  it('frost + reduceTransparency → dark', () => {
    expect(resolveTheme('frost', { prefersDark: false, backdropOk: true, reduceTransparency: true })).toBe('dark');
  });
});
