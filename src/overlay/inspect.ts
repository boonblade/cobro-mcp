import type { ElementInfo } from '../core/types.js';
import { pickUserFrame } from '../core/frame.js';
import { uniqueSelector } from './selector.js';

export const STYLE_KEYS = ['display', 'position', 'width', 'height', 'padding', 'margin', 'gap',
  'color', 'background-color', 'font-size', 'font-weight', 'border-radius'] as const;

type Fiber = {
  type?: unknown; return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
  _debugStack?: string | { stack?: string };
};

function reactInfo(el: Element): ElementInfo['react'] | undefined {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) return undefined;
  let f = (el as unknown as Record<string, Fiber | undefined>)[key] ?? null;
  for (let i = 0; f && i < 30; i++, f = f.return ?? null) {
    const t = f.type as { name?: string; displayName?: string } | string | undefined;
    if (t && typeof t !== 'string') {
      const name = t.displayName || t.name;
      if (name) {
        const src = f._debugSource;
        if (src?.fileName) return { component: name, source: `${src.fileName}${src.lineNumber ? ':' + src.lineNumber : ''}` };
        const stack = typeof f._debugStack === 'string' ? f._debugStack : f._debugStack?.stack;
        const frame = stack ? pickUserFrame(stack) : null;
        return frame ? { component: name, frame } : { component: name };
      }
    }
  }
  return undefined;
}

export function inspectElement(el: Element): ElementInfo {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const styles: Record<string, string> = {};
  // display는 값이 none이어도 남긴다 — "안 보인다"는 핵심 디버깅 단서다. 나머지 키만 none/normal을 버린다
  for (const k of STYLE_KEYS) { const v = cs.getPropertyValue(k); if (v && (k === 'display' || (v !== 'none' && v !== 'normal'))) styles[k] = v; }
  const info: ElementInfo = {
    selector: uniqueSelector(el), tag: el.tagName.toLowerCase(), classes: [...el.classList],
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    styles,
  };
  const react = reactInfo(el);
  if (react) info.react = react;
  return info;
}
