// 원본 대조: 요소의 윤곽선이 원본(투시 교정본)의 실제 선 위에 얼마나 놓이는지 재고,
// 지어낸 요소는 버리고, 조금 어긋난 요소는 원본 선에 붙인다.
import { P, screenBox } from './iso';
import type { El } from './schema';

export type Field = { w: number; h: number; d: Uint8Array };   // 가장 가까운 잉크까지의 거리(1/3px 단위, 최대 255)

const cache = new WeakMap<HTMLImageElement, Field>();

/** 원본의 어두운 선(잉크)까지의 거리 지도 */
export function edgeField(img: HTMLImageElement): Field {
  const hit = cache.get(img);
  if (hit) return hit;
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  const d = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const y = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    d[i] = y < 150 ? 0 : 255;
  }
  // 3-4 체임퍼 거리 변환(앞→뒤, 뒤→앞)
  const at = (x: number, y: number) => y * w + x;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = d[at(x, y)];
    if (v === 0) continue;
    if (x > 0) v = Math.min(v, d[at(x - 1, y)] + 3);
    if (y > 0) {
      v = Math.min(v, d[at(x, y - 1)] + 3);
      if (x > 0) v = Math.min(v, d[at(x - 1, y - 1)] + 4);
      if (x < w - 1) v = Math.min(v, d[at(x + 1, y - 1)] + 4);
    }
    d[at(x, y)] = Math.min(255, v);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    let v = d[at(x, y)];
    if (v === 0) continue;
    if (x < w - 1) v = Math.min(v, d[at(x + 1, y)] + 3);
    if (y < h - 1) {
      v = Math.min(v, d[at(x, y + 1)] + 3);
      if (x < w - 1) v = Math.min(v, d[at(x + 1, y + 1)] + 4);
      if (x > 0) v = Math.min(v, d[at(x - 1, y + 1)] + 4);
    }
    d[at(x, y)] = Math.min(255, v);
  }
  const f = { w, h, d };
  cache.set(img, f);
  return f;
}

type V3 = [number, number, number];
const BOXY = new Set(['wall', 'table', 'shelf', 'box', 'counter', 'sofa', 'armchair', 'planter', 'slab', 'cabinet', 'bed', 'bathtub']);
const FLAT = new Set(['glass', 'rail', 'door', 'panel', 'window']);

/** 요소의 주요 윤곽(3D 선분들). 맞춤 대상이 아니면 null */
function outline(e: El): [V3, V3][] | null {
  const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
  if (BOXY.has(e.kind)) {
    const z0 = e.kind === 'slab' ? e.z - (e.h || 18) : e.z;
    const z1 = e.kind === 'slab' ? e.z : e.z + (e.h || 30);
    if (a1 - a0 < 2 && b1 - b0 < 2) return null;
    const T = (a: number, b: number): V3 => [a, b, z1], B = (a: number, b: number): V3 => [a, b, z0];
    return [
      [T(a0, b0), T(a1, b0)], [T(a1, b0), T(a1, b1)], [T(a1, b1), T(a0, b1)], [T(a0, b1), T(a0, b0)],
      [B(a0, b0), T(a0, b0)], [B(a1, b0), T(a1, b0)], [B(a1, b1), T(a1, b1)],
      [B(a0, b0), B(a1, b0)], [B(a1, b0), B(a1, b1)],
    ];
  }
  if (FLAT.has(e.kind)) {
    const h = e.h || 100;
    const p0: V3 = [e.a0, e.b0, e.z], p1: V3 = [e.a1, e.b1, e.z];
    const q0: V3 = [e.a0, e.b0, e.z + h], q1: V3 = [e.a1, e.b1, e.z + h];
    return [[p0, p1], [q0, q1], [p0, q0], [p1, q1]];
  }
  if (e.kind === 'floor' && e.points.length >= 3)
    return e.points.map((q, i) => { const r = e.points[(i + 1) % e.points.length]; return [[q.a, q.b, q.z], [r.a, r.b, r.z]] as [V3, V3]; });
  if (e.kind === 'prism' && e.points.length >= 3)
    return e.points.map((q, i) => { const r = e.points[(i + 1) % e.points.length]; return [[q.a, q.b, q.z + e.z + (e.h || 30)], [r.a, r.b, r.z + e.z + (e.h || 30)]] as [V3, V3]; });
  return null;
}

/** 윤곽선 표본 중 원본 선 위(2.5px 이내)에 놓인 비율. 표본이 너무 적거나 화면 밖이면 null */
export function support(e: El, f: Field, da = 0, db = 0): number | null {
  const segs = outline(e);
  if (!segs) return null;
  let hit = 0, n = 0;
  for (const [p, q] of segs) {
    const [x0, y0] = P(p[0] + da, p[1] + db, p[2]), [x1, y1] = P(q[0] + da, q[1] + db, q[2]);
    const L = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.floor(L / 4));
    for (let i = 0; i <= k; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / k), y = Math.round(y0 + ((y1 - y0) * i) / k);
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      n++;
      if (f.d[y * f.w + x] <= 7) hit++;
    }
  }
  return n < 12 ? null : hit / n;
}

const shift = (e: El, da: number, db: number): El => ({
  ...e, a0: e.a0 + da, a1: e.a1 + da, b0: e.b0 + db, b1: e.b1 + db,
  points: e.points.map((q) => ({ ...q, a: q.a + da, b: q.b + db })),
});

/** 상하좌우 ±16 범위에서 원본 선에 가장 잘 맞는 자리로 옮긴다(확실히 나아질 때만) */
export function snap(e: El, f: Field): { el: El; moved: boolean; score: number | null } {
  const s0 = support(e, f);
  if (s0 === null) return { el: e, moved: false, score: null };
  let best = { s: s0, da: 0, db: 0 };
  for (let da = -16; da <= 16; da += 4) for (let db = -16; db <= 16; db += 4) {
    if (!da && !db) continue;
    const s = support(e, f, da, db)!;
    if (s > best.s) best = { s, da, db };
  }
  if (best.s - s0 > 0.1 && best.s > 0.4) return { el: shift(e, best.da, best.db), moved: true, score: best.s };
  return { el: e, moved: false, score: s0 };
}

const minSupport = (e: El) => (e.kind === 'slab' || e.kind === 'floor' ? 0.06 : 0.12);

/** 초안 정리: 붙이고, 원본에 근거가 거의 없는 요소는 버린다 */
export function fitDraft(els: El[], f: Field) {
  let moved = 0, dropped = 0;
  const out: El[] = [];
  for (const e of els) {
    const r = snap(e, f);
    if (r.moved) moved++;
    if (r.score !== null && r.score < minSupport(e)) { dropped++; continue; }
    out.push(r.el);
  }
  return { els: out, moved, dropped };
}

/** 보정 수정 하나를 받아들일지: 원본과의 일치가 나빠지면 거절 */
export function acceptEdit(oldE: El, newE: El, f: Field): boolean {
  const s0 = support(oldE, f), s1 = support(newE, f);
  if (s0 === null || s1 === null) return true;
  return s1 >= s0 - 0.03;
}
/** 추가: 원본 선에 충분히 걸칠 때만 */
export const acceptAdd = (e: El, f: Field) => { const s = support(e, f); return s === null || s >= 0.25; };
/** 삭제: 원본과 잘 맞는 요소는 지우지 않는다 */
export const acceptDel = (e: El, f: Field) => { const s = support(e, f); return s === null || s < 0.3; };

// ---------------------------------------------------------------- 공간 규칙
const SUPPORTS = new Set(['table', 'counter', 'shelf', 'box', 'planter', 'roundTable', 'sofa', 'armchair', 'cabinet', 'bed']);
const FURNITURE = new Set(['table', 'chair', 'taskChair', 'stool', 'sofa', 'armchair', 'roundTable', 'shelf', 'monitor', 'laptop', 'plant', 'planter', 'box', 'counter', 'prism', 'lathe', 'cabinet', 'bed', 'toilet', 'bathtub']);
const ON_TOP_ONLY = new Set(['monitor', 'laptop']);
/** 종류별 상식적인 최대 크기(발자국 한 변, 높이) */
const MAX: Record<string, [number, number]> = {
  chair: [55, 130], taskChair: [60, 130], stool: [45, 110], plant: [90, 220], lathe: [70, 260], monitor: [90, 70], laptop: [55, 30], armchair: [110, 110],
};
type Rect = [number, number, number, number];
const rectOf = (e: El): Rect => {
  if (e.kind === 'lathe') { const r = Math.max(8, ...e.points.map((q) => Math.abs(q.a))); return [e.a0 - r, e.a0 + r, e.b0 - r, e.b0 + r]; }
  let a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
  if (e.points.length) { a0 = Math.min(...e.points.map((q) => q.a)); a1 = Math.max(...e.points.map((q) => q.a)); b0 = Math.min(...e.points.map((q) => q.b)); b1 = Math.max(...e.points.map((q) => q.b)); }
  if (a1 - a0 < 1 && b1 - b0 < 1) { a0 -= 12; a1 += 12; b0 -= 12; b1 += 12; }
  return [a0, a1, b0, b1];
};
const centerOfEl = (e: El): [number, number] => { const [a0, a1, b0, b1] = rectOf(e); return [(a0 + a1) / 2, (b0 + b1) / 2]; };
const inRect = ([a, b]: [number, number], r: Rect, m = 0) => a >= r[0] - m && a <= r[1] + m && b >= r[2] - m && b <= r[3] + m;
function inPoly([a, b]: [number, number], pts: { a: number; b: number }[]) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i], pj = pts[j];
    if ((pi.b > b) !== (pj.b > b) && a < ((pj.a - pi.a) * (b - pi.b)) / (pj.b - pi.b) + pi.a) c = !c;
  }
  return c;
}
const topOf = (s: El) => s.z + (s.kind === 'bed' ? 42 : s.h || ({ table: 74, counter: 90, roundTable: 72, sofa: 40, armchair: 32, box: 30, planter: 40, shelf: 200, cabinet: 80 } as Record<string, number>)[s.kind] || 0);
const moveEl = (e: El, da: number, db: number): El => ({ ...e, a0: e.a0 + da, a1: e.a1 + da, b0: e.b0 + db, b1: e.b1 + db, points: e.kind === 'lathe' ? e.points : e.points.map((q) => ({ ...q, a: q.a + da, b: q.b + db })) });

export function groundScene(input: El[], field?: Field) {
  let lifted = 0, dropped2floor = 0, pushed = 0, removed = 0, resized = 0;
  const floors = input.filter((e) => e.kind === 'slab' || (e.kind === 'floor' && e.points.length >= 3));
  // 바닥판이 없으면 벽들이 둘러싼 범위를 건물로 본다
  const wallR = input.filter((e) => e.kind === 'wall' || e.kind === 'glass').map(rectOf);
  const hull: Rect | null = wallR.length >= 2 ? [Math.min(...wallR.map((r) => r[0])), Math.max(...wallR.map((r) => r[1])), Math.min(...wallR.map((r) => r[2])), Math.max(...wallR.map((r) => r[3]))] : null;
  const onFloor = (c: [number, number], m = 25) => (!floors.length ? !hull || inRect(c, hull, m) : false) || floors.some((f) => (f.kind === 'slab' ? inRect(c, rectOf(f), m) : inPoly(c, f.points) || inRect(c, rectOf(f), Math.min(m, 10))));
  const walls = input.filter((e) => e.kind === 'wall').map(rectOf);
  const supports = input.filter((e) => SUPPORTS.has(e.kind));
  const out: El[] = [];
  for (let e of input) {
    if (!FURNITURE.has(e.kind)) { out.push(e); continue; }
    // 비정상 크기
    const lim = MAX[e.kind];
    if (lim) {
      const [a0, a1, b0, b1] = rectOf(e), size = Math.max(a1 - a0, b1 - b0);
      if (e.kind === 'lathe') {
        const rmax = Math.max(...e.points.map((q) => Math.abs(q.a)), 1), hmax = Math.max(...e.points.map((q) => q.z), 1);
        const k = Math.min(1, lim[0] / 2 / rmax, lim[1] / hmax);
        if (k < 1) { e = { ...e, points: e.points.map((q) => ({ ...q, a: q.a * k, z: q.z * k })) }; resized++; }
      } else if (size > lim[0] && Math.abs(e.a1 - e.a0) + Math.abs(e.b1 - e.b0) > 0) {
        const k = lim[0] / size, ca = (e.a0 + e.a1) / 2, cb = (e.b0 + e.b1) / 2;
        e = { ...e, a0: ca + (e.a0 - ca) * k, a1: ca + (e.a1 - ca) * k, b0: cb + (e.b0 - cb) * k, b1: cb + (e.b1 - cb) * k };
        resized++;
      }
      if (e.h > lim[1]) { e = { ...e, h: lim[1] }; resized++; }
    }
    const c = centerOfEl(e);
    // 건물(바닥) 밖, 또는 그 자리에 원본이 아무것도 그려져 있지 않음(지어낸 물건)
    if (!onFloor(c) || (field && inkCover(e, field) < 0.05)) { removed++; continue; }
    // 높이: 받침 위 또는 바닥
    const under = supports.filter((s) => s !== e && inRect(c, rectOf(s), 4) && topOf(s) <= e.z + 25).sort((x, y) => topOf(y) - topOf(x))[0];
    if (e.z > 3 || ON_TOP_ONLY.has(e.kind)) {
      if (under && Math.abs(topOf(under) - e.z) > 0.5) { e = { ...e, z: topOf(under) }; lifted++; }
      else if (!under) {
        if (ON_TOP_ONLY.has(e.kind)) { removed++; continue; }
        e = { ...e, z: 0 }; dropped2floor++;
      }
    }
    // 벽과 겹침: 덜 겹친 방향으로 밀어낸다(바닥에 놓인 것만)
    if (e.z < 3) {
      for (const w of walls) {
        const r = rectOf(e);
        const oa = Math.min(r[1], w[1]) - Math.max(r[0], w[0]), ob = Math.min(r[3], w[3]) - Math.max(r[2], w[2]);
        if (oa <= 1 || ob <= 1) continue;
        // 벽을 벗어나는 네 방향 중, 바닥 위에 남는 가장 짧은 이동
        const moves: [number, number][] = [[w[1] - r[0] + 1, 0], [w[0] - r[1] - 1, 0], [0, w[3] - r[2] + 1], [0, w[2] - r[3] - 1]];
        moves.sort((x, y) => Math.abs(x[0]) + Math.abs(x[1]) - Math.abs(y[0]) - Math.abs(y[1]));
        const ok = moves.find(([da, db]) => onFloor(centerOfEl(moveEl(e, da, db)), -5));
        if (ok) { e = moveEl(e, ok[0], ok[1]); pushed++; }
      }
    }
    out.push(e);
  }
  return { els: out, lifted, dropped2floor, pushed, removed, resized };
}

/** 요소의 화면 범위 안에서 원본 선 근처(2.5px)에 있는 표본의 비율 */
export function inkCover(e: El, f: Field): number {
  const [x0, y0, x1, y1] = screenBox(e, 2);
  let n = 0, hit = 0;
  const sx = Math.max(2, (x1 - x0) / 14), sy = Math.max(2, (y1 - y0) / 14);
  for (let y = Math.max(0, y0); y < Math.min(f.h, y1); y += sy) for (let x = Math.max(0, x0); x < Math.min(f.w, x1); x += sx) {
    n++; if (f.d[Math.floor(y) * f.w + Math.floor(x)] <= 7) hit++;
  }
  return n ? hit / n : 1;
}

// ---------------------------------------------------------------- 구조 정리(건축 도면 규칙)
// 같은 선 위 벽·유리·창·문은 한 줄로, 벽 끝은 만나는 벽에 붙여 모서리를 닫고, 높이는 통일,
// 바닥판 가장자리는 벽선에, 벽 가까운 큰 가구는 벽에 밀착.
type Lin = { e: El; axis: 'a' | 'b'; off: number; lo: number; hi: number; t: number; box: boolean };
const LINEAR = new Set(['wall', 'glass', 'rail', 'door', 'window', 'panel']);
const HUG = new Set(['cabinet', 'shelf', 'counter', 'bed', 'sofa', 'toilet', 'bathtub', 'planter']);

export function regularizeStructure(input: El[]) {
  const els = input.map((e) => ({ ...e, points: e.points.map((q) => ({ ...q })) }));
  const lins: Lin[] = [];
  for (const e of els) {
    if (!LINEAR.has(e.kind)) continue;
    if (e.kind === 'wall') {
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
      if (a1 - a0 >= b1 - b0) lins.push({ e, axis: 'a', off: (b0 + b1) / 2, lo: a0, hi: a1, t: Math.max(4, b1 - b0), box: true });
      else lins.push({ e, axis: 'b', off: (a0 + a1) / 2, lo: b0, hi: b1, t: Math.max(4, a1 - a0), box: true });
    } else {
      const alongA = Math.abs(e.a1 - e.a0) >= Math.abs(e.b1 - e.b0);
      if (alongA) lins.push({ e, axis: 'a', off: (e.b0 + e.b1) / 2, lo: Math.min(e.a0, e.a1), hi: Math.max(e.a0, e.a1), t: 0, box: false });
      else lins.push({ e, axis: 'b', off: (e.a0 + e.a1) / 2, lo: Math.min(e.b0, e.b1), hi: Math.max(e.b0, e.b1), t: 0, box: false });
    }
  }
  // 1) 같은 선 정렬: 축별로 오프셋이 8 안쪽이면 길이 가중 평균으로
  for (const ax of ['a', 'b'] as const) {
    const L = lins.filter((l) => l.axis === ax).sort((x, y) => x.off - y.off);
    let grp: Lin[] = [];
    const flush = () => {
      if (grp.length > 1) {
        const wsum = grp.reduce((t, l) => t + (l.hi - l.lo), 0) || 1;
        const off = grp.reduce((t, l) => t + l.off * (l.hi - l.lo), 0) / wsum;
        for (const l of grp) l.off = off;
      }
      grp = [];
    };
    for (const l of L) { if (grp.length && l.off - grp[grp.length - 1].off > 8) flush(); grp.push(l); }
    flush();
  }
  // 2) 끝 맞춤: 끝에서 14 안에 수직 방향 벽선이 지나가면 그 벽까지 늘이거나 줄인다(모서리 닫기)
  const walls = lins.filter((l) => l.box);
  for (const l of lins) {
    for (const end of ['lo', 'hi'] as const) {
      let best: { d: number; v: number } | null = null;
      for (const o of walls) {
        if (o === l || o.axis === l.axis) continue;
        if (l.off < o.lo - 14 || l.off > o.hi + 14) continue;      // 그 벽이 이 선을 실제로 가로지를 때만
        const target = end === 'lo' ? o.off - o.t / 2 : o.off + o.t / 2;
        const d = Math.abs(l[end] - o.off);
        if (d < 14 && (!best || d < best.d)) best = { d, v: l.box ? target : o.off };
      }
      if (best && (end === 'lo' ? best.v < l.hi - 5 : best.v > l.lo + 5)) l[end] = best.v;
    }
  }
  // 3) 높이 통일: 벽은 벽끼리, 유리는 유리끼리 중앙값에 가까우면 맞춘다
  for (const kind of ['wall', 'glass']) {
    const hs = lins.filter((l) => l.e.kind === kind && l.e.h > 0).map((l) => l.e.h).sort((x, y) => x - y);
    if (hs.length < 2) continue;
    const med = hs[hs.length >> 1];
    for (const l of lins) if (l.e.kind === kind && l.e.h > med * 0.75 && l.e.h < med * 1.33) l.e.h = med;
  }
  // 되돌려 쓰기
  for (const l of lins) {
    const e = l.e;
    if (l.box) {
      if (l.axis === 'a') { e.a0 = l.lo; e.a1 = l.hi; e.b0 = l.off - l.t / 2; e.b1 = l.off + l.t / 2; }
      else { e.b0 = l.lo; e.b1 = l.hi; e.a0 = l.off - l.t / 2; e.a1 = l.off + l.t / 2; }
    } else {
      const fwd = l.axis === 'a' ? e.a1 >= e.a0 : e.b1 >= e.b0;
      if (l.axis === 'a') { e.b0 = e.b1 = l.off; [e.a0, e.a1] = fwd ? [l.lo, l.hi] : [l.hi, l.lo]; }
      else { e.a0 = e.a1 = l.off; [e.b0, e.b1] = fwd ? [l.lo, l.hi] : [l.hi, l.lo]; }
    }
  }
  // 4) 바닥판 가장자리를 가까운 벽 바깥면에 맞춘다
  const faceA = walls.filter((w) => w.axis === 'a').flatMap((w) => [w.off - w.t / 2, w.off + w.t / 2]);   // b 값들
  const faceB = walls.filter((w) => w.axis === 'b').flatMap((w) => [w.off - w.t / 2, w.off + w.t / 2]);   // a 값들
  const near = (v: number, arr: number[], tol: number) => { let best = v, bd = tol; for (const x of arr) { const d = Math.abs(x - v); if (d < bd) { bd = d; best = x; } } return best; };
  for (const e of els) {
    if (e.kind !== 'slab') continue;
    const a0 = near(Math.min(e.a0, e.a1), faceB, 12), a1 = near(Math.max(e.a0, e.a1), faceB, 12);
    const b0 = near(Math.min(e.b0, e.b1), faceA, 12), b1 = near(Math.max(e.b0, e.b1), faceA, 12);
    if (a1 - a0 > 10 && b1 - b0 > 10) Object.assign(e, { a0, a1, b0, b1 });
  }
  // 5) 벽 가까운 큰 가구는 벽면에 밀착
  for (const e of els) {
    if (!HUG.has(e.kind)) continue;
    const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
    let da = 0, db = 0, bd = 14;
    for (const w of walls) {
      if (w.axis === 'a' && Math.min(a1, w.hi) - Math.max(a0, w.lo) > 5) {          // 벽이 B 방향으로 막고 있음
        for (const [face, side] of [[w.off + w.t / 2, b0], [w.off - w.t / 2, b1]] as const) {
          const d = face - side;
          if (Math.abs(d) < bd) { bd = Math.abs(d); da = 0; db = d; }
        }
      }
      if (w.axis === 'b' && Math.min(b1, w.hi) - Math.max(b0, w.lo) > 5) {
        for (const [face, side] of [[w.off + w.t / 2, a0], [w.off - w.t / 2, a1]] as const) {
          const d = face - side;
          if (Math.abs(d) < bd) { bd = Math.abs(d); db = 0; da = d; }
        }
      }
    }
    if (da || db) Object.assign(e, { a0: e.a0 + da, a1: e.a1 + da, b0: e.b0 + db, b1: e.b1 + db, points: e.points.map((q) => ({ ...q, a: q.a + da, b: q.b + db })) });
  }
  return els;
}
