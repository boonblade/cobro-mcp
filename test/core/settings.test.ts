import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUserSettings, writeUserSettings } from '../../src/core/settings.js';

describe('readUserSettings / writeUserSettings', () => {
  it('없는 파일은 {}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    expect(readUserSettings(join(dir, 'settings.json'))).toEqual({});
  });

  it('깨진 JSON은 {} + stderr 1줄', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{oops');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(readUserSettings(file)).toEqual({});
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('writeUserSettings는 파일에 쓰고 결과를 반환한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const file = join(dir, 'settings.json');
    const out = writeUserSettings(file, { theme: 'frost' });
    expect(out).toEqual({ theme: 'frost' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'frost' });
  });

  it('두 번째 write가 덮어쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const file = join(dir, 'settings.json');
    writeUserSettings(file, { theme: 'frost' });
    const out = writeUserSettings(file, { theme: 'light' });
    expect(out).toEqual({ theme: 'light' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'light' });
  });

  it('파일에 유효하지 않은 theme 값이 있으면 read가 무시한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cobro-'));
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'neon' }));
    expect(readUserSettings(file)).toEqual({});
  });
});
