// 등각 렌더 엔진. 요소 목록을 그린 순서대로(뒤→앞) SVG 문자열로 만든다.
import type { El, ColorName, Scene } from './schema';

export const C = Math.cos(Math.PI / 6);
export const S = 0.5;
const INK = '#2B2B2B';
const ROUTE = '#12C060';

export const PALETTE: Record<ColorName, string> = {
  white: '#FFFFFF', green: '#17C767', greenStrip: '#43DA8A', greenGlass: '#A9F1C8', gray: '#E6E6E6',
};

export type V3 = [number, number, number];
export const P = (a: number, b: number, z = 0): [number, number] => [C * (a + b), S * (a - b) - z];
/** 화면 이동량 → 차트 이동량 (z 고정) */
export const screenDeltaToAB = (dx: number, dy: number): [number, number] => [(dx / C + dy / S) / 2, (dx / C - dy / S) / 2];
export const screenToAB = (x: number, y: number, z = 0): [number, number] => screenDeltaToAB(x, y + z);

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
    // 원(반지름 r)의 화면 좌우 끝은 (a ± r/√2, b ± r/√2) 방향 → 화면 x 범위 ±C·r·√2
    const k = Math.SQRT1_2;
    const L = (r: number, z: number): V3 => [a - r * k, b - r * k, z], R = (r: number, z: number): V3 => [a + r * k, b + r * k, z];
    const arc: V3[] = [];
    for (let i = 0; i <= 20; i++) { const t = Math.PI * 1.25 + (Math.PI * i) / 20; arc.push([a + r0 * Math.cos(t), b + r0 * Math.sin(t), z0]); }
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
  p.box(a - hw, a + hw, b - hw, b + hw, z0 + seat - 4, 4, col, '#ECECEC', '#DEDEDE', INK, 1.6);
  const t = 4;
  const bb: [number, number, number, number] =
    face === '+b' ? [a - hw, a + hw, b - hw, b - hw + t] :
    face === '-b' ? [a - hw, a + hw, b + hw - t, b + hw] :
    face === '+a' ? [a - hw, a - hw + t, b - hw, b + hw] : [a + hw - t, a + hw, b - hw, b + hw];
  p.box(...bb, z0 + seat, back, col, '#EDEDED', '#DFDFDF', INK, 1.6);
}

function table(p: Pen, a0: number, a1: number, b0: number, b1: number, z0: number, h: number, top = 7, leg = 5, inset = 12) {
  [a0, a1] = [Math.min(a0, a1), Math.max(a0, a1)];
  [b0, b1] = [Math.min(b0, b1), Math.max(b0, b1)];
  for (const [a, b] of [[a0 + inset, b1 - inset], [a1 - inset, b1 - inset], [a0 + inset, b0 + inset], [a1 - inset, b0 + inset]])
    p.box(a - leg / 2, a + leg / 2, b - leg / 2, b + leg / 2, z0, h - top, '#D9D9D9', '#CFCFCF', '#BDBDBD', INK, 1.4);
  p.box(a0, a1, b0, b1, z0 + h - top, top, '#FFFFFF', '#EFEFEF', '#E2E2E2', INK, 2.0);
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
  const vis = pts.map((q, i) => { const r = pts[(i + 1) % pts.length], da = r[0] - q[0], db = r[1] - q[1]; return db * sgn - (-da * sgn) > 1e-9; });
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
  const k = Math.SQRT1_2;
  const prof2 = prof.length >= 3 ? catmull2(prof, false, 6) : prof;
  const left = prof2.map(([r, zz]) => [a - r * k, b - r * k, z + zz] as V3);
  const right = prof2.map(([r, zz]) => [a + r * k, b + r * k, z + zz] as V3).reverse();
  // 몸통(채움)
  const front = (r: number, zz: number) => { const o: V3[] = []; for (let i = 0; i <= 16; i++) { const t = Math.PI * 1.25 + (Math.PI * i) / 16; o.push([a + r * Math.cos(t), b + r * Math.sin(t), z + zz]); } return o; };
  p.poly([...left, ...right], '#F1F1F1', null, 0);
  p.poly([...front(prof2[0][0], prof2[0][1])].reverse().concat(left.slice(0, 1)), '#F1F1F1', null, 0);
  p.line(left, INK, 1.6); p.line(right, INK, 1.6);
  p.line(front(prof2[0][0], prof2[0][1]), INK, 1.6);
  // 꺾이는 단면마다 앞쪽 테두리(가는 선)
  for (let i = 1; i < prof.length - 1; i++) p.line(front(prof[i][0], prof[i][1]), INK, 0.9);
  const [rt, zt] = prof[prof.length - 1];
  if (rt > 1) p.ellipse(a, b, z + zt, rt, fill, 1.6);
}

// ---------------------------------------------------------------- 세부 도형 도우미
/** 잎: 줄기 끝에서 사방으로 뻗는 뾰족한 잎 n장(뒤쪽부터 그림) */
function leaves(p: Pen, a: number, b: number, z: number, h: number, r: number, n: number, seed: number) {
  const items = Array.from({ length: n }, (_, i) => {
    const th = ((i + seed) / n) * Math.PI * 2 + i * 0.37;
    const reach = r * (0.55 + 0.45 * ((i * 0.618 + seed) % 1));
    const rise = h * (0.45 + 0.55 * ((i * 0.381 + seed * 0.5) % 1));
    return { th, reach, rise };
  }).sort((u, v) => (Math.cos(u.th) - Math.sin(u.th)) - (Math.cos(v.th) - Math.sin(v.th)));   // 화면 뒤(−A, +B)부터
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
  const W = ['#FFFFFF', '#F0F0F0', '#E2E2E2'] as const;
  if (dir === '-b' || dir === '+b') {      // 등받이가 B1 쪽, 팔걸이가 A 양끝
    p.box(a0, a1, b1 - t, b1, z, backH, ...W, INK, 1.8);
    p.box(a0, a0 + t, b0, b1 - t, z, armH, ...W, INK, 1.8);
    p.box(a1 - t, a1, b0, b1 - t, z, armH, ...W, INK, 1.8);
  } else {                                  // 등받이가 A0 쪽, 팔걸이가 B 양끝
    p.box(a0, a0 + t, b0, b1, z, backH, ...W, INK, 1.8);
    p.box(a0 + t, a1, b1 - t, b1, z, armH, ...W, INK, 1.8);
    p.box(a0 + t, a1, b0, b0 + t, z, armH, ...W, INK, 1.8);
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
    return { q, r, vis: na - nb > 1e-6, depth: (q[0] + r[0]) / 2 - (q[1] + r[1]) / 2, light: -nb > na };
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
      const W = ['#FFFFFF', '#F0F0F0', '#E2E2E2'] as const, t = Math.min(a1 - a0, b1 - b0) * 0.22, leg = 8;
      for (const [la, lb] of [[a0 + 4, b0 + 4], [a1 - 4, b0 + 4], [a0 + 4, b1 - 4], [a1 - 4, b1 - 4]]) p.line([[la, lb, z0], [la, lb, z0 + leg]], INK, 1.6);
      p.box(a0, a1, b0, b1, z0 + leg, 24, ...W, INK, 1.8);
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
    case 'box': p.box(e.a0, e.a1, e.b0, e.b1, e.z, e.h || 30, e.color === 'white' ? '#FFFFFF' : PALETTE[e.color], '#F0F0F0', '#E2E2E2', INK, 1.8); break;
    case 'sofa': {
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1), z0 = e.z;
      const W = ['#FFFFFF', '#F0F0F0', '#E2E2E2'] as const, leg = 8, t = Math.min(a1 - a0, b1 - b0) * 0.2;
      for (const [la, lb] of [[a0 + 5, b0 + 5], [a1 - 5, b0 + 5], [a0 + 5, b1 - 5], [a1 - 5, b1 - 5]]) p.line([[la, lb, z0], [la, lb, z0 + leg]], INK, 1.6);
      p.box(a0, a1, b0, b1, z0 + leg, 22, ...W, INK, 1.8);
      // 방석 구분선
      const zt = z0 + leg + 22, alongA = e.dir === '-b' || e.dir === '+b', n = Math.max(1, Math.round(e.n || Math.max(1, Math.round((alongA ? a1 - a0 : b1 - b0) / 60))));
      for (let i = 1; i < n; i++) {
        if (alongA) { const a = a0 + ((a1 - a0) * i) / n; p.line([[a, b0, zt], [a, b1 - t, zt], [a, b0, zt]], INK, 1.1); p.line([[a, b0, zt], [a, b0, zt - 22]], INK, 1.1); }
        else { const b = b0 + ((b1 - b0) * i) / n; p.line([[a0 + t, b, zt], [a1, b, zt]], INK, 1.1); p.line([[a1, b, zt], [a1, b, zt - 22]], INK, 1.1); }
      }
      backAndArms(p, e.dir, a0, a1, b0, b1, zt, t, 32, 14);
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
export const DETAIL_KINDS = new Set(['table', 'chair', 'taskChair', 'stool', 'sofa', 'armchair', 'roundTable', 'shelf', 'monitor', 'laptop', 'plant', 'planter', 'box', 'prism', 'lines', 'panel', 'counter', 'curve', 'lathe']);
const scaleWidths = (body: string, k: number) => (k === 1 ? body : body.replace(/stroke-width="([0-9.]+)"/g, (_, v) => `stroke-width="${(parseFloat(v) * k).toFixed(2)}"`));

export function renderSVG(scene: Scene, opts: { wscale?: number; wdetail?: number; bg?: string | null; only?: (e: El) => boolean } = {}) {
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
