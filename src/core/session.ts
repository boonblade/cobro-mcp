import { EventEmitter } from 'node:events';
import { Store, emptySession } from './store.js';
import { samePage } from './page.js';
import type { Batch, DoneInfo, PageInfo, Payload, RefreshStrategy, Session, WaitResult } from './types.js';

type Waiter = { resolve: (r: WaitResult) => void };

export class SessionCore extends EventEmitter {
  private s: Session;
  private queue: Array<{ payload: Payload; browserRestarted?: boolean }> = [];
  private waiter: Waiter | null = null;
  private expectedUrl: string | null = null; // R176: navigateTo가 이동을 건 목적지 — noteArrival이 도착 판정에 쓴다(저장 안 함)

  constructor(private readonly store: Store) {
    super();
    this.s = store.load() ?? emptySession();
    // 재시작 시 'waiting'/'working'은 의미가 없다 → idle. 단, 'waiting'의 text(직전 done 요약일 수 있다)는
    // 상태의 주인이 서버이므로 재시작해도 남긴다(M1)
    if (this.s.agent.status === 'waiting') this.s.agent = { status: 'idle', text: this.s.agent.text };
    else if (this.s.agent.status === 'working') this.s.agent = { status: 'idle', text: '' };
    // R160: 재시작 시 처리 중이던 묶음은 '건드리는 중' 표시만 사라지고 sent로 되돌아간다(내용은 유지)
    for (const b of this.s.batches) if (b.status === 'working') b.status = 'sent';
    // R176: 재시작 시 따라가기 중지 상태는 의미가 없다 — 새 프로세스는 아직 아무 곳으로도 옮긴 적이 없다
    this.s.followPaused = false;
  }
  get session(): Session { return this.s; }

  private commit(): void { this.store.save(this.s); this.emit('change', this.s); }

  setPage(page: PageInfo, detected: RefreshStrategy): void { this.s.page = page; this.s.detected = detected; this.commit(); }
  setStrategy(strategy: RefreshStrategy | null): void { this.s.strategy = strategy; this.commit(); }
  effectiveStrategy(): RefreshStrategy { return this.s.strategy ?? this.s.detected ?? 'reload'; }

  setDrafts(batches: Batch[]): void {
    const others = this.s.batches.filter((b) => b.status !== 'draft');
    const prevById = new Map(this.s.batches.map((b) => [b.id, b]));
    // R129: 빈 초안은 저장하지 않는다(부채 #9)
    const kept = batches.filter((b) => b.elements.length || b.regions?.length || b.note.trim());
    // R174: 내용 있는 초안이 새로(이전엔 저장돼 있지 않던 id) 생기고 처리 중인 묶음이 없으면, 지난 라운드의 done 묶음을 치운다(샷은 그대로 — R81)
    const hasNewContent = kept.some((b) => !prevById.has(b.id));
    const activeExists = others.some((b) => b.status === 'sent' || b.status === 'working');
    const survivors = hasNewContent && !activeExists ? others.filter((b) => b.status !== 'done') : others;
    this.s.batches = [...survivors, ...kept.map((b): Batch => {
      const draft: Batch = { ...b, status: 'draft' };
      // R161: page는 서버가 찍는다 — 처음 보는 초안만 현재 s.page를 찍고, 이미 있던 초안은 기존 page를 유지(오버레이가 보낸 값은 무시)
      const prev = prevById.get(b.id);
      const page = prev ? prev.page : (this.s.page ? { url: this.s.page.url, title: this.s.page.title } : undefined);
      if (page) draft.page = page; else delete draft.page;
      return draft;
    })];
    this.commit();
  }
  markSent(batchIds: string[], page: PageInfo): Batch[] {
    const now = new Date().toISOString();
    const sent: Batch[] = [];
    for (const b of this.s.batches) {
      // R160(R79 폐기): 앞선 sent/working 묶음은 건드리지 않는다 — 장바구니는 처리 중에도 계속 담아 보낼 수 있어야 한다
      if (b.status === 'draft' && batchIds.includes(b.id)) { b.status = 'sent'; b.sentAt = now; sent.push(b); }
    }
    this.s.page = page; this.s.agent = { status: 'sent', text: '' };
    this.resetFollowIfIdle(); // R176: 처리 중인 묶음이 하나도 없으면 따라가기 중지 상태를 남기지 않는다
    this.commit();
    return sent;
  }
  // R176: expectedUrl은 저장 안 함 — navigateTo가 브라우저를 옮기기 직전에 목적지를 적어 둔다
  expectNavigation(url: string): void { this.expectedUrl = url; }
  expectedNavigation(): string | null { return this.expectedUrl; }
  /** bridge가 'page' 메시지를 받으면 setPage 전에 호출한다 — this.s.page는 아직 도착 전(옮기기 전) 페이지다(R176) */
  noteArrival(url: string): void {
    if (this.expectedUrl !== null && samePage(url, this.expectedUrl)) { this.expectedUrl = null; return; } // 따라간 도착
    const active = this.s.batches.some((b) => b.status === 'sent' || b.status === 'working');
    if (active && this.s.page && !samePage(url, this.s.page.url)) { this.s.followPaused = true; this.commit(); }
  }
  private resetFollowIfIdle(): void {
    const active = this.s.batches.some((b) => b.status === 'sent' || b.status === 'working');
    if (!active) { this.s.followPaused = false; this.expectedUrl = null; }
  }
  setScreenshot(batchId: string, path: string): void {
    const b = this.s.batches.find((x) => x.id === batchId);
    if (!b) return;
    b.screenshot = path; this.commit();
  }
  deliver(payload: Payload, extra: { browserRestarted?: boolean } = {}): void {
    const item = { payload, ...extra };
    if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve({ status: 'sent', ...item }); }
    else this.queue.push(item);
  }
  wait(timeoutMs: number, onTick?: (elapsedMs: number) => void | Promise<void>, opts: { tickMs?: number; signal?: AbortSignal } = {}): Promise<WaitResult> {
    // 두 번째 wait()가 첫 번째보다 먼저 오면(백그라운드 재호출 등) 이전 대기자를 pending으로
    // 즉시 해소하고(타이머·abort 리스너 정리 포함) 고아로 남기지 않는다. 최신 호출만 살아있다.
    if (this.waiter) { const prev = this.waiter; this.waiter = null; prev.resolve({ status: 'pending' }); }
    const queued = this.queue.shift();
    if (queued) return Promise.resolve({ status: 'sent', ...queued });
    // cancelWait는 idle을 text: ''로 두므로, idle의 text는 재시작 복구본뿐이다(R98)
    const keep = (this.s.agent.status === 'sent' || this.s.agent.status === 'working') ? '' : this.s.agent.text;
    this.s.agent = { status: 'waiting', text: keep };
    this.commit();
    const tickMs = opts.tickMs ?? 30_000;
    const started = Date.now();
    return new Promise<WaitResult>((resolve) => {
      const finish = (r: WaitResult) => { clearInterval(iv); clearTimeout(to); opts.signal?.removeEventListener('abort', onAbort); if (this.waiter?.resolve === wrapped) this.waiter = null; resolve(r); };
      const wrapped = (r: WaitResult) => finish(r);
      const onAbort = () => finish({ status: 'pending' });
      const iv = setInterval(() => { void onTick?.(Date.now() - started); }, tickMs);
      const to = setTimeout(() => finish({ status: 'pending' }), timeoutMs);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.waiter = { resolve: wrapped };
    });
  }
  /** 대기 중인 wait()가 있으면 즉시 browserGone으로 풀어주고 세션을 idle로 정리한다(close() 전용, R77) */
  cancelWait(): boolean {
    this.s.agent = { status: 'idle', text: '' };
    this.commit();
    if (!this.waiter) return false;
    const w = this.waiter; this.waiter = null;
    w.resolve({ status: 'pending', browserGone: true });
    return true;
  }
  // R125: 메모 없는 초안은 브라우저와 함께 버린다
  dropEmptyDrafts(): number {
    const before = this.s.batches.length;
    this.s.batches = this.s.batches.filter((b) => !(b.status === 'draft' && !b.note.trim()));
    if (before !== this.s.batches.length) this.commit();
    return before - this.s.batches.length;
  }
  /** 미완 묶음의 샷만 남기고 done 묶음의 샷과 manual/ 전체를 지운다(close() 전용, R81·R82) */
  closeSession(): void {
    this.dropEmptyDrafts();
    this.store.clearShots(this.s.batches.filter((b) => b.status !== 'done').map((b) => b.id));
    for (const b of this.s.batches) if (b.status === 'done') b.screenshot = undefined;
    this.s.pendingDone = []; // R163
    this.commit();
  }
  setAgentText(text: string, batchId?: string): void {
    // R162: batchId가 sent/working 묶음이면 그 묶음을 working으로. 아니면 무시(agent text만)
    if (batchId) {
      const b = this.s.batches.find((x) => x.id === batchId);
      if (b && (b.status === 'sent' || b.status === 'working')) b.status = 'working';
    }
    this.s.agent = { status: 'working', text };
    this.commit();
  }
  done(info: DoneInfo, batchId?: string): Batch[] {
    const now = new Date().toISOString();
    const out: Batch[] = [];
    // R162: batchId가 있으면 그 id 중 sent/working인 것만, 없으면 sent/working 전부
    for (const b of this.s.batches) {
      if ((b.status === 'sent' || b.status === 'working') && (!batchId || b.id === batchId)) {
        b.status = 'done'; b.doneAt = now; b.summary = info.summary; out.push(b);
      }
    }
    const remaining = this.s.batches.some((b) => b.status === 'sent' || b.status === 'working');
    this.s.agent = remaining ? { status: 'sent', text: info.summary } : { status: 'done', text: info.summary };
    if (!remaining) { this.s.followPaused = false; this.expectedUrl = null; } // R176
    this.store.pruneShots(this.s.batches.filter((b) => b.status !== 'done').map((b) => b.id));
    this.commit();
    return out;
  }
  // R163: 같은 url 항목은 교체, 최대 20개(오래된 것부터 버림)
  pushPendingDone(e: { url: string; batchIds: string[]; info: DoneInfo }): void {
    // M1: takePendingDone과 같은 기준(samePage) — hash만 다른 push가 별개 항목으로 쌓여 done이 중복 재생되는 것을 막는다
    const list = (this.s.pendingDone ?? []).filter((p) => !samePage(p.url, e.url));
    list.push(e);
    this.s.pendingDone = list.slice(-20);
    this.commit();
  }
  takePendingDone(url: string): Array<{ url: string; batchIds: string[]; info: DoneInfo }> {
    const list = this.s.pendingDone ?? [];
    const matched = list.filter((p) => samePage(p.url, url));
    if (matched.length === 0) return [];
    this.s.pendingDone = list.filter((p) => !samePage(p.url, url));
    this.commit();
    return matched;
  }
  markResolved(batchId: string, index: number, missing: boolean): void {
    const e = this.s.batches.find((b) => b.id === batchId)?.elements[index];
    if (!e) return;
    e.missing = missing; this.commit();
  }
}
