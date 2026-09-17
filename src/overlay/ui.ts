import type { AgentStatus, Batch, RefreshStrategy } from '../core/types.js';
import { stripStatusLabel } from './status-text.js';

export interface ViewModel { selecting: boolean; connected: boolean; agent: { status: AgentStatus; text: string }; strategy: RefreshStrategy | null; drafts: Batch[]; locked: boolean }
export interface UIHandlers { onToggleSelect(): void; onNoteInput(id: string, note: string): void; onRemoveElement(id: string, index: number): void; onSend(): void }

const CSS = `
:host{position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh;overflow:visible;pointer-events:none;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#e8ecf5}
:host::backdrop{display:none}
*{box-sizing:border-box}
.glass{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;display:none}
.hover-box{position:fixed;display:none;border:2px solid #e35d5d;background:rgba(227,93,93,.08);border-radius:2px;pointer-events:none}
.hover-badge{position:fixed;display:none;background:#1c2333;border:1px solid #e35d5d;border-radius:4px;padding:4px 8px;white-space:pre;color:#fff;pointer-events:none;max-width:480px}
.band{position:fixed;display:none;border:1.5px dashed #e35d5d;background:rgba(227,93,93,.06);pointer-events:none}
.toolbar{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px;align-items:center;background:#0e111a;border:1px solid #2a3350;border-radius:999px;padding:6px 10px;box-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:auto}
.toolbar button,.panel button{font:inherit;color:#cdd8f0;background:#232c42;border:1px solid #3a4a72;border-radius:999px;padding:4px 10px;cursor:pointer}
.toolbar button:hover,.panel button:hover{background:#2e3a58;border-color:#4c5f92;color:#fff}
.toolbar button:focus-visible,.panel button:focus-visible{outline:2px solid #9db8ef;outline-offset:1px}
.toolbar button.on{color:#fff;background:#e35d5d;border-color:#e35d5d}
.els button{background:transparent;border-color:transparent;color:#8291b0;padding:0 6px}
.els button:hover{background:#2e3a58;color:#fff}
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:#161b2a;border:1px solid transparent;color:#aab6d0;white-space:nowrap;cursor:default;user-select:none}
.chip.off{color:#f0b429;border-color:#4a3a1a}
.dot{font-size:9px;line-height:1;color:#8291b0}
.dot.waiting{color:#4fd18b}
.dot.sent{color:#f0b429}
.dot.working{color:#9db8ef}
.dot.done{color:#4fd18b}
.status{max-width:440px;overflow:hidden;color:#8a97b5}
.status.off{color:#f0b429}
.status-in{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;transition:transform .2s ease-out}
.status-in.scroll{max-width:none;overflow:visible;text-overflow:clip}
.status-in.enter{animation:cobroin .15s ease-out}
@keyframes cobroin{from{opacity:.4;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
@media (prefers-reduced-motion: reduce){.status-in{transition:none}.status-in.enter{animation:none}}
.panel{position:fixed;right:14px;bottom:60px;width:320px;background:#171b28;border:1px solid #e35d5d;border-radius:8px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:auto;display:none}
.panel.show{display:block}
.panel h4{margin:0 0 6px;color:#e8ecf5;font-size:12px;font-weight:400}
.panel h4 .mark{color:#e35d5d;margin-right:4px}
.els{max-height:110px;overflow:auto;margin-bottom:8px;color:#aab6d0;font-size:11px}
.els div{display:flex;justify-content:space-between;gap:6px;word-break:break-all}
.els .missing{color:#f0b429}
textarea{width:100%;height:54px;resize:none;font:inherit;color:#e8ecf5;background:#0e111a;border:1px solid #3a4a72;border-radius:4px;padding:4px 6px;margin-bottom:8px}
.row{display:flex;justify-content:flex-end;gap:6px;align-items:center}
.row .send{color:#fff;background:#e35d5d;border-color:#e35d5d;font-weight:700}
.row .send:disabled{opacity:.4;cursor:not-allowed}
.flash{position:fixed;border:2px solid #4fd18b;border-radius:2px;pointer-events:none;animation:cobroflash 1.6s ease-out forwards}
@keyframes cobroflash{0%{opacity:1}100%{opacity:0}}
/* shadow root의 자식은 모두 position:fixed 형제 — picker가 glass를 toolbar/panel 뒤에 append하므로 쌓임 순서를 명시한다 */
.glass{z-index:0}
.hover-box,.hover-badge,.band,.flash{z-index:1}
.toolbar,.panel{z-index:2}
`;

const LANG = navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
const T = {
  ko: {
    agentIdle: '에이전트 미연결', agentWaiting: '피드백 대기 중', agentSent: '전송됨 — 에이전트 응답 대기',
    agentWorking: '수정 중', agentDone: '완료',
    chipIdle: '미연결', chipWaiting: '대기 중', chipSent: '전송됨', chipWorking: '수정 중', chipDone: '완료', chipOff: '연결 끊김',
    agentSentDetail: '에이전트 응답 대기',
    disconnected: '연결 끊김 — 재연결 중',
    hintSend: 'Send로 전송하세요', hintClick: '페이지에서 요소를 클릭하세요 · Esc로 해제',
    hintMore: (n: number) => `요소 ${n}개 선택 · 더 고르거나 메모를 적으세요`,
    hintNote: '메모를 적고 Send를 누르세요', hintPick: 'Ctrl+Shift+F 또는 Select로 요소를 고르세요',
    refresh: '갱신',
    selCount: (n: number) => `요소 ${n}개 선택됨`,
    selNone: '선택된 요소 없음 · 메모만 보내도 됩니다',
    elMissing: '요소 없음', notePlaceholder: '수정 요청 메모…',
    tipSelect: '요소 선택 모드 (Ctrl+Shift+F)', tipCollapse: '패널 접기 / 펼치기',
    tipSend: '선택한 요소와 메모를 에이전트에 전송',
    tipSendLocked: '에이전트가 작업 중 — done 뒤에 보낼 수 있습니다',
    tipRemove: '이 요소 빼기',
  },
  en: {
    agentIdle: 'Agent not connected', agentWaiting: 'Waiting for your feedback', agentSent: 'Sent — waiting for the agent',
    agentWorking: 'Working', agentDone: 'Done',
    chipIdle: 'Offline', chipWaiting: 'Waiting', chipSent: 'Sent', chipWorking: 'Working', chipDone: 'Done', chipOff: 'Disconnected',
    agentSentDetail: 'Waiting for the agent',
    disconnected: 'Disconnected — reconnecting',
    hintSend: 'Press Send to deliver', hintClick: 'Click an element on the page · Esc to exit',
    hintMore: (n: number) => `${n} selected · pick more or write a note`,
    hintNote: 'Write a note, then press Send', hintPick: 'Press Ctrl+Shift+F or Select to pick an element',
    refresh: 'refresh',
    selCount: (n: number) => `${n} element(s) selected`,
    selNone: 'No element selected · a note alone is fine',
    elMissing: 'missing', notePlaceholder: 'Describe the change…',
    tipSelect: 'Pick mode (Ctrl+Shift+F)', tipCollapse: 'Collapse / expand the panel',
    tipSend: 'Send the selected elements and note to the agent',
    tipSendLocked: 'Agent is working — you can send after done',
    tipRemove: 'Remove this element',
  },
}[LANG];
const LABELS = { working: ['수정 중', 'Editing', 'Working'], done: ['완료', 'Done'] };
const AGENT_TEXT: Record<AgentStatus, (t: string) => string> = {
  idle: () => T.agentIdle, waiting: () => T.agentWaiting, sent: () => T.agentSentDetail,
  working: (t) => stripStatusLabel(t, LABELS.working), done: (t) => stripStatusLabel(t, LABELS.done),
};
const DOT_TITLE: Record<AgentStatus, string> = { idle: T.agentIdle, waiting: T.agentWaiting, sent: T.agentSent, working: T.agentWorking, done: T.agentDone };
const CHIP_LABEL: Record<AgentStatus, string> = { idle: T.chipIdle, waiting: T.chipWaiting, sent: T.chipSent, working: T.chipWorking, done: T.chipDone };

export function createUI(h: UIHandlers) {
  const host = document.createElement('div');
  host.setAttribute('data-cobro-host', '');
  host.setAttribute('popover', 'manual');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS;
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const selectBtn = document.createElement('button'); selectBtn.textContent = 'Select'; selectBtn.title = T.tipSelect; selectBtn.onclick = () => h.onToggleSelect();
  const chip = document.createElement('span'); chip.className = 'chip';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = '●';
  const chipLabel = document.createElement('span'); chipLabel.className = 'chip-label';
  chip.append(dot, chipLabel);
  const status = document.createElement('span'); status.className = 'status';
  const statusIn = document.createElement('span'); statusIn.className = 'status-in';
  status.append(statusIn);
  const collapseBtn = document.createElement('button'); collapseBtn.textContent = 'Collapse'; collapseBtn.title = T.tipCollapse;
  toolbar.append(selectBtn, chip, status, collapseBtn);
  const panel = document.createElement('div'); panel.className = 'panel';
  root.append(style, toolbar, panel);
  let collapsed = false; let lastVm: ViewModel | null = null; let lastHint: string | null = null;
  collapseBtn.onclick = () => { collapsed = !collapsed; collapseBtn.textContent = collapsed ? 'Expand' : 'Collapse'; if (lastVm) render(lastVm); };
  const textareas = new Map<string, HTMLTextAreaElement>();

  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  const applyHoverScroll = () => {
    const over = statusIn.scrollWidth - status.clientWidth;
    if (over <= 0) { statusIn.classList.remove('scroll'); statusIn.style.transform = ''; statusIn.style.transitionDuration = ''; return; }
    statusIn.classList.add('scroll');
    statusIn.style.transitionDuration = Math.max(0.6, over / 60) + 's';
    statusIn.style.transform = `translateX(-${over}px)`;
  };
  status.addEventListener('mouseenter', () => { clearTimeout(leaveTimer); hovering = true; applyHoverScroll(); });
  status.addEventListener('mouseleave', () => {
    hovering = false;
    statusIn.style.transitionDuration = '.2s';
    statusIn.style.transform = '';
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => statusIn.classList.remove('scroll'), 200);
  });
  statusIn.addEventListener('animationend', () => statusIn.classList.remove('enter'));

  const mount = () => {
    if (!host.isConnected) document.documentElement.append(host);
    try { if (!host.matches(':popover-open')) host.showPopover(); } catch { /* popover 미지원: fixed + 최대 z-index로 폴백 */ host.style.zIndex = '2147483647'; }
  };
  const bump = () => { try { if (host.matches(':popover-open')) { host.hidePopover(); host.showPopover(); } } catch { /* 무시 */ } };
  // 페이지가 나중에 띄운 dialog/popover가 top layer 위로 올라오면 우리를 다시 맨 위로
  document.addEventListener('toggle', (e) => { if (e.target !== host) bump(); }, true);
  new MutationObserver((muts) => {
    if (!host.isConnected) mount();
    if (muts.some((m) => m.type === 'attributes' && (m.target as Element).tagName === 'DIALOG')) bump();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  mount();

  const el = (tag: string, cls?: string, text?: string) => { const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };

  function render(vm: ViewModel) {
    lastVm = vm;
    // panel을 통째로 다시 그리므로 textarea가 분리되면서 포커스·캐럿이 날아간다(디바운스된 draft 왕복마다 발생) → 복원
    const active = root.activeElement;
    const wasTa = active instanceof HTMLTextAreaElement ? active : null;
    const sel: [number, number] | null = wasTa ? [wasTa.selectionStart, wasTa.selectionEnd] : null;
    selectBtn.classList.toggle('on', vm.selecting);
    const cur = vm.drafts[vm.drafts.length - 1];
    const hasElements = !!cur && cur.elements.length > 0;
    const strategyText = vm.strategy ? `${T.refresh}: ${vm.strategy}` : '';
    let hint: string;
    if (!vm.connected) hint = T.disconnected;
    else {
      let text: string;
      if (vm.agent.status === 'sent' || vm.agent.status === 'working' || vm.agent.status === 'done') text = AGENT_TEXT[vm.agent.status](vm.agent.text);
      else if (hasElements && cur!.note.trim() !== '') text = T.hintSend;
      else if (vm.selecting && !hasElements) text = T.hintClick;
      else if (vm.selecting) text = T.hintMore(cur!.elements.length);
      else if (hasElements) text = T.hintNote;
      else text = T.hintPick;
      hint = [text, strategyText].filter(Boolean).join(' · ');
    }
    if (hint !== lastHint) {
      lastHint = hint;
      if (!statusIn.classList.contains('scroll')) {
        statusIn.classList.remove('enter');
        void statusIn.offsetWidth; // 리플로우 강제 — 연속 변경 시 애니메이션 재시작
        statusIn.classList.add('enter');
      }
    }
    statusIn.textContent = hint;
    statusIn.title = hint;
    if (hovering) { applyHoverScroll(); if (statusIn.classList.contains('scroll')) statusIn.classList.remove('enter'); }
    status.classList.toggle('off', !vm.connected);
    chip.classList.toggle('off', !vm.connected);
    dot.className = vm.connected ? 'dot ' + vm.agent.status : 'dot';
    chipLabel.textContent = vm.connected ? CHIP_LABEL[vm.agent.status] : T.chipOff;
    chip.title = vm.connected ? DOT_TITLE[vm.agent.status] : T.disconnected;
    const show = !collapsed && vm.drafts.length > 0;
    panel.classList.toggle('show', show);
    if (vm.drafts.length === 0) { panel.textContent = ''; textareas.clear(); return; }
    if (!show) return;
    panel.textContent = '';
    if (cur) {
      const h4 = el('h4');
      h4.append(el('span', 'mark', '▮'), document.createTextNode(cur.elements.length > 0 ? T.selCount(cur.elements.length) : T.selNone));
      panel.append(h4);
      const list = el('div', 'els');
      cur.elements.forEach((e, i) => {
        const row = el('div', e.missing ? 'missing' : '');
        row.append(el('span', '', `${i + 1}. ${e.selector.split(' > ').pop()}${e.react ? ' · ' + e.react.component : ''}${e.missing ? ' · ' + T.elMissing : ''}`));
        const x = el('button', '', '✕'); x.title = T.tipRemove; x.onclick = () => h.onRemoveElement(cur.id, i); row.append(x);
        list.append(row);
      });
      panel.append(list);
      let ta = textareas.get(cur.id);
      if (!ta) { ta = document.createElement('textarea'); ta.placeholder = T.notePlaceholder; const id = cur.id; ta.addEventListener('input', () => h.onNoteInput(id, ta!.value)); textareas.set(id, ta); }
      if (ta.value !== cur.note) ta.value = cur.note;
      panel.append(ta);
    }
    const row = el('div', 'row');
    const send = el('button', 'send', 'Send') as HTMLButtonElement; send.disabled = vm.locked;
    send.title = vm.locked ? T.tipSendLocked : T.tipSend;
    send.onclick = () => h.onSend();
    row.append(send);
    panel.append(row);
    for (const id of [...textareas.keys()]) if (!vm.drafts.some((b) => b.id === id)) textareas.delete(id);
    // 다시 붙은 textarea가 아까 그 textarea면(= 현재 배치의 것) 포커스와 선택 범위를 되돌린다
    if (wasTa && sel && wasTa.isConnected) { wasTa.focus(); wasTa.setSelectionRange(sel[0], sel[1]); }
  }
  function flash(selectors: string[]) {
    for (const s of selectors) {
      let target: Element | null = null;
      try { target = document.querySelector(s); } catch { /* 선택자 불량 */ }
      if (!target) continue;
      const r = target.getBoundingClientRect();
      const f = el('div', 'flash');
      Object.assign(f.style, { left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' });
      root.append(f); setTimeout(() => f.remove(), 1700);
    }
  }
  function focusNote() { const ta = panel.querySelector('textarea'); ta?.focus(); }
  return { host, root, render, flash, focusNote };
}
