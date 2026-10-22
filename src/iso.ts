// 등각 렌더 엔진. 요소 목록을 그린 순서대로(뒤→앞) SVG 문자열로 만든다.
import type { El, ColorName, Scene } from './schema';
const INK = '#2B2B2B';const ROUTE = '#12C060';

// 투영: A축(화면 오른쪽 아래)과 B축(오른쪽 위)의 화면 각도. 기본은 30° 등각. 원본 그림의 축 각도를 그대로 쓸 수 있다.
export type Proj = { a: number; b: number };    // 도: a = A축 각도(0~90, 아래로), b = B축 각도(-90~0, 위로)
export const ISO: Proj = { a: 30, b: -30 };
let uA: [number, number] = [Math.cos(Math.PI / 6), 0.5], uB: [number, number] = [Math.cos(Math.PI / 6), -0.5];
let curProj: Proj = ISO;
export function setProjection(pr: Proj = ISO) {
  curProj = pr;
  uA = [Math.cos((pr.a * Math.PI) / 180), Math.sin((pr.a * Math.PI) / 180)];
  uB = [Math.cos((pr.b * Math.PI) / 180), Math.sin((pr.b * Math.PI) / 180)];
}
export const getProjection = () => curProj;
/** 축 단위 벡터(화면) */
export const axes = () => ({ uA, uB });

export const PALETTE: Record<ColorName, string> = {
  white: '#FFFFFF', green: '#17C767', greenStrip: '#43DA8A', greenGlass: '#A9F1C8', gray: '#E6E6E6',
};

export type V3 = [number, number, number];
export const P = (a: number, b: number, z = 0): [number, number] => [a * uA[0] + b * uB[0], a * uA[1] + b * uB[1] - z];
/** 화면 이동량 → 차트 이동량 (z 고정) */
export function screenDeltaToAB(dx: number, dy: number): [number, number] {
  const det = uA[0] * uB[1] - uB[0] * uA[1];
  return [(dx * uB[1] - uB[0] * dy) / det, (uA[0] * dy - dx * uA[1]) / det];
}
export const screenToAB = (x: number, y: number, z = 0): [number, number] => screenDeltaToAB(x, y + z);
/** 바닥 위 h만큼 높은 점이 차트에서 몇 칸 옮겨 보이는지: (0,-h)를 A,B로 나타낸 값 */
export const liftShift = (h: number) => screenDeltaToAB(0, -h);
/** 둥근 물체의 화면 좌우 끝 방향(차트 단위벡터)과 앞쪽 반원의 시작 각 */
function roundDirs() {
  const ts = Math.atan2(uB[0], uA[0]);          // 화면 x가 가장 큰 방향
  const ty = Math.atan2(uB[1], uA[1]);          // 화면 y가 가장 큰(앞쪽) 방향
  return { k: [Math.cos(ts), Math.sin(ts)] as [number, number], front0: ty - Math.PI / 2 };
}
/** 수직 면의 바깥 법선(차트)이 보는 사람 쪽(화면 아래)을 향하면 보인다 */
const facesViewer = (na: number, nb: number) => na * uA[1] + nb * uB[1] > 1e-9;

const f = (v: number) => (Math.round(v * 10) / 10).toString();

class Pen {
  out: string[] = [];
  poly(pts: V3[], fill = 'none', stroke: string | null = INK, sw = 2.2, op?: number) {
    const d = 'M' + pts.map((p) => { const [x, y] = P(...p); return `${f(x)} ${f(y)}`; }).join('L') + 'Z';
    const o = op !== undefined ? ` fill-opacity="${op}"` : '';
    const st = stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ' stroke="none"';
    this.out.push(`<path d="${d}" fill="${fill}"${o}${st}/>`);
  }
  line(pts: V3[], stroke = INK, sw = 2.2, dash?: string, cap = 'round') {
    const d = 'M' + pts.map((p) => { const [x, y] = P(...p); return `${f(x)} ${f(y)}`; }).join('L');
    const da = dash ? ` stroke-dasharray="${dash}"` : '';
    this.out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="${cap}" stroke-linejoin="round"${da}/>`);
  }
  box(a0: number, a1: number, b0: number, b1: number, z0: number, h: number,
      top = '#FFFFFF', left = '#F1F1F1', right = '#E4E4E4', stroke: string | null = INK, sw = 2.2, op?: number) {
    [a0, a1] = [Math.min(a0, a1), Math.max(a0, a1)];
    [b0, b1] = [Math.min(b0, b1), Math.max(b0, b1)];
    const z1 = z0 + h;
    if (h > 0) {
      this.poly([[a0, b0, z0], [a1, b0, z0], [a1, b0, z1], [a0, b0, z1]], left, stroke, sw, op);
      this.poly([[a1, b0, z0], [a1, b1, z0], [a1, b1, z1], [a1, b0, z1]], right, stroke, sw, op);
    }
    this.poly([[a0, b0, z1], [a1, b0, z1], [a1, b1, z1], [a0, b1, z1]], top, stroke, sw, op);
  }
  ellipse(a: number, b: number, z: number, r: number, fill = '#FFFFFF', sw = 2, rb = r) {
    const pts: V3[] = [];
    for (let i = 0; i < 40; i++) { const t = (2 * Math.PI * i) / 40; pts.push([a + r * Math.cos(t), b + rb * Math.sin(t), z]); }
    this.poly(pts, fill, INK, sw);
  }
  /** 수직 원기둥(위·아래 반지름 다를 수 있음): 화분, 기둥, 휴지통 */
  cylinder(a: number, b: number, z0: number, h: number, r0: number, r1: number, fill = '#FFFFFF') {
    const { k, front0 } = roundDirs();
    const L = (r: number, z: number): V3 => [a - r * k[0], b - r * k[1], z], R = (r: number, z: number): V3 => [a + r * k[0], b + r * k[1], z];
    const arc: V3[] = [];
    for (let i = 0; i <= 20; i++) { const t = front0 + (Math.PI * i) / 20; arc.push([a + r0 * Math.cos(t), b + r0 * Math.sin(t), z0]); }
    this.poly([L(r1, z0 + h), ...arc, R(r1, z0 + h)], '#EFEFEF', INK, 1.6);
    this.ellipse(a, b, z0 + h, r1, fill, 1.6);
  }
  /** 화면 기준 원(잎 덩어리 등) */
  blob(a: number, b: number, z: number, r: number, fill: string, sw = 1.3) {
    const [x, y] = P(a, b, z);
    this.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`);
  }
  node(a: number, b: number, z: number, r = 27) {
    const [x, y] = P(a, b, z);
    this.out.push(`<g transform="translate(${f(x)} ${f(y)})"><circle r="${f(r * 1.25)}" fill="#E7FAEF"/><circle r="${f(r)}" fill="${ROUTE}"/>` +
      `<circle r="${f(r * 0.63)}" fill="#FFFFFF"/><circle r="${f(r * 0.38)}" fill="${ROUTE}"/></g>`);
  }
}

// ---------------------------------------------------------------- furniture helpers
function chair(p: Pen, a: number, b: number, z0: number, face: string, w = 26, seat = 44, back = 40, col = '#FFFFFF') {
  const hw = w / 2;
  for (const [da, db] of [[-hw + 3, -hw + 3], [hw - 3, -hw + 3], [-hw + 3, hw - 3], [hw - 3, hw - 3]])
    p.line([[a + da, b + db, z0], [a + da, b + db, z0 + seat]], INK, 1.5);
  if (col === '#FFFFFF') roundBox(p, a - hw, a + hw, b - hw, b + hw, z0 + seat - 4, 4, hw * 0.35, col);
  else p.box(a - hw, a + hw, b - hw, b + hw, z0 + seat - 4, 4, col, '#ECECEC', '#DEDEDE', INK, 1.6);
  const t = 4;
  const bb: [number, number, number, number] =
    face === '+b' ? [a - hw, a + hw, b - hw, b - hw + t] :
    face === '-b' ? [a - hw, a + hw, b + hw - t, b + hw] :
    face === '+a' ? [a - hw, a - hw + t, b - hw, b + hw] : [a + hw - t, a + hw, b - hw, b + hw];
  // 등받이: 위 가로대 + 세로 살 2개(살 사이는 비어 보이게)
  const [ba0, ba1, bb0, bb1] = bb, rail = Math.max(5, back * 0.28);
  p.box(ba0, ba1, bb0, bb1, z0 + seat + back - rail, rail, col, '#EDEDED', '#DFDFDF', INK, 1.6);
  const alongA = face === '+b' || face === '-b';
  for (const t of [0.12, 0.88]) {
    const pa = alongA ? ba0 + (ba1 - ba0) * t : (ba0 + ba1) / 2, pb = alongA ? (bb0 + bb1) / 2 : bb0 + (bb1 - bb0) * t;
    p.line([[pa, pb, z0 + seat], [pa, pb, z0 + seat + back - rail]], INK, 1.6);
  }
  if (col === '#FFFFFF') {   // 좌판 쿠션선
    const ins = hw * 0.25;
    p.poly([[a - hw + ins, b - hw + ins, z0 + seat], [a + hw - ins, b - hw + ins, z0 + seat], [a + hw - ins, b + hw - ins, z0 + seat], [a - hw + ins, b + hw - ins, z0 + seat]], 'none', '#9A9A9A', 0.9);
  }
}

function table(p: Pen, a0: number, a1: number, b0: number, b1: number, z0: number, h: number, top = 7, leg = 5, inset = 12) {
  [a0, a1] = [Math.min(a0, a1), Math.max(a0, a1)];
  [b0, b1] = [Math.min(b0, b1), Math.max(b0, b1)];
  for (const [a, b] of [[a0 + inset, b1 - inset], [a1 - inset, b1 - inset], [a0 + inset, b0 + inset], [a1 - inset, b0 + inset]])
    p.box(a - leg / 2, a + leg / 2, b - leg / 2, b + leg / 2, z0, h - top, '#D9D9D9', '#CFCFCF', '#BDBDBD', INK, 1.4);
  roundBox(p, a0, a1, b0, b1, z0 + h - top, top, Math.min(5, (a1 - a0) / 10, (b1 - b0) / 10));
}

function shelf(p: Pen, e: El) {
  const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
  const z0 = e.z, h = e.h || 200, rows = Math.max(1, e.n || 5), cols = Math.max(1, e.m || 4);
  p.box(a0, a1, b0, b1, z0, h, '#FFFFFF', '#F2F2F2', '#E4E4E4', INK, 2.0);
  const alongA = e.dir === '-b';          // 열린 면이 B0 쪽(보는 사람 쪽)
  const alongB = e.dir === '+a';          // 열린 면이 A1 쪽
  if (!alongA && !alongB) return;
  for (let i = 1; i < rows; i++) {
    const z = z0 + (h * i) / rows;
    p.line(alongA ? [[a0, b0, z], [a1, b0, z]] : [[a1, b0, z], [a1, b1, z]], INK, 1.6);
  }
  for (let j = 1; j < cols; j++) {
    if (alongA) { const a = a0 + ((a1 - a0) * j) / cols; p.line([[a, b0, z0], [a, b0, z0 + h]], INK, 1.6); }
    else { const b = b0 + ((b1 - b0) * j) / cols; p.line([[a1, b, z0], [a1, b, z0 + h]], INK, 1.6); }
  }
  for (let i = 0; i < rows; i++) {
    const zb = z0 + (h * i) / rows + 3, zt = zb + (h / rows) * 0.62;
    for (let j = 0; j < cols; j++) for (let k = 0; k < 4; k++) {
      const fr = (k + 1) / 6, zz = zt - 4 * (k % 2);
      if (alongA) { const a = a0 + ((a1 - a0) * (j + fr)) / cols; p.line([[a, b0, zb], [a, b0, zz]], '#8E8E8E', 2.4, undefined, 'butt'); }
      else { const b = b0 + ((b1 - b0) * (j + fr)) / cols; p.line([[a1, b, zb], [a1, b, zz]], '#8E8E8E', 2.4, undefined, 'butt'); }
    }
  }
}

function glass(p: Pen, e: El, tint: string, op: number, solid = false) {
  const { a0, b0, a1, b1, z } = e, h = e.h || 300;
  p.poly([[a0, b0, z], [a1, b1, z], [a1, b1, z + h], [a0, b0, z + h]], solid ? '#FFFFFF' : tint, null, 0, solid ? undefined : op);
  const n = Math.max(0, Math.round(e.n));
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1), a = a0 + (a1 - a0) * t, b = b0 + (b1 - b0) * t;
    p.line([[a, b, z], [a, b, z + h]], '#8A8A8A', 1.6);
  }
  p.line([[a0, b0, z], [a1, b1, z]], INK, 2.2);
  p.line([[a0, b0, z + h], [a1, b1, z + h]], INK, 2.6);
  p.line([[a0, b0, z], [a0, b0, z + h]], INK, 2.4);
  p.line([[a1, b1, z], [a1, b1, z + h]], INK, 2.4);
}

function stairs(p: Pen, e: El) {
  const n = Math.max(2, Math.round(e.n || 10)), top = e.h || 120, z0 = e.z, rise = top / n;
  const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
  const alongA = e.dir === '+a' || e.dir === '-a';
  const len = alongA ? a1 - a0 : b1 - b0, run = len / n;
  // dir = 내려가는 방향. 뒤쪽 칸부터 그려야 겹침이 맞는다(보는 사람은 +A, −B 쪽).
  const down = e.dir === '+a' || e.dir === '+b';
  const idx = [...Array(n).keys()];
  if (!alongA) idx.reverse();
  for (const i of idx) {
    const hgt = down ? top - i * rise : rise * (i + 1);
    if (alongA) p.box(a0 + i * run, a0 + (i + 1) * run, b0, b1, z0, hgt, '#FFFFFF', '#EEEEEE', '#E1E1E1', INK, 1.4);
    else p.box(a0, a1, b0 + i * run, b0 + (i + 1) * run, z0, hgt, '#FFFFFF', '#EEEEEE', '#E1E1E1', INK, 1.4);
  }
  // 보는 쪽 난간(유리)
  const hi = top, lo = rise;
  if (alongA) {
    const [ah, al] = e.dir === '+a' ? [a0, a1] : [a1, a0];
    p.poly([[ah, b0, z0 + hi], [al, b0, z0 + lo], [al, b0, z0 + lo + 95], [ah, b0, z0 + hi + 95]], '#F3F5F5', INK, 2.2, 0.55);
  } else {
    const [bh, bl] = e.dir === '+b' ? [b0, b1] : [b1, b0];
    p.poly([[a1, bh, z0 + hi], [a1, bl, z0 + lo], [a1, bl, z0 + lo + 95], [a1, bh, z0 + hi + 95]], '#F3F5F5', INK, 2.2, 0.55);
  }
}

// ---------------------------------------------------------------- 곡선 도우미
type P2 = [number, number];
/** Catmull-Rom으로 점들 사이를 촘촘히 채운다(닫힌 곡선이면 closed) */
function catmull2(pts: P2[], closed: boolean, per = 10): P2[] {
  const n = pts.length;
  if (n < 3) return pts;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: P2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as P2);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function catmull3(pts: V3[], per = 10): V3[] {
  const n = pts.length;
  if (n < 3) return pts;
  const at = (i: number) => pts[Math.max(0, Math.min(n - 1, i))];
  const out: V3[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as V3);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/** 매끈한 곡선 바닥 모양의 입체: 옆면은 선 없이 채우고, 윗면·아래 보이는 가장자리·좌우 윤곽선만 긋는다 */
function smoothPrism(p: Pen, ctrl: P2[], z: number, h: number, top: string) {
  const pts = catmull2(ctrl, true, 12);
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
  const sgn = area > 0 ? 1 : -1;
  const vis = pts.map((q, i) => { const r = pts[(i + 1) % pts.length], da = r[0] - q[0], db = r[1] - q[1]; return facesViewer(db * sgn, -da * sgn); });
  // 옆면(채움만)
  pts.forEach((q, i) => {
    if (!vis[i] || h <= 0) return;
    const r = pts[(i + 1) % pts.length];
    p.poly([[q[0], q[1], z], [r[0], r[1], z], [r[0], r[1], z + h], [q[0], q[1], z + h]], '#EDEDED', '#EDEDED', 0.8);
  });
  // 아래 보이는 가장자리와 윤곽 세로선
  if (h > 0) {
    let run: V3[] = [];
    const flush = () => { if (run.length > 1) p.line(run, INK, 1.8); run = []; };
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], r = pts[(i + 1) % pts.length];
      if (vis[i]) { if (!run.length) run.push([q[0], q[1], z]); run.push([r[0], r[1], z]); } else flush();
      const prev = vis[(i - 1 + pts.length) % pts.length];
      if (vis[i] !== prev) p.line([[q[0], q[1], z], [q[0], q[1], z + h]], INK, 1.8);
    }
    flush();
  }
  p.poly(pts.map(([a, b]) => [a, b, z + h] as V3), top, INK, 1.8);
}

/** 회전체: 단면(반지름, 높이) 목록을 수직축으로 돌린 모양 — 화병, 조명, 병, 둥근 스툴 */
function lathe(p: Pen, a: number, b: number, z: number, prof: P2[], fill: string) {
  if (prof.length < 2) return;
  const { k, front0 } = roundDirs();
  const prof2 = prof.length >= 3 ? catmull2(prof, false, 6) : prof;
  const left = prof2.map(([r, zz]) => [a - r * k[0], b - r * k[1], z + zz] as V3);
  const right = prof2.map(([r, zz]) => [a + r * k[0], b + r * k[1], z + zz] as V3).reverse();
  // 몸통(채움)
  const front = (r: number, zz: number) => { const o: V3[] = []; for (let i = 0; i <= 16; i++) { const t = front0 + (Math.PI * i) / 16; o.push([a + r * Math.cos(t), b + r * Math.sin(t), z + zz]); } return o; };
  p.poly([...left, ...right], '#F1F1F1', null, 0);
  p.poly([...front(prof2[0][0], prof2[0][1])].reverse().concat(left.slice(0, 1)), '#F1F1F1', null, 0);
  p.line(left, INK, 1.6); p.line(right, INK, 1.6);
  p.line(front(prof2[0][0], prof2[0][1]), INK, 1.6);
  // 꺾이는 단면마다 앞쪽 테두리(가는 선)
  for (let i = 1; i < prof.length - 1; i++) p.line(front(prof[i][0], prof[i][1]), INK, 0.9);
  const [rt, zt] = prof[prof.length - 1];
  if (rt > 1) p.ellipse(a, b, z + zt, rt, fill, 1.6);
}

// ---------------------------------------------------------------- 수납·가전 세부
type Rect4 = [number, number, number, number];
const norm = (e: El): Rect4 => [Math.min(e.a0, e.a1), Math.max(e.a0, e.a1), Math.min(e.b0, e.b1), Math.max(e.b0, e.b1)];
/** 보이는 앞면: dir이 −b/+b면 B0 면, +a/−a면 A1 면(뒤쪽 면은 보이지 않으므로 앞쪽으로 바꿔 그린다) */
function frontFace(r: Rect4, dir: string) {
  const [a0, a1, b0, b1] = r;
  return dir === '+a' || dir === '-a'
    ? { at: (t: number, z: number): V3 => [a1, b0 + (b1 - b0) * t, z], len: b1 - b0 }
    : { at: (t: number, z: number): V3 => [a0 + (a1 - a0) * t, b0, z], len: a1 - a0 };
}
/** 앞면을 문 n개(세로)·서랍 m단(가로)으로 나누고 손잡이를 단다 */
function doorsAndDrawers(p: Pen, r: Rect4, dir: string, z0: number, h: number, n: number, m: number, plinth = 6) {
  const f = frontFace(r, dir), zb = z0 + plinth, zt = z0 + h - 2;
  if (plinth > 0) p.line([f.at(0, zb), f.at(1, zb)], INK, 1.1);
  const dh = m > 0 ? Math.min((zt - zb) * 0.45, 22 * m) : 0;      // 위쪽 서랍 구역 높이
  for (let j = 1; j <= m; j++) { const z = zt - (dh * j) / m; p.line([f.at(0, z), f.at(1, z)], INK, 1.1); }
  for (let j = 0; j < m; j++) { const z = zt - (dh * (j + 0.5)) / m; p.line([f.at(0.42, z), f.at(0.58, z)], INK, 1.8); }
  const doorTop = zt - dh;
  if (n > 0 && doorTop - zb > 12) {
    for (let i = 1; i < n; i++) p.line([f.at(i / n, zb), f.at(i / n, doorTop)], INK, 1.1);
    for (let i = 0; i < n; i++) {
      const t = (i + (i % 2 ? 0.12 : 0.88)) / n, zc = Math.min(doorTop - 8, zb + (doorTop - zb) * 0.62);
      p.line([f.at(t, zc - Math.min(14, (doorTop - zb) * 0.18)), f.at(t, zc)], INK, 1.8);
    }
  }
}
/** 모서리가 둥근 상자(곡선 입체) */
function roundBox(p: Pen, a0: number, a1: number, b0: number, b1: number, z: number, h: number, r: number, fill = '#FFFFFF') {
  [a0, a1] = [Math.min(a0, a1), Math.max(a0, a1)]; [b0, b1] = [Math.min(b0, b1), Math.max(b0, b1)];
  if (r < 1.5 || a1 - a0 < 4 || b1 - b0 < 4) { p.box(a0, a1, b0, b1, z, h, fill, '#F0F0F0', '#E2E2E2', INK, 1.8); return; }
  smoothPrism(p, roundedRect(a0, a1, b0, b1, r), z, h, fill);
}
/** 둥근 모서리 사각형 조절점(곡선 입체용) */
const roundedRect = (a0: number, a1: number, b0: number, b1: number, r: number): [number, number][] => {
  r = Math.min(r, (a1 - a0) / 2.2, (b1 - b0) / 2.2);
  return [[a0 + r, b0], [a1 - r, b0], [a1, b0 + r], [a1, b1 - r], [a1 - r, b1], [a0 + r, b1], [a0, b1 - r], [a0, b0 + r]];
};
const ellipseCtrl = (a: number, b: number, ra: number, rb: number, n = 8): [number, number][] =>
  Array.from({ length: n }, (_, i) => [a + ra * Math.cos((2 * Math.PI * i) / n), b + rb * Math.sin((2 * Math.PI * i) / n)]);

// ---------------------------------------------------------------- 세부 도형 도우미
/** 잎: 줄기 끝에서 사방으로 뻗는 뾰족한 잎 n장(뒤쪽부터 그림) */
function leaves(p: Pen, a: number, b: number, z: number, h: number, r: number, n: number, seed: number) {
  const items = Array.from({ length: n }, (_, i) => {
    const th = ((i + seed) / n) * Math.PI * 2 + i * 0.37;
    const reach = r * (0.55 + 0.45 * ((i * 0.618 + seed) % 1));
    const rise = h * (0.45 + 0.55 * ((i * 0.381 + seed * 0.5) % 1));
    return { th, reach, rise };
  }).sort((u, v) => P(Math.cos(u.th), Math.sin(u.th))[1] - P(Math.cos(v.th), Math.sin(v.th))[1]);   // 화면 뒤(위쪽)부터
  for (const { th, reach, rise } of items) {
    const ca = Math.cos(th), sb = Math.sin(th), pa = -sb, pb = ca, w = reach * 0.34;
    const base: V3 = [a, b, z], tip: V3 = [a + ca * reach, b + sb * reach, z + rise];
    const m = (t: number, side: number): V3 => [a + ca * reach * t + pa * w * side, b + sb * reach * t + pb * w * side, z + rise * Math.sin(t * Math.PI / 2) * 0.95];
    p.poly([base, m(0.45, 1), m(0.75, 0.6), tip, m(0.75, -0.6), m(0.45, -1)], '#6FBF8C', INK, 1.1);
    p.line([base, m(0.5, 0), tip], '#2E7A4C', 0.8);
  }
}

/** 소파·안락의자의 등받이와 팔걸이 */
function backAndArms(p: Pen, dir: string, a0: number, a1: number, b0: number, b1: number, z: number, t: number, backH: number, armH: number) {
  const r = Math.min(t * 0.45, 7);
  if (dir === '-b' || dir === '+b') {      // 등받이가 B1 쪽, 팔걸이가 A 양끝(뒤→앞 순서로 그림)
    roundBox(p, a0, a1, b1 - t, b1, z, backH, r);
    roundBox(p, a0, a0 + t, b0, b1 - t + r, z, armH, r);
    roundBox(p, a1 - t, a1, b0, b1 - t + r, z, armH, r);
  } else {                                  // 등받이가 A0 쪽, 팔걸이가 B 양끝
    roundBox(p, a0, a0 + t, b0, b1, z, backH, r);
    roundBox(p, a0 + t - r, a1, b1 - t, b1, z, armH, r);
    roundBox(p, a0 + t - r, a1, b0, b0 + t, z, armH, r);
  }
}

/** 임의 다각형 발자국의 입체: 보이는 옆면(뒤→앞)과 윗면 */
function prism(p: Pen, pts: [number, number][], z: number, h: number, top: string) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
  const sgn = area > 0 ? 1 : -1;
  const faces = pts.map((q, i) => {
    const r = pts[(i + 1) % pts.length], da = r[0] - q[0], db = r[1] - q[1];
    const na = db * sgn, nb = -da * sgn;            // 바깥 법선
    const mid = P((q[0] + r[0]) / 2, (q[1] + r[1]) / 2);
    return { q, r, vis: facesViewer(na, nb), depth: mid[1], light: -nb > na };
  }).filter((f) => f.vis).sort((u, v) => u.depth - v.depth);
  for (const f of faces)
    p.poly([[f.q[0], f.q[1], z], [f.r[0], f.r[1], z], [f.r[0], f.r[1], z + h], [f.q[0], f.q[1], z + h]], f.light ? '#F1F1F1' : '#E4E4E4', INK, 1.8);
  p.poly(pts.map(([a, b]) => [a, b, z + h] as V3), top, INK, 1.8);
}

// ---------------------------------------------------------------- element dispatch
/** 점처럼 놓는 가구: 발자국(a0..a1 × b0..b1)이 있으면 그 중심과 크기, 없으면 (a0,b0)와 기본 크기 */
function spot(e: El, def: number) {
  const da = Math.abs(e.a1 - e.a0), db = Math.abs(e.b1 - e.b0);
  if (da < 1 && db < 1) return { a: e.a0, b: e.b0, k: 1 };
  const size = Math.max(da, db);
  return { a: (e.a0 + e.a1) / 2, b: (e.b0 + e.b1) / 2, k: def ? Math.max(0.35, Math.min(3, size / def)) : 1 };
}

export function drawElement(p: Pen, e: El) {
  const col = PALETTE[e.color] ?? '#FFFFFF';
  switch (e.kind) {
    case 'slab': p.box(e.a0, e.a1, e.b0, e.b1, e.z - (e.h || 18), e.h || 18, col, '#EDEDED', '#E0E0E0', INK, 2.4); break;
    case 'floor': {
      if (e.points.length < 3) break;
      // m = 1이면 매끈한 곡선 윤곽(원형·곡선 러그)
      const pts = e.m >= 1 ? catmull2(e.points.map((q) => [q.a, q.b] as P2), true, 12).map(([a, b]) => [a, b, e.points[0].z] as V3) : e.points.map((q) => [q.a, q.b, q.z] as V3);
      p.poly(pts, col, e.n > 0 || e.m >= 1 ? INK : null, e.n > 0 || e.m >= 1 ? 1.6 : 0);
      break;
    }
    case 'wall': p.box(e.a0, e.a1, e.b0, e.b1, e.z, e.h || 300, col, e.color === 'white' ? '#F3F3F3' : col, e.color === 'white' ? '#E6E6E6' : col, INK, 2.4); break;
    case 'glass': glass(p, e, e.color === 'white' ? '#F5F7F7' : col, e.color === 'white' ? 0.5 : 0.3, e.color === 'gray'); break;
    case 'rail': glass(p, { ...e, h: e.h || 95 }, '#F5F7F7', 0.35); break;
    case 'door': {
      const { a0, b0, a1, b1, z } = e, h = e.h || 160;
      p.poly([[a0, b0, z], [a0, b0, z + h], [a1, b1, z + h], [a1, b1, z]], 'none', INK, 2.4);
      break;
    }
    case 'shaft': {
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
      const z0 = e.z, z1 = e.z + (e.h || 600);
      p.poly([[a0, b0, z0], [a1, b0, z0], [a1, b0, z1], [a0, b0, z1]], PALETTE.greenGlass, null, 0, 0.6);
      p.poly([[a1, b0, z0], [a1, b1, z0], [a1, b1, z1], [a1, b0, z1]], PALETTE.greenGlass, null, 0, 0.45);
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      p.line([[ca, cb, z0 + 12], [ca, cb, z1 - 12]], ROUTE, 6, '22 16', 'butt');
      break;
    }
    case 'table': table(p, e.a0, e.a1, e.b0, e.b1, e.z, e.h || 74); break;
    case 'chair': { const { a, b, k } = spot(e, 26), kz = Math.min(1.15, Math.max(0.8, k)); chair(p, a, b, e.z, e.dir, 26 * k, 44 * kz, 38 * kz); break; }
    case 'taskChair': {
      const { a, b, k } = spot(e, 30), z = e.z;
      for (let ang = 0; ang < 360; ang += 72) {
        const r = (ang * Math.PI) / 180;
        p.line([[a, b, z + 6 * k], [a + 20 * k * Math.cos(r), b + 20 * k * Math.sin(r), z + 2 * k]], INK, 2.2);
      }
      p.line([[a, b, z + 6 * k], [a, b, z + 40 * k]], INK, 2.6);
      const kz = Math.min(1.15, Math.max(0.8, k));
      chair(p, a, b, z - 4 * kz, e.dir, 30 * k, 44 * kz, 36 * kz, '#5A5A5A');
      break;
    }
    case 'stool': {
      const { a, b, k } = spot(e, 22), z = e.z, h = e.h || 62;
      for (const [da, db] of [[-8, -8], [8, -8], [-8, 8], [8, 8]])
        p.line([[a + da * k, b + db * k, z], [a + da * 0.6 * k, b + db * 0.6 * k, z + h]], INK, 1.6);
      p.box(a - 11 * k, a + 11 * k, b - 11 * k, b + 11 * k, z + h, 4, '#FFFFFF', '#E6E6E6', '#DADADA', INK, 1.5);
      break;
    }
    case 'plant': {
      const { a, b, k } = spot(e, 30), z = e.z, h = e.h || 70 * k, r = 15 * k;
      const pot = Math.min(h * 0.4, 24 * k);
      p.cylinder(a, b, z, pot, r * 0.55, r * 0.68);
      leaves(p, a, b, z + pot, h - pot, r * 1.35, 12, (Math.abs(a * 7 + b * 13) % 97) / 97);
      break;
    }
    case 'planter': {
      // 긴 화분 상자 + 그 위에 식물 n그루
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
      const bh = Math.min(e.h || 40, 45);
      p.box(a0, a1, b0, b1, e.z, bh, '#FFFFFF', '#F0F0F0', '#E2E2E2', INK, 1.8);
      const alongA = a1 - a0 >= b1 - b0, Lng = alongA ? a1 - a0 : b1 - b0, Wd = alongA ? b1 - b0 : a1 - a0;
      const n = Math.max(1, Math.round(e.n || Lng / Math.max(20, Wd)));
      // 뒤(작은 A, 큰 B)부터
      const idx = [...Array(n).keys()];
      if (!alongA) idx.reverse();
      for (const i of idx) {
        const t = (i + 0.5) / n;
        const pa = alongA ? a0 + Lng * t : (a0 + a1) / 2, pb = alongA ? (b0 + b1) / 2 : b0 + Lng * t;
        leaves(p, pa, pb, e.z + bh, Math.max(25, Wd * 0.9), Math.max(10, Wd * 0.55), 7, i / n);
      }
      break;
    }
    case 'armchair': {
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1), z0 = e.z;
      const t = Math.min(a1 - a0, b1 - b0) * 0.22, leg = 8;
      for (const [la, lb] of [[a0 + 4, b0 + 4], [a1 - 4, b0 + 4], [a0 + 4, b1 - 4], [a1 - 4, b1 - 4]]) p.line([[la, lb, z0], [la, lb, z0 + leg]], INK, 1.6);
      roundBox(p, a0, a1, b0, b1, z0 + leg, 24, Math.min(9, t * 0.5));
      backAndArms(p, e.dir, a0, a1, b0, b1, z0 + leg + 24, t, 30, 14);
      break;
    }
    case 'prism': {
      // 임의 발자국 다각형을 세운 입체: 전용 종류가 없는 물건. n = 1이면 매끈한 곡선 윤곽
      if (e.points.length < 3) break;
      const ctrl = e.points.map((q) => [q.a, q.b] as [number, number]), top = e.color === 'white' ? '#FFFFFF' : PALETTE[e.color];
      if (e.n >= 1) smoothPrism(p, ctrl, e.points[0].z + e.z, e.h || 30, top);
      else prism(p, ctrl, e.points[0].z + e.z, e.h || 30, top);
      break;
    }
    case 'curve': if (e.points.length >= 2) p.line(catmull3(e.points.map((q) => [q.a, q.b, q.z] as V3)), INK, 1.4); break;
    case 'lathe': {
      const { a, b } = spot(e, 0);
      lathe(p, a, b, e.z, e.points.map((q) => [Math.abs(q.a), q.z] as [number, number]), e.color === 'white' ? '#FFFFFF' : PALETTE[e.color]);
      break;
    }
    case 'lines': if (e.points.length >= 2) p.line(e.points.map((q) => [q.a, q.b, q.z] as V3), INK, 1.3); break;
    case 'panel': {
      // 벽에 붙은 얇은 판: 화이트보드, TV, 액자, 문짝
      const { a0, b0, a1, b1, z } = e, h = e.h || 80;
      p.poly([[a0, b0, z], [a1, b1, z], [a1, b1, z + h], [a0, b0, z + h]], e.color === 'white' ? '#FFFFFF' : PALETTE[e.color], INK, 1.8);
      if (e.n > 0) {
        const ins = 0.08, A = (t: number): [number, number] => [a0 + (a1 - a0) * t, b0 + (b1 - b0) * t];
        const [ia, ib] = A(ins), [ja, jb] = A(1 - ins), dz = h * ins;
        p.poly([[ia, ib, z + dz], [ja, jb, z + dz], [ja, jb, z + h - dz], [ia, ib, z + h - dz]], 'none', INK, 1.2);
      }
      break;
    }
    case 'counter': {
      // 조리대/아일랜드: 상판 + n개 싱크(상판에 파인 사각형 + 수전)
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1), h = e.h || 90, zt = e.z + h;
      p.box(a0, a1, b0, b1, e.z, h, '#FFFFFF', '#F0F0F0', '#E2E2E2', INK, 1.8);
      p.line([[a0, b0, zt - 6], [a1, b0, zt - 6]], INK, 1.1);
      p.line([[a1, b0, zt - 6], [a1, b1, zt - 6]], INK, 1.1);
      const n = Math.max(0, Math.round(e.n)), alongA = a1 - a0 >= b1 - b0;
      // 보이는 긴 면에 수납장 문(약 45 단위마다)과 손잡이, 위 서랍 한 단
      const fdir = alongA ? '-b' : '+a', flen = alongA ? a1 - a0 : b1 - b0;
      if (h > 50) doorsAndDrawers(p, [a0, a1, b0, b1], fdir, e.z, h - 6, Math.max(1, Math.round(flen / 45)), 1, 8);
      // 화구 m개(상판 한쪽 끝)
      const m = Math.max(0, Math.round(e.m));
      if (m > 0) {
        const cols = Math.min(2, m), rows = Math.ceil(m / cols), cell = Math.min(a1 - a0, b1 - b0) * 0.42;
        const ea = alongA ? a1 - cell * cols * 0.6 : (a0 + a1) / 2, eb = alongA ? (b0 + b1) / 2 : b0 + cell * rows * 0.6;
        p.poly([[ea - cell, eb - cell, zt + 0.5], [ea + cell * 0.2, eb - cell, zt + 0.5], [ea + cell * 0.2, eb + cell, zt + 0.5], [ea - cell, eb + cell, zt + 0.5]], '#3A3A3A', INK, 1.2);
        for (let i = 0; i < m; i++) {
          const ca = ea - cell * 0.4 + (i % cols) * cell * 0.5 - cell * 0.15, cb = eb - cell * 0.5 + Math.floor(i / cols) * cell;
          p.ellipse(ca, cb, zt + 0.8, cell * 0.17, '#3A3A3A', 1.1);
          p.ellipse(ca, cb, zt + 0.9, cell * 0.08, '#7A7A7A', 0.8);
        }
      }
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, sw = Math.min(a1 - a0, b1 - b0) * 0.5, sl = sw * 1.3;
        const ca = alongA ? a0 + (a1 - a0) * t : (a0 + a1) / 2, cb = alongA ? (b0 + b1) / 2 : b0 + (b1 - b0) * t;
        const ha = (alongA ? sl : sw) / 2, hb = (alongA ? sw : sl) / 2;
        p.poly([[ca - ha, cb - hb, zt], [ca + ha, cb - hb, zt], [ca + ha, cb + hb, zt], [ca - ha, cb + hb, zt]], '#F2F2F2', INK, 1.3);
        const fa = alongA ? ca : ca - ha - 4, fb = alongA ? cb + hb + 4 : cb;
        p.line([[fa, fb, zt], [fa, fb, zt + 18], [alongA ? fa : fa + 8, alongA ? fb - 8 : fb, zt + 18]], INK, 1.6);
      }
      break;
    }
    case 'cabinet': {
      // 수납장: 옷장·협탁·TV장·주방장·서랍장. n = 문 개수, m = 서랍 단수, dir = 앞면
      const r = norm(e), h = e.h || 80;
      p.box(r[0], r[1], r[2], r[3], e.z, h, e.color === 'white' ? '#FFFFFF' : PALETTE[e.color], '#F2F2F2', '#E4E4E4', INK, 1.8);
      doorsAndDrawers(p, r, e.dir, e.z, h, Math.max(0, Math.round(e.n)), Math.max(0, Math.round(e.m)), e.z < 5 ? 6 : 0);
      break;
    }
    case 'bed': {
      // 침대: dir = 머리(헤드보드) 쪽. 받침 + 매트리스 + 이불(접힌 선) + 베개 + 헤드보드
      const [a0, a1, b0, b1] = norm(e), z0 = e.z, base = 22, mat = 20, hb = Math.max(e.h || 0, 95);
      const W = ['#FFFFFF', '#F1F1F1', '#E4E4E4'] as const;
      const head = e.dir, alongA = head === '+a' || head === '-a', L = alongA ? a1 - a0 : b1 - b0, Wd = alongA ? b1 - b0 : a1 - a0;
      const t = 7;
      const headBox: Rect4 = head === '-a' ? [a0, a0 + t, b0, b1] : head === '+a' ? [a1 - t, a1, b0, b1] : head === '-b' ? [a0, a1, b0, b0 + t] : [a0, a1, b1 - t, b1];
      const headBehind = head === '-a' || head === '+b';      // 뒤쪽(먼저 그려야 하는) 머리
      if (headBehind) p.box(...headBox, z0, hb, ...W, INK, 1.8);
      const [ma0, ma1, mb0, mb1] = head === '-a' ? [a0 + t, a1, b0, b1] : head === '+a' ? [a0, a1 - t, b0, b1] : head === '-b' ? [a0, a1, b0 + t, b1] : [a0, a1, b0, b1 - t];
      p.box(ma0 + 2, ma1 - 2, mb0 + 2, mb1 - 2, z0, base, '#EDEDED', '#E2E2E2', '#D6D6D6', INK, 1.6);
      roundBox(p, ma0, ma1, mb0, mb1, z0 + base, mat, 7);
      const zt = z0 + base + mat;
      // 이불: 발치에서 길이의 62%를 덮고 위쪽으로 접힌 띠
      const cover = 0.62, fold = 0.1;
      const span = (f0: number, f1: number): Rect4 => {
        if (head === '-a') return [ma1 - (ma1 - ma0) * f1, ma1 - (ma1 - ma0) * f0, mb0 - 2, mb1 + 2];
        if (head === '+a') return [ma0 + (ma1 - ma0) * f0, ma0 + (ma1 - ma0) * f1, mb0 - 2, mb1 + 2];
        if (head === '-b') return [ma0 - 2, ma1 + 2, mb1 - (mb1 - mb0) * f1, mb1 - (mb1 - mb0) * f0];
        return [ma0 - 2, ma1 + 2, mb0 + (mb1 - mb0) * f0, mb0 + (mb1 - mb0) * f1];
      };
      const dv = span(0, cover);
      roundBox(p, dv[0], dv[1], dv[2], dv[3], zt - mat * 0.6, mat * 0.6 + 4, 6);
      const fd = span(cover - fold, cover);
      p.box(fd[0], fd[1], fd[2], fd[3], zt + 4, 2.5, '#F7F7F7', '#EFEFEF', '#E5E5E5', INK, 1.2);
      // 베개 두 개(넓으면) 또는 하나
      const np = Wd > 120 ? 2 : 1, pl = Math.min(L * 0.16, 34), pw = Wd / np - 10;
      for (let i = 0; i < np; i++) {
        const c = (i + 0.5) / np;
        let r: Rect4;
        if (head === '-a') r = [ma0 + 4, ma0 + 4 + pl, mb0 + (mb1 - mb0) * c - pw / 2, mb0 + (mb1 - mb0) * c + pw / 2];
        else if (head === '+a') r = [ma1 - 4 - pl, ma1 - 4, mb0 + (mb1 - mb0) * c - pw / 2, mb0 + (mb1 - mb0) * c + pw / 2];
        else if (head === '-b') r = [ma0 + (ma1 - ma0) * c - pw / 2, ma0 + (ma1 - ma0) * c + pw / 2, mb0 + 4, mb0 + 4 + pl];
        else r = [ma0 + (ma1 - ma0) * c - pw / 2, ma0 + (ma1 - ma0) * c + pw / 2, mb1 - 4 - pl, mb1 - 4];
        smoothPrism(p, roundedRect(r[0], r[1], r[2], r[3], 6), zt, 9, '#FFFFFF');
      }
      if (!headBehind) p.box(...headBox, z0, hb, ...W, INK, 1.8);
      break;
    }
    case 'toilet': {
      // 변기: dir = 물탱크 쪽(벽 쪽)
      const [a0, a1, b0, b1] = norm(e), z0 = e.z, d = e.dir, alongA = d === '+a' || d === '-a';
      const tankD = (alongA ? a1 - a0 : b1 - b0) * 0.28;
      const tank: Rect4 = d === '-a' ? [a0, a0 + tankD, b0, b1] : d === '+a' ? [a1 - tankD, a1, b0, b1] : d === '-b' ? [a0, a1, b0, b0 + tankD] : [a0, a1, b1 - tankD, b1];
      const bowl: Rect4 = d === '-a' ? [a0 + tankD, a1, b0 + 3, b1 - 3] : d === '+a' ? [a0, a1 - tankD, b0 + 3, b1 - 3] : d === '-b' ? [a0 + 3, a1 - 3, b0 + tankD, b1] : [a0 + 3, a1 - 3, b0, b1 - tankD];
      const tankBehind = d === '-a' || d === '+b';
      const drawTank = () => { p.box(...tank, z0, 78, '#FFFFFF', '#F2F2F2', '#E4E4E4', INK, 1.8); p.box(tank[0] - 1, tank[1] + 1, tank[2] - 1, tank[3] + 1, z0 + 78, 3, '#FFFFFF', '#F2F2F2', '#E4E4E4', INK, 1.4); };
      if (tankBehind) drawTank();
      const ca = (bowl[0] + bowl[1]) / 2, cb = (bowl[2] + bowl[3]) / 2, ra = (bowl[1] - bowl[0]) / 2, rb = (bowl[3] - bowl[2]) / 2;
      smoothPrism(p, ellipseCtrl(ca, cb, ra * 0.7, rb * 0.7), z0, 30, '#FFFFFF');
      smoothPrism(p, ellipseCtrl(ca, cb, ra, rb), z0 + 30, 8, '#FFFFFF');
      p.ellipse(ca, cb, z0 + 38.5, Math.min(ra, rb) * 0.62, '#EFEFEF', 1.1, Math.max(ra, rb) * 0.62 * (ra > rb ? 1 : 1));
      if (!tankBehind) drawTank();
      break;
    }
    case 'bathtub': {
      // 욕조: 바깥 상자 + 안쪽 둥근 테두리 + 수전(dir 쪽 끝)
      const [a0, a1, b0, b1] = norm(e), h = e.h || 55, zt = e.z + h, rim = Math.min(a1 - a0, b1 - b0) * 0.12;
      p.box(a0, a1, b0, b1, e.z, h, '#FFFFFF', '#F1F1F1', '#E4E4E4', INK, 1.8);
      p.poly(catmull2(roundedRect(a0 + rim, a1 - rim, b0 + rim, b1 - rim, rim * 2), true, 8).map(([a, b]) => [a, b, zt] as V3), '#EEF1F1', INK, 1.4);
      const d = e.dir, fa = d === '-a' ? a0 + rim * 0.5 : d === '+a' ? a1 - rim * 0.5 : (a0 + a1) / 2, fb = d === '-b' ? b0 + rim * 0.5 : d === '+b' ? b1 - rim * 0.5 : (b0 + b1) / 2;
      const ia = d === '-a' ? 1 : d === '+a' ? -1 : 0, ib = d === '-b' ? 1 : d === '+b' ? -1 : 0;
      p.line(catmull3([[fa, fb, zt], [fa, fb, zt + 22], [fa + ia * 10, fb + ib * 10, zt + 24], [fa + ia * 14, fb + ib * 14, zt + 16]]), INK, 2.2);
      break;
    }
    case 'window': {
      // 벽에 낸 창: (a0,b0)→(a1,b1) 벽 방향, z = 창 아래 높이, h = 창 높이, n = 세로 창살 수
      const { a0, b0, a1, b1, z } = e, h = e.h || 120;
      const P3 = (t: number, zz: number): V3 => [a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, zz];
      p.poly([P3(0, z), P3(1, z), P3(1, z + h), P3(0, z + h)], '#F2F6F6', INK, 2.0);
      const ins = 0.04, dz = 5;
      p.poly([P3(ins, z + dz), P3(1 - ins, z + dz), P3(1 - ins, z + h - dz), P3(ins, z + h - dz)], 'none', INK, 1.2);
      const n = Math.max(1, Math.round(e.n || 2));
      for (let i = 1; i < n; i++) p.line([P3(i / n, z + dz), P3(i / n, z + h - dz)], INK, 1.4);
      p.line([P3(ins, z + h * 0.72), P3(1 - ins, z + h * 0.72)], INK, 1.1);
      // 창턱
      p.line([P3(-0.02, z - 2), P3(1.02, z - 2)], INK, 2.4);
      break;
    }
    case 'box': p.box(e.a0, e.a1, e.b0, e.b1, e.z, e.h || 30, e.color === 'white' ? '#FFFFFF' : PALETTE[e.color], '#F0F0F0', '#E2E2E2', INK, 1.8); break;
    case 'sofa': {
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1), z0 = e.z;
      const leg = 8, t = Math.min(a1 - a0, b1 - b0) * 0.2;
      for (const [la, lb] of [[a0 + 5, b0 + 5], [a1 - 5, b0 + 5], [a0 + 5, b1 - 5], [a1 - 5, b1 - 5]]) p.line([[la, lb, z0], [la, lb, z0 + leg]], INK, 1.6);
      roundBox(p, a0, a1, b0, b1, z0 + leg, 22, Math.min(8, t * 0.4));
      // 방석 구분선
      const zt = z0 + leg + 22, alongA = e.dir === '-b' || e.dir === '+b', n = Math.max(1, Math.round(e.n || Math.max(1, Math.round((alongA ? a1 - a0 : b1 - b0) / 60))));
      for (let i = 1; i < n; i++) {
        if (alongA) { const a = a0 + ((a1 - a0) * i) / n; p.line([[a, b0, zt], [a, b1 - t, zt], [a, b0, zt]], INK, 1.1); p.line([[a, b0, zt], [a, b0, zt - 22]], INK, 1.1); }
        else { const b = b0 + ((b1 - b0) * i) / n; p.line([[a0 + t, b, zt], [a1, b, zt]], INK, 1.1); p.line([[a1, b, zt], [a1, b, zt - 22]], INK, 1.1); }
      }
      backAndArms(p, e.dir, a0, a1, b0, b1, zt, t, 32, 14);
      // 등쿠션 분할선(등받이 앞면)과 등쪽 쿠션 두 개
      for (let i = 1; i < n; i++) {
        if (alongA) { const a = a0 + ((a1 - a0) * i) / n; p.line([[a, b1 - t, zt], [a, b1 - t, zt + 30]], INK, 1.1); }
        else { const b = b0 + ((b1 - b0) * i) / n; p.line([[a0 + t, b, zt], [a0 + t, b, zt + 30]], INK, 1.1); }
      }
      for (const end of [0, 1]) {
        const ps = 22;
        if (alongA) { const ca = end ? a1 - t - ps * 0.8 : a0 + t + ps * 0.8; p.box(ca - ps / 2, ca + ps / 2, b1 - t - 7, b1 - t, zt, 20, '#FFFFFF', '#F3F3F3', '#E6E6E6', INK, 1.3); }
        else { const cb = end ? b1 - t - ps * 0.8 : b0 + t + ps * 0.8; p.box(a0 + t, a0 + t + 7, cb - ps / 2, cb + ps / 2, zt, 20, '#FFFFFF', '#F3F3F3', '#E6E6E6', INK, 1.3); }
      }
      break;
    }
    case 'roundTable': {
      const a = (e.a0 + e.a1) / 2, b = (e.b0 + e.b1) / 2, h = e.h || 72;
      const ra = Math.max(8, Math.abs(e.a1 - e.a0) / 2), rb = Math.max(8, Math.abs(e.b1 - e.b0) / 2);
      if (Math.max(ra, rb) / Math.min(ra, rb) > 1.3) {
        // 타원 테이블: 다리 4개
        for (const [da, db] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) p.line([[a + da * ra, b + db * rb, e.z], [a + da * ra, b + db * rb, e.z + h - 4]], INK, 1.8);
      } else {
        p.line([[a, b, e.z], [a, b, e.z + h]], INK, 3.0);
        p.ellipse(a, b, e.z + 2, Math.min(ra, rb) * 0.45, '#EDEDED', 1.5);
      }
      p.ellipse(a, b, e.z + h - 4, ra, '#EFEFEF', 1.4, rb);
      p.ellipse(a, b, e.z + h, ra, '#FFFFFF', 2, rb);
      break;
    }
    case 'shelf': shelf(p, e); break;
    case 'monitor': {
      const { a, b, k } = spot(e, 42), z = e.z, w = 42 * k, h = 30 * k;
      if (e.dir === '+a' || e.dir === '-a') p.box(a - w / 2, a + w / 2, b - 2, b + 2, z + 10 * k, h, '#FFFFFF', '#FFFFFF', '#E6E6E6', INK, 2.0);
      else p.box(a - 2, a + 2, b - w / 2, b + w / 2, z + 10 * k, h, '#FFFFFF', '#E6E6E6', '#FFFFFF', INK, 2.0);
      p.line([[a, b, z], [a, b, z + 10 * k]], INK, 2.0);
      break;
    }
    case 'laptop': {
      const { a, b, k } = spot(e, 30), z = e.z, w = 30 * k, d = 22 * k;
      p.poly([[a - w / 2, b - d / 2, z + 1], [a + w / 2, b - d / 2, z + 1], [a + w / 2, b + d / 2, z + 1], [a - w / 2, b + d / 2, z + 1]], '#DADADA', INK, 1.5);
      p.poly([[a - w / 2, b + d / 2, z + 1], [a + w / 2, b + d / 2, z + 1], [a + w / 2, b + d / 2, z + 20 * k], [a - w / 2, b + d / 2, z + 20 * k]], '#BFBFBF', INK, 1.5);
      break;
    }
    case 'stairs': stairs(p, e); break;
    case 'route': if (e.points.length >= 2) p.line(e.points.map((q) => [q.a, q.b, q.z] as V3), ROUTE, 12); break;
    case 'node': { const { a, b } = spot(e, 0); p.node(a, b, e.z); break; }
  }
}

/** 가구(세부) 요소: 선 굵기를 따로 조절한다 */
export const DETAIL_KINDS = new Set(['table', 'chair', 'taskChair', 'stool', 'sofa', 'armchair', 'roundTable', 'shelf', 'monitor', 'laptop', 'plant', 'planter', 'box', 'prism', 'lines', 'panel', 'counter', 'curve', 'lathe', 'cabinet', 'bed', 'toilet', 'bathtub', 'window']);
const scaleWidths = (body: string, k: number) => (k === 1 ? body : body.replace(/stroke-width="([0-9.]+)"/g, (_, v) => `stroke-width="${(parseFloat(v) * k).toFixed(2)}"`));

export function renderSVG(scene: Scene, opts: { wscale?: number; wdetail?: number; bg?: string | null; only?: (e: El) => boolean } = {}) {
  setProjection(scene.proj ?? ISO);
  const ws = opts.wscale ?? 1.35, wd = opts.wdetail ?? ws;
  const parts: string[] = [];
  for (const e of scene.elements) {
    if (opts.only && !opts.only(e)) continue;
    const pen = new Pen();
    drawElement(pen, e);
    parts.push(scaleWidths(pen.out.join('\n'), DETAIL_KINDS.has(e.kind) ? wd : ws));
  }
  const bg = opts.bg === undefined ? '#FFFFFF' : opts.bg;
  const { width: W, height: H } = scene;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    (bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : '') + parts.join('\n') + '</svg>';
}

/** 요소 하나만 그린 SVG 조각(에디터의 레이어별 렌더용) */
export function renderElement(e: El, wscale = 1.35) {
  const pen = new Pen();
  drawElement(pen, e);
  let body = pen.out.join('');
  if (wscale !== 1) body = body.replace(/stroke-width="([0-9.]+)"/g, (_, v) => `stroke-width="${(parseFloat(v) * wscale).toFixed(2)}"`);
  return body;
}

/** 요소가 화면에서 차지하는 범위(x0, y0, x1, y1). 점처럼 놓는 가구는 기본 크기로 잡는다. */
export function screenBox(e: El, pad = 8): [number, number, number, number] {
  let a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1);
  if (a1 - a0 < 1 && b1 - b0 < 1) { a0 -= 22; a1 += 22; b0 -= 22; b1 += 22; }
  const top = e.z + Math.max(e.h || 0, ['chair', 'taskChair'].includes(e.kind) ? 90 : ['monitor', 'laptop'].includes(e.kind) ? 45 : ['plant'].includes(e.kind) ? 80 : 30);
  const pts = e.points.length ? e.points.flatMap((q) => [P(q.a, q.b, q.z), P(q.a, q.b, q.z + (e.h || 0))]) :
    [a0, a1].flatMap((a) => [b0, b1].flatMap((b) => [P(a, b, e.z), P(a, b, top)]));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}
