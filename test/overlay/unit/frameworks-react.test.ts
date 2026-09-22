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

  it('T2: callerLocs carries Frame and string caller candidates in one array, in encounter order (R158)', () => {
    function Inner() { /* noop */ }
    function Outer() { /* noop */ }
    function Root() { /* noop */ }
    const host: Fiber = {
      type: 'button',
      _debugStack: 'at Button (http://x/src/host.jsx:2:5)',
      return: {
        type: Inner,
        _debugStack: 'at Inner (http://x/src/inner.jsx:5:3)',
        return: {
          type: Outer,
          _debugSource: { fileName: '/p/src/outer.jsx', lineNumber: 8 },
          return: { type: Root, return: null },
        },
      },
    };
    const el = withFiber(host);
    expect(react.detect(el)).toEqual({
      component: 'Inner',
      frame: { url: 'http://x/src/host.jsx', line: 2, col: 5 },
      callerLocs: [
        { url: 'http://x/src/inner.jsx', line: 5, col: 3 },
        '/p/src/outer.jsx:8',
      ],
    });
  });
});
