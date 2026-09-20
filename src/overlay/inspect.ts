import type { ElementInfo } from '../core/types.js';
import { detectComponent } from './frameworks/index.js';
import { uniqueSelector } from './selector.js';

export const STYLE_KEYS = ['display', 'position', 'width', 'height', 'padding', 'margin', 'gap',
  'color', 'background-color', 'font-size', 'font-weight', 'border-radius'] as const;

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
  const d = detectComponent(el);
  if (d) info[d.key] = d.info;
  return info;
}
