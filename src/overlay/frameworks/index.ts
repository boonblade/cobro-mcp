import { react } from './react.js';
import { vue } from './vue.js';
import type { ComponentInfo, FrameworkAdapter } from './types.js';

export const adapters: FrameworkAdapter[] = [react, vue];

let projectRoot: string | undefined;
export function setProjectRoot(root: string | undefined) { projectRoot = root; }

export function detectComponent(el: Element): { key: FrameworkAdapter['key']; info: ComponentInfo } | undefined {
  for (const adapter of adapters) {
    const info = adapter.detect(el, projectRoot);
    if (info) return { key: adapter.key, info };
  }
  return undefined;
}
