import { describe, it, expect } from 'vitest';
import { normalizeVueSource, vue } from '../../../src/overlay/frameworks/vue.js';

describe('normalizeVueSource', () => {
  it('normalizes an absolute SFC path to a repo-relative one, drops node_modules, keeps already-relative paths', () => {
    expect(normalizeVueSource('/Users/x/proj/src/components/Cta.vue')).toBe('src/components/Cta.vue');
    expect(normalizeVueSource('src/App.vue')).toBe('src/App.vue');
    expect(normalizeVueSource('/x/node_modules/lib/A.vue')).toBeUndefined();
    expect(normalizeVueSource('C:/proj/src/A.vue')).toBe('src/A.vue');
    expect(normalizeVueSource('/home/src/proj/src/A.vue')).toBe('src/A.vue'); // 마지막 /src/ 기준(M3)
  });

  it('project root itself sits under node_modules — a file inside root is not dropped (R157)', () => {
    expect(normalizeVueSource('C:/mono/node_modules/@scope/app/src/A.vue', 'C:/mono/node_modules/@scope/app')).toBe('src/A.vue');
  });
});

describe('vue adapter detect', () => {
  function withParentComponent(chain: Array<{ name?: string; __name?: string }>) {
    document.body.innerHTML = '<div></div>';
    const el = document.querySelector('div')!;
    let head: { type: { name?: string; __name?: string }; parent: unknown } | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      head = { type: chain[i]!, parent: head };
    }
    (el as unknown as Record<string, unknown>)['__vueParentComponent'] = head;
    return el;
  }

  it('prefers type.name over type.__name when both are present', () => {
    const el = withParentComponent([{ name: 'Foo', __name: 'Bar' }]);
    expect(vue.detect(el)).toEqual({ component: 'Foo' });
  });

  it('stops at 10 levels — a name only found at depth 11 is never seen', () => {
    const chain = Array.from({ length: 10 }, () => ({})).concat([{ name: 'Deep' }]);
    const el = withParentComponent(chain);
    expect(vue.detect(el)).toBeUndefined();
  });
});
