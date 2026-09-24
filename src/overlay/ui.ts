import type { AgentStatus, Batch, RefreshStrategy, Theme, UiPrefs } from '../core/types.js';
import { THEMES } from '../core/types.js';
import { stripStatusLabel } from './status-text.js';
import type { ResolvedTheme } from './theme.js';
import { svg } from './icons.js';
import { isChildRef } from './refs.js';
import { queueCards, lastRoundDone, roundOf, pageLoc } from './cart.js';
import { samePage } from '../core/page.js';
type IconName = Parameters<typeof svg>[0];

// R172: 가로 막대 2개 — 큐 탭 아이콘(이모지 금지)
const QUEUE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="9" width="12" height="2" rx="1" fill="currentColor"/></svg>';

// R166·R169: current = 현재 페이지 초안, queue = sent·working·라운드 done(전 페이지), busy = sent·working 묶음 존재
// R172·R174·R175·R176: batches = 전체 묶음(큐 카드·완료 정리용), locked = 에이전트 기준 잠금, tab·doneOpen = UI 전용 상태, panelOpen = 패널 표시 여부(선택 모드와 분리 — R175)
export interface ViewModel { selecting: boolean; connected: boolean; agent: { status: AgentStatus; text: string }; strategy: RefreshStrategy | null; drafts: Batch[]; current: Batch | null; queue: Batch[]; batches: Batch[]; busy: boolean; locked: boolean; followPaused: boolean; pendingElsewhere: { url: string; path: string } | null; prefs: UiPrefs; expanded: string | null; href: string; tab: 'here' | 'queue'; doneOpen: boolean; panelOpen: boolean }
export interface UIHandlers { onToggleSelect(): void; onClose(): void; onNoteInput(id: string, note: string): void; onRemoveElement(id: string, index: number): void; onRemoveRegion(id: string, index: number): void; onSend(): void; onSettings(patch: { theme?: Theme }): void; onToggleGroup(ref: string): void; onTab(tab: 'here' | 'queue'): void; onToggleDone(): void; onGoPage(url: string): void }

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
.toolbar button:disabled,.panel button:disabled{opacity:.4;cursor:not-allowed}
.toolbar button.locked{opacity:.6}
textarea:disabled{opacity:.6;cursor:not-allowed}
.els button{background:transparent;border-color:transparent;color:var(--fg-5);padding:0 6px}
.els button:hover{background:var(--hover);color:var(--fg-hover)}
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:var(--chip);border:1px solid transparent;color:var(--fg-3);white-space:nowrap;cursor:default;user-select:none}
.chip[hidden]{display:none}
.chip .ico{display:inline-flex;line-height:0}
.chip.off{color:var(--warn);border-color:var(--chip-off-border)}
.dot{font-size:9px;line-height:1;color:var(--fg-5)}
.dot.waiting{color:var(--ok)}
.dot.sent{color:var(--warn)}
.dot.working{color:var(--info)}
.dot.done{color:var(--ok)}
.status{width:320px;flex:none;overflow:hidden;color:var(--fg-4)}
.status.off{color:var(--warn)}
.status-in{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;transition:transform .2s ease-out}
.status-in.scroll{max-width:none;overflow:visible;text-overflow:clip}
.status-in.enter{animation:cobroin .15s ease-out}
.status-in a.goto{color:inherit;text-decoration:underline;cursor:pointer}
@keyframes cobroin{from{opacity:.4;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
@media (prefers-reduced-motion: reduce){.status-in{transition:none}.status-in.enter{animation:none}}
.wbox{position:fixed;border:1.5px solid var(--info);border-radius:2px;pointer-events:none;box-sizing:border-box;animation:cobrobreathe 2.4s ease-in-out infinite}
.wbox.region{border-style:dashed;background:color-mix(in srgb, var(--info) 6%, transparent)}
.wbox .clip{position:absolute;inset:0;overflow:hidden;border-radius:inherit}
.wbox .sweep{position:absolute;top:0;bottom:0;left:0;width:55%;background:linear-gradient(90deg,transparent,color-mix(in srgb, var(--info) 55%, transparent),transparent);animation:cobrosweep 2.2s cubic-bezier(.4,0,.2,1) infinite}
/* 배지 배경 토큰을 글자색으로 — --info 위 대비가 세 테마 모두 맞는다 */
.wbox .n{position:absolute;left:-2px;top:-2px;transform:translate(-50%,-50%);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--info);color:var(--badge-bg);font:700 11px/18px ui-monospace,Menlo,Consolas,monospace;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)}
@keyframes cobrosweep{0%{transform:translateX(-110%)}100%{transform:translateX(300%)}}
@keyframes cobrobreathe{0%{box-shadow:0 0 0 1px color-mix(in srgb, var(--info) 12%, transparent),0 0 6px color-mix(in srgb, var(--info) 18%, transparent)}50%{box-shadow:0 0 0 3px color-mix(in srgb, var(--info) 16%, transparent),0 0 16px color-mix(in srgb, var(--info) 42%, transparent)}100%{box-shadow:0 0 0 1px color-mix(in srgb, var(--info) 12%, transparent),0 0 6px color-mix(in srgb, var(--info) 18%, transparent)}}
.toolbar .line{position:absolute;left:20px;right:20px;bottom:0;height:2px;background:linear-gradient(90deg,transparent,var(--info) 30%,var(--accent) 50%,var(--info) 70%,transparent);background-size:200% 100%;background-position:100%;opacity:.9;animation:cobroflow 2.2s linear infinite;pointer-events:none}
@keyframes cobroflow{from{background-position:100%}to{background-position:-100%}}
@media (prefers-reduced-motion: reduce){.wbox{animation:none}.wbox .sweep{display:none}.toolbar .line{animation:none}}
.panel{position:fixed;right:14px;bottom:60px;width:320px;background:var(--bg-2);border:1px solid var(--accent);border-radius:var(--radius);padding:16px 16px 14px;box-shadow:var(--shadow);pointer-events:auto;display:none}
.panel.show{display:block}
.panel h4{margin:0 0 12px;color:var(--fg);font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:grab;user-select:none}
.panel.dragging h4{cursor:grabbing}
.panel h4 .mark{color:var(--accent);margin-right:4px}
.panel h4 .grip{display:inline-flex;width:14px;height:16px;color:var(--fg-4);flex:none;margin-right:-2px}
.panel h4 .grip svg{width:14px;height:16px;fill:currentColor;display:block}
.panel h4 .close{margin-left:auto;background:transparent;border-color:transparent;color:var(--fg-5);padding:0 6px}
.panel h4 .close:hover{background:var(--hover);color:var(--fg-hover)}
.panel .tabs{display:flex;flex:1;border-bottom:1px solid var(--border)}
.panel .tabs button.tab{flex:1;min-height:40px;background:none;border:0;border-bottom:2px solid transparent;color:var(--fg-4);font-weight:600;font-family:inherit;letter-spacing:0;display:inline-flex;align-items:center;justify-content:center;gap:5px;border-radius:0;padding:4px 6px}
.panel .tabs button.tab.on{color:var(--fg);border-bottom-color:var(--accent)}
.panel .tabs .badge{display:inline-flex;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--chip);font-size:10px;line-height:16px;text-align:center}
.sub{display:flex;align-items:center;gap:6px;margin:12px 0;color:var(--fg);font-size:12px;font-weight:700}
.sub .mark{color:var(--accent)}
.els{max-height:min(45vh,260px);overflow:auto;margin-bottom:8px;color:var(--fg-3);font-size:11px}
.els div{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;word-break:break-all}
.els div:last-child{margin-bottom:0}
.els .missing{color:var(--warn)}
.els .num{color:var(--accent);font-weight:700;flex:none}
.els .label{flex:1;min-width:0}
.els .kind{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--chip);border:1px solid var(--border);color:var(--fg-4)}
.els .kind.region{color:var(--accent);border-color:color-mix(in srgb, var(--accent) 45%, transparent);background:color-mix(in srgb, var(--accent) 10%, transparent)}
.els .child{margin-left:22px;background:var(--bg);padding:6px 10px}
.els .chev{flex:none;width:14px;text-align:center;color:var(--fg-5);cursor:pointer}
.els .cnt{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:color-mix(in srgb, var(--accent) 12%, transparent);border:1px solid color-mix(in srgb, var(--accent) 45%, transparent);color:var(--accent)}
.els .child .num{color:var(--fg-4)}
.els > div.group{cursor:pointer}
.marker.child{border-style:dotted}
.marker.child .n{background:#fff;color:var(--accent);border:1.5px solid var(--accent)}
textarea{width:100%;min-height:80px;resize:none;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--border-2);border-radius:8px;padding:10px;margin-bottom:0;display:block}
div.queue{display:flex;flex-direction:column;gap:8px;max-height:min(45vh,320px);overflow:auto;margin:12px 0}
.queue .card{display:flex;gap:8px;padding:8px;border:1px solid var(--border);border-radius:10px;text-decoration:none;color:inherit;align-items:center}
.card.working{border-color:var(--accent)}
.card.here{background:var(--chip)}
.queue .card .body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.queue .card .title{font-weight:600;color:var(--fg-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.queue .card .path{font-size:10px;color:var(--fg-5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.queue .card .meta{font-size:11px;color:var(--fg-4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.queue .card .chip{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--chip);border:1px solid var(--border);color:var(--fg-4);align-self:flex-start}
.queue .card.working .chip{color:var(--accent)}
.queue .card.done .chip{color:var(--ok)}
.queue .card .here{flex:none;font-size:10px;color:var(--fg-5)}
.thumb{flex:none;width:44px;height:32px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;gap:3px;padding:4px}
.thumb .rect{display:block;width:10px;height:14px;border:1.5px solid var(--border-2);border-radius:2px}
.thumb .rect.sent{border-color:var(--warn)}
.thumb .rect.working{border-color:var(--accent)}
.thumb .rect.done{border-color:var(--ok)}
.done-row{display:block;width:100%;text-align:left;background:transparent;border:1px dashed var(--border);color:var(--fg-4);padding:8px 10px;border-radius:8px}
.done-item{display:flex;gap:8px;padding:6px 10px;font-size:11px;color:var(--fg-4)}
.done-item .title{flex:none;color:var(--fg-3)}
.done-item .path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.done-item .summary{color:var(--ok)}
.row{display:flex;justify-content:space-between;margin-top:8px;gap:6px;align-items:center}
.row .sends{color:var(--fg-5);font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .send{color:var(--fg-on-accent);background:var(--accent);border-color:var(--accent);font-weight:700;flex:none;white-space:nowrap}
.row .send:disabled{opacity:.4;cursor:not-allowed}
.row .foot{font-size:11px;color:var(--fg-4)}
.row .foot.ok{color:var(--ok)}
.marker{position:fixed;border:2px solid var(--accent);border-radius:2px;pointer-events:none;box-sizing:border-box}
.marker.region{border-style:dashed;background:color-mix(in srgb, var(--accent) 6%, transparent)}
.marker .n{position:absolute;left:-2px;top:-2px;transform:translate(-50%,-50%);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:#fff;font:700 11px/18px ui-monospace,Menlo,Consolas,monospace;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.marker.inside-x .n,.wbox.inside-x .n{transform:translate(4px,-50%)}
.marker.inside-y .n,.wbox.inside-y .n{transform:translate(-50%,4px)}
.marker.inside-x.inside-y .n,.wbox.inside-x.inside-y .n{transform:translate(4px,4px)}
.marker.child .n{left:auto;right:-2px;transform:translate(50%,-50%)}
.flash{position:fixed;border:2px solid var(--ok);border-radius:2px;pointer-events:none;animation:cobroflash 1.6s ease-out forwards}
@keyframes cobroflash{0%{opacity:1}100%{opacity:0}}
/* shadow root의 자식은 모두 position:fixed 형제 — picker가 glass를 toolbar/panel 뒤에 append하므로 쌓임 순서를 명시한다 */
.glass{z-index:0}
.hover-box,.hover-badge,.band,.flash,.marker,.wbox{z-index:1}
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
.pop-row.strategy{align-items:center;flex-wrap:wrap}
.pop-row.strategy[hidden]{display:none}
.strategy-val{display:inline-flex;align-items:center;gap:4px;font-family:ui-monospace,Menlo,Consolas,monospace;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--fg-3)}
.strategy-val .ico svg{width:12px;height:12px}
.pop-sub{font-size:11px;color:var(--fg-4);margin-left:8px}
.ib{display:inline-flex;align-items:center;padding:4px 7px}
.ib .ico{display:inline-flex;line-height:0}
.ib .lbl{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;margin-left:0;transition:max-width .1s ease-in,opacity .1s ease-in,margin-left .1s ease-in}
.ib:hover .lbl,.ib:focus-visible .lbl{max-width:9ch;opacity:1;margin-left:5px;transition-duration:.15s;transition-timing-function:ease-out}
@media (prefers-reduced-motion: reduce){.ib .lbl{transition:none}}
@media (max-width:760px){
  .status{width:180px}
  .ib .lbl,.ib:hover .lbl,.ib:focus-visible .lbl{max-width:0;opacity:0;margin-left:0}
}
@media (max-width:520px){
  .toolbar{left:8px;right:8px;transform:none;border-radius:12px;flex-wrap:wrap;row-gap:4px}
  .status{flex-basis:100%;width:auto;order:9}
  .panel{left:8px;right:8px;width:auto;bottom:calc(var(--tb-h, 84px) + 14px + 12px);max-height:60vh;overflow:auto}
  .els{max-height:30vh}
  .pop{left:8px;right:8px;transform:none;min-width:0}
}
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
    hintMore: (n: number) => `${n}개 선택 · 더 고르거나 메모를 적으세요`,
    hintNote: '메모를 적고 Send를 누르세요', hintPick: 'Ctrl+Shift+F 또는 Select로 요소를 고르세요',
    strategyDesc: (s: RefreshStrategy) => ({ none: 'HMR이 있어 done 뒤 새로고침 없음', reload: 'done 뒤 페이지 새로고침', event: '앱이 cobro:done 이벤트로 직접 갱신' }[s]),
    selCount: (n: number) => `요소 ${n}개 선택됨`,
    selCountMixed: (n: number, m: number) => `요소 ${n}개 + 영역 ${m}개 선택됨`,
    regionRow: (w: number, h: number) => `▭ ${w}×${h}`,
    regionIn: (s: string) => ` · ${s} 안`,
    selNone: '요소 없음 · 메모만 보내도 됩니다',
    elMissing: '요소 없음', notePlaceholder: '수정 요청 메모…',
    notePlaceholderMulti: '번호로 구분해 적을 수 있어요 — 1: … 1b: … 2: …',
    groupInside: (n: number) => `${n}개 포함`, tipExpand: '펼치기 / 접기',
    tipSelect: '요소 선택 모드 (Ctrl+Shift+F)', tipClose: '닫기 (Esc)', tipDrag: '툴바 이동',
    sends: '선택자 · 스타일 · 스크린샷 · 콘솔',
    tipSend: '선택한 요소와 메모를 에이전트에 전송',
    tipRemove: '이 요소 빼기',
    cartNoNote: '메모 없음',
    doneElsewhere: (path: string) => `✓ 완료 · ${path} 보기`,
    tabHere: '이 페이지', tabQueue: '큐', herePage: '지금 보고 있는 페이지',
    queueCount: (n: number) => `${n}개`,
    footBusy: (d: number, n: number) => `처리 중 ${d}/${n} — 끝나면 담을 수 있어요`,
    footPaused: (d: number, n: number) => `처리 중 ${d}/${n} — 이 페이지를 떠나 따라가기를 멈췄어요`,
    footAllDone: (n: number) => `✓ ${n}페이지 완료 — 요소를 고르면 새 요청이 시작됩니다`,
    footHint: '메모를 적으면 보낼 수 있어요',
    tipSelectLocked: '에이전트가 수정 중 — 큐를 볼 수 있어요, 담기는 완료 후',
    followPaused: '따라가기 중지 — 완료되면 「보기」 링크로 확인',
    doneRow: (n: number) => `✓ 완료 ${n}페이지 · 새로 담으면 정리됩니다`,
    sendPages: (n: number) => `Send · ${n}페이지 →`,
    chipDraft: '초안',
    progress: (d: number, n: number) => `${d}/${n}`,
    tipSettings: '설정', theme: '테마', themeAuto: '자동', themeDark: '어둡게', themeLight: '밝게', themeFrost: '유리',
    themeLocked: 'COBRO_THEME 환경 변수로 고정됨', strategyLabel: '갱신 전략',
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
    hintNote: 'Write a note, then press Send', hintPick: 'Press Ctrl+Shift+F or Select to pick an element',
    strategyDesc: (s: RefreshStrategy) => ({ none: 'HMR present — no reload after done', reload: 'page reloads after done', event: 'the app refreshes itself on cobro:done' }[s]),
    selCount: (n: number) => `${n} element(s) selected`,
    selCountMixed: (n: number, m: number) => `${n} element(s) + ${m} region(s) selected`,
    regionRow: (w: number, h: number) => `▭ ${w}×${h}`,
    regionIn: (s: string) => ` · in ${s}`,
    selNone: 'No element · note alone is fine',
    elMissing: 'missing', notePlaceholder: 'Describe the change…',
    notePlaceholderMulti: 'Number them if they differ — 1: … 1b: … 2: …',
    groupInside: (n: number) => `${n} inside`, tipExpand: 'Expand / collapse',
    tipSelect: 'Pick mode (Ctrl+Shift+F)', tipClose: 'Close (Esc)', tipDrag: 'Move toolbar',
    sends: 'Sends selector · styles · shot · console',
    tipSend: 'Send the selected elements and note to the agent',
    tipRemove: 'Remove this element',
    cartNoNote: 'No note',
    doneElsewhere: (path: string) => `✓ Done · view ${path}`,
    tabHere: 'This page', tabQueue: 'Queue', herePage: 'The page you\'re on',
    queueCount: (n: number) => `${n} element${n === 1 ? '' : 's'}`,
    footBusy: (d: number, n: number) => `Working ${d}/${n} — you can add more once it's done`,
    footPaused: (d: number, n: number) => `Working ${d}/${n} — you left this page, so following paused`,
    footAllDone: (n: number) => `✓ ${n} page${n === 1 ? '' : 's'} done — pick an element to start a new request`,
    footHint: 'Write a note to send',
    tipSelectLocked: 'Agent is working — view the queue; picking resumes after done',
    followPaused: 'Following paused — check the "view" link when it\'s done',
    doneRow: (n: number) => `✓ ${n} done · cleared when you pick again`,
    sendPages: (n: number) => `Send · ${n} pages →`,
    chipDraft: 'Draft',
    progress: (d: number, n: number) => `${d}/${n}`,
    tipSettings: 'Settings', theme: 'Theme', themeAuto: 'Auto', themeDark: 'Dark', themeLight: 'Light', themeFrost: 'Frost',
    themeLocked: 'Pinned by COBRO_THEME', strategyLabel: 'Refresh',
  },
}[LANG];
const THEME_LABEL: Record<Theme, string> = { auto: T.themeAuto, dark: T.themeDark, light: T.themeLight, frost: T.themeFrost };
const LABELS = { working: ['수정 중', 'Editing', 'Working'], done: ['완료', 'Done'] };
const AGENT_TEXT: Record<AgentStatus, (t: string) => string> = {
  idle: () => T.agentIdle, waiting: () => T.agentWaiting, sent: () => T.agentSentDetail,
  working: (t) => stripStatusLabel(t, LABELS.working), done: (t) => stripStatusLabel(t, LABELS.done),
};
const DOT_TITLE: Record<AgentStatus, string> = { idle: T.agentIdle, waiting: T.agentWaiting, sent: T.agentSent, working: T.agentWorking, done: T.agentDone };
const CHIP_LABEL: Record<AgentStatus | 'draft', string> = { idle: T.chipIdle, waiting: T.chipWaiting, sent: T.chipSent, working: T.chipWorking, done: T.chipDone, draft: T.chipDraft };

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
  const chip = document.createElement('span'); chip.className = 'chip';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = '●';
  const chipLabel = document.createElement('span'); chipLabel.className = 'chip-label';
  chip.append(dot, chipLabel);
  const status = document.createElement('span'); status.className = 'status';
  const statusIn = document.createElement('span'); statusIn.className = 'status-in';
  status.append(statusIn);
  const gearParts = iconBtn('settings', T.tipSettings, T.tipSettings, 'gear', false);
  const gearBtn = gearParts.btn;
  const gripParts = iconBtn('drag', 'Move', T.tipDrag, 'grip', false); const grip = gripParts.btn; grip.setAttribute('aria-label', 'Move toolbar');
  toolbar.append(grip, selectBtn, chip, status, gearBtn);
  // R131: 작업 중 흐름선 — el()이 아직 선언 전(TDZ)이라 여기서는 직접 createElement한다
  const line = document.createElement('span'); line.className = 'line'; line.hidden = true;
  toolbar.append(line);
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
  const stratRow = document.createElement('div'); stratRow.className = 'pop-row strategy';
  const stratLabel = document.createElement('span'); stratLabel.className = 'pop-label'; stratLabel.textContent = T.strategyLabel;
  const stratVal = document.createElement('span'); stratVal.className = 'strategy-val';
  const stratIco = document.createElement('span'); stratIco.className = 'ico'; stratIco.innerHTML = svg('sync');
  const stratValText = document.createElement('span');
  stratVal.append(stratIco, stratValText);
  const stratSub = document.createElement('span'); stratSub.className = 'pop-sub';
  stratRow.append(stratLabel, stratVal, stratSub);
  const popNote = document.createElement('div'); popNote.className = 'pop-note'; popNote.textContent = T.themeLocked;
  pop.append(popRow, stratRow, popNote);
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
  let lastHint: string | null = null;
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
  const truncate40 = (s: string) => (s.length > 40 ? s.slice(0, 40) + '…' : s);

  function render(vm: ViewModel) {
    renderMarkers(vm); // 패널이 닫혀 있거나 draft가 비어도(= 이른 return) 마커는 매번 갱신(R103)
    updateTbH(); // 좁은 뷰포트에서 툴바가 두 줄이 되면 패널 bottom이 이 값을 따라간다(R118)
    // panel을 통째로 다시 그리므로 textarea가 분리되면서 포커스·캐럿이 날아간다(디바운스된 draft 왕복마다 발생) → 복원
    const active = root.activeElement;
    const wasTa = active instanceof HTMLTextAreaElement ? active : null;
    const sel: [number, number] | null = wasTa ? [wasTa.selectionStart, wasTa.selectionEnd] : null;
    selectBtn.classList.toggle('on', vm.selecting);
    selectBtn.classList.toggle('locked', vm.locked); // B2: 잠겨도 클릭은 된다 — 패널(큐 탭) 열기/닫기로 동작, 흐린 스타일만
    selectBtn.title = vm.locked ? T.tipSelectLocked : T.tipSelect;
    for (const btn of segButtons) { btn.classList.toggle('on', btn.dataset.theme === vm.prefs.theme); btn.disabled = vm.prefs.themeLocked; }
    popNote.hidden = !vm.prefs.themeLocked;
    const cur = vm.current;
    const hasElements = !!cur && (cur.elements.length + (cur.regions?.length ?? 0)) > 0;
    let hint: string;
    let gotoUrl: string | null = null; // R171: 다른 페이지에서 끝난 완료의 폴백 "보기" 링크
    if (!vm.connected) hint = T.disconnected;
    else if (!vm.busy && vm.pendingElsewhere) { hint = T.doneElsewhere(vm.pendingElsewhere.path); gotoUrl = vm.pendingElsewhere.url; }
    else if (vm.locked && vm.followPaused) hint = T.followPaused; // R176: 폴백 링크보다 낮은 우선순위
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
    const displayHint = hint.length > 160 ? hint.slice(0, 160) + '…' : hint; // 표시만 절단, title은 전문(R117)
    if (hint !== lastHint) {
      lastHint = hint;
      if (!statusIn.classList.contains('scroll')) {
        statusIn.classList.remove('enter');
        void statusIn.offsetWidth; // 리플로우 강제 — 연속 변경 시 애니메이션 재시작
        statusIn.classList.add('enter');
      }
    }
    if (gotoUrl) {
      statusIn.textContent = '';
      const a = document.createElement('a'); a.className = 'goto'; a.href = gotoUrl; a.textContent = displayHint;
      statusIn.append(a);
    } else {
      statusIn.textContent = displayHint;
    }
    statusIn.title = hint;
    if (hovering) { applyHoverScroll(); if (statusIn.classList.contains('scroll')) statusIn.classList.remove('enter'); }
    status.classList.toggle('off', !vm.connected);
    chip.classList.toggle('off', !vm.connected);
    dot.className = vm.connected ? 'dot ' + vm.agent.status : 'dot';
    // R169: busy면 라운드 진행 숫자(done/total)를 칩 라벨·title에 붙인다
    const round = roundOf(vm.queue);
    const roundSuffix = vm.busy ? ' ' + T.progress(round.done, round.total) : '';
    chipLabel.textContent = vm.connected ? CHIP_LABEL[vm.agent.status] + roundSuffix : T.chipOff;
    chip.title = vm.connected ? DOT_TITLE[vm.agent.status] + roundSuffix : T.disconnected;
    stratRow.hidden = !vm.strategy;
    if (vm.strategy) { stratValText.textContent = vm.strategy; stratSub.textContent = T.strategyDesc(vm.strategy); stratRow.title = T.strategyDesc(vm.strategy); }
    panel.classList.toggle('show', vm.panelOpen); // R175: 선택 모드와 분리 — 잠겨서 선택이 꺼져도 패널은 열어 둘 수 있다
    if (!vm.panelOpen) { panel.textContent = ''; textareas.clear(); return; }
    panel.textContent = '';
    // R172: 큐 카드·완료 목록 — 패널 머리(탭)의 N과 큐 탭 본문에 함께 쓴다
    const labels = { noNote: T.cartNoNote, count: T.queueCount };
    const cards = queueCards(vm.drafts, vm.batches, vm.href, vm.busy, labels);
    const doneList = lastRoundDone(vm.batches);
    const queueN = cards.length > 0 ? cards.length : doneList.length;

    const h4 = el('h4');
    const g = el('span', 'grip'); g.innerHTML = svg('drag'); g.setAttribute('aria-hidden', 'true'); h4.append(g);
    const tabs = el('div', 'tabs');
    const tabHereBtn = el('button', 'tab current' + (vm.tab === 'here' ? ' on' : ''), T.tabHere);
    tabHereBtn.onclick = () => h.onTab('here');
    const tabQueueBtn = el('button', 'tab queue' + (vm.tab === 'queue' ? ' on' : ''));
    tabQueueBtn.innerHTML = QUEUE_ICON;
    tabQueueBtn.append(document.createTextNode(T.tabQueue), el('span', 'badge', String(queueN)));
    tabQueueBtn.onclick = () => h.onTab('queue');
    tabs.append(tabHereBtn, tabQueueBtn);
    h4.append(tabs);
    const close = el('button', 'close', '✕'); close.title = T.tipClose; close.setAttribute('aria-label', 'Close'); close.onclick = () => h.onClose();
    h4.append(close);
    panel.append(h4);

    if (vm.tab === 'here') {
      if (cur) {
      const sub = el('div', 'sub');
      sub.append(el('span', 'mark', '▮'), document.createTextNode(cur.regions?.length ? T.selCountMixed(cur.elements.length, cur.regions.length) : cur.elements.length > 0 ? T.selCount(cur.elements.length) : T.selNone));
      panel.append(sub);
      const list = el('div', 'els');
      // 행 목록 = 낱개 요소(ref에 글자 없음) ∪ 영역, ref 오름차순(R127·R128). 그룹 자식은 여기 안 나오고 펼침에서만 보인다
      const looseEls = cur.elements.filter((e) => /^\d+$/.test(e.ref ?? ''));
      const rows: Array<{ ref: string; render(): void }> = [];
      looseEls.forEach((e) => {
        const idx = cur.elements.indexOf(e);
        rows.push({ ref: e.ref!, render: () => {
          const row = el('div', e.missing ? 'missing' : '');
          row.append(el('span', 'num', `${e.ref}.`));
          const comp = (e.react ?? e.vue)?.component;
          row.append(el('span', 'label', `${e.selector.split(' > ').pop()}${comp ? ' · ' + comp : ''}${e.missing ? ' · ' + T.elMissing : ''}`));
          row.append(el('span', 'kind', e.tag));
          const x = el('button', '', '✕'); x.title = T.tipRemove; x.onclick = () => h.onRemoveElement(cur.id, idx); row.append(x);
          list.append(row);
        } });
      });
      cur.regions?.forEach((r, i) => {
        rows.push({ ref: r.ref ?? '', render: () => {
          const kids = r.ref ? cur.elements.filter((e) => isChildRef(e.ref, r.ref!)) : [];
          const row = el('div', '');
          if (kids.length) { row.classList.add('group'); const chev = el('span', 'chev', vm.expanded === r.ref ? '▾' : '▸'); chev.title = T.tipExpand; row.append(chev); }
          row.append(el('span', 'num', `${r.ref ?? ''}.`));
          row.append(el('span', 'label', `${T.regionRow(r.rect.w, r.rect.h)}${r.within ? T.regionIn(r.within.split(' > ').pop()!) : ''}`));
          if (kids.length) row.append(el('span', 'cnt', T.groupInside(kids.length)));
          if (!kids.length) row.append(el('span', 'kind region', 'region')); // M5(리뷰): 자식 있는 그룹 행은 cnt 칩으로 충분, region 칩 생략
          const x = el('button', '', '✕'); x.title = T.tipRemove; x.onclick = () => h.onRemoveRegion(cur.id, i); row.append(x);
          if (kids.length) row.addEventListener('click', (ev) => { const t = ev.target as Element; if (t.closest('button') || t.closest('.num')) return; h.onToggleGroup(r.ref!); });
          list.append(row);
          if (kids.length && vm.expanded === r.ref) {
            kids.forEach((c) => {
              const cidx = cur.elements.indexOf(c);
              const crow = el('div', 'child' + (c.missing ? ' missing' : ''));
              crow.append(el('span', 'num', `${c.ref}.`));
              const ccomp = (c.react ?? c.vue)?.component;
              crow.append(el('span', 'label', `${c.selector.split(' > ').pop()}${ccomp ? ' · ' + ccomp : ''}${c.missing ? ' · ' + T.elMissing : ''}`));
              crow.append(el('span', 'kind', c.tag));
              const cx = el('button', '', '✕'); cx.title = T.tipRemove; cx.onclick = () => h.onRemoveElement(cur.id, cidx); crow.append(cx);
              list.append(crow);
            });
          }
        } });
      });
      rows.sort((a, b) => Number(a.ref) - Number(b.ref));
      rows.forEach((r) => r.render());
      panel.append(list);
      let ta = textareas.get(cur.id);
      if (!ta) { ta = document.createElement('textarea'); const id = cur.id; ta.addEventListener('input', () => h.onNoteInput(id, ta!.value)); textareas.set(id, ta); }
      ta.placeholder = (cur.elements.length + (cur.regions?.length ?? 0)) >= 2 ? T.notePlaceholderMulti : T.notePlaceholder;
      if (ta.value !== cur.note) ta.value = cur.note;
      ta.disabled = vm.locked; // R175
      panel.append(ta);
      }
    } else {
      // R172: 큐 탭 — 카드(초안·진행 묶음) + R174 완료 접힘 행(busy 아닐 때만)
      const queue = el('div', 'queue');
      for (const c of cards) {
        const a = document.createElement('a');
        a.className = `card ${c.kind}` + (c.isCurrent ? ' here' : '');
        a.href = c.url;
        a.onclick = (ev) => { ev.preventDefault(); h.onGoPage(c.url); };
        const thumb = el('div', 'thumb');
        for (let i = 0; i < Math.min(c.count, 2); i++) thumb.append(el('span', `rect ${c.kind}`));
        a.append(thumb);
        const body = el('div', 'body');
        body.append(el('div', 'title', c.title), el('div', 'path', c.path), el('div', 'meta', c.meta));
        a.append(body);
        a.append(el('span', 'chip', CHIP_LABEL[c.kind]));
        if (c.isCurrent) a.append(el('span', 'here', T.herePage));
        queue.append(a);
      }
      if (!vm.busy && doneList.length > 0) {
        const doneRow = el('button', 'done-row', `${vm.doneOpen ? '▾' : '▸'} ${T.doneRow(doneList.length)}`);
        doneRow.onclick = () => h.onToggleDone();
        queue.append(doneRow);
        if (vm.doneOpen) {
          for (const b of doneList) {
            const url = b.page?.url ?? vm.href;
            const item = el('div', 'done-item');
            item.append(el('span', 'title', b.page?.title || url), el('span', 'path', pageLoc(url, vm.href)), el('span', 'summary', '✓ ' + truncate40(b.summary ?? '')));
            queue.append(item);
          }
        }
      }
      panel.append(queue);
    }
    // R173: 메모 있는 초안이 하나도 없으면 Send 대신 상태 문장
    const readyDrafts = vm.drafts.filter((b) => b.note.trim());
    const row = el('div', 'row');
    if (readyDrafts.length > 0) {
      const send = el('button', 'send', readyDrafts.length >= 2 ? T.sendPages(readyDrafts.length) : 'Send →') as HTMLButtonElement;
      send.title = T.tipSend;
      send.onclick = () => { closePop(); h.onSend(); };
      row.append(el('span', 'sends', T.sends), send);
    } else {
      let footText: string; let footOk = false;
      if (vm.busy) footText = vm.followPaused ? T.footPaused(round.done, round.total) : T.footBusy(round.done, round.total);
      else if (doneList.length > 0) { footText = T.footAllDone(doneList.length); footOk = true; }
      else footText = T.footHint;
      row.append(el('span', `foot${footOk ? ' ok' : ''}`, footText));
    }
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
      root.querySelectorAll('.wbox').forEach((m) => m.remove());
      const place = (m: HTMLElement, left: number, top: number, width: number, height: number, n: number | string) => {
        Object.assign(m.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
        if (left < 12) m.classList.add('inside-x');
        if (top < 12) m.classList.add('inside-y');
        m.append(el('span', 'n', String(n)));
        root.append(m);
      };
      const cur = vm.current;
      if (cur) {
        cur.elements.forEach((e) => {
          if (e.missing) return;
          const isChild = /[a-z]$/.test(e.ref ?? '');
          const groupRef = isChild ? e.ref!.slice(0, -1) : null;
          if (isChild && vm.expanded !== groupRef) return; // R128: 자식 마커는 그 그룹이 펼쳐진 동안만
          let target: Element | null = null;
          try { target = document.querySelector(e.selector); } catch { /* 선택자 불량 */ }
          if (!target) return;
          const r = target.getBoundingClientRect();
          place(el('div', isChild ? 'marker child' : 'marker'), r.left - 2, r.top - 2, r.width + 4, r.height + 4, e.ref ?? '');
        });
        cur.regions?.forEach((r) => {
          place(el('div', 'marker region'), r.rect.x - scrollX, r.rect.y - scrollY, r.rect.w, r.rect.h, r.ref ?? '');
        });
      }
      // R131: 작업 중 표시 — 서버가 sent·working으로 든 배치의 요소·영역 위에 스캔 테두리
      const working = vm.busy && vm.connected;
      line.hidden = !working;
      if (working) {
        const wbox = (cls: string) => { const m = el('div', cls); const clip = el('div', 'clip'); clip.append(el('span', 'sweep')); m.append(clip); return m; };
        // R168: 현재 페이지 묶음만(page 없는 옛 묶음은 그대로 그린다) · done은 스캔 대상이 아니다
        for (const b of vm.queue) {
          if (b.status === 'done') continue;
          if (b.page && !samePage(b.page.url, vm.href)) continue;
          b.elements.forEach((e) => {
            if (e.missing) return;
            if (/[a-z]$/.test(e.ref ?? '')) return; // sent 배치에는 펼침 상태가 없다 — 접힌 상태와 동일, 자식은 그리지 않는다
            let target: Element | null = null;
            try { target = document.querySelector(e.selector); } catch { /* 선택자 불량 */ }
            if (!target) return;
            const r = target.getBoundingClientRect();
            place(wbox('wbox'), r.left - 2, r.top - 2, r.width + 4, r.height + 4, e.ref ?? '');
          });
          b.regions?.forEach((r) => {
            place(wbox('wbox region'), r.rect.x - scrollX, r.rect.y - scrollY, r.rect.w, r.rect.h, r.ref ?? '');
          });
        }
      }
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
  function updateTbH(): void { const h = toolbar.offsetHeight; if (h > 0) host.style.setProperty('--tb-h', `${h}px`); }
  return { host, root, render, renderMarkers, flash, focusNote, setTheme, closePop, updateTbH };
}
