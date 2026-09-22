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
  let hit: ReactInfo | undefined;
  const callers: string[] = [];
  const callerFrames: Frame[] = [];
  // R147: source 위 피버의 위치는 그 위에 이름 있는 피버(=조상)가 하나 더 있어야 확정된다.
  // 확정 전까지 pending으로 들고, 조상을 못 만나고 루프가 끝나면(=마운트 지점) 버린다.
  let pending: string | Frame | undefined;
  const commit = (loc: string | Frame) => {
    if (callers.length + callerFrames.length >= 2) return;
    if (typeof loc === 'string') { if (loc !== hit!.source && !callers.includes(loc)) callers.push(loc); } // M2: caller끼리 중복 제거
    else callerFrames.push(loc);
  };
  for (let i = 0; f && i < 30; i++, f = f.return ?? null) {
    const t = f.type as { name?: string; displayName?: string } | string | undefined;
    if (t && typeof t !== 'string') {
      const name = t.displayName || t.name;
      if (name) {
        if (pending !== undefined) { commit(pending); pending = undefined; }
        const loc = userLoc(f);
        if (!hit) {
          hit = typeof loc === 'string' ? { component: name, source: loc } : loc ? { component: name, frame: loc } : undefined;
          if (hit) continue;
          fallback ??= { component: name };
          continue;
        }
        if (loc !== undefined) pending = loc;
      }
    }
  }
  if (!hit) return fallback;
  if (callers.length) hit.callers = callers;
  if (callerFrames.length) hit.callerFrames = callerFrames;
  return hit;
}

export const react: FrameworkAdapter = { key: 'react', detect: reactInfo };
