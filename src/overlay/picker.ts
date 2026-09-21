export function createPicker(opts: { root: ShadowRoot; host: HTMLElement; onPick(el: Element): void; onBandPick(hits: Element[], band: { left: number; top: number; right: number; bottom: number }): void }) {
  const { root, host } = opts;
  const glass = document.createElement('div');
  glass.className = 'glass';
  const box = document.createElement('div'); box.className = 'hover-box';
  const badge = document.createElement('div'); badge.className = 'hover-badge';
  const band = document.createElement('div'); band.className = 'band';
  root.append(glass, box, badge, band);

  let active = false;
  let dragStart: { x: number; y: number } | null = null;
  let dragging = false;
  let suppressClick = false;
  let target: Element | null = null;

  const notOurs = (el: Element) => el !== host && !host.contains(el) && el !== document.documentElement && el !== document.body;
  const pick = (x: number, y: number): Element | null => document.elementsFromPoint(x, y).find(notOurs) ?? null;
  const rectOf = (e: MouseEvent) => ({ left: Math.min(dragStart!.x, e.clientX), top: Math.min(dragStart!.y, e.clientY), right: Math.max(dragStart!.x, e.clientX), bottom: Math.max(dragStart!.y, e.clientY) });
  const hide = () => { box.style.display = badge.style.display = 'none'; target = null; };
  const show = (el: Element, x: number, y: number, label: string) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    badge.textContent = `${label}\n${Math.round(r.width)}×${Math.round(r.height)}`;
    badge.style.display = 'block';
    const bw = badge.offsetWidth, bh = badge.offsetHeight;
    badge.style.left = Math.min(x + 14, innerWidth - bw - 8) + 'px';
    badge.style.top = (y + 18 + bh > innerHeight ? y - bh - 8 : y + 18) + 'px';
  };
  const labelOf = (el: Element) => el.id ? '#' + el.id : el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
  // R130: 밴드 안 = rect가 밴드에 완전히 포함(중심점 판정 R120은 폐기)
  const containedIn = (el: Element, b: { left: number; top: number; right: number; bottom: number }) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
  };
  const topLevel = (els: Element[]) => { const set = new Set(els); return els.filter((el) => !(el.parentElement && set.has(el.parentElement))); };
  // R126: H = 밴드 안 최상위 요소들 + 각 최상위의 안쪽 한 단계(그 최상위의 자손 중 밴드에 완전히 포함되는 것(R130)), 문서 순서로 평면화 — 총 12개 상한
  const inBand = (b: { left: number; top: number; right: number; bottom: number }): Element[] => {
    const within: Element[] = [];
    for (const el of document.body.querySelectorAll('*')) { if (notOurs(el) && containedIn(el, b)) within.push(el); }
    const top = topLevel(within);
    const hits: Element[] = [];
    for (const p of top) {
      if (hits.length >= 12) break;
      hits.push(p);
      const kids = topLevel([...p.querySelectorAll('*')].filter((el) => notOurs(el) && containedIn(el, b)));
      for (const k of kids) { if (hits.length >= 12) break; hits.push(k); }
    }
    return hits;
  };

  glass.addEventListener('mousedown', (e) => { if (e.button === 0) { dragStart = { x: e.clientX, y: e.clientY }; dragging = false; } });
  glass.addEventListener('mousemove', (e) => {
    if (dragStart && (dragging || Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 6)) {
      dragging = true; hide();
      const b = rectOf(e);
      Object.assign(band.style, { display: 'block', left: b.left + 'px', top: b.top + 'px', width: b.right - b.left + 'px', height: b.bottom - b.top + 'px' });
      e.preventDefault(); return;
    }
    const el = pick(e.clientX, e.clientY);
    if (!el) return hide();
    target = el; show(el, e.clientX, e.clientY, labelOf(el));
  });
  glass.addEventListener('mouseup', (e) => {
    if (!dragging) { dragStart = null; return; }
    e.preventDefault();
    const b = rectOf(e);
    const hits = inBand(b);
    opts.onBandPick(hits, b);
    band.style.display = 'none'; dragStart = null; dragging = false; suppressClick = true;
  });
  glass.addEventListener('click', (e) => {
    e.preventDefault();
    if (suppressClick) { suppressClick = false; return; }
    if (target) opts.onPick(target);
  });
  glass.addEventListener('mouseleave', hide);
  glass.addEventListener('wheel', (e) => { // 스크롤은 아래 컨테이너로 전달
    e.preventDefault();
    for (let cur = pick(e.clientX, e.clientY); cur && cur !== document.body; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (/(auto|scroll)/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight) { cur.scrollBy(e.deltaX, e.deltaY); return; }
    }
    window.scrollBy(e.deltaX, e.deltaY);
  }, { passive: false });

  const setActive = (on: boolean) => { active = on; suppressClick = false; glass.style.display = on ? 'block' : 'none'; if (!on) { hide(); band.style.display = 'none'; dragStart = null; dragging = false; } };
  setActive(false);
  return { setActive, isActive: () => active, destroy: () => { glass.remove(); box.remove(); badge.remove(); band.remove(); } };
}
