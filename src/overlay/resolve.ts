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

// 그룹 영역: 자식이 없으면(순수 영역) 항상 그린다. 자식이 있으면 "확인 가능한 자식"(저장 text가 있는 것)이 있을 때 그 자식들로만 생존을 판정한다 —
// text가 빈 자식(col·빈 셀·아이콘)은 tag만 맞으면 옆 요소로 해석되므로 판정에 쓰지 않는다. 확인 가능한 자식이 하나도 없을 때만 tag 비교 자식으로 판정한다(R187)
export function groupAlive(kids: ElementInfo[]): boolean {
  if (kids.length === 0) return true;
  const verifiable = kids.filter((k) => k.text);
  return (verifiable.length > 0 ? verifiable : kids).some((k) => resolveEl(k) !== null);
}
