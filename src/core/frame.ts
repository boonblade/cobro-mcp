// React _debugStack에서 첫 사용자 프레임을 뽑는다(R112). 오버레이·서버 공유, 의존성 0
// — overlay 번들에 trace-mapping을 유입시키지 않기 위해 sourcemap.ts와 분리한다(I3)
const REACT_INTERNAL_FN = /jsxDEV|jsx-dev-runtime|react-stack-top-frame|react_stack_bottom_frame/;
// 라이브러리(compiled) 프레임도 사용자 코드가 아니다(R143)
// Turbopack은 라이브러리 청크를 `node_modules_<hash>._.js` 파일명으로 낸다(R148)
const NODE_MODULES_URL = /\/node_modules[\/_]/i;
// V8: "at fn (url:line:col)" / "at url:line:col" — WebKit·Firefox: "fn@url:line:col"
const FRAME_RE = /(?:at (?:(\S+) \()?|(\S+)@)(https?:\/\/[^\s)]+?):(\d+):(\d+)\)?/g;

/** _debugStack 문자열에서 React 내부 프레임을 건너뛴 첫 사용자 프레임(JSX 호출 지점)을 뽑는다 */
export function pickUserFrame(stack: string): { url: string; line: number; col: number } | null {
  const frames = [...stack.matchAll(FRAME_RE)]
    .map((m) => ({ fn: m[1] ?? m[2] ?? '', url: m[3]!, line: Number(m[4]), col: Number(m[5]) }));
  const frame = frames.find((f) => !REACT_INTERNAL_FN.test(f.fn) && !NODE_MODULES_URL.test(f.url));
  return frame ? { url: frame.url, line: frame.line, col: frame.col } : null;
}

/** Windows 드라이브 선행 슬래시("/C:/x" → "C:/x")를 제거하고 백슬래시를 슬래시로 바꾼다(R152). 드라이브 문자는 소문자로 맞춘다(M1) — 경로 나머지는 대소문자 유지 */
export function normalizeDrivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/?([a-zA-Z]):\//, (_, drive: string) => `${drive.toLowerCase()}:/`);
}

/** path가 root 아래·root 밖의 라이브러리(node_modules)인지 판정한다(R157) — root가 있으면 root 접두를 뗀 상대경로로,
 * 없으면 절대경로 그대로 검사해 루트 자체가 node_modules 아래(예: 모노레포 패키지) 있어도 오판하지 않는다 */
export function isLibraryPath(path: string, root?: string): boolean {
  const norm = normalizeDrivePath(path);
  let rel = norm;
  if (root) {
    const r = normalizeDrivePath(root).replace(/\/+$/, '');
    if (norm.startsWith(`${r}/`)) rel = norm.slice(r.length + 1);
  }
  return /(^|\/)node_modules\//.test(rel);
}
