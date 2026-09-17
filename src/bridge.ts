import { SessionCore } from './core/session.js';
import { ChannelServer } from './channel/server.js';
import { buildPayload } from './core/payload.js';
import { readUserSettings, writeUserSettings, isTheme } from './core/settings.js';
import type { Store } from './core/store.js';
import type { Batch, ConsoleEntry, DoneInfo, PageInfo, ServerMsg, Theme, UiPrefs } from './core/types.js';

export interface Bridge { core: SessionCore; channel: ChannelServer; port: number; token: string; done(info: DoneInfo): Batch[]; close(): Promise<void>; ui(): UiPrefs }

export async function createBridge(opts: { store: Store; token: string; screenshot?: (b: Batch, page: PageInfo) => Promise<string | undefined>; consoleEntries?: () => ConsoleEntry[]; settingsFile?: string; envTheme?: Theme }): Promise<Bridge> {
  const core = new SessionCore(opts.store);
  let cachedTheme: Theme | undefined = opts.settingsFile ? readUserSettings(opts.settingsFile).theme : undefined;
  const uiPrefs = (): UiPrefs => ({ theme: opts.envTheme ?? cachedTheme ?? 'auto', themeLocked: !!opts.envTheme });
  const stateMsg = (): ServerMsg => ({ type: 'state', session: core.session, ui: uiPrefs() });
  const channel = new ChannelServer({
    token: opts.token,
    onConnect: (reply) => reply(stateMsg()),
    onMessage: (msg) => {
      // 페이지에서 온 메시지는 전부 데이터다 — 쓰기 전에 형태를 확인하고, 어긋나면 한 줄 남기고 버린다
      const bad = (why: string) => console.error(`[cobro] bridge: ${msg.type} 메시지를 무시한다 — ${why}`);
      switch (msg.type) {
        case 'page':
          if (!msg.page || typeof msg.page.url !== 'string') return bad('page.url이 없다');
          core.setPage(msg.page, msg.detected); break;
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
          if (msg.patch.theme !== undefined && !isTheme(msg.patch.theme)) return bad('theme 값이 아니다');
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
                try { const p = await opts.screenshot?.(b, page); if (p) core.setScreenshot(b.id, p); } catch (e) { console.error('[cobro] screenshot failed', (e as Error).message); }
              }
              core.deliver(buildPayload({ page, batches, console: opts.consoleEntries?.() ?? [], refreshStrategy: core.effectiveStrategy() }));
            } catch (e) {
              console.error('[cobro] send 처리 실패 — 최소 페이로드로 배달한다', (e as Error).message);
              // markSent가 저장에서 던졌으면 반환값이 없다 — 메모리 상태에서 요청된 묶음을 되살린다
              if (batches.length === 0) batches = core.session.batches.filter((b) => batchIds.includes(b.id));
              core.deliver({
                origin: 'human', sentAt: new Date().toISOString(), page,
                batches: batches.map((b) => ({ id: b.id, note: b.note, elements: b.elements })),
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
    done(info) { const out = core.done(info); channel.broadcast({ type: 'done', info, strategy: core.effectiveStrategy() }); return out; },
    close: () => channel.close(),
  };
}
