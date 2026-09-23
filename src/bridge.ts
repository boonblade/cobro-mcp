import { SessionCore, samePage } from './core/session.js';
import { ChannelServer } from './channel/server.js';
import { buildPayload } from './core/payload.js';
import { stripFrame } from './core/sourcemap.js';
import { readUserSettings, writeUserSettings, isTheme } from './core/settings.js';
import type { Store } from './core/store.js';
import type { Batch, ConsoleEntry, DoneInfo, PageInfo, ServerMsg, Theme, UiPrefs } from './core/types.js';

export interface Bridge { core: SessionCore; channel: ChannelServer; port: number; token: string; done(info: DoneInfo, batchId?: string): Batch[]; close(): Promise<void>; ui(): UiPrefs }

export async function createBridge(opts: { store: Store; token: string; screenshot?: (b: Batch, page: PageInfo) => Promise<string | undefined>; consoleEntries?: () => ConsoleEntry[]; settingsFile?: string; envTheme?: Theme; resolveSource?: (b: Batch, page: PageInfo) => Promise<void> }): Promise<Bridge> {
  const core = new SessionCore(opts.store);
  let cachedTheme: Theme | undefined = opts.settingsFile ? readUserSettings(opts.settingsFile).theme : undefined;
  const uiPrefs = (): UiPrefs => ({ theme: opts.envTheme ?? cachedTheme ?? 'auto', themeLocked: !!opts.envTheme });
  const stateMsg = (): ServerMsg => ({ type: 'state', session: core.session, ui: uiPrefs() });
  const channel = new ChannelServer({
    token: opts.token,
    onConnect: (reply) => reply(stateMsg()),
    onMessage: (msg, reply) => {
      // 페이지에서 온 메시지는 전부 데이터다 — 쓰기 전에 형태를 확인하고, 어긋나면 한 줄 남기고 버린다
      const bad = (why: string) => console.error(`[cobro] bridge: ${msg.type} 메시지를 무시한다 — ${why}`);
      switch (msg.type) {
        case 'page':
          if (!msg.page || typeof msg.page.url !== 'string') return bad('page.url이 없다');
          core.setPage(msg.page, msg.detected);
          // R163: 이 페이지로 재접속했으니 그 페이지 몫으로 미뤄둔 done을 이 소켓에만 재생한다(리로드 재발 방지로 strategy는 none)
          for (const p of core.takePendingDone(msg.page.url)) reply({ type: 'done', info: p.info, strategy: 'none', batchIds: p.batchIds });
          break;
        case 'draft':
          if (!Array.isArray(msg.batches)) return bad('batches가 배열이 아니다');
          core.setDrafts(msg.batches); break;
        case 'resolved':
          if (typeof msg.batchId !== 'string') return bad('batchId가 문자열이 아니다');
          core.markResolved(msg.batchId, msg.index, msg.missing); break;
        case 'settings': {
          if (!msg.patch || typeof msg.patch !== 'object') return bad('patch가 없다');
          if (!opts.settingsFile) return bad('settingsFile 없음');
          if (opts.envTheme) return bad('COBRO_THEME로 고정됨');
          if (!isTheme(msg.patch.theme)) return bad('theme 값이 아니다'); // theme 없는 patch({})도 거부 — 아니면 {theme:undefined}가 저장돼 auto로 지워진다(M1)
          const next = writeUserSettings(opts.settingsFile, { theme: msg.patch.theme });
          cachedTheme = next.theme;
          channel.broadcast(stateMsg());
          break;
        }
        case 'send': {
          if (!Array.isArray(msg.batchIds) || !msg.page || typeof msg.page.url !== 'string') return bad('batchIds 배열이나 page.url이 없다');
          const page = msg.page;
          const batchIds = msg.batchIds;
          void (async () => {
            // 무엇이 던지든 wait는 반드시 풀어준다 — 상태 저장·스크린샷·콘솔이 실패해도 최소 페이로드는 배달한다
            let batches: Batch[] = [];
            try {
              batches = core.markSent(batchIds, page);
              for (const b of batches) {
                // R164: 묶음이 다른 페이지에서 찍혔으면 그 모듈 URL 기준으로 origin을 판정해야 한다
                const srcPage = b.page ? { ...page, url: b.page.url, title: b.page.title } : page;
                try { await opts.resolveSource?.(b, srcPage); } catch (e) { console.error('[cobro] resolveSource failed', (e as Error).message); }
                // 다른 페이지에서 찍힌 묶음은 지금 화면을 다시 찍으면 안 된다 — 기존 screenshot(초안 단계 샷)을 유지한다
                if (!b.page || samePage(b.page.url, page.url)) {
                  try { const p = await opts.screenshot?.(b, page); if (p) core.setScreenshot(b.id, p); } catch (e) { console.error('[cobro] screenshot failed', (e as Error).message); }
                }
              }
              core.deliver(buildPayload({ page, batches, console: opts.consoleEntries?.() ?? [], refreshStrategy: core.effectiveStrategy() }));
            } catch (e) {
              console.error('[cobro] send 처리 실패 — 최소 페이로드로 배달한다', (e as Error).message);
              // markSent가 저장에서 던졌으면 반환값이 없다 — 메모리 상태에서 요청된 묶음을 되살린다
              if (batches.length === 0) batches = core.session.batches.filter((b) => batchIds.includes(b.id));
              core.deliver({
                origin: 'human', sentAt: new Date().toISOString(), page,
                batches: batches.map((b) => ({ id: b.id, note: b.note, elements: b.elements.map(stripFrame), ...(b.regions?.length ? { regions: b.regions } : {}) })),
                console: [], refreshStrategy: core.effectiveStrategy(),
              });
            }
          })().catch((e) => console.error('[cobro] send 복구 실패 — 이 전송은 배달되지 않는다', (e as Error).message));
          break;
        }
      }
    },
  });
  core.on('change', () => channel.broadcast(stateMsg()));
  const port = await channel.listen();
  return {
    core, channel, port, token: opts.token,
    ui: uiPrefs,
    done(info, batchId) {
      // R163: 대상 묶음의 page별로 나눠 현재 페이지에는 즉시 방송하고, 다른 페이지는 그 페이지가 재접속할 때 재생하도록 들고 있는다
      const out = core.done(info, batchId);
      const cur = core.session.page?.url;
      const strategy = core.effectiveStrategy();
      if (cur === undefined) {
        channel.broadcast({ type: 'done', info, strategy, batchIds: out.map((b) => b.id) });
        return out;
      }
      const urls = out.length === 0 ? [cur] : [...new Set(out.map((b) => b.page?.url ?? cur))];
      for (const url of urls) {
        const batchIds = out.filter((b) => (b.page?.url ?? cur) === url).map((b) => b.id);
        if (url === cur) {
          channel.broadcast({ type: 'done', info, strategy, batchIds });
          if (strategy === 'reload') core.pushPendingDone({ url, batchIds, info });
        } else {
          core.pushPendingDone({ url, batchIds, info });
        }
      }
      return out;
    },
    close: () => channel.close(),
  };
}
