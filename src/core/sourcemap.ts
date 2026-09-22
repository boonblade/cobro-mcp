// React 19 react.source 복원(R112) — 오버레이는 _debugStack 프레임만 싣고, 서버가 소스맵으로 역변환한다
// pickUserFrame은 의존성 0인 ./frame.js에 있다(I3) — 여기서 재수출하지 않는다(overlay 번들에 trace-mapping 유입 방지)
import { FlattenMap, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { isLibraryPath, normalizeDrivePath } from './frame.js';
import type { Batch, ComponentInfo, ElementInfo, Frame, PageInfo } from './types.js';

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

/** file: 원본을 프로젝트 루트 상대경로로 줄인다(R152) — 이미 정규화된 절대경로(abs)를 받는다. root 접두 제거 → 실패 시 `/src/` 폴백 → 그것도 없으면 절대경로 그대로 */
function normalizeFileSource(path: string, root: string | undefined): string {
  if (root) {
    const r = normalizeDrivePath(root).replace(/\/+$/, '');
    if (path === r) return '';
    if (path.startsWith(`${r}/`)) return path.slice(r.length + 1);
  }
  const idx = path.indexOf('/src/');
  if (idx !== -1) return path.slice(idx + 1);
  return path;
}

/** 소스맵으로 생성 위치(1-based line, 1-based col)를 원본 "<프로젝트 상대 경로>:<행>"으로 되돌린다 */
export function resolveOriginal(mapJson: unknown, opts: { moduleUrl: string; mapUrl?: string; line: number; col: number; root?: string }): string | undefined {
  let tm: TraceMap;
  try { tm = new FlattenMap(mapJson as ConstructorParameters<typeof FlattenMap>[0], opts.mapUrl ?? opts.moduleUrl); } catch { return undefined; }
  const pos = originalPositionFor(tm, { line: opts.line, column: opts.col - 1 });
  if (!pos.source || pos.line == null) return undefined;
  let url: URL;
  try { url = new URL(pos.source); } catch { return undefined; }
  const raw = decodeURIComponent(url.pathname);
  const abs = url.protocol === 'file:' ? normalizeDrivePath(raw) : raw.replace(/^\/+/, '');
  if (isLibraryPath(abs, opts.root)) return undefined; // R157: 라이브러리 판정은 /src/ 폴백 전에, 프로젝트 루트 기준으로
  const path = (url.protocol === 'file:' ? normalizeFileSource(abs, opts.root) : abs).split('?')[0]!;
  if (!path || path.split('/').includes('..') || /[\x00-\x1f]/.test(path)) return undefined;
  return `${path}:${pos.line}`;
}

/** react·vue 어느 쪽 frame·callerLocs도 페이로드로 내보내지 않는다(R112·R65·R146 계약 불변) — 둘 다 없으면 바이트 동일 */
export function stripFrame(e: ElementInfo): ElementInfo {
  let out = e;
  for (const key of FRAMEWORK_KEYS) {
    const info = out[key];
    if (!info?.frame && !info?.callerLocs) continue;
    const rest: ComponentInfo = { component: info.component };
    if (info.source) rest.source = info.source;
    if (info.callers?.length) rest.callers = info.callers;
    out = { ...out, [key]: rest };
  }
  return out;
}

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** 프레임 하나를 소스맵으로 해석해 "<프로젝트 상대 경로>:<행>"을 돌려준다. 못 풀면 undefined(그 프레임만 건너뜀) */
async function resolveFrame(frame: Frame, page: PageInfo, fetchText: (url: string) => Promise<string | undefined>, root: string | undefined): Promise<string | undefined> {
  if (!sameOrigin(frame.url, page.url)) return undefined;
  try {
    const moduleText = await fetchText(frame.url);
    if (moduleText === undefined) return undefined;
    const mapRef = findSourceMapUrl(moduleText, frame.url);
    if (!mapRef) return undefined;
    let mapJson: unknown;
    let mapUrl: string | undefined;
    if (mapRef.startsWith('data:')) {
      const b64 = mapRef.split(',')[1];
      if (!b64) return undefined;
      mapJson = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } else {
      if (!sameOrigin(mapRef, page.url)) return undefined;
      const mapText = await fetchText(mapRef);
      if (mapText === undefined) return undefined;
      mapJson = JSON.parse(mapText);
      mapUrl = mapRef;
    }
    return resolveOriginal(mapJson, { moduleUrl: frame.url, mapUrl, line: frame.line, col: frame.col, root });
  } catch (err) {
    console.error('[cobro] source map 해석 실패', (err as Error).message);
    return undefined;
  }
}

/** frame이 있고 source가 없는 요소마다 소스맵을 해석해 e.react.source를 채우고, callerLocs를 만난 순서대로 풀어 react.callers를 새로 만든다(R146·R158) —
 * 페이지가 보낸 react.callers는 읽지 않는다(스펙 §6: 페이지에서 온 것은 데이터) */
export async function resolveElementSources(batch: Batch, page: PageInfo, fetchText: (url: string) => Promise<string | undefined>, opts?: { root?: string }): Promise<void> {
  const root = opts?.root;
  for (const e of batch.elements) {
    const react = e.react;
    if (!react) continue;
    if (react.frame && !react.source) {
      const source = await resolveFrame(react.frame, page, fetchText, root);
      if (source) react.source = source;
    }
    const callers: string[] = [];
    for (const loc of react.callerLocs ?? []) {
      if (callers.length >= 2) break;
      const s = typeof loc === 'string' ? loc : await resolveFrame(loc, page, fetchText, root);
      if (!s || s === react.source || callers.includes(s)) continue; // M2: caller끼리 중복 제거
      callers.push(s);
    }
    if (callers.length) react.callers = callers; else delete react.callers;
  }
}
