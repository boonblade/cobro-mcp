// R127/I1(2026-09-21 리뷰): 그룹 자식 판정은 정확히 "그룹ref + 문자 1개"여야 한다.
// startsWith+length 비교는 그룹 "1"과 낱개 "10"을 혼동한다(10~19가 전부 "1"의 자식으로 보임).
export const isChildRef = (ref: string | undefined, g: string): boolean => !!ref && new RegExp('^' + g + '[a-l]$').test(ref);
