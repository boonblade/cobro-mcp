import type { Batch, Session } from '../core/types.js';
import { samePage } from '../core/page.js';

// R166: 현재 페이지 초안 — drafts 중 현재 페이지(href)와 같은 첫 초안. page 없는 옛 초안은 현재 페이지 것으로 본다
export function currentDraft(drafts: Batch[], href: string): Batch | null {
  return drafts.find((b) => !b.page || samePage(b.page.url, href)) ?? null;
}

// R169: 라운드 = sent·working 전부 + 그 라운드 안에서 끝난 done(doneAt >= sent·working 중 가장 이른 sentAt).
// sent·working이 하나도 없으면 라운드가 없다 — done만 남아 있어도 빈 배열(라운드가 끝나면 .cart에서 done이 빠지는 기준)
export function roundBatches(batches: Batch[]): Batch[] {
  const active = batches.filter((b) => b.status === 'sent' || b.status === 'working');
  if (active.length === 0) return [];
  // M4: sentAt이 없거나 파싱 실패하면 Infinity — 옛 done을 라운드로 끌어들이는 쪽(0)이 아니라 배제하는 쪽으로 안전하게 실패한다
  const parseSentAt = (b: Batch): number => { const t = Date.parse(b.sentAt ?? ''); return Number.isNaN(t) ? Infinity : t; };
  const minSentAt = Math.min(...active.map(parseSentAt));
  const done = batches.filter((b) => b.status === 'done' && b.doneAt && Date.parse(b.doneAt) >= minSentAt);
  return [...active, ...done];
}

export function roundOf(batches: Batch[]): { queue: number; done: number; total: number } {
  const round = roundBatches(batches);
  const done = round.filter((b) => b.status === 'done').length;
  return { queue: round.length - done, done, total: round.length };
}

// R171: 위치 부분만(제목 제외) — 같은 origin이면 pathname(+search)만, 다른 origin이면 host를 붙인다.
export function pageLoc(url: string, href: string): string {
  const u = new URL(url); const cur = new URL(href);
  return u.origin === cur.origin ? u.pathname + u.search : u.host + u.pathname + u.search;
}

// R171: session.pendingDone 중 현재 페이지가 아닌 첫 항목 — 폴백 "보기" 링크에 쓰인다
// M2: 깨진 URL이면 던지지 않고 null(링크를 안 보이는 쪽으로 안전하게)
export function pendingElsewhere(session: Session | null, href: string): { url: string; path: string } | null {
  const item = (session?.pendingDone ?? []).find((p) => !samePage(p.url, href));
  if (!item) return null;
  try { return { url: item.url, path: pageLoc(item.url, href) }; } catch { return null; }
}

// R172: pathname만(제목 없는 페이지용) — 깨진 url이면 그대로
function pathnameOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

export interface QueueCard {
  kind: 'draft' | 'sent' | 'working' | 'done';
  url: string; title: string; path: string; meta: string;
  isCurrent: boolean; count: number; // count = elements+regions 수(.thumb 윤곽 사각형용)
}

// R172: 큐 탭의 카드 목록 — ①내용 있는 초안(현재 페이지 포함, 담은 순) → ②진행 묶음(sentAt 순, busy 아니면 done 제외)
export function queueCards(drafts: Batch[], batches: Batch[], href: string, busy: boolean, labels: { noNote: string; count: (n: number) => string }): QueueCard[] {
  const noteMeta = (note: string): string => { const line = note.split('\n')[0] ?? ''; return line ? truncate40(line) : labels.noNote; };
  const draftCards: QueueCard[] = drafts
    .filter((b) => b.elements.length || b.regions?.length || b.note.trim())
    .map((b) => {
      const url = b.page?.url ?? href;
      const count = b.elements.length + (b.regions?.length ?? 0);
      return {
        kind: 'draft', url, title: b.page?.title || pathnameOf(url), path: pageLoc(url, href),
        meta: `${labels.count(count)} · ${noteMeta(b.note)}`, isCurrent: samePage(url, href), count,
      };
    });
  const round = roundBatches(batches);
  const progressSrc = busy ? round : round.filter((b) => b.status !== 'done');
  const progressCards: QueueCard[] = progressSrc
    .slice()
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
    .map((b) => {
      const url = b.page?.url ?? href;
      const count = b.elements.length + (b.regions?.length ?? 0);
      const meta = b.status === 'done' ? '✓ ' + truncate40(b.summary ?? '') : `${labels.count(count)} · ${noteMeta(b.note)}`;
      return { kind: b.status as 'sent' | 'working' | 'done', url, title: b.page?.title || pathnameOf(url), path: pageLoc(url, href), meta, isCurrent: samePage(url, href), count };
    });
  return [...draftCards, ...progressCards];
}

// R174: 접힌 완료 행(done-row)용 — busy 아닐 때만 의미가 있다(호출부에서 게이트)
export function lastRoundDone(batches: Batch[]): Batch[] {
  return batches.filter((b) => b.status === 'done');
}
// M40: 40자 절단 — queueCards의 meta에 쓴다(ui.ts의 기존 truncate40과 동일 규칙)
function truncate40(s: string): string { return s.length > 40 ? s.slice(0, 40) + '…' : s; }
