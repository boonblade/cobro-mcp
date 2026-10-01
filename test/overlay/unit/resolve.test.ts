import { describe, it, expect } from 'vitest';
import { resolveEl, groupAlive } from '../../../src/overlay/resolve.js';
import type { ElementInfo } from '../../../src/core/types.js';

const info = (selector: string, tag: string, text: string): ElementInfo => ({ selector, tag, classes: [], text, rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {} });

describe('resolveEl (R186)', () => {
  it('selector·tag·text가 모두 맞으면 그 요소를 돌려준다', () => {
    document.body.innerHTML = '<p><button id="b">  Save   now </button></p>';
    expect(resolveEl(info('#b', 'button', 'Save now'))).toBe(document.querySelector('#b'));
  });
  it('불량 selector → null (예외를 던지지 않는다)', () => {
    expect(resolveEl(info('[[', 'button', ''))).toBeNull();
  });
  it('selector가 아무것도 못 찾으면 null', () => {
    document.body.innerHTML = '<p></p>';
    expect(resolveEl(info('#none', 'button', ''))).toBeNull();
  });
  it('tag 불일치 → null', () => {
    document.body.innerHTML = '<div id="b">x</div>';
    expect(resolveEl(info('#b', 'button', 'x'))).toBeNull();
  });
  it('저장 text가 있는데 live text가 다르면 → null (옆 요소가 대신 잡힌 경우)', () => {
    document.body.innerHTML = '<ul><li>a</li><li>b</li></ul>';
    expect(resolveEl(info('li:nth-of-type(2)', 'li', 'a'))).toBeNull();
  });
  it('저장 text가 비어 있으면 tag만 본다', () => {
    document.body.innerHTML = '<ul><li>a</li><li>b</li></ul>';
    expect(resolveEl(info('li:nth-of-type(2)', 'li', ''))).not.toBeNull();
  });
  it('40자 넘는 text는 앞 40자로 비교한다', () => {
    document.body.innerHTML = `<p id="p">${'x'.repeat(60)}</p>`;
    expect(resolveEl(info('#p', 'p', 'x'.repeat(40)))).not.toBeNull();
  });
});

describe('groupAlive (R187)', () => {
  it('자식이 없는 순수 영역은 항상 true', () => { expect(groupAlive([])).toBe(true); });
  it('확인 가능한 자식이 하나라도 살아 있으면 true', () => {
    document.body.innerHTML = '<p id="a">A</p>';
    expect(groupAlive([info('#gone', 'p', 'G'), info('#a', 'p', 'A')])).toBe(true);
  });
  it('text 없는 자식이 옆 요소로 해석돼도 확인 가능한 자식이 전부 사라졌으면 false', () => {
    document.body.innerHTML = '<table><colgroup><col></colgroup></table>';
    const col = info('col:nth-of-type(1)', 'col', ''); // 이웃 col로 해석되는 빈 text 자식
    expect(resolveEl(col)).not.toBeNull();
    expect(groupAlive([col, info('#th', 'th', 'H9')])).toBe(false);
  });
  it('확인 가능한 자식이 하나도 없으면 tag 비교 자식으로 판정한다', () => {
    document.body.innerHTML = '<table><colgroup><col></colgroup></table>';
    expect(groupAlive([info('col:nth-of-type(1)', 'col', '')])).toBe(true);
    expect(groupAlive([info('col:nth-of-type(2)', 'col', '')])).toBe(false);
  });
});
