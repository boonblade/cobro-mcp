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
  type VType = { name?: string; __name?: string; __file?: string };
  function withParentComponent(chain: VType[]) {
    document.body.innerHTML = '<div></div>';
    const el = document.querySelector('div')!;
    let head: { type: VType; parent: unknown } | null = null;
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

  it('stops at 15 levels — a name only found at depth 16 is never seen', () => {
    const chain = Array.from({ length: 15 }, () => ({})).concat([{ name: 'Deep' }]);
    const el = withParentComponent(chain);
    expect(vue.detect(el)).toBeUndefined();
  });

  const user = (name: string) => ({ name, __file: `/proj/src/${name}.vue` });
  const lib = (name: string) => ({ name, __file: `/proj/node_modules/ui/${name}.vue` });

  it('user SFC at the start: itself as component and source, calling SFCs as callers (R189)', () => {
    const el = withParentComponent([user('Panel'), user('Page'), user('App')]);
    expect(vue.detect(el)).toEqual({ component: 'Panel', source: 'src/Panel.vue', callers: ['src/Page.vue', 'src/App.vue'] });
  });

  it('library component below the first user SFC keeps its name as component, source is the user SFC (R189-3 = React R153)', () => {
    const el = withParentComponent([lib('ElButton'), user('Panel'), user('App')]);
    expect(vue.detect(el)).toEqual({ component: 'ElButton', source: 'src/Panel.vue', callers: ['src/App.vue'] });
  });

  it('Vue built-ins (no __file) are skipped and never become the component', () => {
    const el = withParentComponent([{ name: 'BaseTransition' }, { name: 'Transition' }, lib('ElTag'), user('Card')]);
    expect(vue.detect(el)).toEqual({ component: 'ElTag', source: 'src/Card.vue' });
    const el2 = withParentComponent([{ name: 'KeepAlive' }, user('Card')]);
    expect(vue.detect(el2)).toEqual({ component: 'Card', source: 'src/Card.vue' });
  });

  it('library components above the first user SFC are not callers; callers are deduped and capped at 2', () => {
    const el = withParentComponent([user('A'), lib('L'), user('B'), user('A'), user('C'), user('D')]);
    expect(vue.detect(el)).toEqual({ component: 'A', source: 'src/A.vue', callers: ['src/B.vue', 'src/C.vue'] });
  });

  it('unnamed user SFC falls back to the file basename', () => {
    const el = withParentComponent([{ __file: '/proj/src/views/Home.vue' }]);
    expect(vue.detect(el)).toEqual({ component: 'Home', source: 'src/views/Home.vue' });
  });

  it('no user SFC in the chain: first named instance, no source (as before)', () => {
    const el = withParentComponent([{ name: 'BaseTransition' }, lib('VCard'), lib('VCol')]);
    expect(vue.detect(el)).toEqual({ component: 'BaseTransition' });
  });
});
