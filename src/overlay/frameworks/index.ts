import { react } from './react.js';
import { vue } from './vue.js';
import type { ComponentInfo, FrameworkAdapter } from './types.js';

export const adapters: FrameworkAdapter[] = [react, vue];

export function detectComponent(el: Element): { key: FrameworkAdapter['key']; info: ComponentInfo } | undefined {
  for (const adapter of adapters) {
    const info = adapter.detect(el);
    if (info) return { key: adapter.key, info };
  }
  return undefined;
}
