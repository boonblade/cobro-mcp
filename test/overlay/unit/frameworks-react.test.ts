import { describe, it, expect } from 'vitest';
import { react } from '../../../src/overlay/frameworks/react.js';

type Fiber = {
  type?: unknown;
  return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
  _debugStack?: string | { stack?: string };
};

function withFiber(fiber: Fiber): Element {
  return { __reactFiber$abc: fiber } as unknown as Element;
}

describe('react adapter detect', () => {
  it('T1: project root itself sits under node_modules — host _debugSource resolves only when root is given (R157)', () => {
    function App() { /* noop */ }
    const host: Fiber = {
      type: 'div',
      _debugSource: { fileName: 'C:/mono/node_modules/@scope/app/src/App.jsx', lineNumber: 3 },
      return: { type: App, return: null },
    };
    const el = withFiber(host);
    expect(react.detect(el, 'C:/mono/node_modules/@scope/app')).toEqual({
      component: 'App', source: 'C:/mono/node_modules/@scope/app/src/App.jsx:3',
    });
    expect(react.detect(el)).toEqual({ component: 'App' }); // root 없음 → node_modules 라이브러리 취급, 폴백
  });
});
