import type { Batch, PageInfo, ServerMsg, Session, UiPrefs } from '../core/types.js';
import { createUI } from './ui.js';
import { createPicker } from './picker.js';
import { installGuards } from './guard.js';
import { connectChannel } from './channel.js';
import { inspectElement } from './inspect.js';
import { uniqueSelector } from './selector.js';
import { detectStrategy, applyDone } from './refresh.js';
import { resolveTheme } from './theme.js';
import { isChildRef } from './refs.js';

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
    const GROUP_LETTERS = 'abcdefghijkl';
    // R127: ref는 안정 번호 — 발급 뒤 다른 항목이 지워져도 바뀌지 않는다. refSeq는 발급 전용 카운터.
    const nextRef = (b: Batch): string => { b.refSeq = (b.refSeq ?? 0) + 1; return String(b.refSeq); };
    const resetSeqIfEmpty = (b: Batch) => { if (b.elements.length === 0 && !(b.regions?.length)) b.refSeq = 0; };
    // 그룹 g의 다음 자식 문자 — 기존 자식 수로 결정, 12개(a~l) 상한이면 더 받지 않는다
    const childRef = (g: string, b: Batch): string | null => {
      const n = b.elements.filter((e) => isChildRef(e.ref, g)).length;
      return n < GROUP_LETTERS.length ? g + GROUP_LETTERS[n] : null;
    };
    // 옛 초안(ref 없는 요소·영역)에 순서대로 ref를 채운다 — 요소 먼저, 영역 다음
    // M1(리뷰): refSeq를 0부터 다시 세지 않고, 기존 ref들의 앞 숫자 최댓값부터 이어간다(중복 발급 방지)
    const ensureRefs = (b: Batch) => {
      const lead = (s?: string) => { const m = /^\d+/.exec(s ?? ''); return m ? Number(m[0]) : 0; };
      let max = b.refSeq ?? 0;
      for (const e of b.elements) max = Math.max(max, lead(e.ref));
      for (const r of b.regions ?? []) max = Math.max(max, lead(r.ref));
      b.refSeq = max;
      for (const e of b.elements) if (!e.ref) e.ref = nextRef(b);
      for (const r of b.regions ?? []) if (!r.ref) r.ref = nextRef(b);
    };
    const removeEl = (b: Batch, selector: string) => {
      const i = b.elements.findIndex((e) => e.selector === selector);
      if (i >= 0) b.elements.splice(i, 1);
    };
    const addEl = (b: Batch, el: Element, toggle: boolean, ref: string) => {
      const info = inspectElement(el);
      info.ref = ref;
      const i = b.elements.findIndex((e) => e.selector === info.selector);
      if (i >= 0) { if (toggle) removeEl(b, info.selector); } else b.elements.push(info);
    };
    // 그룹(영역) 제거 = 영역 splice + 그 자식 전부(ref가 그룹 ref로 시작하고 글자 하나만 붙은 요소) 제거
    const removeRegion = (b: Batch, i: number) => {
      const r = b.regions?.[i];
      if (!r) return;
      b.regions!.splice(i, 1);
      if (r.ref) {
        const g = r.ref;
        b.elements = b.elements.filter((e) => !isChildRef(e.ref, g));
        if (expandedGroup === g) expandedGroup = null; // M2: 펼쳐진 그룹이 사라지면 접힘
      }
    };
    const resolveDraft = (b: Batch): Batch => {
      ensureRefs(b);
      return { ...b, status: 'draft', elements: b.elements.map((e, i) => {
        let found: Element | null = null; try { found = document.querySelector(e.selector); } catch { /* 불량 선택자 */ }
        const missing = !found;
        if (missing !== !!e.missing) chan.send({ type: 'resolved', batchId: b.id, index: i, missing });
        return { ...e, missing };
      }) };
    };

    const ui = createUI({
      onToggleSelect: () => setSelecting(!picker.isActive()),
      onNoteInput: (id, note) => { const b = drafts?.find((d) => d.id === id); if (b) { b.note = note; pushDraft(); } },
      onRemoveElement: (id, i) => {
        const b = drafts?.find((d) => d.id === id); if (!b) return;
        const sel = b.elements[i]?.selector;
        if (sel) removeEl(b, sel);
        resetSeqIfEmpty(b); pushDraft(); render();
      },
      onRemoveRegion: (id, i) => {
        const b = drafts?.find((d) => d.id === id); if (!b) return;
        removeRegion(b, i);
        resetSeqIfEmpty(b); pushDraft(); render();
      },
      onSend: () => {
        const ready = (drafts ?? []).filter((b) => b.note.trim());
        if (!ready.length) { ui.focusNote(); return; }
        flushDraft();
        chan.send({ type: 'send', batchIds: ready.map((b) => b.id), page: pageInfo() });
        drafts = (drafts ?? []).filter((b) => !ready.includes(b)); current = null;
        picker.setActive(false); expandedGroup = null; render(); // M2: 다음 초안은 접힘부터
      },
      onSettings: (patch) => chan.send({ type: 'settings', patch }),
      onToggleGroup: (ref) => { expandedGroup = expandedGroup === ref ? null : ref; render(); },
    });
    const applyTheme = () => ui.setTheme(resolveTheme(prefs.theme, {
      prefersDark: mq.matches,
      backdropOk: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
      reduceTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    }));
    mq.addEventListener('change', applyTheme);
    const picker = createPicker({
      root: ui.root, host: ui.host,
      onPick: (el) => {
        if (!stateSeen) return;
        const b = ensureCurrent();
        const sel = uniqueSelector(el);
        if (b.elements.some((e) => e.selector === sel)) removeEl(b, sel);
        else addEl(b, el, false, nextRef(b));
        resetSeqIfEmpty(b);
        pushDraft(); render(); ui.focusNote();
      },
      // R126: 0개 → 영역만 / fresh 0개(전부 이미 있음) → 아무것도 안 함(I2) / fresh 1개 → 낱개 요소 / fresh 2개 이상 → 그룹
      onBandPick: (hits, band) => {
        if (!stateSeen) return;
        const b = ensureCurrent();
        const rect = { x: Math.round(band.left + scrollX), y: Math.round(band.top + scrollY), w: Math.round(band.right - band.left), h: Math.round(band.bottom - band.top) };
        const withinAt = () => {
          const cx = (band.left + band.right) / 2, cy = (band.top + band.bottom) / 2;
          const hit = document.elementsFromPoint(cx, cy).find((el) => el !== ui.host && !ui.host.contains(el) && el !== document.documentElement && el !== document.body);
          return hit ? uniqueSelector(hit) : undefined;
        };
        if (hits.length === 0) {
          if (band.right - band.left >= 8 && band.bottom - band.top >= 8) {
            const ref = nextRef(b);
            const within = withinAt();
            (b.regions ??= []).push(within ? { ref, rect, within } : { ref, rect });
            pushDraft(); render();
          }
          return;
        }
        // I2(리뷰): 이미 목록에 있는 요소를 뺀 "새로 잡힌" 요소 수로 판정 — 같은 밴드 재드래그가 자식 없는 그룹을 또 만들지 않게
        const fresh = hits.filter((h) => !b.elements.some((e) => e.selector === uniqueSelector(h)));
        if (fresh.length === 0) return;
        if (fresh.length === 1) {
          addEl(b, fresh[0]!, false, nextRef(b));
        } else {
          const g = nextRef(b);
          const within = withinAt();
          (b.regions ??= []).push(within ? { ref: g, rect, within } : { ref: g, rect });
          for (const h of fresh) { const cr = childRef(g, b); if (cr) addEl(b, h, false, cr); }
        }
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
