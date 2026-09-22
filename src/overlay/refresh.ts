import type { DoneInfo, RefreshStrategy } from '../core/types.js';

export const DONE_EVENT = 'cobro:done';

export function detectStrategy(): 'none' | 'reload' {
  if (document.querySelector('script[src*="/@vite/client"]')) return 'none';
  if (Object.keys(window).some((k) => k.startsWith('webpackHotUpdate'))) return 'none';
  const next = (window as unknown as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__;
  if (next?.buildId === 'development') return 'none';
  if ('TURBOPACK_CHUNK_UPDATE_LISTENERS' in window) return 'none'; // Next.js dev (Turbopack)
  if (document.querySelector('script[src*="hmr-client"]')) return 'none'; // Turbopack HMR 클라이언트 청크
  return 'reload';
}

export function applyDone(info: DoneInfo, strategy: RefreshStrategy, reload: () => void = () => location.reload()): void {
  window.dispatchEvent(new CustomEvent(DONE_EVENT, { detail: info }));
  if (strategy === 'reload') reload();
}
