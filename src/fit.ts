// 원본 대조: 요소의 윤곽선이 원본(투시 교정본)의 실제 선 위에 얼마나 놓이는지 재고,
// 지어낸 요소는 버리고, 조금 어긋난 요소는 원본 선에 붙인다.
import { P } from './iso';
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
const BOXY = new Set(['wall', 'table', 'shelf', 'box', 'counter', 'sofa', 'armchair', 'planter', 'slab']);
const FLAT = new Set(['glass', 'rail', 'door', 'panel']);

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
