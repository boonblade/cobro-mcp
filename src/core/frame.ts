// React _debugStack에서 첫 사용자 프레임을 뽑는다(R112). 오버레이·서버 공유, 의존성 0
// — overlay 번들에 trace-mapping을 유입시키지 않기 위해 sourcemap.ts와 분리한다(I3)
const REACT_INTERNAL_FN = /jsxDEV|jsx-dev-runtime|react-stack-top-frame|react_stack_bottom_frame/;
const REACT_MODULE_URL = /\/node_modules\/[^)\s]*(?:react|jsx-dev-runtime)/i;
// V8: "at fn (url:line:col)" / "at url:line:col" — WebKit·Firefox: "fn@url:line:col"
const FRAME_RE = /(?:at (?:(\S+) \()?|(\S+)@)(https?:\/\/[^\s)]+?):(\d+):(\d+)\)?/g;

/** _debugStack 문자열에서 React 내부 프레임을 건너뛴 첫 사용자 프레임(JSX 호출 지점)을 뽑는다 */
export function pickUserFrame(stack: string): { url: string; line: number; col: number } | null {
  const frames = [...stack.matchAll(FRAME_RE)]
    .map((m) => ({ fn: m[1] ?? m[2] ?? '', url: m[3]!, line: Number(m[4]), col: Number(m[5]) }));
  const frame = frames.find((f) => !REACT_INTERNAL_FN.test(f.fn) && !REACT_MODULE_URL.test(f.url));
  return frame ? { url: frame.url, line: frame.line, col: frame.col } : null;
}
