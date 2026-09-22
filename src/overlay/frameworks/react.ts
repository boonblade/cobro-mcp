import { pickUserFrame } from '../../core/frame.js';
import type { Frame } from '../../core/types.js';
import type { FrameworkAdapter } from './types.js';

type Fiber = {
  type?: unknown; return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
  _debugStack?: string | { stack?: string };
};

type ReactInfo = { component: string; source?: string; frame?: Frame; callers?: string[]; callerFrames?: Frame[] };

/** f의 사용자 코드 위치(_debugSource 우선, 없으면 _debugStack). node_modules·못 찾으면 undefined */
function userLoc(f: Fiber): string | Frame | undefined {
  const src = f._debugSource;
  const fileName = src?.fileName?.replace(/\\/g, '/');
  if (fileName && !fileName.includes('node_modules/')) return `${src!.fileName}${src!.lineNumber ? ':' + src!.lineNumber : ''}`;
  const stack = typeof f._debugStack === 'string' ? f._debugStack : f._debugStack?.stack;
  return stack ? (pickUserFrame(stack) ?? undefined) : undefined;
}

function reactInfo(el: Element): ReactInfo | undefined {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) return undefined;
  let f = (el as unknown as Record<string, Fiber | undefined>)[key] ?? null;
  let fallback: { component: string } | undefined;
  // R149: source는 요소 자신의 첫 사용자 코드 위치 — 호스트 피버(문자열 type)도 대상.
  let loc: string | Frame | undefined;
  // ⑦: component = loc을 낸 피버가 이름 있으면 그 이름, 아니면 그 위 첫 이름 있는 피버의 이름.
  let component: string | undefined;
  const callers: string[] = [];
  const callerFrames: Frame[] = [];
  // R147: source 위 피버의 위치는 그 위에 이름 있는 피버(=조상)가 하나 더 있어야 확정된다.
  // 확정 전까지 pending으로 들고, 조상을 못 만나고 루프가 끝나면(=마운트 지점) 버린다.
  let pending: string | Frame | undefined;
  const commit = (p: string | Frame) => {
    if (callers.length + callerFrames.length >= 2) return;
    if (typeof p === 'string') { if (p !== loc && !callers.includes(p)) callers.push(p); } // M2: caller끼리 중복 제거
    else callerFrames.push(p);
  };
  // R153: loc과 component 사이에 위치를 못 찾은 호스트(라이브러리 내부)가 있으면 세운다.
  let libBelow = false;
  for (let i = 0; f && i < 30; i++, f = f.return ?? null) {
    const t = f.type as { name?: string; displayName?: string } | string | undefined;
    const name = t && typeof t !== 'string' ? t.displayName || t.name : undefined;
    if (loc === undefined) {
      const l = userLoc(f);
      if (l !== undefined) { loc = l; component = name; continue; }
      if (name) fallback ??= { component: name };
      continue;
    }
    if (!name) { // R150: hit 위 이름 없는 호스트는 callers 대상 아님
      if ((f._debugSource !== undefined || f._debugStack !== undefined) && userLoc(f) === undefined) libBelow = true;
      continue;
    }
    if (component === undefined) {
      // R153: libBelow 상태에서 자기 위치도 node_modules면 라이브러리 내부 레이어 — component로 쓰지 않는다
      if (libBelow && userLoc(f) === undefined) continue;
      component = name;
      const l = userLoc(f);
      if (l !== undefined) pending = l;
      continue;
    }
    if (pending !== undefined) { commit(pending); pending = undefined; }
    const l = userLoc(f);
    if (l !== undefined) pending = l;
  }
  if (loc === undefined) return fallback;
  if (!component) return fallback; // M2: 이름 있는 피버를 끝까지 못 만나면 fallback으로(이전 계약과 동등)
  const hit: ReactInfo = typeof loc === 'string' ? { component, source: loc } : { component, frame: loc };
  if (callers.length) hit.callers = callers;
  if (callerFrames.length) hit.callerFrames = callerFrames;
  return hit;
}

export const react: FrameworkAdapter = { key: 'react', detect: reactInfo };
