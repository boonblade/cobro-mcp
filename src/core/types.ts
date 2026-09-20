export const THEMES = ['auto', 'dark', 'light', 'frost'] as const;
export type Theme = typeof THEMES[number];
export type RefreshStrategy = 'none' | 'reload' | 'event';
export type AgentStatus = 'idle' | 'waiting' | 'sent' | 'working' | 'done';
export type BatchStatus = 'draft' | 'sent' | 'done' | 'unanswered'; // unanswered: done 없이 다음 Send가 오면 앞 묶음이 이 상태가 된다(R79)

export interface Rect { x: number; y: number; w: number; h: number } // 페이지 좌표
// frame: React 19 _debugStack 첫 사용자 프레임, 서버가 source로 해석 후 페이로드에서 제거(R112). Vue는 채우지 않는다(행 정보 없음, R114)
export interface ComponentInfo { component: string; source?: string; frame?: { url: string; line: number; col: number } }
export interface ElementInfo {
  selector: string; tag: string; classes: string[]; text: string; rect: Rect;
  styles: Record<string, string>;
  react?: ComponentInfo;
  vue?: ComponentInfo;
  missing?: boolean; // 재주입 후 선택자로 못 찾음
}
export interface RegionInfo { rect: Rect; within?: string }
export interface Batch {
  id: string; note: string; elements: ElementInfo[]; status: BatchStatus;
  createdAt: string; sentAt?: string; doneAt?: string; screenshot?: string; summary?: string;
  regions?: RegionInfo[];
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
