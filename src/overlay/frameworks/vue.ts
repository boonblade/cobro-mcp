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

// R190-a: 인스턴스가 생기는 Vue 내장 컴포넌트의 닫힌 집합(Transition은 함수형이라 BaseTransition 인스턴스만 보인다) — 이름으로 판정
const BUILTIN = new Set(['BaseTransition', 'KeepAlive', 'TransitionGroup']);

/** R189·R190(React R149·R153의 Vue 대응판): 체인을 위로 걸어 첫 사용자 SFC(__file 있고 라이브러리 경로 아님)를 source로 삼는다.
 * 내장 3개는 건너뛰고, 그 외 이름 있는 인스턴스 중 사용자 SFC가 아닌 것(__file이 node_modules이거나 __file 자체가 없는 배포본)은 라이브러리다.
 * component = 첫 사용자 SFC 바로 아래의 라이브러리 인스턴스(가장 바깥 = 사용자 템플릿에 직접 쓴 것, R190-b), 없으면 사용자 SFC 이름.
 * callers = 첫 사용자 SFC 위의 사용자 SFC 경로(중복 제거, 최대 2, 가까운 순).
 * 사용자 SFC를 못 만나면 첫 이름 있는 비내장 인스턴스의 {component}만(없으면 첫 이름 있는 인스턴스) */
function vueInfo(el: Element, root: string | undefined): ComponentInfo | undefined {
  let c = (el as unknown as Record<string, VueInstance | undefined>)['__vueParentComponent'] ?? null;
  let fallback: string | undefined;
  let fallbackBuiltin: string | undefined;
  let libName: string | undefined;
  let hit: ComponentInfo | undefined;
  const callers: string[] = [];
  for (let i = 0; c && i < 15 && callers.length < 2; i++, c = c.parent ?? null) {
    const name = c.type?.name || c.type?.__name;
    const builtin = !!name && BUILTIN.has(name);
    if (name) { if (builtin) fallbackBuiltin ??= name; else fallback ??= name; }
    if (builtin) continue;
    const file = c.type?.__file;
    const source = file ? normalizeVueSource(file, root) : undefined;
    if (!source) {
      // 라이브러리 인스턴스 — 이름이 없으면 __file basename, 둘 다 없으면 익명이라 건너뛴다. 덮어써서 가장 바깥(사용자 SFC에 가장 가까운) 것을 남긴다
      if (!hit) { const n = name || (file ? fileBase(file) : ''); if (n) libName = n; }
      continue;
    }
    if (!hit) hit = { component: libName ?? (name || fileBase(file!)), source };
    else if (source !== hit.source && !callers.includes(source)) callers.push(source);
  }
  if (!hit) { const n = fallback ?? fallbackBuiltin; return n ? { component: n } : undefined; }
  if (callers.length) hit.callers = callers;
  return hit;
}

export const vue: FrameworkAdapter = { key: 'vue', detect: vueInfo };
