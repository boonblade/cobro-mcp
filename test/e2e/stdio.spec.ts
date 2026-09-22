import { test, expect } from '@playwright/test';
import { mkdtempSync, existsSync, writeFileSync, rmSync, readFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const inherited = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
);
const parse = (r: unknown) => JSON.parse(((r as { content: Array<{ text: string }> }).content)[0]!.text);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('빌드된 dist/server.js가 stdio로 도구 6개를 제공하고 stdin 종료 시 스스로 내려간다', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'cobro-state-'));
  const profileDir = mkdtempSync(join(tmpdir(), 'cobro-prof-'));
  writeFileSync(join(stateDir, 'config.json'), JSON.stringify({ refreshStrategy: 'event' })); // 갱신 전략 로더
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'dist/server.js')],
    cwd: tmpdir(),
    env: {
      ...inherited,
      COBRO_HEADLESS: '1',
      COBRO_STATE_DIR: stateDir,
      COBRO_PROFILE_DIR: profileDir,
      COBRO_WAIT_SEC: '5',
      COBRO_TICK_MS: '1000',
    },
    stderr: 'pipe',
  });
  const stderrText: string[] = [];
  transport.stderr?.on('data', (c: Buffer) => stderrText.push(c.toString()));
  const client = new Client({ name: 'cobro-stdio-smoke', version: '0' });
  await client.connect(transport);
  expect(client.getServerVersion()?.version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
  expect(client.getInstructions()).toContain('open(url)');
  expect(client.getInstructions()).toContain('done(summary');
  const pid = transport.pid;
  expect(pid).not.toBeNull();

  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['close', 'done', 'open', 'screenshot', 'status', 'wait']);

    const opened = parse(await client.callTool({ name: 'open', arguments: { url: 'http://127.0.0.1:4173/basic.html' } }));
    expect(opened).toMatchObject({ title: 'Basic', strategy: 'event' }); // .cobro/config.json이 이겼다

    const progress: number[] = [];
    const waited = parse(await client.callTool({ name: 'wait', arguments: { timeoutSec: 5 } }, undefined, {
      onprogress: (p) => { progress.push(p.progress); },
    }));
    expect(waited).toEqual({ status: 'pending' });
    expect(progress.length).toBeGreaterThanOrEqual(3); // 5초 대기 · 1초 주기

    const shot = parse(await client.callTool({ name: 'screenshot', arguments: {} }));
    expect(shot.path).toMatch(/\.png$/);
    expect(existsSync(shot.path)).toBe(true);

    expect(parse(await client.callTool({ name: 'close', arguments: {} }))).toEqual({ ok: true });
  } finally {
    await client.close().catch(() => {});
    await expect.poll(() => alive(pid!), { timeout: 5000 }).toBe(false);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(profileDir, { recursive: true, force: true });
  }
  expect(stderrText.join('')).toContain('[cobro] ready');
});

test('stdin이 파일이면(EOF 뒤 close 없음) end로 스스로 내려간다(R156)', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'cobro-state-'));
  const profileDir = mkdtempSync(join(tmpdir(), 'cobro-prof-'));
  const stdinPath = join(stateDir, 'empty-stdin');
  writeFileSync(stdinPath, '');
  const fd = openSync(stdinPath, 'r');
  const child = spawn(process.execPath, [join(process.cwd(), 'dist/server.js')], {
    stdio: [fd, 'pipe', 'pipe'],
    env: {
      ...inherited,
      COBRO_HEADLESS: '1',
      COBRO_STATE_DIR: stateDir,
      COBRO_PROFILE_DIR: profileDir,
      COBRO_WAIT_SEC: '5',
      COBRO_TICK_MS: '1000',
    },
  });
  const pid = child.pid!;
  try {
    await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false);
  } finally {
    closeSync(fd);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(profileDir, { recursive: true, force: true });
  }
});
