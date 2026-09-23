import type { Batch } from '../core/types.js';
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
  const minSentAt = Math.min(...active.map((b) => Date.parse(b.sentAt ?? '') || 0));
  const done = batches.filter((b) => b.status === 'done' && b.doneAt && Date.parse(b.doneAt) >= minSentAt);
  return [...active, ...done];
}

// now는 시그니처 자리만 — 라운드 판정은 sentAt/doneAt만으로 결정되고 현재 시각에 의존하지 않는다
export function roundOf(batches: Batch[], _now: number = Date.now()): { queue: number; done: number; total: number } {
  const round = roundBatches(batches);
  const done = round.filter((b) => b.status === 'done').length;
  return { queue: round.length - done, done, total: round.length };
}

// R167: 같은 origin이면 pathname(+search)만, 다른 origin이면 host를 붙인다. title이 있으면 앞에 " · "로 붙이고,
// 없으면 위치만(중복 방지 — "path · path"를 만들지 않는다)
export function pageLabel(page: { url: string; title: string } | undefined, href: string): string {
  if (!page) return '';
  let u: URL; let cur: URL;
  try { u = new URL(page.url); cur = new URL(href); } catch { return page.title || page.url; }
  const loc = u.origin === cur.origin ? u.pathname + u.search : u.host + u.pathname + u.search;
  return page.title ? `${page.title} · ${loc}` : loc;
}

export interface CartItem {
  kind: 'other' | 'sent' | 'working' | 'done';
  page: string; note: string;
  elementCount?: number; // kind 'other'만
  summary?: string; // kind 'done'만
}

// R167: ①다른 페이지 초안(담은 순) → ②진행 묶음(sentAt 순). 현재 페이지 초안(page 없음 포함)은 제외
export function cartItems(drafts: Batch[], batches: Batch[], href: string): CartItem[] {
  const others: CartItem[] = drafts
    .filter((b) => b.page && !samePage(b.page.url, href))
    .map((b) => ({ kind: 'other', page: pageLabel(b.page, href), note: b.note, elementCount: b.elements.length + (b.regions?.length ?? 0) }));
  const progress: CartItem[] = roundBatches(batches)
    .slice()
    .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
    .map((b) => ({ kind: b.status as 'sent' | 'working' | 'done', page: pageLabel(b.page, href), note: b.note, ...(b.status === 'done' ? { summary: b.summary } : {}) }));
  return [...others, ...progress];
}
