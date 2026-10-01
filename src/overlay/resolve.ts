import type { ElementInfo } from '../core/types.js';

// 요소 text 정규화 — inspect.ts(저장)와 resolveEl(비교)이 같은 함수를 쓴다(R186)
export const normalizeText = (s: string | null): string => (s || '').trim().replace(/\s+/g, ' ').slice(0, 40);

// R186: 저장된 요소를 지금 DOM에서 다시 찾는 단일 해석기. selector가 가리키는 노드가
// 저장 당시 요소와 같은 것(tag·text)일 때만 돌려준다 — 열 삭제처럼 DOM이 바뀌어 같은 selector가
// 옆 요소를 가리키는 경우 null(= 없어짐)로 본다. text가 비어 있으면 tag까지만 본다.
export function resolveEl(e: ElementInfo): Element | null {
  let found: Element | null = null;
  try { found = document.querySelector(e.selector); } catch { /* 선택자 불량 */ }
  if (!found || found.tagName.toLowerCase() !== e.tag) return null;
  if (e.text && normalizeText(found.textContent) !== e.text) return null;
  return found;
}

// 그룹 영역: 자식이 있으면 하나 이상 찾아질 때만 그린다. 자식 없는 순수 영역은 항상 그린다
export const groupAlive = (kids: ElementInfo[]): boolean => kids.length === 0 || kids.some((k) => resolveEl(k) !== null);
