import { pickUserFrame } from '../../core/frame.js';
import type { FrameworkAdapter } from './types.js';

type Fiber = {
  type?: unknown; return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
  _debugStack?: string | { stack?: string };
};

function reactInfo(el: Element) {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) return undefined;
  let f = (el as unknown as Record<string, Fiber | undefined>)[key] ?? null;
  let fallback: { component: string } | undefined;
  for (let i = 0; f && i < 30; i++, f = f.return ?? null) {
    const t = f.type as { name?: string; displayName?: string } | string | undefined;
    if (t && typeof t !== 'string') {
      const name = t.displayName || t.name;
      if (name) {
        const src = f._debugSource;
        const fileName = src?.fileName?.replace(/\\/g, '/');
        if (fileName && !fileName.includes('node_modules/')) return { component: name, source: `${src!.fileName}${src!.lineNumber ? ':' + src!.lineNumber : ''}` };
        const stack = typeof f._debugStack === 'string' ? f._debugStack : f._debugStack?.stack;
        const frame = stack ? pickUserFrame(stack) : null;
        if (frame) return { component: name, frame };
        fallback ??= { component: name };
      }
    }
  }
  return fallback;
}

export const react: FrameworkAdapter = { key: 'react', detect: reactInfo };
