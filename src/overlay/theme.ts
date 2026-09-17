import type { Theme } from '../core/types.js';
export type ResolvedTheme = 'dark' | 'light' | 'frost';
/** auto → 페이지 색 구성. frost는 지원·접근성 조건이 안 맞으면 dark */
export function resolveTheme(pref: Theme, env: { prefersDark: boolean; backdropOk: boolean; reduceTransparency: boolean }): ResolvedTheme {
  if (pref === 'frost') return env.backdropOk && !env.reduceTransparency ? 'frost' : 'dark';
  if (pref === 'auto') return env.prefersDark ? 'dark' : 'light';
  return pref;
}
