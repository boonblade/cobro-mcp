import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from './core/store.js';
import { createBridge } from './bridge.js';
import { isTheme } from './core/settings.js';
import { resolveElementSources } from './core/sourcemap.js';
import { BrowserLauncher, parseEngine } from './browser/launcher.js';
import { createMcpServer } from './mcp/server.js';
import { startParentWatch } from './parent-watch.js';
import { union } from './core/rect.js';
import type { RefreshStrategy } from './core/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const overlaySource = readFileSync(join(here, 'overlay.js'), 'utf8'); // build가 server.js 옆에 둔다
const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string };
const stateDir = process.env.COBRO_STATE_DIR ?? join(process.cwd(), '.cobro');
const settingsFile = join(homedir(), '.cobro', 'settings.json');
const engine = parseEngine(process.env.COBRO_BROWSER);
if (process.env.COBRO_BROWSER && engine !== process.env.COBRO_BROWSER) console.error(`[cobro] COBRO_BROWSER=${process.env.COBRO_BROWSER} 무시 — chromium|webkit|firefox 중 하나. chromium 사용`);
const profileDir = join(process.env.COBRO_PROFILE_DIR ?? join(homedir(), '.cobro', 'profile'), engine);

// 잘못된 값(0·문자열·음수)이 setInterval로 새어 들어가면 1ms 알림 폭주가 된다 — 검사 후 기본값으로 되돌린다
const envInt = (v: string | undefined, min: number, name: string): number | undefined => {
  const n = Number(v);
  if (v !== undefined && Number.isFinite(n) && n >= min) return n;
  if (v !== undefined) console.error(`[cobro] ${name}=${v} 무시 — ${min} 이상의 수만 받는다. 기본값을 쓴다`);
  return undefined;
};
const defaultWaitSec = envInt(process.env.COBRO_WAIT_SEC, 5, 'COBRO_WAIT_SEC') ?? 1800;
const tickMs = envInt(process.env.COBRO_TICK_MS, 1000, 'COBRO_TICK_MS');
const envThemeRaw = process.env.COBRO_THEME;
const envTheme = isTheme(envThemeRaw) ? envThemeRaw : undefined;
if (envThemeRaw && !envTheme) console.error(`[cobro] COBRO_THEME=${envThemeRaw} 무시 — auto|dark|light|frost 중 하나`);
const token = randomBytes(24).toString('hex');
const store = new Store(stateDir);

// .cobro/config.json의 refreshStrategy(스펙 §9). open의 strategy 인자가 나중에 덮어쓴다
const configStrategy = (): RefreshStrategy | undefined => {
  const file = join(stateDir, 'config.json');
  if (!existsSync(file)) return undefined;
  try {
    const v: unknown = (JSON.parse(readFileSync(file, 'utf8')) as { refreshStrategy?: unknown }).refreshStrategy;
    if (v === 'none' || v === 'reload' || v === 'event') return v;
    if (v !== undefined) console.error(`[cobro] ${file}의 refreshStrategy 무시 — none|reload|event만 받는다`);
  } catch (e) { console.error(`[cobro] ${file}을 읽지 못해 무시한다: ${(e as Error).message}`); }
  return undefined;
};

let launcher: BrowserLauncher | null = null;
// 모듈 텍스트·소스맵 JSON 문자열을 URL별로 세션 동안 캐시한다(R112) — 같은 페이지 안에서 여러 요소가 같은 모듈을 가리킬 수 있다
// 성공(문자열)만 캐시한다 — 실패를 캐시하면 일시적 오류가 세션 내내 고정된다(M1)
const fetchCache = new Map<string, string>();
const cachedFetchText = async (url: string): Promise<string | undefined> => {
  const cached = fetchCache.get(url);
  if (cached !== undefined) return cached;
  const text = await launcher?.fetchText(url);
  if (text !== undefined) fetchCache.set(url, text);
  return text;
};
const bridge = await createBridge({
  store, token, settingsFile, envTheme,
  screenshot: async (b) => launcher?.isAlive() ? launcher.screenshot({ rect: union([...b.elements.filter((e) => !e.missing).map((e) => e.rect), ...(b.regions ?? []).map((r) => r.rect)]), outPath: store.shotPath(b.id) }) : undefined,
  consoleEntries: () => launcher?.consoleEntries() ?? [],
  resolveSource: (b, page) => resolveElementSources(b, page, cachedFetchText, { root: process.cwd() }),
});
const fixed = configStrategy();
if (fixed) bridge.core.setStrategy(fixed);
launcher = new BrowserLauncher({ overlaySource, port: bridge.port, token, root: process.cwd(), profileDir, headless: process.env.COBRO_HEADLESS === '1', engine });

const mcp = createMcpServer({
  core: bridge.core, browser: launcher, done: (info) => bridge.done(info), manualShotPath: (n) => store.manualShotPath(n), defaultWaitSec, tickMs, version,
  onClose: async () => { /* 브라우저만 닫는다. 프로세스는 호스트가 관리 */ },
});
await mcp.connect(new StdioServerTransport());
console.error(`[cobro] ready · state=${stateDir} · ws=127.0.0.1:${bridge.port}`);
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  // 브라우저·채널이 안 닫혀도 호스트를 기다리게 두지 않는다
  await Promise.race([Promise.all([launcher?.close(), bridge.close()]), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown); // 호스트가 stdio를 닫으면 브라우저도 거둔다
process.stdin.on('end', shutdown); // stdin이 파일이면 close 없이 end만 온다(부채 #4) — shutdown은 closing 가드로 한 번만 돈다
const ppid = process.ppid; // 루트 컨테이너 재부모화 대비 — ppid가 바뀌면(예: 1로) 더 이상 원래 부모가 아니다(M3)
startParentWatch({ isParentAlive: () => { if (process.ppid !== ppid) return false; try { process.kill(ppid, 0); return true; } catch { return false; } }, onDead: shutdown, intervalMs: 5000 });
