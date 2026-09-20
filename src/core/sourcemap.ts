// React 19 react.source 복원(R112) — 오버레이는 _debugStack 프레임만 싣고, 서버가 소스맵으로 역변환한다
// pickUserFrame은 의존성 0인 ./frame.js에 있다(I3) — 여기서 재수출하지 않는다(overlay 번들에 trace-mapping 유입 방지)
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { Batch, ComponentInfo, ElementInfo, PageInfo } from './types.js';

const FRAMEWORK_KEYS = ['react', 'vue'] as const;

/** 모듈 텍스트 끝의 sourceMappingURL을 찾는다 — data:면 그대로, 아니면 모듈 URL 기준 절대 URL로 */
export function findSourceMapUrl(moduleText: string, moduleUrl: string): string | undefined {
  const re = /\/\/[#@]\s*sourceMappingURL=(\S+)/g;
  let m: RegExpExecArray | null;
  let last: string | undefined;
  while ((m = re.exec(moduleText))) last = m[1];
  if (!last) return undefined;
  if (last.startsWith('data:')) return last;
  try { return new URL(last, moduleUrl).href; } catch { return undefined; }
}

/** 소스맵으로 생성 위치(1-based line, 1-based col)를 원본 "<프로젝트 상대 경로>:<행>"으로 되돌린다 */
export function resolveOriginal(mapJson: unknown, opts: { moduleUrl: string; mapUrl?: string; line: number; col: number }): string | undefined {
  let tm: TraceMap;
  try { tm = new TraceMap(mapJson as ConstructorParameters<typeof TraceMap>[0], opts.mapUrl ?? opts.moduleUrl); } catch { return undefined; }
  const pos = originalPositionFor(tm, { line: opts.line, column: opts.col - 1 });
  if (!pos.source || pos.line == null) return undefined;
  let path: string;
  try { path = decodeURIComponent(new URL(pos.source).pathname); } catch { return undefined; }
  path = path.replace(/^\/+/, '').split('?')[0]!;
  if (!path || path.includes('node_modules/') || path.split('/').includes('..') || /[\x00-\x1f]/.test(path)) return undefined;
  return `${path}:${pos.line}`;
}

/** react·vue 어느 쪽 frame도 페이로드로 내보내지 않는다(R112·R65 계약 불변) — frame이 없으면 바이트 동일 */
export function stripFrame(e: ElementInfo): ElementInfo {
  let out = e;
  for (const key of FRAMEWORK_KEYS) {
    const info = out[key];
    if (!info?.frame) continue;
    const rest: ComponentInfo = { component: info.component };
    if (info.source) rest.source = info.source;
    out = { ...out, [key]: rest };
  }
  return out;
}

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** frame이 있고 source가 없는 요소마다 소스맵을 해석해 e.react.source를 채운다. 실패는 그 요소만 건너뛴다 */
export async function resolveElementSources(batch: Batch, page: PageInfo, fetchText: (url: string) => Promise<string | undefined>): Promise<void> {
  for (const e of batch.elements) {
    const frame = e.react?.frame;
    if (!frame || e.react?.source) continue;
    if (!sameOrigin(frame.url, page.url)) continue;
    try {
      const moduleText = await fetchText(frame.url);
      if (moduleText === undefined) continue;
      const mapRef = findSourceMapUrl(moduleText, frame.url);
      if (!mapRef) continue;
      let mapJson: unknown;
      let mapUrl: string | undefined;
      if (mapRef.startsWith('data:')) {
        const b64 = mapRef.split(',')[1];
        if (!b64) continue;
        mapJson = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } else {
        if (!sameOrigin(mapRef, page.url)) continue;
        const mapText = await fetchText(mapRef);
        if (mapText === undefined) continue;
        mapJson = JSON.parse(mapText);
        mapUrl = mapRef;
      }
      const source = resolveOriginal(mapJson, { moduleUrl: frame.url, mapUrl, line: frame.line, col: frame.col });
      if (source) e.react!.source = source;
    } catch (err) {
      console.error('[cobro] source map 해석 실패', (err as Error).message);
    }
  }
}
