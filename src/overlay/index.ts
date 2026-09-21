import type { Batch, PageInfo, ServerMsg, Session, UiPrefs } from '../core/types.js';
import { createUI } from './ui.js';
import { createPicker } from './picker.js';
import { installGuards } from './guard.js';
import { connectChannel } from './channel.js';
import { inspectElement } from './inspect.js';
import { uniqueSelector } from './selector.js';
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
    let stateSeen = false; // 첫 state 수신 전에는 ensureCurrent를 미룬다 — 서버 복구 초안을 가리지 않도록(I1)
    let openPending = false;
    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    let prefs: UiPrefs = { theme: 'auto', themeLocked: false };
    let expandedGroup: string | null = null; // R124: UI 전용, 서버 저장 안 함
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
      prefs, expanded: expandedGroup,
    });
    const render = () => ui.render(vm());
    const setSelecting = (on: boolean) => {
      picker.setActive(on);
      if (!on) { render(); return; }
      if (!stateSeen) { openPending = true; render(); return; }
      ensureCurrent(); render(); ui.focusNote();
    };
    // I1: 부모 제거 시 그 parent를 가진 자식도 함께 지운다 — addEl의 토글 해제·onRemoveElement 둘 다 이 함수로
    const removeEl = (b: Batch, selector: string) => {
      const i = b.elements.findIndex((e) => e.selector === selector);
      if (i < 0) return;
      const removed = b.elements[i]!;
      b.elements.splice(i, 1);
      if (!removed.parent) b.elements = b.elements.filter((e) => e.parent !== removed.selector);
      if (expandedGroup === removed.selector) expandedGroup = null; // M2: 펼쳐진 그룹의 부모가 사라지면 접힘
    };
    const addEl = (b: Batch, el: Element, toggle: boolean, parent?: string) => {
      const info = inspectElement(el);
      if (parent) {
        info.parent = parent;
        if (b.elements.filter((e) => e.parent === parent).length >= 12) return; // M3: 자식 12개 상한(밴드 재드래그 누적 방지)
      }
      const i = b.elements.findIndex((e) => e.selector === info.selector);
      if (i >= 0) { if (toggle) removeEl(b, info.selector); } else b.elements.push(info);
    };
    const GROUP_LETTERS = 'abcdefghijkl';
    // R123: 그룹(parent 있는 요소)이 하나라도 있으면 전 요소에 ref 부여(부모 1,2,… / 자식은 부모 뒤 1a,1b,…), 없으면 전부 삭제
    const assignRefs = (b: Batch) => {
      if (!b.elements.some((e) => e.parent)) { for (const e of b.elements) delete e.ref; return; }
      let top = 0, childIdx = 0;
      for (const e of b.elements) {
        if (e.parent) { e.ref = `${top}${GROUP_LETTERS[childIdx]}`; childIdx++; } // M3: addEl이 12개에서 막으므로 폴백 불필요
        else { top++; childIdx = 0; e.ref = String(top); }
      }
    };
    const resolveDraft = (b: Batch): Batch => ({ ...b, status: 'draft', elements: b.elements.map((e, i) => {
      let found: Element | null = null; try { found = document.querySelector(e.selector); } catch { /* 불량 선택자 */ }
      const missing = !found;
      if (missing !== !!e.missing) chan.send({ type: 'resolved', batchId: b.id, index: i, missing });
      return { ...e, missing };
    }) });

    const ui = createUI({
      onToggleSelect: () => setSelecting(!picker.isActive()),
      onNoteInput: (id, note) => { const b = drafts?.find((d) => d.id === id); if (b) { b.note = note; pushDraft(); } },
      onRemoveElement: (id, i) => {
        const b = drafts?.find((d) => d.id === id); if (!b) return;
        const sel = b.elements[i]?.selector;
        if (sel) removeEl(b, sel);
        assignRefs(b); pushDraft(); render();
      },
      onRemoveRegion: (id, i) => { const b = drafts?.find((d) => d.id === id); if (b?.regions) { b.regions.splice(i, 1); pushDraft(); render(); } },
      onSend: () => {
        const ready = (drafts ?? []).filter((b) => b.note.trim());
        if (!ready.length) { ui.focusNote(); return; }
        flushDraft();
        chan.send({ type: 'send', batchIds: ready.map((b) => b.id), page: pageInfo() });
        drafts = (drafts ?? []).filter((b) => !ready.includes(b)); current = null;
        picker.setActive(false); expandedGroup = null; render(); // M2: 다음 초안은 접힘부터
      },
      onSettings: (patch) => chan.send({ type: 'settings', patch }),
      onToggleGroup: (selector) => { expandedGroup = expandedGroup === selector ? null : selector; render(); },
    });
    const applyTheme = () => ui.setTheme(resolveTheme(prefs.theme, {
      prefersDark: mq.matches,
      backdropOk: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
      reduceTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    }));
    mq.addEventListener('change', applyTheme);
    const picker = createPicker({
      root: ui.root, host: ui.host,
      onPick: (el) => { if (!stateSeen) return; const b = ensureCurrent(); addEl(b, el, true); assignRefs(b); pushDraft(); render(); ui.focusNote(); },
      onBandPick: (top, band, childrenOf) => {
        if (!stateSeen) return;
        const b = ensureCurrent();
        if (top.length) {
          for (const p of top) {
            addEl(b, p, false);
            const parentSel = uniqueSelector(p);
            for (const c of childrenOf.get(p) ?? []) addEl(b, c, false, parentSel);
          }
        } else if (band.right - band.left >= 8 && band.bottom - band.top >= 8) {
          const cx = (band.left + band.right) / 2, cy = (band.top + band.bottom) / 2;
          const hit = document.elementsFromPoint(cx, cy).find((el) => el !== ui.host && !ui.host.contains(el) && el !== document.documentElement && el !== document.body);
          const rect = { x: Math.round(band.left + scrollX), y: Math.round(band.top + scrollY), w: Math.round(band.right - band.left), h: Math.round(band.bottom - band.top) };
          (b.regions ??= []).push(hit ? { rect, within: uniqueSelector(hit) } : { rect });
        }
        assignRefs(b);
        pushDraft(); render();
      },
    });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); ui.closePop(); setSelecting(!picker.isActive()); }
      else if (e.key === 'Escape' && picker.isActive()) { setSelecting(false); }
    }, true);
    const onViewport = () => ui.renderMarkers(vm());
    window.addEventListener('scroll', onViewport, { capture: true, passive: true });
    window.addEventListener('resize', onViewport, { passive: true });
    window.addEventListener('resize', () => ui.updateTbH(), { passive: true });
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
        stateSeen = true;
        if (openPending) { openPending = false; ensureCurrent(); render(); ui.focusNote(); }
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
