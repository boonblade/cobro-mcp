import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectStrategy, applyDone } from '../../../src/overlay/refresh.js';

afterEach(() => {
  document.head.innerHTML = '';
  for (const k of Object.keys(window)) {
    if (k.startsWith('webpackHotUpdate')) delete (window as unknown as Record<string, unknown>)[k];
  }
  delete (window as unknown as Record<string, unknown>)['TURBOPACK_CHUNK_UPDATE_LISTENERS'];
});

describe('detectStrategy', () => {
  it('none when vite client script exists', () => {
    document.head.innerHTML = '<script type="module" src="/@vite/client"></script>';
    expect(detectStrategy()).toBe('none');
  });

  it('none when webpack HMR global exists', () => {
    (window as unknown as Record<string, unknown>)['webpackHotUpdateapp'] = () => {};
    expect(detectStrategy()).toBe('none');
  });

  it('reload otherwise', () => {
    expect(detectStrategy()).toBe('reload');
  });

  it('none when Turbopack HMR global exists', () => {
    (window as unknown as Record<string, unknown>)['TURBOPACK_CHUNK_UPDATE_LISTENERS'] = [];
    expect(detectStrategy()).toBe('none');
  });

  it('none when Turbopack hmr-client script exists', () => {
    document.head.innerHTML =
      '<script src="/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_0yjw1oe._.js"></script>';
    expect(detectStrategy()).toBe('none');
  });
});

describe('applyDone', () => {
  const info = { summary: 's', selectors: ['#a'], changedFiles: ['f'] };

  it('always dispatches the done event with detail', () => {
    const seen = vi.fn();
    window.addEventListener('cobro:done', (e) => seen((e as CustomEvent).detail));
    applyDone(info, 'none', vi.fn());
    expect(seen).toHaveBeenCalledWith(info);
  });

  it('calls reload only for reload strategy', () => {
    const reload = vi.fn();
    applyDone(info, 'event', reload);
    applyDone(info, 'none', reload);
    expect(reload).not.toHaveBeenCalled();
    applyDone(info, 'reload', reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
