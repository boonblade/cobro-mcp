import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, emptySession } from '../../src/core/store.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cobro-')); });

describe('Store', () => {
  it('load returns null when nothing saved', () => {
    expect(new Store(dir).load()).toBeNull();
  });
  it('save then load round-trips and leaves no temp file', () => {
    const s = new Store(dir);
    const session = emptySession();
    session.agent.text = 'hi';
    s.save(session);
    expect(s.load()).toEqual(session);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });
  it('load returns null on corrupt json', () => {
    const s = new Store(dir);
    writeFileSync(join(dir, 'session.json'), '{oops');
    expect(s.load()).toBeNull();
  });
  it('pruneShots keeps listed ids and newest up to max', () => {
    const s = new Store(dir);
    const baseTime = Date.now();
    const ids = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 4; i++) {
      const id = ids[i]!;
      writeFileSync(s.shotPath(id), 'x');
      // Set distinct mtimes: oldest → d newest (base time + 1000ms per file)
      const mtime = new Date(baseTime + i * 1000);
      utimesSync(s.shotPath(id), mtime, mtime);
    }
    // keep 대상은 예산(max)에 산입하지 않는다 → d(무조건) + 나머지 중 최신 2개(c, b) = 3개
    s.pruneShots(['d'], 2);
    const left = readdirSync(join(dir, 'shots')).filter((f) => f.endsWith('.png')).sort();
    expect(left).toEqual(['b.png', 'c.png', 'd.png']);
    expect(existsSync(s.shotPath('a'))).toBe(false);
  });
  it('manualShotPath lives under shots/manual/ and survives pruning', () => {
    const s = new Store(dir);
    const manual = s.manualShotPath('manual-123');
    expect(manual).toBe(join(dir, 'shots', 'manual', 'manual-123.png'));
    writeFileSync(manual, 'x');
    for (const id of ['a', 'b', 'c']) writeFileSync(s.shotPath(id), 'x');
    s.pruneShots([], 1);
    expect(existsSync(manual)).toBe(true); // 하위 폴더는 prune 대상이 아니다
    expect(readdirSync(join(dir, 'shots')).filter((f) => f.endsWith('.png'))).toHaveLength(1);
  });
  it('clearShots keeps only listed ids and removes manual/ entirely', () => {
    const s = new Store(dir);
    for (const id of ['a', 'b', 'c']) writeFileSync(s.shotPath(id), 'x');
    writeFileSync(s.manualShotPath('m'), 'x');
    s.clearShots(['a']);
    expect(readdirSync(join(dir, 'shots')).filter((f) => f.endsWith('.png'))).toEqual(['a.png']);
    expect(existsSync(join(dir, 'shots', 'manual'))).toBe(false);
  });
  it('manualShotPath caps manual/ at 50, deleting the oldest', () => {
    const s = new Store(dir);
    const baseTime = Date.now();
    for (let i = 0; i < 51; i++) {
      const p = s.manualShotPath('m' + i);
      writeFileSync(p, 'x');
      const mtime = new Date(baseTime + i * 1000);
      utimesSync(p, mtime, mtime);
    }
    const left = readdirSync(join(dir, 'shots', 'manual')).filter((f) => f.endsWith('.png'));
    expect(left).toHaveLength(50);
    expect(left).not.toContain('m0.png');
  });
});
