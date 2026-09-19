import type { Batch, PageInfo, ServerMsg, Session, UiPrefs } from '../core/types.js';
import { createUI } from './ui.js';
import { createPicker } from './picker.js';
import { installGuards } from './guard.js';
import { connectChannel } from './channel.js';
import { inspectElement } from './inspect.js';
import { detectStrategy, applyDone } from './refresh.js';
import { resolveTheme } from './theme.js';

declare const __COBRO_PORT__: number;
declare const __COBRO_TOKEN__: string;

(() => {
  if (window.top !== window) return; // iframe은 첫 버전 범위 밖
  const PORT = __COBRO_PORT__; const TOKEN = __COBRO_TOKEN__;

  // init script는 document가 아직 없을 수 있는 시점에 돈다 → DOM 준비 후에만 documentElement를 만진다
  const boot = () => {
    if (document.documentElement.hasAttribute('data-cobro')) return;
    document.documentElement.setAttribute('data-cobro', '1');

    let session: Session | null = null;
    let drafts: Batch[] | null = null; // null = 서버 상태를 아직 못 받음
    let current: string | null = null;
    let connected = false;
    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    let prefs: UiPrefs = { theme: 'auto', themeLocked: false };
    const mq = matchMedia('(prefers-color-scheme: dark)');

    const pageInfo = (): PageInfo => ({ url: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight } });
    const newBatch = (): Batch => ({ id: crypto.randomUUID(), note: '', elements: [], status: 'draft', createdAt: new Date().toISOString() });
    const ensureCurrent = (): Batch => { drafts ??= []; let b = drafts.find((d) => d.id === current); if (!b) { b = newBatch(); drafts.push(b); current = b.id; } return b; };
    const flushDraft = () => { if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; } chan.send({ type: 'draft', batches: drafts ?? [] }); };
    const pushDraft = () => { if (draftTimer) clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 300); };
    const vm = () => ({
      selecting: picker.isActive(), connected, agent: session?.agent ?? { status: 'idle' as const, text: '' },
      strategy: session ? session.strategy ?? session.detected : null, drafts: drafts ?? [],
      locked: session?.agent.status === 'sent' || session?.agent.status === 'working',
      prefs,
    });
    const render = () => ui.render(vm());
    const addEl = (b: Batch, el: Element, toggle: boolean) => {
      const info = inspectElement(el);
      const i = b.elements.findIndex((e) => e.selector === info.selector);
      if (i >= 0) { if (toggle) b.elements.splice(i, 1); } else b.elements.push(info);
    };
    const resolveDraft = (b: Batch): Batch => ({ ...b, status: 'draft', elements: b.elements.map((e, i) => {
      let found: Element | null = null; try { found = document.querySelector(e.selector); } catch { /* 불량 선택자 */ }
      const missing = !found;
      if (missing !== !!e.missing) chan.send({ type: 'resolved', batchId: b.id, index: i, missing });
      return { ...e, missing };
    }) });

    const ui = createUI({
      onToggleSelect: () => { picker.setActive(!picker.isActive()); render(); },
      onNoteInput: (id, note) => { const b = drafts?.find((d) => d.id === id); if (b) { b.note = note; pushDraft(); } },
      onRemoveElement: (id, i) => { const b = drafts?.find((d) => d.id === id); if (b) { b.elements.splice(i, 1); pushDraft(); render(); } },
      onSend: () => {
        const ready = (drafts ?? []).filter((b) => b.elements.length && b.note.trim());
        if (!ready.length) { ui.focusNote(); return; }
        flushDraft();
        chan.send({ type: 'send', batchIds: ready.map((b) => b.id), page: pageInfo() });
        drafts = (drafts ?? []).filter((b) => !ready.includes(b)); current = null;
        picker.setActive(false); render();
      },
      onSettings: (patch) => chan.send({ type: 'settings', patch }),
    });
    const applyTheme = () => ui.setTheme(resolveTheme(prefs.theme, {
      prefersDark: mq.matches,
      backdropOk: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
      reduceTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    }));
    mq.addEventListener('change', applyTheme);
    const picker = createPicker({
      root: ui.root, host: ui.host,
      onPick: (el) => { addEl(ensureCurrent(), el, true); pushDraft(); render(); ui.focusNote(); },
      onBandPick: (els) => { const b = ensureCurrent(); for (const el of els) addEl(b, el, false); pushDraft(); render(); },
    });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); ui.closePop(); picker.setActive(!picker.isActive()); render(); }
      else if (e.key === 'Escape' && picker.isActive()) { picker.setActive(false); render(); }
    }, true);
    const onViewport = () => ui.renderMarkers(vm());
    window.addEventListener('scroll', onViewport, { capture: true, passive: true });
    window.addEventListener('resize', onViewport, { passive: true });
    installGuards(ui.host); // 반드시 위 리스너들 뒤

    const onMessage = (m: ServerMsg) => {
      if (m.type === 'state') {
        session = m.session;
        prefs = m.ui;
        applyTheme();
        // 서버가 이미 draft에서 넘긴(sent/done/unanswered) 배치는 로컬 draft에서 지운다.
        // 없으면 send 직후 도착하는 첫 state('draft'로 커밋된 상태)가 방금 보낸 배치를 좀비 draft로 되살린다.
        const nonDraft = new Set(m.session.batches.filter((b) => b.status !== 'draft').map((b) => b.id));
        const serverDrafts = m.session.batches.filter((b) => b.status === 'draft');
        if (drafts === null) { drafts = serverDrafts.map(resolveDraft); current = drafts[drafts.length - 1]?.id ?? null; }
        else {
          drafts = drafts.filter((d) => !nonDraft.has(d.id));
        }
        render();
      } else if (m.type === 'done') {
        ui.flash(m.info.selectors);
        flushDraft();
        applyDone(m.info, m.strategy);
      }
    };
    const chan = connectChannel({
      port: PORT, token: TOKEN, onMessage,
      onOpen: () => { connected = true; chan.send({ type: 'page', page: pageInfo(), detected: detectStrategy() }); render(); },
      onClose: () => { connected = false; render(); },
    });
    render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
