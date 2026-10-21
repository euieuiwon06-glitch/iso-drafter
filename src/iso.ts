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
  ellipse(a: number, b: number, z: number, r: number, fill = '#FFFFFF', sw = 2) {
    const pts: V3[] = [];
    for (let i = 0; i < 40; i++) { const t = (2 * Math.PI * i) / 40; pts.push([a + r * Math.cos(t), b + r * Math.sin(t), z]); }
    this.poly(pts, fill, INK, sw);
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
    case 'floor': if (e.points.length >= 3) p.poly(e.points.map((q) => [q.a, q.b, q.z] as V3), col, e.n > 0 ? INK : null, e.n > 0 ? 2.4 : 0); break;
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
    case 'chair': { const { a, b, k } = spot(e, 26); chair(p, a, b, e.z, e.dir, 26 * k, 44 * k, 40 * k); break; }
    case 'taskChair': {
      const { a, b, k } = spot(e, 30), z = e.z;
      for (let ang = 0; ang < 360; ang += 72) {
        const r = (ang * Math.PI) / 180;
        p.line([[a, b, z + 6 * k], [a + 20 * k * Math.cos(r), b + 20 * k * Math.sin(r), z + 2 * k]], INK, 2.2);
      }
      p.line([[a, b, z + 6 * k], [a, b, z + 40 * k]], INK, 2.6);
      chair(p, a, b, z - 4 * k, e.dir, 30 * k, 44 * k, 36 * k, '#5A5A5A');
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
      // 화분 + 잎 덩어리(초록 타원 여러 개)
      const { a, b, k } = spot(e, 30), z = e.z, h = e.h || 60 * k, r = 15 * k;
      const pot = Math.min(h * 0.45, 26 * k);
      p.box(a - r * 0.7, a + r * 0.7, b - r * 0.7, b + r * 0.7, z, pot, '#FFFFFF', '#F0F0F0', '#E2E2E2', INK, 1.6);
      // 잎: 아래 큰 덩어리 → 위 작은 덩어리 순서로 겹쳐 덤불처럼
      const top = z + h, mid = z + pot + (h - pot) * 0.45;
      const leaves: [number, number, number, number, string][] = [
        [-0.55, 0.35, mid, 0.55, '#2F8F55'], [0.55, -0.3, mid, 0.55, '#2F8F55'], [0.1, 0.6, mid + (top - mid) * 0.3, 0.5, '#37A060'],
        [-0.35, -0.45, mid + (top - mid) * 0.35, 0.5, '#37A060'], [0, 0, mid + (top - mid) * 0.55, 0.6, '#3FAE6A'],
        [0.35, 0.2, top - (top - mid) * 0.25, 0.45, '#4CBB76'], [-0.25, 0.05, top, 0.42, '#55C47E'],
      ];
      for (const [da, db, zz, rf, col] of leaves) p.blob(a + da * r, b + db * r, zz, r * rf * 1.1, col, 1.2);
      break;
    }
    case 'box': p.box(e.a0, e.a1, e.b0, e.b1, e.z, e.h || 30, e.color === 'white' ? '#FFFFFF' : PALETTE[e.color], '#F0F0F0', '#E2E2E2', INK, 1.8); break;
    case 'sofa': {
      const a0 = Math.min(e.a0, e.a1), a1 = Math.max(e.a0, e.a1), b0 = Math.min(e.b0, e.b1), b1 = Math.max(e.b0, e.b1), z0 = e.z;
      const W = ['#FFFFFF', '#F0F0F0', '#E2E2E2'] as const;
      p.box(a0, a1, b0, b1, z0, 40, ...W, INK, 2.0);
      if (e.dir === '-b' || e.dir === '+b') {      // 등받이가 B1 쪽, 팔걸이가 A 양끝
        p.box(a0, a1, b1 - 16, b1, z0 + 40, 36, ...W, INK, 2.0);
        p.box(a0, a0 + 16, b0, b1 - 16, z0 + 40, 18, ...W, INK, 2.0);
        p.box(a1 - 16, a1, b0, b1 - 16, z0 + 40, 18, ...W, INK, 2.0);
      } else {                                      // 등받이가 A0 쪽
        p.box(a0, a0 + 16, b0, b1, z0 + 40, 36, ...W, INK, 2.0);
        p.box(a0 + 16, a1, b0, b0 + 16, z0 + 40, 18, ...W, INK, 2.0);
        p.box(a0 + 16, a1, b1 - 16, b1, z0 + 40, 18, ...W, INK, 2.0);
      }
      break;
    }
    case 'roundTable': {
      const a = (e.a0 + e.a1) / 2, b = (e.b0 + e.b1) / 2, r = Math.max(10, Math.min(Math.abs(e.a1 - e.a0), Math.abs(e.b1 - e.b0)) / 2), h = e.h || 72;
      p.line([[a, b, e.z], [a, b, e.z + h]], INK, 3.0);
      p.ellipse(a, b, e.z + 2, r * 0.45, '#EDEDED', 1.5);
      p.ellipse(a, b, e.z + h, r);
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
export const DETAIL_KINDS = new Set(['table', 'chair', 'taskChair', 'stool', 'sofa', 'roundTable', 'shelf', 'monitor', 'laptop', 'plant', 'box']);
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
