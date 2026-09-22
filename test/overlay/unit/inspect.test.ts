import { describe, it, expect } from 'vitest';
import { inspectElement, STYLE_KEYS } from '../../../src/overlay/inspect.js';

describe('inspectElement', () => {
  it('collects tag, classes, text(40), styles keys subset, rect, and react when fiber present', () => {
    document.body.innerHTML = '<button class="btn primary">' + 'x'.repeat(60) + '</button>';
    const el = document.querySelector('button')!;
    const fiber = { type: { name: 'SaveButton' }, _debugSource: { fileName: 'src/Save.tsx', lineNumber: 12 }, return: null };
    (el as unknown as Record<string, unknown>)['__reactFiber$abc'] = fiber;
    const info = inspectElement(el);
    expect(info.tag).toBe('button');
    expect(info.classes).toEqual(['btn', 'primary']);
    expect(info.text).toHaveLength(40);
    expect(Object.keys(info.styles).every((k) => (STYLE_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(info.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 }); // jsdom은 레이아웃 없음
    expect(info.react).toEqual({ component: 'SaveButton', source: 'src/Save.tsx:12' });
    expect(STYLE_KEYS).toHaveLength(12);
  });

  it('keeps display even when it is none (핵심 디버깅 단서), still drops none/normal elsewhere', () => {
    document.body.innerHTML = '<div id="hidden" style="display:none;border-radius:none;font-weight:normal"></div>';
    const styles = inspectElement(document.getElementById('hidden')!).styles;
    expect(styles.display).toBe('none');
    expect(styles['border-radius']).toBeUndefined();
    expect(styles['font-weight']).toBeUndefined();
  });

  it('walks up fibers to the nearest named component', () => {
    document.body.innerHTML = '<div></div>';
    const el = document.querySelector('div')!;
    const parent = { type: { displayName: 'Card' }, return: null };
    (el as unknown as Record<string, unknown>)['__reactFiber$z'] = { type: 'div', return: parent };
    expect(inspectElement(el).react).toEqual({ component: 'Card' });
  });

  it('collects up to 2 user-code caller fibers above the source fiber, discarding the mount-point fiber at the top (R144·R147)', () => {
    document.body.innerHTML = '<button></button>';
    const el = document.querySelector('button')!;
    const root = { type: { name: 'Root' }, _debugSource: { fileName: 'src/main.jsx', lineNumber: 5 }, return: null };
    const app = { type: { name: 'App' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 20 }, return: root };
    const appCta = { type: { name: 'Button' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 9 }, return: app };
    const button = { type: { name: 'Button' }, _debugSource: { fileName: 'src/ui/Button.jsx', lineNumber: 2 }, return: appCta };
    const buttonBase = { type: { name: 'ButtonBase' }, _debugSource: { fileName: 'node_modules/x/a.js', lineNumber: 3 }, return: button };
    (el as unknown as Record<string, unknown>)['__reactFiber$c'] = { type: 'button', return: buttonBase };
    expect(inspectElement(el).react).toEqual({
      component: 'Button', source: 'src/ui/Button.jsx:2', callers: ['src/App.jsx:9', 'src/App.jsx:20'],
    });
  });

  it('omits callers key when there is only one user-code fiber (R144)', () => {
    document.body.innerHTML = '<button></button>';
    const el = document.querySelector('button')!;
    const button = { type: { name: 'Button' }, _debugSource: { fileName: 'src/ui/Button.jsx', lineNumber: 2 }, return: null };
    const buttonBase = { type: { name: 'ButtonBase' }, _debugSource: { fileName: 'node_modules/x/a.js', lineNumber: 3 }, return: button };
    (el as unknown as Record<string, unknown>)['__reactFiber$d'] = { type: 'button', return: buttonBase };
    expect(inspectElement(el).react).toEqual({ component: 'Button', source: 'src/ui/Button.jsx:2' });
  });

  it('discards the top-most (mount-point) fiber location instead of listing it as a caller (R147)', () => {
    document.body.innerHTML = '<button></button>';
    const el = document.querySelector('button')!;
    const app = { type: { name: 'App' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 6 }, return: null };
    const cta = { type: { name: 'Cta' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 4 }, return: app };
    (el as unknown as Record<string, unknown>)['__reactFiber$e'] = { type: 'button', return: cta };
    expect(inspectElement(el).react).toEqual({ component: 'Cta', source: 'src/App.jsx:4' });
  });

  it('dedupes two ancestor fibers created on the same JSX line, keeping the higher caller (M2)', () => {
    document.body.innerHTML = '<button></button>';
    const el = document.querySelector('button')!;
    const root = { type: { name: 'Root' }, _debugSource: { fileName: 'src/main.jsx', lineNumber: 5 }, return: null };
    const app = { type: { name: 'App' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 20 }, return: root };
    const row = { type: { name: 'Row' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 9 }, return: app };
    const appCta = { type: { name: 'Button' }, _debugSource: { fileName: 'src/App.jsx', lineNumber: 9 }, return: row };
    const button = { type: { name: 'Button' }, _debugSource: { fileName: 'src/ui/Button.jsx', lineNumber: 2 }, return: appCta };
    const buttonBase = { type: { name: 'ButtonBase' }, _debugSource: { fileName: 'node_modules/x/a.js', lineNumber: 3 }, return: button };
    (el as unknown as Record<string, unknown>)['__reactFiber$f'] = { type: 'button', return: buttonBase };
    expect(inspectElement(el).react).toEqual({
      component: 'Button', source: 'src/ui/Button.jsx:2', callers: ['src/App.jsx:9', 'src/App.jsx:20'],
    });
  });
});
