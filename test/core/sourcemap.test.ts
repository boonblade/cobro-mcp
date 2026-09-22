import { describe, it, expect } from 'vitest';
import { findSourceMapUrl, resolveOriginal, stripFrame, resolveElementSources } from '../../src/core/sourcemap.js';
import type { Batch, ElementInfo, PageInfo } from '../../src/core/types.js';

describe('findSourceMapUrl', () => {
  const moduleUrl = 'http://127.0.0.1:4190/app.js';

  it('resolves an external sourceMappingURL against the module URL', () => {
    const js = 'console.log(1);\n//# sourceMappingURL=app.js.map';
    expect(findSourceMapUrl(js, moduleUrl)).toBe('http://127.0.0.1:4190/app.js.map');
  });

  it('returns a data: sourceMappingURL as-is', () => {
    const js = 'console.log(1);\n//# sourceMappingURL=data:application/json;base64,eyJhIjoxfQ==';
    expect(findSourceMapUrl(js, moduleUrl)).toBe('data:application/json;base64,eyJhIjoxfQ==');
  });

  it('returns undefined when there is no sourceMappingURL', () => {
    expect(findSourceMapUrl('console.log(1);', moduleUrl)).toBeUndefined();
  });
});

describe('resolveOriginal', () => {
  // npx esbuild main.jsx --sourcemap --jsx=automatic --outfile=out.js (esbuild 0.24) — 185B 소스, 아래는 그 out.js.map
  const map = {
    version: 3,
    sources: ['main.jsx'],
    sourcesContent: ['function Cta({ label }) {\n  return <button>{label}</button>;\n}\n'],
    mappings: 'AACS;AADT,SAAS,IAAI,EAAE,MAAM,GAAG;AACtB,SAAO,oBAAC,YAAQ,iBAAM;AACxB;',
    names: [],
  };

  it('resolves a known generated position to file:line via an external .map URL', () => {
    const source = resolveOriginal(map, {
      moduleUrl: 'http://x/src/main.jsx', mapUrl: 'http://x/src/main.jsx.map', line: 3, col: 10,
    });
    expect(source).toBe('src/main.jsx:2');
  });

  it('resolves sourceRoot-less relative sources against the module URL when the map is inline', () => {
    const source = resolveOriginal(map, {
      moduleUrl: 'http://localhost:4174/src/main.jsx', line: 3, col: 10,
    });
    expect(source).toBe('src/main.jsx:2');
  });

  it('resolves a sourceRoot against the map URL, not the module URL', () => {
    const withRoot = { ...map, sourceRoot: '/src/' };
    const source = resolveOriginal(withRoot, {
      moduleUrl: 'http://x/assets/out.js', mapUrl: 'http://x/assets/out.js.map', line: 3, col: 10,
    });
    expect(source).toBe('src/main.jsx:2');
  });
});

function makeElement(react: ElementInfo['react']): ElementInfo {
  return { selector: '#x', tag: 'button', classes: [], text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, react };
}

describe('stripFrame with callers (R144·R146)', () => {
  it('drops callerFrames but keeps callers', () => {
    const e = makeElement({
      component: 'Button', source: 'src/ui/Button.jsx:2',
      frame: { url: 'http://x/src/main.jsx', line: 3, col: 10 },
      callers: ['src/react.jsx:4'],
      callerFrames: [{ url: 'http://x/src/main.jsx', line: 3, col: 10 }],
    });
    const out = stripFrame(e);
    expect(out.react).toEqual({ component: 'Button', source: 'src/ui/Button.jsx:2', callers: ['src/react.jsx:4'] });
    expect(JSON.stringify(out)).not.toContain('callerFrames');
    expect(JSON.stringify(out)).not.toContain('"frame"');
  });
});

describe('resolveElementSources with callerFrames (R146)', () => {
  const page: PageInfo = { url: 'http://x/', title: 'X', viewport: { w: 1, h: 1 } };
  const moduleText = 'console.log(1);\n//# sourceMappingURL=main.jsx.map';
  // resolveOriginal 위쪽 describe와 같은 esbuild 픽스처(재사용, 로컬 스코프라 복제)
  const map = {
    version: 3,
    sources: ['main.jsx'],
    sourcesContent: ['function Cta({ label }) {\n  return <button>{label}</button>;\n}\n'],
    mappings: 'AACS;AADT,SAAS,IAAI,EAAE,MAAM,GAAG;AACtB,SAAO,oBAAC,YAAQ,iBAAM;AACxB;',
    names: [],
  };

  it('resolves callerFrames into callers, excluding a value equal to source', async () => {
    // line 3 col 10 => src/main.jsx:2 (same as source, excluded) / line 2 col 0 => src/main.jsx:1 (kept)
    const batch: Batch = {
      id: 'b1', note: '', status: 'draft', createdAt: '',
      elements: [makeElement({
        component: 'Button', source: 'src/main.jsx:2',
        callerFrames: [
          { url: 'http://x/src/main.jsx', line: 3, col: 10 },
          { url: 'http://x/src/main.jsx', line: 2, col: 1 },
        ],
      })],
    };
    const fetchText = async (url: string) => {
      if (url === 'http://x/src/main.jsx') return moduleText;
      if (url === 'http://x/src/main.jsx.map') return JSON.stringify(map);
      return undefined;
    };
    await resolveElementSources(batch, page, fetchText);
    const react = batch.elements[0]!.react!;
    expect(react.callers).toEqual(['src/main.jsx:1']);
  });

  it('skips a callerFrame whose module fetch fails, keeping order of the other two (M3)', async () => {
    // frame 1 => src/main.jsx:1 / frame 2 => fetch 실패(건너뜀) / frame 3 => src/main.jsx:2
    const batch: Batch = {
      id: 'b2', note: '', status: 'draft', createdAt: '',
      elements: [makeElement({
        component: 'Button', source: 'src/other/place.jsx:5',
        callerFrames: [
          { url: 'http://x/src/main.jsx', line: 2, col: 1 },
          { url: 'http://x/src/other.jsx', line: 1, col: 1 },
          { url: 'http://x/src/main.jsx', line: 3, col: 10 },
        ],
      })],
    };
    const fetchText = async (url: string) => {
      if (url === 'http://x/src/main.jsx') return moduleText;
      if (url === 'http://x/src/main.jsx.map') return JSON.stringify(map);
      if (url === 'http://x/src/other.jsx') return undefined; // fetch 실패
      return undefined;
    };
    await resolveElementSources(batch, page, fetchText);
    const react = batch.elements[0]!.react!;
    expect(react.callers).toEqual(['src/main.jsx:1', 'src/main.jsx:2']);
  });
});
