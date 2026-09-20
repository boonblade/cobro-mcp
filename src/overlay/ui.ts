import type { AgentStatus, Batch, RefreshStrategy, Theme, UiPrefs } from '../core/types.js';
import { THEMES } from '../core/types.js';
import { stripStatusLabel } from './status-text.js';
import type { ResolvedTheme } from './theme.js';
import { svg } from './icons.js';
type IconName = Parameters<typeof svg>[0];

export interface ViewModel { selecting: boolean; connected: boolean; agent: { status: AgentStatus; text: string }; strategy: RefreshStrategy | null; drafts: Batch[]; locked: boolean; prefs: UiPrefs }
export interface UIHandlers { onToggleSelect(): void; onNoteInput(id: string, note: string): void; onRemoveElement(id: string, index: number): void; onRemoveRegion(id: string, index: number): void; onSend(): void; onSettings(patch: { theme?: Theme }): void; onNoteOnly(): void }

const CSS = `
:host{
  --bg:#0e111a;--bg-2:#171b28;--bg-3:#232c42;--chip:#161b2a;--border:#2a3350;--border-2:#3a4a72;
  --hover:#2e3a58;--hover-border:#4c5f92;--fg:#e8ecf5;--fg-2:#cdd8f0;--fg-3:#aab6d0;--fg-4:#8a97b5;--fg-5:#8291b0;
  --accent:#e35d5d;--warn:#f0b429;--ok:#4fd18b;--info:#9db8ef;--badge-bg:#1c2333;--badge-fg:#fff;--fg-on-accent:#fff;--fg-hover:#fff;
  --chip-off-border:#4a3a1a;--shadow:0 4px 16px rgba(0,0,0,.5);--blur:none;--radius:12px;--radius-sm:6px;
  position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh;overflow:visible;pointer-events:none;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:var(--fg)
}
:host([data-theme="light"]){
  --bg:#ffffff;--bg-2:#f4f6fb;--bg-3:#e6eaf3;--chip:#eef1f7;--border:#cfd6e4;--border-2:#b8c2d6;
  --hover:#dde3ef;--hover-border:#9fadc8;--fg:#171b28;--fg-2:#2a3350;--fg-3:#4b5670;--fg-4:#5f6b86;--fg-5:#6f7c97;
  --accent:#d9453f;--warn:#b7791f;--ok:#1f8f57;--info:#3b6fd6;--badge-bg:#ffffff;--badge-fg:#171b28;--fg-hover:#171b28;
  --chip-off-border:#e6d29c;--shadow:0 4px 16px rgba(20,30,60,.18);--blur:none;
}
:host([data-theme="frost"]){
  --bg:rgba(14,17,26,.78);--bg-2:#171b28;--bg-3:rgba(255,255,255,.10);--chip:rgba(255,255,255,.06);
  --border:rgba(255,255,255,.14);--border-2:rgba(255,255,255,.22);--hover:rgba(255,255,255,.16);--hover-border:rgba(255,255,255,.30);
  --fg:#e8ecf5;--fg-2:#cdd8f0;--fg-3:#aab6d0;--fg-4:#9aa6c2;--fg-5:#8291b0;
  --accent:#e35d5d;--warn:#f0b429;--ok:#4fd18b;--info:#9db8ef;--badge-bg:#1c2333;--badge-fg:#fff;--fg-hover:#fff;
  --chip-off-border:rgba(240,180,41,.35);--shadow:0 8px 24px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.08);--blur:blur(18px) saturate(140%);
}
@supports not (backdrop-filter: blur(1px)) { :host([data-theme="frost"]) { --bg:#0e111a; --blur:none } }
:host::backdrop{display:none}
*{box-sizing:border-box}
.glass{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;display:none}
.hover-box{position:fixed;display:none;border:2px solid var(--accent);background:color-mix(in srgb, var(--accent) 8%, transparent);border-radius:2px;pointer-events:none}
.hover-badge{position:fixed;display:none;background:var(--badge-bg);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:4px 8px;white-space:pre;color:var(--badge-fg);pointer-events:none;max-width:480px}
.band{position:fixed;display:none;border:1.5px dashed var(--accent);background:color-mix(in srgb, var(--accent) 6%, transparent);pointer-events:none}
.toolbar{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:6px 10px;box-shadow:var(--shadow);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);pointer-events:auto}
.toolbar button,.panel button{font:inherit;color:var(--fg-2);background:var(--bg-3);border:1px solid var(--border-2);border-radius:999px;padding:4px 10px;cursor:pointer}
.toolbar .grip{padding:4px 4px;cursor:grab;color:var(--fg-4);background:transparent;border-color:transparent;touch-action:none}
.toolbar .grip:active,.toolbar.dragging .grip{cursor:grabbing}
.toolbar.dragging{user-select:none}
.toolbar button:hover,.panel button:hover{background:var(--hover);border-color:var(--hover-border);color:var(--fg-hover)}
.toolbar button:focus-visible,.panel button:focus-visible{outline:2px solid var(--info);outline-offset:1px}
.toolbar button.on{color:var(--fg-on-accent);background:var(--accent);border-color:var(--accent)}
.els button{background:transparent;border-color:transparent;color:var(--fg-5);padding:0 6px}
.els button:hover{background:var(--hover);color:var(--fg-hover)}
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:var(--chip);border:1px solid transparent;color:var(--fg-3);white-space:nowrap;cursor:default;user-select:none}
.chip[hidden]{display:none}
.chip .ico{display:inline-flex;line-height:0}
.chip.strategy .ico svg{width:12px;height:12px}
.chip.off{color:var(--warn);border-color:var(--chip-off-border)}
.dot{font-size:9px;line-height:1;color:var(--fg-5)}
.dot.waiting{color:var(--ok)}
.dot.sent{color:var(--warn)}
.dot.working{color:var(--info)}
.dot.done{color:var(--ok)}
.status{max-width:440px;overflow:hidden;color:var(--fg-4)}
.status.off{color:var(--warn)}
.status-in{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;transition:transform .2s ease-out}
.status-in.scroll{max-width:none;overflow:visible;text-overflow:clip}
.status-in.enter{animation:cobroin .15s ease-out}
@keyframes cobroin{from{opacity:.4;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
@media (prefers-reduced-motion: reduce){.status-in{transition:none}.status-in.enter{animation:none}}
.panel{position:fixed;right:14px;bottom:60px;width:320px;background:var(--bg-2);border:1px solid var(--accent);border-radius:var(--radius);padding:16px 16px 14px;box-shadow:var(--shadow);pointer-events:auto;display:none}
.panel.show{display:block}
.panel h4{margin:0 0 12px;color:var(--fg);font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:grab;user-select:none}
.panel.dragging h4{cursor:grabbing}
.panel h4 .mark{color:var(--accent);margin-right:4px}
.panel h4 .grip{display:inline-flex;width:14px;height:16px;color:var(--fg-4);flex:none;margin-right:-2px}
.panel h4 .grip svg{width:14px;height:16px;fill:currentColor;display:block}
.panel h4 .close{margin-left:auto;background:transparent;border-color:transparent;color:var(--fg-5);padding:0 6px}
.panel h4 .close:hover{background:var(--hover);color:var(--fg-hover)}
.els{max-height:min(40vh,172px);overflow:auto;margin-bottom:8px;color:var(--fg-3);font-size:11px}
.els div{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;word-break:break-all}
.els div:last-child{margin-bottom:0}
.els .missing{color:var(--warn)}
.els .num{color:var(--accent);font-weight:700;flex:none}
.els .label{flex:1;min-width:0}
.els .kind{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--chip);border:1px solid var(--border);color:var(--fg-4)}
.els .kind.region{color:var(--accent);border-color:color-mix(in srgb, var(--accent) 45%, transparent);background:color-mix(in srgb, var(--accent) 10%, transparent)}
textarea{width:100%;min-height:80px;resize:none;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--border-2);border-radius:8px;padding:10px;margin-bottom:0;display:block}
.row{display:flex;justify-content:space-between;margin-top:8px;gap:6px;align-items:center}
.row .sends{color:var(--fg-5);font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .send{color:var(--fg-on-accent);background:var(--accent);border-color:var(--accent);font-weight:700;flex:none;white-space:nowrap}
.row .send:disabled{opacity:.4;cursor:not-allowed}
.marker{position:fixed;border:2px solid var(--accent);border-radius:2px;pointer-events:none;box-sizing:border-box}
.marker.region{border-style:dashed;background:color-mix(in srgb, var(--accent) 6%, transparent)}
.marker .n{position:absolute;left:-2px;top:-2px;transform:translate(-50%,-50%);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:#fff;font:700 11px/18px ui-monospace,Menlo,Consolas,monospace;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.marker.inside-x .n{transform:translate(4px,-50%)}
.marker.inside-y .n{transform:translate(-50%,4px)}
.marker.inside-x.inside-y .n{transform:translate(4px,4px)}
.flash{position:fixed;border:2px solid var(--ok);border-radius:2px;pointer-events:none;animation:cobroflash 1.6s ease-out forwards}
@keyframes cobroflash{0%{opacity:1}100%{opacity:0}}
/* shadow root의 자식은 모두 position:fixed 형제 — picker가 glass를 toolbar/panel 뒤에 append하므로 쌓임 순서를 명시한다 */
.glass{z-index:0}
.hover-box,.hover-badge,.band,.flash,.marker{z-index:1}
.toolbar,.pop,.panel{z-index:2}
.pop{position:fixed;bottom:56px;left:50%;transform:translateX(-50%);display:none;min-width:260px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;box-shadow:var(--shadow);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);pointer-events:auto;color:var(--fg-2)}
.pop.show{display:block}
.pop-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.pop-label{color:var(--fg-3)}
.seg{display:inline-flex;gap:2px;background:var(--chip);border-radius:999px;padding:2px}
.seg button{border:1px solid transparent;background:transparent;padding:2px 9px;font:inherit;cursor:pointer;color:var(--fg-3)}
.seg button:hover:not(:disabled){color:var(--fg)}
.seg button.on{background:var(--bg-3);color:var(--fg)}
.seg button:disabled{opacity:.5;cursor:not-allowed}
.pop-note{margin-top:6px;color:var(--warn);font-size:11px}
.ib{display:inline-flex;align-items:center;padding:4px 7px}
.ib .ico{display:inline-flex;line-height:0}
.ib .lbl{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;margin-left:0;transition:max-width .1s ease-in,opacity .1s ease-in,margin-left .1s ease-in}
.ib:hover .lbl,.ib:focus-visible .lbl{max-width:9ch;opacity:1;margin-left:5px;transition-duration:.15s;transition-timing-function:ease-out}
@media (prefers-reduced-motion: reduce){.ib .lbl{transition:none}}
`;

const LANG = navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
const T = {
  ko: {
    agentIdle: '에이전트 미연결', agentWaiting: '피드백 대기 중', agentSent: '전송됨 — 에이전트 응답 대기',
    agentWorking: '수정 중', agentDone: '완료',
    doneResult: (s: string) => `✓ ${T.agentDone}: ${s}`,
    chipIdle: '미연결', chipWaiting: '대기 중', chipSent: '전송됨', chipWorking: '수정 중', chipDone: '완료', chipOff: '연결 끊김',
    agentSentDetail: '에이전트 응답 대기',
    disconnected: '연결 끊김 — 재연결 중',
    hintSend: 'Send로 전송하세요', hintClick: '페이지에서 요소를 클릭하세요 · Esc로 해제',
    hintMore: (n: number) => `요소 ${n}개 선택 · 더 고르거나 메모를 적으세요`,
    hintNote: '메모를 적고 Send를 누르세요', hintPick: 'Ctrl+Shift+F 요소 선택 · Ctrl+Shift+M 메모만',
    tipStrategy: (s: RefreshStrategy) => `갱신 전략: ${s} — ${{ none: 'HMR이 있어 done 뒤 새로고침 없음', reload: 'done 뒤 페이지 새로고침', event: '앱이 cobro:done 이벤트로 직접 갱신' }[s]}`,
    selCount: (n: number) => `요소 ${n}개 선택됨`,
    selCountMixed: (n: number, m: number) => `요소 ${n}개 + 영역 ${m}개 선택됨`,
    regionRow: (w: number, h: number) => `▭ ${w}×${h}`,
    regionIn: (s: string) => ` · ${s} 안`,
    selNone: '요소 없음 · 메모만 보내도 됩니다',
    elMissing: '요소 없음', notePlaceholder: '수정 요청 메모…',
    notePlaceholderMulti: '번호로 구분해 적을 수 있어요 — 1: … 2: …',
    tipSelect: '요소 선택 모드 (Ctrl+Shift+F)', tipCollapse: '패널 접기 / 펼치기', tipDrag: '툴바 이동',
    tipNote: '메모만 보내기 (Ctrl+Shift+M)',
    sends: '선택자 · 스타일 · 스크린샷 · 콘솔',
    tipSend: '선택한 요소와 메모를 에이전트에 전송',
    tipSendLocked: '에이전트가 작업 중 — done 뒤에 보낼 수 있습니다',
    tipRemove: '이 요소 빼기',
    tipSettings: '설정', theme: '테마', themeAuto: '자동', themeDark: '어둡게', themeLight: '밝게', themeFrost: '유리',
    themeLocked: 'COBRO_THEME 환경 변수로 고정됨',
  },
  en: {
    agentIdle: 'Agent not connected', agentWaiting: 'Waiting for your feedback', agentSent: 'Sent — waiting for the agent',
    agentWorking: 'Working', agentDone: 'Done',
    doneResult: (s: string) => `✓ ${T.agentDone}: ${s}`,
    chipIdle: 'Offline', chipWaiting: 'Waiting', chipSent: 'Sent', chipWorking: 'Working', chipDone: 'Done', chipOff: 'Disconnected',
    agentSentDetail: 'Waiting for the agent',
    disconnected: 'Disconnected — reconnecting',
    hintSend: 'Press Send to deliver', hintClick: 'Click an element on the page · Esc to exit',
    hintMore: (n: number) => `${n} selected · pick more or write a note`,
    hintNote: 'Write a note, then press Send', hintPick: 'Ctrl+Shift+F pick · Ctrl+Shift+M note only',
    tipStrategy: (s: RefreshStrategy) => `Refresh strategy: ${s} — ${{ none: 'HMR present — no reload after done', reload: 'page reloads after done', event: 'the app refreshes itself on cobro:done' }[s]}`,
    selCount: (n: number) => `${n} element(s) selected`,
    selCountMixed: (n: number, m: number) => `${n} element(s) + ${m} region(s) selected`,
    regionRow: (w: number, h: number) => `▭ ${w}×${h}`,
    regionIn: (s: string) => ` · in ${s}`,
    selNone: 'No element · note alone is fine',
    elMissing: 'missing', notePlaceholder: 'Describe the change…',
    notePlaceholderMulti: 'Number them if they differ — 1: … 2: …',
    tipSelect: 'Pick mode (Ctrl+Shift+F)', tipCollapse: 'Collapse / expand the panel', tipDrag: 'Move toolbar',
    tipNote: 'Note only (Ctrl+Shift+M)',
    sends: 'Sends selector · styles · shot · console',
    tipSend: 'Send the selected elements and note to the agent',
    tipSendLocked: 'Agent is working — you can send after done',
    tipRemove: 'Remove this element',
    tipSettings: 'Settings', theme: 'Theme', themeAuto: 'Auto', themeDark: 'Dark', themeLight: 'Light', themeFrost: 'Frost',
    themeLocked: 'Pinned by COBRO_THEME',
  },
}[LANG];
const THEME_LABEL: Record<Theme, string> = { auto: T.themeAuto, dark: T.themeDark, light: T.themeLight, frost: T.themeFrost };
const LABELS = { working: ['수정 중', 'Editing', 'Working'], done: ['완료', 'Done'] };
const AGENT_TEXT: Record<AgentStatus, (t: string) => string> = {
  idle: () => T.agentIdle, waiting: () => T.agentWaiting, sent: () => T.agentSentDetail,
  working: (t) => stripStatusLabel(t, LABELS.working), done: (t) => stripStatusLabel(t, LABELS.done),
};
const DOT_TITLE: Record<AgentStatus, string> = { idle: T.agentIdle, waiting: T.agentWaiting, sent: T.agentSent, working: T.agentWorking, done: T.agentDone };
const CHIP_LABEL: Record<AgentStatus, string> = { idle: T.chipIdle, waiting: T.chipWaiting, sent: T.chipSent, working: T.chipWorking, done: T.chipDone };

// 드래그: CSS translate로 오프셋만 얹는다(transform의 -50% 중앙 정렬과 독립). 저장 없음(R101)
// off는 target.style.translate에서 읽어 시작한다 — 재호출(패널처럼 매 render마다 새 handle에 다시 붙는 경우)에도
// DOM에 이미 남아 있는 오프셋을 이어받는다.
function makeDraggable(target: HTMLElement, handle: HTMLElement, opts?: { ignore?: (e: Event) => boolean }) {
  const current = target.style.translate.split(' ').map((v) => parseFloat(v) || 0);
  let off = { x: current[0] ?? 0, y: current[1] ?? 0 };
  let drag: { sx: number; sy: number; ox: number; oy: number } | null = null;
  const clamp = (x: number, y: number) => {
    const r = target.getBoundingClientRect(); const bx = r.left - off.x, by = r.top - off.y; // 오프셋 0일 때의 위치
    return { x: Math.min(Math.max(x, -bx + 4), innerWidth - r.width - bx - 4), y: Math.min(Math.max(y, -by + 4), innerHeight - r.height - by - 4) };
  };
  handle.addEventListener('pointerdown', (e) => { if (e.button !== 0 || opts?.ignore?.(e)) return; e.preventDefault(); handle.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y }; target.classList.add('dragging'); });
  handle.addEventListener('pointermove', (e) => { if (!drag) return; off = clamp(drag.ox + e.clientX - drag.sx, drag.oy + e.clientY - drag.sy); target.style.translate = `${off.x}px ${off.y}px`; });
  const endDrag = () => { drag = null; target.classList.remove('dragging'); };
  handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('click', (e) => { if (opts?.ignore?.(e)) return; e.preventDefault(); });
  window.addEventListener('resize', () => { off = clamp(off.x, off.y); target.style.translate = `${off.x}px ${off.y}px`; });
}

export function createUI(h: UIHandlers) {
  const host = document.createElement('div');
  host.setAttribute('data-cobro-host', '');
  host.setAttribute('popover', 'manual');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS;
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const iconBtn = (icon: IconName, label: string, title: string, extraClass: string, withLabel: boolean) => {
    const btn = document.createElement('button'); btn.className = `ib ${extraClass}`; btn.title = title; btn.setAttribute('aria-label', label);
    const ico = document.createElement('span'); ico.className = 'ico'; ico.innerHTML = svg(icon);
    btn.append(ico);
    if (withLabel) { const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = label; btn.append(lbl); }
    return { btn, ico };
  };
  const selectParts = iconBtn('select', 'Select', T.tipSelect, 'select', true);
  const selectBtn = selectParts.btn; selectBtn.onclick = () => { closePop(); h.onToggleSelect(); };
  const noteParts = iconBtn('note', 'Note', T.tipNote, 'note', false); const noteBtn = noteParts.btn;
  noteBtn.onclick = () => { closePop(); h.onNoteOnly(); };
  const chip = document.createElement('span'); chip.className = 'chip';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = '●';
  const chipLabel = document.createElement('span'); chipLabel.className = 'chip-label';
  chip.append(dot, chipLabel);
  const chip2 = document.createElement('span'); chip2.className = 'chip strategy';
  const chip2Ico = document.createElement('span'); chip2Ico.className = 'ico'; chip2Ico.innerHTML = svg('sync');
  const chip2Label = document.createElement('span'); chip2Label.className = 'chip-label';
  chip2.append(chip2Ico, chip2Label);
  const status = document.createElement('span'); status.className = 'status';
  const statusIn = document.createElement('span'); statusIn.className = 'status-in';
  status.append(statusIn);
  const gearParts = iconBtn('settings', T.tipSettings, T.tipSettings, 'gear', false);
  const gearBtn = gearParts.btn;
  const collapseParts = iconBtn('collapse', 'Collapse', T.tipCollapse, 'collapse', false);
  const collapseBtn = collapseParts.btn;
  const gripParts = iconBtn('drag', 'Move', T.tipDrag, 'grip', false); const grip = gripParts.btn; grip.setAttribute('aria-label', 'Move toolbar');
  toolbar.append(grip, selectBtn, noteBtn, chip, chip2, status, gearBtn, collapseBtn);
  makeDraggable(toolbar, grip);
  const pop = document.createElement('div'); pop.className = 'pop';
  const popRow = document.createElement('div'); popRow.className = 'pop-row';
  const popLabel = document.createElement('span'); popLabel.className = 'pop-label'; popLabel.textContent = T.theme;
  const seg = document.createElement('div'); seg.className = 'seg';
  const segButtons = THEMES.map((key) => {
    const btn = document.createElement('button'); btn.textContent = THEME_LABEL[key]; btn.dataset.theme = key;
    btn.onclick = () => h.onSettings({ theme: key });
    return btn;
  });
  seg.append(...segButtons);
  popRow.append(popLabel, seg);
  const popNote = document.createElement('div'); popNote.className = 'pop-note'; popNote.textContent = T.themeLocked;
  pop.append(popRow, popNote);
  let popOpen = false;
  let popCloseListeners: { doc: (e: Event) => void; key: (e: KeyboardEvent) => void } | null = null;
  const closePop = () => {
    if (!popOpen) return;
    pop.classList.remove('show');
    popOpen = false;
    if (popCloseListeners) { document.removeEventListener('pointerdown', popCloseListeners.doc, true); window.removeEventListener('keydown', popCloseListeners.key, true); popCloseListeners = null; }
  };
  const openPop = () => {
    pop.classList.add('show');
    popOpen = true;
    const onDocPointerDown = (e: Event) => { const path = e.composedPath(); if (!path.includes(pop) && !path.includes(gearBtn)) closePop(); };
    // 선택 모드 진입이 항상 closePop()을 부르므로(B1) pop이 열려 있는 동안 picker는 비활성 — Escape가 pop·picker 양쪽에서 동시에 처리될 일이 없다(M3)
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closePop(); };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    popCloseListeners = { doc: onDocPointerDown, key: onKeyDown };
  };
  gearBtn.onclick = () => { if (popOpen) closePop(); else openPop(); };
  const panel = document.createElement('div'); panel.className = 'panel';
  root.append(style, toolbar, pop, panel);
  // handle을 h4가 아니라 panel 자체로 둔다 — h4는 render마다 다시 만들어지므로(panel.textContent='') h4에
  // 직접 붙이면 makeDraggable을 매번 재호출해야 하고, 그러면 window resize 리스너가 쌓인다(라운드 1 R0 교정).
  // panel에 한 번만 붙이고 ignore로 위임: h4 밖이거나 버튼 위면 드래그를 시작하지 않는다.
  makeDraggable(panel, panel, { ignore: (e) => { const t = e.target as Element; return !t.closest('h4') || t.closest('button') !== null; } });
  let collapsed = false; let lastVm: ViewModel | null = null; let lastHint: string | null = null;
  const setCollapsed = (v: boolean) => {
    collapsed = v;
    const label = collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.title = label;
    collapseParts.ico.innerHTML = svg(collapsed ? 'expand' : 'collapse');
    if (lastVm) render(lastVm);
  };
  const toggleCollapse = () => setCollapsed(!collapsed);
  collapseBtn.onclick = toggleCollapse;
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
    renderMarkers(vm); // 패널이 접혀 있거나 draft가 비어도(= 이른 return) 마커는 매번 갱신(R103)
    // panel을 통째로 다시 그리므로 textarea가 분리되면서 포커스·캐럿이 날아간다(디바운스된 draft 왕복마다 발생) → 복원
    const active = root.activeElement;
    const wasTa = active instanceof HTMLTextAreaElement ? active : null;
    const sel: [number, number] | null = wasTa ? [wasTa.selectionStart, wasTa.selectionEnd] : null;
    selectBtn.classList.toggle('on', vm.selecting);
    for (const btn of segButtons) { btn.classList.toggle('on', btn.dataset.theme === vm.prefs.theme); btn.disabled = vm.prefs.themeLocked; }
    popNote.hidden = !vm.prefs.themeLocked;
    const cur = vm.drafts[vm.drafts.length - 1];
    const hasElements = !!cur && (cur.elements.length + (cur.regions?.length ?? 0)) > 0;
    let hint: string;
    if (!vm.connected) hint = T.disconnected;
    else {
      let text: string;
      if (vm.agent.status === 'sent' || vm.agent.status === 'working' || vm.agent.status === 'done') text = AGENT_TEXT[vm.agent.status](vm.agent.text);
      else if (vm.agent.status === 'waiting' && vm.agent.text && !hasElements && (cur?.note.trim() ?? '') === '') text = T.doneResult(stripStatusLabel(vm.agent.text, LABELS.done));
      else if (cur && cur.note.trim() !== '') text = T.hintSend;
      else if (vm.selecting && !hasElements) text = T.hintClick;
      else if (vm.selecting) text = T.hintMore(cur!.elements.length + (cur!.regions?.length ?? 0));
      else if (hasElements) text = T.hintNote;
      else text = T.hintPick;
      hint = text;
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
    chip2.hidden = !vm.strategy;
    if (vm.strategy) { chip2Label.textContent = vm.strategy; chip2.title = T.tipStrategy(vm.strategy); }
    const show = !collapsed && vm.drafts.length > 0;
    panel.classList.toggle('show', show);
    if (vm.drafts.length === 0) { panel.textContent = ''; textareas.clear(); return; }
    if (!show) return;
    panel.textContent = '';
    if (cur) {
      const h4 = el('h4');
      const g = el('span', 'grip'); g.innerHTML = svg('drag'); g.setAttribute('aria-hidden', 'true'); h4.append(g);
      h4.append(el('span', 'mark', '▮'), document.createTextNode(cur.regions?.length ? T.selCountMixed(cur.elements.length, cur.regions.length) : cur.elements.length > 0 ? T.selCount(cur.elements.length) : T.selNone));
      const close = el('button', 'close', '✕'); close.title = T.tipCollapse; close.setAttribute('aria-label', 'Collapse'); close.onclick = () => toggleCollapse();
      h4.append(close);
      panel.append(h4);
      const list = el('div', 'els');
      cur.elements.forEach((e, i) => {
        const row = el('div', e.missing ? 'missing' : '');
        row.append(el('span', 'num', `${i + 1}.`));
        const comp = (e.react ?? e.vue)?.component;
        row.append(el('span', 'label', `${e.selector.split(' > ').pop()}${comp ? ' · ' + comp : ''}${e.missing ? ' · ' + T.elMissing : ''}`));
        row.append(el('span', 'kind', e.tag));
        const x = el('button', '', '✕'); x.title = T.tipRemove; x.onclick = () => h.onRemoveElement(cur.id, i); row.append(x);
        list.append(row);
      });
      cur.regions?.forEach((r, i) => {
        const n = cur.elements.length + i + 1;
        const row = el('div', '');
        row.append(el('span', 'num', `${n}.`));
        row.append(el('span', 'label', `${T.regionRow(r.rect.w, r.rect.h)}${r.within ? T.regionIn(r.within.split(' > ').pop()!) : ''}`));
        row.append(el('span', 'kind region', 'region'));
        const x = el('button', '', '✕'); x.title = T.tipRemove; x.onclick = () => h.onRemoveRegion(cur.id, i); row.append(x);
        list.append(row);
      });
      panel.append(list);
      let ta = textareas.get(cur.id);
      if (!ta) { ta = document.createElement('textarea'); const id = cur.id; ta.addEventListener('input', () => h.onNoteInput(id, ta!.value)); textareas.set(id, ta); }
      ta.placeholder = (cur.elements.length + (cur.regions?.length ?? 0)) >= 2 ? T.notePlaceholderMulti : T.notePlaceholder;
      if (ta.value !== cur.note) ta.value = cur.note;
      panel.append(ta);
    }
    const row = el('div', 'row');
    const send = el('button', 'send', 'Send →') as HTMLButtonElement; send.disabled = vm.locked;
    send.title = vm.locked ? T.tipSendLocked : T.tipSend;
    send.onclick = () => { closePop(); h.onSend(); };
    row.append(el('span', 'sends', T.sends), send);
    panel.append(row);
    for (const id of [...textareas.keys()]) if (!vm.drafts.some((b) => b.id === id)) textareas.delete(id);
    // 다시 붙은 textarea가 아까 그 textarea면(= 현재 배치의 것) 포커스와 선택 범위를 되돌린다
    if (wasTa && sel && wasTa.isConnected) { wasTa.focus(); wasTa.setSelectionRange(sel[0], sel[1]); }
  }
  // 선택 마커 — 현재 초안의 요소마다 테두리+번호. 매 render와 scroll/resize에서 전부 다시 그린다(R103)
  let markerFrame = 0;
  function renderMarkers(vm: ViewModel) {
    cancelAnimationFrame(markerFrame);
    markerFrame = requestAnimationFrame(() => {
      root.querySelectorAll('.marker').forEach((m) => m.remove());
      const cur = vm.drafts.length ? vm.drafts[vm.drafts.length - 1] : null;
      if (!cur) return;
      const place = (m: HTMLElement, left: number, top: number, width: number, height: number, n: number) => {
        Object.assign(m.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
        if (left < 12) m.classList.add('inside-x');
        if (top < 12) m.classList.add('inside-y');
        m.append(el('span', 'n', String(n)));
        root.append(m);
      };
      cur.elements.forEach((e, i) => {
        if (e.missing) return;
        let target: Element | null = null;
        try { target = document.querySelector(e.selector); } catch { /* 선택자 불량 */ }
        if (!target) return;
        const r = target.getBoundingClientRect();
        place(el('div', 'marker'), r.left - 2, r.top - 2, r.width + 4, r.height + 4, i + 1);
      });
      cur.regions?.forEach((r, i) => {
        place(el('div', 'marker region'), r.rect.x - scrollX, r.rect.y - scrollY, r.rect.w, r.rect.h, cur.elements.length + i + 1);
      });
    });
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
  function setTheme(t: ResolvedTheme): void { host.dataset.theme = t; }
  function expand(): void { if (collapsed) setCollapsed(false); }
  return { host, root, render, renderMarkers, flash, focusNote, setTheme, closePop, expand };
}
