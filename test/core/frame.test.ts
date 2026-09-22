import { describe, it, expect } from 'vitest';
import { isLibraryPath, pickUserFrame } from '../../src/core/frame.js';

describe('pickUserFrame', () => {
  it('picks the first user frame after esbuild jsxDEV/react_stack_bottom_frame', () => {
    const stack = 'at exports.jsxDEV (http://127.0.0.1:4190/app.js:23788:33)\n'
      + 'at App (http://127.0.0.1:4190/app.js:23835:61)\n'
      + 'at Object.react_stack_bottom_frame (…)';
    expect(pickUserFrame(stack)).toEqual({ url: 'http://127.0.0.1:4190/app.js', line: 23835, col: 61 });
  });

  it('picks the first user frame after Vite jsx-dev-runtime deps frame', () => {
    const stack = 'at exports.jsxDEV (http://localhost:4191/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=a490e72c:244:31)\n'
      + 'at App (http://localhost:4191/src/main.jsx:11:21)';
    expect(pickUserFrame(stack)).toEqual({ url: 'http://localhost:4191/src/main.jsx', line: 11, col: 21 });
  });

  it('picks the first user frame in the WebKit/Firefox "fn@url:line:col" format', () => {
    const stack = 'jsxDEV@http://localhost:4191/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=a:244:31\n'
      + 'App@http://localhost:4191/src/main.jsx:11:21';
    expect(pickUserFrame(stack)).toEqual({ url: 'http://localhost:4191/src/main.jsx', line: 11, col: 21 });
  });

  it('returns null when there is no user frame', () => {
    expect(pickUserFrame('at Object.react_stack_bottom_frame (…)')).toBeNull();
  });

  it('skips a compiled library frame under node_modules and keeps going to the user frame', () => {
    const libOnly = 'at Button (http://localhost:4191/node_modules/fake-ui/index.js:4:40)';
    expect(pickUserFrame(libOnly)).toBeNull();

    const withUserFrame = libOnly + '\n' + 'at App (http://localhost:4191/src/App.jsx:6:10)';
    expect(pickUserFrame(withUserFrame)).toEqual({ url: 'http://localhost:4191/src/App.jsx', line: 6, col: 10 });
  });

  it('skips a Turbopack node_modules_ chunk filename and keeps going to the user chunk (R148)', () => {
    const libOnly = 'at LoginPage (http://localhost:3001/_next/static/chunks/node_modules_next_dist_compiled_abc._.js:10:5)';
    expect(pickUserFrame(libOnly)).toBeNull();

    const withUserFrame = libOnly + '\n' + 'at Page (http://localhost:3001/_next/static/chunks/src_0.rza82._.js:506:20)';
    expect(pickUserFrame(withUserFrame)).toEqual({ url: 'http://localhost:3001/_next/static/chunks/src_0.rza82._.js', line: 506, col: 20 });
  });
});

describe('isLibraryPath (R157)', () => {
  it('(a) project root itself sits under node_modules — a file inside root is not a library', () => {
    expect(isLibraryPath('C:\\mono\\node_modules\\@scope\\app\\src\\App.jsx', 'c:/mono/node_modules/@scope/app')).toBe(false);
  });

  it('(b) a node_modules segment above the given root is a library', () => {
    expect(isLibraryPath('C:\\mono\\node_modules\\@scope\\app\\src\\App.jsx', 'C:/mono')).toBe(true);
  });

  it('(c) without a root, any node_modules segment is a library', () => {
    expect(isLibraryPath('C:\\mono\\node_modules\\@scope\\app\\src\\App.jsx', undefined)).toBe(true);
  });

  it('(d) a path under root with no node_modules segment is not a library', () => {
    expect(isLibraryPath('/home/u/proj/src/vendor/x.js', '/home/u/proj')).toBe(false);
  });

  it('(e) a node_modules segment inside root (nested package) is a library', () => {
    expect(isLibraryPath('/home/u/proj/packages/a/node_modules/lib/x.js', '/home/u/proj')).toBe(true);
  });

  it('(f) relative path with node_modules segment, no root, is a library', () => {
    expect(isLibraryPath('node_modules/fake-ui/index.js', undefined)).toBe(true);
  });

  it('(g) relative path without node_modules segment is not a library', () => {
    expect(isLibraryPath('src/main.jsx', undefined)).toBe(false);
  });
});
