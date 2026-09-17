import { EventEmitter } from 'node:events';
import { Store, emptySession } from './store.js';
import type { Batch, DoneInfo, PageInfo, Payload, RefreshStrategy, Session, WaitResult } from './types.js';

type Waiter = { resolve: (r: WaitResult) => void };

export class SessionCore extends EventEmitter {
  private s: Session;
  private queue: Array<{ payload: Payload; browserRestarted?: boolean }> = [];
  private waiter: Waiter | null = null;

  constructor(private readonly store: Store) {
    super();
    this.s = store.load() ?? emptySession();
    // 재시작 시 'waiting'/'working'은 의미가 없다 → idle. 단, 'waiting'의 text(직전 done 요약일 수 있다)는
    // 상태의 주인이 서버이므로 재시작해도 남긴다(M1)
    if (this.s.agent.status === 'waiting') this.s.agent = { status: 'idle', text: this.s.agent.text };
    else if (this.s.agent.status === 'working') this.s.agent = { status: 'idle', text: '' };
  }
  get session(): Session { return this.s; }

  private commit(): void { this.store.save(this.s); this.emit('change', this.s); }

  setPage(page: PageInfo, detected: RefreshStrategy): void { this.s.page = page; this.s.detected = detected; this.commit(); }
  setStrategy(strategy: RefreshStrategy | null): void { this.s.strategy = strategy; this.commit(); }
  effectiveStrategy(): RefreshStrategy { return this.s.strategy ?? this.s.detected ?? 'reload'; }

  setDrafts(batches: Batch[]): void {
    const others = this.s.batches.filter((b) => b.status !== 'draft');
    this.s.batches = [...others, ...batches.map((b) => ({ ...b, status: 'draft' as const }))];
    this.commit();
  }
  markSent(batchIds: string[], page: PageInfo): Batch[] {
    const now = new Date().toISOString();
    const sent: Batch[] = [];
    for (const b of this.s.batches) {
      if (b.status === 'sent') b.status = 'unanswered';
      if (b.status === 'draft' && batchIds.includes(b.id)) { b.status = 'sent'; b.sentAt = now; sent.push(b); }
    }
    this.s.page = page; this.s.agent = { status: 'sent', text: '' };
    this.commit();
    return sent;
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
    const keep = (this.s.agent.status === 'done' || this.s.agent.status === 'waiting') ? this.s.agent.text : '';
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
  setAgentText(text: string): void { this.s.agent = { status: 'working', text }; this.commit(); }
  done(info: DoneInfo): Batch[] {
    const now = new Date().toISOString();
    const out: Batch[] = [];
    for (const b of this.s.batches) if (b.status === 'sent') { b.status = 'done'; b.doneAt = now; b.summary = info.summary; out.push(b); }
    this.s.agent = { status: 'done', text: info.summary };
    this.store.pruneShots(this.s.batches.filter((b) => b.status !== 'done').map((b) => b.id));
    this.commit();
    return out;
  }
  markResolved(batchId: string, index: number, missing: boolean): void {
    const e = this.s.batches.find((b) => b.id === batchId)?.elements[index];
    if (!e) return;
    e.missing = missing; this.commit();
  }
}
