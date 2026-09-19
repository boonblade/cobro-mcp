import type { Batch, ConsoleEntry, PageInfo, Payload, RefreshStrategy } from './types.js';

export function dedupeConsole(entries: Array<{ level: ConsoleEntry['level']; text: string; at: string }>, max = 10): ConsoleEntry[] {
  const map = new Map<string, ConsoleEntry>();
  for (const e of entries) {
    const text = e.text.slice(0, 300);
    const key = e.level + '\n' + text;
    const cur = map.get(key);
    if (cur) { cur.count++; if (e.at > cur.last) cur.last = e.at; }
    else map.set(key, { level: e.level, text, count: 1, last: e.at });
  }
  return [...map.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)).slice(0, max);
}

export function buildPayload(input: { page: PageInfo; batches: Batch[]; console: ConsoleEntry[]; refreshStrategy: RefreshStrategy; now?: Date }): Payload {
  return {
    origin: 'human',
    sentAt: (input.now ?? new Date()).toISOString(),
    page: input.page,
    batches: input.batches.map((b) => ({ id: b.id, note: b.note, elements: b.elements, ...(b.screenshot ? { screenshot: b.screenshot } : {}), ...(b.regions?.length ? { regions: b.regions } : {}) })),
    console: input.console,
    refreshStrategy: input.refreshStrategy,
  };
}
