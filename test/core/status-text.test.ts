import { describe, it, expect } from 'vitest';
import { stripStatusLabel } from '../../src/overlay/status-text.js';

describe('stripStatusLabel', () => {
  it('strips a matching label prefix followed by a colon', () => {
    expect(stripStatusLabel('수정 중: a.ts', ['수정 중', 'Editing'])).toBe('a.ts');
    expect(stripStatusLabel('Editing: a.ts', ['수정 중', 'Editing'])).toBe('a.ts');
  });
  it('ignores case and surrounding whitespace around the colon', () => {
    expect(stripStatusLabel('editing:a.ts', ['수정 중', 'Editing'])).toBe('a.ts');
  });
  it('returns the trimmed original when there is no colon after the label', () => {
    expect(stripStatusLabel('수정 중 a.ts', ['수정 중', 'Editing'])).toBe('수정 중 a.ts');
  });
  it('strips only once, not repeatedly', () => {
    expect(stripStatusLabel('수정 중: 수정 중: a.ts', ['수정 중', 'Editing'])).toBe('수정 중: a.ts');
  });
  it('trims plain text with no label match', () => {
    expect(stripStatusLabel('  b ', ['수정 중', 'Editing'])).toBe('b');
  });
});
