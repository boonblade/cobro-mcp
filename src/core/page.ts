// R163: 페이지 비교는 origin+pathname+search만(hash 무시). URL 파싱 실패 시 문자열 비교로 되돌아간다
export function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a); const ub = new URL(b);
    return ua.origin + ua.pathname + ua.search === ub.origin + ub.pathname + ub.search;
  } catch { return a === b; }
}
