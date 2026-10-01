import { isLibraryPath } from '../../core/frame.js';
import type { ComponentInfo, FrameworkAdapter } from './types.js';

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

function fileBase(file: string): string {
  return (file.replace(/\\/g, '/').split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}

/** R189(React R149·R153의 Vue 대응판): 체인을 위로 걸어 첫 사용자 SFC(__file 있고 라이브러리 아님)를 source로 삼는다.
 * __file 없는 인스턴스(Vue 내장)는 건너뛰고, 사용자 SFC 아래의 가장 가까운 라이브러리 컴포넌트는 component 이름으로 남긴다(R153).
 * callers = 첫 사용자 SFC 위의 사용자 SFC 경로(중복 제거, 최대 2, 가까운 순). 사용자 SFC를 못 만나면 첫 이름 있는 인스턴스의 {component}만 */
function vueInfo(el: Element, root: string | undefined): ComponentInfo | undefined {
  let c = (el as unknown as Record<string, VueInstance | undefined>)['__vueParentComponent'] ?? null;
  let fallback: string | undefined;
  let libName: string | undefined;
  let hit: ComponentInfo | undefined;
  const callers: string[] = [];
  for (let i = 0; c && i < 15 && callers.length < 2; i++, c = c.parent ?? null) {
    const name = c.type?.name || c.type?.__name;
    if (name) fallback ??= name;
    const file = c.type?.__file;
    if (!file) continue;
    const source = normalizeVueSource(file, root);
    if (!source) { libName ??= name || fileBase(file); continue; }
    if (!hit) hit = { component: libName ?? (name || fileBase(file)), source };
    else if (source !== hit.source && !callers.includes(source)) callers.push(source);
  }
  if (!hit) return fallback ? { component: fallback } : undefined;
  if (callers.length) hit.callers = callers;
  return hit;
}

export const vue: FrameworkAdapter = { key: 'vue', detect: vueInfo };
