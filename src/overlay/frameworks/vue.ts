import { isLibraryPath } from '../../core/frame.js';
import type { FrameworkAdapter } from './types.js';

type VueInstance = {
  type?: { name?: string; __name?: string; __file?: string };
  parent?: VueInstance | null;
};

const ABSOLUTE_RE = /^([a-zA-Z]:\/|\/)/;

/** Vite dev의 __file(절대 경로)을 리포 상대 SFC 경로로 줄인다(R114). 이미 상대 경로면 그대로 둔다 */
export function normalizeVueSource(file: string, root?: string): string | undefined {
  const norm = file.replace(/\\/g, '/');
  if (isLibraryPath(norm, root)) return undefined;
  if (!ABSOLUTE_RE.test(norm)) return norm;
  const idx = norm.lastIndexOf('/src/');
  if (idx !== -1) return norm.slice(idx + 1);
  const segs = norm.split('/').filter(Boolean);
  return segs.slice(-2).join('/');
}

function vueInfo(el: Element, root: string | undefined) {
  let c = (el as unknown as Record<string, VueInstance | undefined>)['__vueParentComponent'] ?? null;
  for (let i = 0; c && i < 10; i++, c = c.parent ?? null) {
    const name = c.type?.name || c.type?.__name;
    if (name) {
      const file = c.type?.__file;
      const source = file ? normalizeVueSource(file, root) : undefined;
      return source ? { component: name, source } : { component: name };
    }
  }
  return undefined;
}

export const vue: FrameworkAdapter = { key: 'vue', detect: vueInfo };
