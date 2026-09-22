import { describe, it, expect } from 'vitest';
import { pickUserFrame } from '../../src/core/frame.js';

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
