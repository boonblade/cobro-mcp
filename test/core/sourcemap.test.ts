import { describe, it, expect } from 'vitest';
import { findSourceMapUrl, resolveOriginal } from '../../src/core/sourcemap.js';

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
