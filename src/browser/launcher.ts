import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit, firefox, type APIRequestContext, type BrowserContext, type Page } from 'playwright-core';
import { dedupeConsole } from '../core/payload.js';
import type { ConsoleEntry, Rect } from '../core/types.js';

const INSTALL_HINT = 'Chrome or Edge not found. Install Chrome, or set COBRO_BROWSER_CHANNEL (chrome|msedge|chromium). Bundled Chromium: npx playwright-core install chromium\nWebKit/Firefox engines: npx playwright-core install webkit firefox';

/** 소스맵 해석용 fetch 가드 — 8MB 상한·5초 타임아웃, 실패는 undefined(launcher·e2e helpers 공유, M4) */
export async function fetchTextGuarded(request: APIRequestContext, url: string, maxBytes = 8 * 1024 * 1024, timeout = 5000): Promise<string | undefined> {
  try {
    const res = await request.get(url, { timeout });
    if (!res.ok()) return undefined;
    const body = await res.body();
    if (body.length > maxBytes) return undefined;
    return body.toString('utf8');
  } catch { return undefined; }
}

/** 모든 채널 시도가 "has been closed"로 실패하고 잠금 파일이 있으면 다른 프로세스가 프로필을 쓰고 있는 것 */
export function classifyLaunchFailure(tried: string[], lockExists: boolean): 'profile-locked' | 'not-found' {
  return tried.every((t) => t.includes('has been closed')) && lockExists ? 'profile-locked' : 'not-found';
}

export type Engine = 'chromium' | 'webkit' | 'firefox';
export function parseEngine(v: string | undefined): Engine {
  return v === 'webkit' || v === 'firefox' || v === 'chromium' ? v : 'chromium';
}

export function channelOrder(explicit: string | undefined, env: string | undefined): Array<string | undefined> {
  const named = [...new Set([explicit, env, 'chrome', 'msedge'].filter((c): c is string => !!c))];
  return [...named, undefined];
}

/** chromium 실행 옵션. 샌드박스는 켜는 것이 기본이고, 못 뜨는 환경에서만 호출자가 sandbox=false로 한 번 더 부른다 */
export function chromiumLaunchOptions(o: { headless: boolean; channel: string | undefined; sandbox: boolean }) {
  return {
    headless: o.headless,
    channel: o.channel === 'chromium' ? undefined : o.channel,
    bypassCSP: true,
    viewport: null,
    args: ['--disable-infobars'],
    ignoreDefaultArgs: ['--enable-automation'],
    chromiumSandbox: o.sandbox,
  };
}

export class BrowserLauncher {
  private ctx: BrowserContext | null = null;
  page: Page | null = null;
  private launchedOnce = false;
  private raw: Array<{ level: ConsoleEntry['level']; text: string; at: string }> = [];
  constructor(private readonly opts: { overlaySource: string; port: number; token: string; root: string; profileDir: string; headless?: boolean; channel?: string; engine?: Engine }) {}

  isAlive(): boolean { return !!this.ctx && !!this.page && !this.page.isClosed(); }
  wasLaunched(): boolean { return this.launchedOnce; }

  private injected(): string {
    // 치환값을 함수로 넘긴다 — 문자열 2번째 인자면 $&·$$ 등이 replace 패턴으로 해석된다(Task 64 M4, root는 사용자 경로라 위험 문자를 담을 수 있다)
    return this.opts.overlaySource
      .replace(/__COBRO_PORT__/g, () => String(this.opts.port))
      .replace(/__COBRO_TOKEN__/g, () => JSON.stringify(this.opts.token))
      .replace(/__COBRO_ROOT__/g, () => JSON.stringify(this.opts.root));
  }
  private async launch(): Promise<void> {
    const engine = this.opts.engine ?? 'chromium';
    if (engine !== 'chromium') {
      const type = engine === 'webkit' ? webkit : firefox;
      try {
        this.ctx = await type.launchPersistentContext(this.opts.profileDir, {
          headless: this.opts.headless ?? false, bypassCSP: true, viewport: null,
        });
      } catch (e) {
        throw new Error(INSTALL_HINT + '\n' + engine + ': ' + (e as Error).message.split('\n')[0]);
      }
    } else {
      const tried: string[] = [];
      const order = channelOrder(this.opts.channel, process.env.COBRO_BROWSER_CHANNEL);
      for (const sandbox of [true, false]) {
        for (const channel of order) {
          try {
            this.ctx = await chromium.launchPersistentContext(this.opts.profileDir, chromiumLaunchOptions({
              headless: this.opts.headless ?? false, channel, sandbox,
            }));
            break;
          } catch (e) { tried.push(`${channel ?? 'bundled'}${sandbox ? '' : ' (no-sandbox)'}: ${(e as Error).message.split('\n')[0]}`); this.ctx = null; }
        }
        if (this.ctx) {
          if (!sandbox) console.error('[cobro] Chromium 샌드박스를 켜고 띄우지 못해 --no-sandbox로 실행한다 — 브라우저가 경고 줄을 표시한다');
          break;
        }
      }
      if (!this.ctx) {
        const lockExists = existsSync(join(this.opts.profileDir, 'lockfile')) || existsSync(join(this.opts.profileDir, 'SingletonLock'));
        if (classifyLaunchFailure(tried, lockExists) === 'profile-locked') {
          throw new Error(`The cobro browser profile is in use by another process: ${this.opts.profileDir}\nClose the other session's cobro browser (close), or set COBRO_PROFILE_DIR to a different profile.\n` + tried.join('\n'));
        }
        throw new Error(INSTALL_HINT + '\n' + tried.join('\n'));
      }
    }
    await this.ctx.addInitScript(this.injected());
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    this.attach(this.page);
    this.ctx.on('close', () => { this.ctx = null; this.page = null; });
    this.ctx.on('page', (p) => { this.page = p; this.attach(p); }); // 새 탭을 열면 그 탭을 대상으로
  }
  private attach(p: Page): void {
    const push = (level: ConsoleEntry['level'], text: string) => { this.raw.push({ level, text, at: new Date().toISOString() }); if (this.raw.length > 200) this.raw.splice(0, this.raw.length - 200); };
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') push(m.type() as 'error' | 'warning', m.text()); });
    p.on('pageerror', (e) => push('pageerror', e.message));
    p.on('requestfailed', (r) => push('requestfailed', `${r.method()} ${r.url()} — ${r.failure()?.errorText ?? ''}`));
    p.on('load', () => { if (p === this.page) this.raw = []; }); // 활성 탭이 새 문서로 바뀌면 이전 문서의 에러는 버린다(백그라운드 탭의 load는 무시)
  }
  async open(url: string): Promise<{ title: string; restarted: boolean }> {
    const restarted = !this.isAlive() && this.launchedOnce;
    if (!this.isAlive()) { await this.launch(); this.launchedOnce = true; }
    await this.page!.goto(url, { waitUntil: 'load' });
    return { title: await this.page!.title(), restarted };
  }
  private async rectOfSelector(selector: string): Promise<Rect | undefined> {
    const p = this.page!;
    // 기본 30초를 기다리지 않는다 — 못 찾으면 곧바로 뷰포트로 폴백하는 편이 낫다
    const box = await p.locator(selector).first().boundingBox({ timeout: 2000 }).catch(() => null);
    if (!box) { console.error(`[cobro] screenshot: selector로 요소를 찾지 못해 뷰포트를 찍는다 — ${selector}`); return undefined; }
    // boundingBox는 뷰포트 기준 좌표 → 스크롤을 더해 페이지 좌표(clip이 쓰는 좌표계)로 바꾼다
    const scroll = await p.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    return { x: box.x + scroll.x, y: box.y + scroll.y, w: box.width, h: box.height };
  }
  async screenshot(opts: { rect?: Rect; selector?: string; outPath: string }): Promise<string> {
    if (!this.isAlive()) throw new Error('browser not open');
    const p = this.page!;
    const rect = opts.rect ?? (opts.selector ? await this.rectOfSelector(opts.selector) : undefined);
    if (rect) {
      const pad = 16;
      const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: Math.max(1, rect.w + pad * 2), height: Math.max(1, rect.h + pad * 2) };
      try { await p.screenshot({ path: opts.outPath, clip, fullPage: true }); return opts.outPath; }
      catch (e) { console.error('[cobro] clip screenshot failed, falling back to viewport', (e as Error).message); }
    }
    await p.screenshot({ path: opts.outPath });
    return opts.outPath;
  }
  consoleEntries(): ConsoleEntry[] { return dedupeConsole(this.raw); }
  /** 소스맵 해석용 — 페이지와 같은 컨텍스트로 받는다 */
  async fetchText(url: string, maxBytes = 8 * 1024 * 1024): Promise<string | undefined> {
    if (!this.isAlive()) return undefined;
    return fetchTextGuarded(this.ctx!.request, url, maxBytes);
  }
  async close(): Promise<void> { const c = this.ctx; this.ctx = null; this.page = null; if (c) await c.close().catch(() => {}); }
}
