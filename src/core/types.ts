export const THEMES = ['auto', 'dark', 'light', 'frost'] as const;
export type Theme = typeof THEMES[number];
export type RefreshStrategy = 'none' | 'reload' | 'event';
export type AgentStatus = 'idle' | 'waiting' | 'sent' | 'working' | 'done';
export type BatchStatus = 'draft' | 'sent' | 'done' | 'unanswered'; // unanswered: done 없이 다음 Send가 오면 앞 묶음이 이 상태가 된다(R79)

export interface Rect { x: number; y: number; w: number; h: number } // 페이지 좌표
// frame: React 19 _debugStack 첫 사용자 프레임, 서버가 source로 해석 후 페이로드에서 제거(R112). Vue는 채우지 않는다(행 정보 없음, R114)
export type Frame = { url: string; line: number; col: number };
// callers: source 위 사용자 코드 호출 지점 ≤2, 가까운 순(R144). callerLocs는 오버레이→서버 내부 전달용 후보 배열(문자열=React ≤18 _debugSource, Frame=React 19 _debugStack, 만난 순서 그대로 한 배열) —
// 서버가 resolveElementSources에서 순서대로 해석해 callers를 새로 만든다(R158). 페이로드 제외
export interface ComponentInfo { component: string; source?: string; frame?: Frame; callers?: string[]; callerLocs?: Array<string | Frame> }
export interface ElementInfo {
  selector: string; tag: string; classes: string[]; text: string; rect: Rect;
  styles: Record<string, string>;
  react?: ComponentInfo;
  vue?: ComponentInfo;
  missing?: boolean; // 재주입 후 선택자로 못 찾음
  ref?: string; // R127: 안정 번호("2", "1a" — 그룹 "1" 안에서 추가된 순서). 옛 초안만 없음
}
export interface RegionInfo { ref?: string; rect: Rect; within?: string }
export interface Batch {
  id: string; note: string; elements: ElementInfo[]; status: BatchStatus;
  createdAt: string; sentAt?: string; doneAt?: string; screenshot?: string; summary?: string;
  regions?: RegionInfo[];
  refSeq?: number; // R127: ref 발급용 내부 카운터. 페이로드에는 안 나감(buildPayload의 Pick이 걸러줌)
}
export interface PageInfo { url: string; title: string; viewport: { w: number; h: number } }
export interface Session {
  version: 1; page: PageInfo | null; batches: Batch[];
  agent: { status: AgentStatus; text: string };
  strategy: RefreshStrategy | null;  // 설정·open 인자로 고정된 값
  detected: RefreshStrategy | null;  // 오버레이 자동 감지
}
export interface ConsoleEntry { level: 'error' | 'warning' | 'pageerror' | 'requestfailed'; text: string; count: number; last: string }
export interface Payload {
  origin: 'human'; sentAt: string; page: PageInfo;
  batches: Array<Pick<Batch, 'id' | 'note' | 'elements' | 'screenshot' | 'regions'>>;
  console: ConsoleEntry[]; refreshStrategy: RefreshStrategy;
}
export interface DoneInfo { summary: string; selectors: string[]; changedFiles: string[] }
export interface UiPrefs { theme: Theme; themeLocked: boolean }

// 오버레이 → 서버
export type OverlayMsg =
  | { type: 'hello'; token: string }
  | { type: 'page'; page: PageInfo; detected: RefreshStrategy }
  | { type: 'draft'; batches: Batch[] }            // status 'draft'인 것 전체 교체
  | { type: 'send'; batchIds: string[]; page: PageInfo }
  | { type: 'resolved'; batchId: string; index: number; missing: boolean }
  | { type: 'settings'; patch: { theme?: Theme } };
// 서버 → 오버레이
export type ServerMsg =
  | { type: 'state'; session: Session; ui: UiPrefs }
  | { type: 'done'; info: DoneInfo; strategy: RefreshStrategy }
  | { type: 'error'; message: string };

export type WaitResult = { status: 'sent'; payload: Payload; browserRestarted?: boolean } | { status: 'pending'; browserGone?: boolean };
