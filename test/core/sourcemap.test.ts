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

describe('resolveOriginal — sectioned map + file: root (R151·R152)', () => {
  // sections[0]은 빈 매핑(자리만 차지), sections[1]이 offset.line=5로 실제 위치를 담는다 —
  // FlattenMap이 offset을 더해 전체를 한 TraceMap으로 합치므로, 생성 위치 line 8(=5+3)에서 조회한다
  it('① resolves a position inside the second section of a sectioned (indexed) source map', () => {
    const sectioned = {
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.js'], sourcesContent: [''], names: [], mappings: [[]] } },
        { offset: { line: 5, column: 0 }, map: { version: 3, sources: ['sectioned/b.jsx'], sourcesContent: ['b'], names: [], mappings: [[], [], [[0, 0, 0, 0]]] } },
      ],
    };
    const source = resolveOriginal(sectioned, { moduleUrl: 'http://x/app.js', line: 8, col: 1 });
    expect(source).toBe('sectioned/b.jsx:1');
  });

  const fileMap = (source: string) => ({ version: 3, sources: [source], sourcesContent: [''], names: [], mappings: [[[0, 0, 0, 0]]] });

  it('② file: with a forward-slash root under it → project-relative path', () => {
    const source = resolveOriginal(fileMap('file:///C:/x/proj/src/a.tsx'), {
      moduleUrl: 'http://x/app.js', line: 1, col: 1, root: 'C:/x/proj',
    });
    expect(source).toBe('src/a.tsx:1');
  });

  it('③ file: with a backslash root under it → project-relative path', () => {
    const source = resolveOriginal(fileMap('file:///C:/x/proj/frontend/src/app/p.tsx'), {
      moduleUrl: 'http://x/app.js', line: 1, col: 1, root: 'C:\\x\\proj',
    });
    expect(source).toBe('frontend/src/app/p.tsx:1');
  });

  it('④ file: outside root falls back to the /src/ segment', () => {
    const source = resolveOriginal(fileMap('file:///D:/other/src/b.tsx'), {
      moduleUrl: 'http://x/app.js', line: 1, col: 1, root: 'C:/x/proj',
    });
    expect(source).toBe('src/b.tsx:1');
  });

  it('⑤ POSIX file: under a POSIX root → project-relative path', () => {
    const source = resolveOriginal(fileMap('file:///home/u/proj/src/a.tsx'), {
      moduleUrl: 'http://x/app.js', line: 1, col: 1, root: '/home/u/proj',
    });
    expect(source).toBe('src/a.tsx:1');
  });

  it('⑦ Windows drive letter case is ignored when matching root (M1)', () => {
    const source = resolveOriginal(fileMap('file:///c:/x/proj/frontend/src/a.tsx'), {
      moduleUrl: 'http://x/app.js', line: 1, col: 1, root: 'C:\\x\\proj',
    });
    expect(source).toBe('frontend/src/a.tsx:1');
  });

  it('⑥ node_modules filter still applies after file: normalization', () => {
    const source = resolveOriginal(fileMap('file:///C:/x/proj/node_modules/lib/x.js'), {
      moduleUrl: 'http://x/app.js', line: 1, col: 1,
    });
    expect(source).toBeUndefined();
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
