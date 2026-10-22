// 가구·제품 선 따기: 투시 교정된 원본에서 구조 도형이 그린 선을 뺀 나머지 잉크를
// 1px 중심선으로 만들고, 이어진 선 단위로 따서 매끈한 베지어 패스로 만든다.

type Pt = [number, number];
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/** 이미지 → 잉크 마스크: 주변 배경보다 확실히 어두운 무채색 화소(회색 연필선도 잡힌다). 초록 표시 그래픽은 빠진다. */
function inkMask(img: HTMLImageElement) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h), sat = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * gg + 0.114 * b; sat[i] = Math.max(r, gg, b) - Math.min(r, gg, b);
  }
  // 배경 밝기: 31px 상자 평균(적분 영상)
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const R = 15, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
      const bg = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const i = y * w + x;
      m[i] = lum[i] < Math.min(215, bg - 22) && sat[i] < 70 ? 1 : 0;
    }
  }
  return { w, h, m };
}

/** 구조 도형의 선만 그린 SVG → 선이 지나는 화소 마스크(굵게 부풀림) */
async function strokeMask(svg: string, w: number, h: number, grow: number) {
  const lines = svg.replace(/fill="#[0-9A-Fa-f]{3,6}"/g, 'fill="none"').replace(/<rect [^>]*\/>/, '');
  const url = URL.createObjectURL(new Blob([lines], { type: 'image/svg+xml' }));
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const a = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = a[i * 4 + 3] > 40 ? 1 : 0;
  return dilate(m, w, h, grow);
}

function dilate(m: Uint8Array, w: number, h: number, r: number) {
  // 가로 → 세로 분리 팽창(정사각 커널)
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let run = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) run = x; if (x - run <= r) t[y * w + x] = 1; } run = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) run = x; if (run - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) run = y; if (y - run <= r) o[y * w + x] = 1; } run = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) run = y; if (run - y <= r) o[y * w + x] = 1; } }
  return o;
}

/** Zhang–Suen 세선화 */
async function thin(m: Uint8Array, w: number, h: number) {
  const del: number[] = [];
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!m[i]) continue;
          const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1], p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) + (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2));
          if (A !== 1) continue;
          if (step === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
          del.push(i);
        }
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
    if (!changed) break;
    if (iter % 3 === 2) await yieldUI();
  }
}

const N8 = (w: number) => [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];

/** 중심선 화소를 이어진 선(체인)들로 */
function chains(m: Uint8Array, w: number, h: number): Pt[][] {
  const nb = N8(w), deg = new Uint8Array(w * h);
  for (let i = w + 1; i < w * (h - 1) - 1; i++) if (m[i]) { let d = 0; for (const o of nb) d += m[i + o]; deg[i] = d; }
  const used = new Uint8Array(w * h), out: Pt[][] = [];
  const walk = (start: number, next: number) => {
    const pts: Pt[] = [[start % w, (start / w) | 0]];
    let prev = start, cur = next;
    for (;;) {
      pts.push([cur % w, (cur / w) | 0]);
      if (deg[cur] !== 2 || used[cur]) break;
      used[cur] = 1;
      let nx = -1;
      for (const o of nb) { const j = cur + o; if (m[j] && j !== prev && !(used[j] && deg[j] === 2)) { nx = j; break; } }
      if (nx < 0) break;
      prev = cur; cur = nx;
    }
    return pts;
  };
  // 끝점·갈림점에서 출발
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || deg[i] === 2 || deg[i] === 0) continue;
    for (const o of nb) { const j = i + o; if (m[j] && !(deg[j] === 2 && used[j])) { if (deg[j] !== 2 && j < i) continue; out.push(walk(i, j)); } }
  }
  // 남은 고리
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || used[i] || deg[i] !== 2) continue;
    used[i] = 1;
    const j = nb.map((o) => i + o).find((k) => m[k]);
    if (j !== undefined) out.push(walk(i, j));
  }
  return out;
}

// ---------------------------------------------------------------- 매끈하게
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st: [number, number][] = [[0, pts.length - 1]];
  while (st.length) {
    const [i0, i1] = st.pop()!, a = pts[i0], ab = sub(pts[i1], a), L = Math.hypot(ab[0], ab[1]) || 1e-9;
    let bd = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) { const d = Math.abs(ab[0] * (pts[i][1] - a[1]) - ab[1] * (pts[i][0] - a[0])) / L; if (d > bd) { bd = d; bi = i; } }
    if (bd > eps) { keep[bi] = 1; st.push([i0, bi], [bi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function smooth(pts: Pt[], r: number): Pt[] {
  if (pts.length <= 2 * r + 1) return pts;
  return pts.map((p, i) => {
    if (i < r || i >= pts.length - r) return p;
    let x = 0, y = 0; for (let k = -r; k <= r; k++) { x += pts[i + k][0]; y += pts[i + k][1]; }
    return [x / (2 * r + 1), y / (2 * r + 1)];
  });
}
/** 꺾인 곳(45° 넘게 도는 곳)에서 나눈다 */
function splitCorners(pts: Pt[]): Pt[][] {
  const out: Pt[][] = []; let start = 0;
  for (let i = 3; i < pts.length - 3; i++) {
    const a = sub(pts[i], pts[i - 3]), b = sub(pts[i + 3], pts[i]);
    const c = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
    if (c < Math.cos(Math.PI / 4) && i - start > 3) { out.push(pts.slice(start, i + 1)); start = i; i += 3; }
  }
  out.push(pts.slice(start));
  return out;
}
const AXES = [90, 30, 150];
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

function toPath(piece: Pt[]): string {
  const sm = rdp(smooth(piece, 2), 0.8);
  if (sm.length === 2 || rdp(sm, 1.4).length === 2) {
    let [a, b] = [sm[0], sm[sm.length - 1]];
    // 거의 등각 축이면 축에 맞춰 편다
    const ang = ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 180) % 180;
    for (const t of AXES) {
      const d = Math.abs(((ang - t + 270) % 180) - 90);
      if (d < 3) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const u: Pt = [Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180)], s = Math.sign(u[0] * (b[0] - a[0]) + u[1] * (b[1] - a[1])) || 1;
        a = [m[0] - (u[0] * s * L) / 2, m[1] - (u[1] * s * L) / 2]; b = [m[0] + (u[0] * s * L) / 2, m[1] + (u[1] * s * L) / 2];
        break;
      }
    }
    return `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`;
  }
  // Catmull-Rom → 베지어
  let d = `M${f1(sm[0][0])} ${f1(sm[0][1])}`;
  for (let i = 0; i < sm.length - 1; i++) {
    const p0 = sm[i - 1] ?? sm[i], p1 = sm[i], p2 = sm[i + 1], p3 = sm[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}

const traceCache = new Map<string, string[]>();

export type Region = [number, number, number, number];   // 화면 x0, y0, x1, y1

/**
 * 가구·제품 자리(regions) 안에서, 구조 도형(structureSvg)이 설명하지 못하는 원본 선을 곡선 패스들로 돌려준다.
 * key가 같으면 다시 계산하지 않는다.
 */
export async function traceDetails(img: HTMLImageElement, structureSvg: string, regions: Region[], key: string, onStage?: (s: string) => void): Promise<string[]> {
  const hit = traceCache.get(key);
  if (hit) return hit;
  onStage?.('원본 선을 읽는 중…');
  const { w, h, m } = inkMask(img);
  // 가구 자리만 남긴다
  const keep = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of regions) {
    const ax = Math.max(1, Math.floor(x0)), ay = Math.max(1, Math.floor(y0)), bx = Math.min(w - 2, Math.ceil(x1)), by = Math.min(h - 2, Math.ceil(y1));
    for (let y = ay; y <= by; y++) keep.fill(1, y * w + ax, y * w + bx + 1);
  }
  const struct = await strokeMask(structureSvg, w, h, 3);
  for (let i = 0; i < w * h; i++) if (!keep[i] || struct[i]) m[i] = 0;
  // 끊긴 획을 잇고 겹선을 하나로: 1px 부풀린 뒤 세선화
  const closed = dilate(m, w, h, 1);
  for (let x = 0; x < w; x++) { closed[x] = 0; closed[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { closed[y * w] = 0; closed[y * w + w - 1] = 0; }
  onStage?.('선을 가늘게 정리하는 중…');
  await yieldUI();
  await thin(closed, w, h);
  onStage?.('곡선으로 바꾸는 중…');
  await yieldUI();
  const paths: string[] = [];
  for (const c of chains(closed, w, h)) {
    if (c.length < 10) continue;              // 티끌·짧은 잔선
    for (const piece of splitCorners(c)) if (piece.length >= 3) paths.push(toPath(piece));
  }
  traceCache.set(key, paths);
  return paths;
}

// ================================================================ 원본 벡터화(윤곽 따기)
// 획을 1px로 줄이지 않고, 잉크 농도장의 등고선(0.5)을 소수점 단위로 따서 채운 도형으로 만든다.
// 선 굵기·끝 모양·작은 디테일이 원본 그대로 남는다.

/** 잉크 농도(0~1): 주변 배경보다 얼마나 어두운지. 채도 높은 색(초록 표시 등)은 0 */
function inkStrength(img: HTMLImageElement, k = 1) {
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h), sat = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    sat[i] = Math.max(r, gg, b) - Math.min(r, gg, b);
    lum[i] = sat[i] > 70 ? 255 : 0.299 * r + 0.587 * gg + 0.114 * b;   // 색 면(초록 바닥 등)은 배경으로
  }
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const R = 15, s = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
      const bg = Math.max(lum[y * w + x], (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)));
      const i = y * w + x;
      s[i] = sat[i] > 70 ? 0 : Math.max(0, Math.min(1, (Math.min(bg, 245) - lum[i]) / 110));
    }
  }
  // 흐림 없이 그대로 쓴다(1px 가는 선도 살리기 위해). 계단 무늬는 곡선 다듬기에서 정리된다.
  return { w, h, s };
}

/** 마칭 스퀘어로 0.5 등고선 고리들을 만든다(소수점 좌표). 메모리를 아끼려고 고정 크기 배열을 쓴다. */
function contours(s: Float32Array, w: number, h: number, iso = 0.5): Pt[][] {
  const N = 2 * w * h;
  const px = new Float32Array(N), py = new Float32Array(N);
  const n1 = new Int32Array(N).fill(-1), n2 = new Int32Array(N).fill(-1);
  const hid = (x: number, y: number) => 2 * (y * w + x), vid = (x: number, y: number) => 2 * (y * w + x) + 1;
  const lerp = (a: number, b: number) => (iso - a) / (b - a || 1e-9);
  const link = (p: number, q: number) => {
    if (n1[p] < 0) n1[p] = q; else n2[p] = q;
    if (n1[q] < 0) n1[q] = p; else n2[q] = p;
  };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const v0 = s[y * w + x], v1 = s[y * w + x + 1], v2 = s[(y + 1) * w + x + 1], v3 = s[(y + 1) * w + x];
    const c = (v0 >= iso ? 1 : 0) | (v1 >= iso ? 2 : 0) | (v2 >= iso ? 4 : 0) | (v3 >= iso ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const T = hid(x, y), B = hid(x, y + 1), L = vid(x, y), Rr = vid(x + 1, y);
    px[T] = x + lerp(v0, v1); py[T] = y;
    px[B] = x + lerp(v3, v2); py[B] = y + 1;
    px[L] = x; py[L] = y + lerp(v0, v3);
    px[Rr] = x + 1; py[Rr] = y + lerp(v1, v2);
    const mid = (v0 + v1 + v2 + v3) / 4 >= iso;
    switch (c) {
      case 1: case 14: link(L, T); break;
      case 2: case 13: link(T, Rr); break;
      case 3: case 12: link(L, Rr); break;
      case 4: case 11: link(Rr, B); break;
      case 6: case 9: link(T, B); break;
      case 7: case 8: link(L, B); break;
      case 5: if (mid) { link(L, B); link(T, Rr); } else { link(L, T); link(Rr, B); } break;
      case 10: if (mid) { link(L, T); link(Rr, B); } else { link(T, Rr); link(L, B); } break;
    }
  }
  const seen = new Uint8Array(N), loops: Pt[][] = [];
  for (let start = 0; start < N; start++) {
    if (n1[start] < 0 || seen[start]) continue;
    const loop: Pt[] = []; let prev = -1, cur = start;
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1; loop.push([px[cur], py[cur]]);
      const nx = n1[cur] !== prev ? n1[cur] : n2[cur];
      prev = cur; cur = nx;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

const area = (p: Pt[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; };

// ---------------------------------------------------------------- 직선 교정(도면 기준)
// 윤곽을 다각형으로 줄인 뒤, 길게 곧은 변은 그림의 축(수직·A축·B축·수평)에 맞춰 펴고,
// 같은 축·같은 줄 위의 변들은 한 줄로 정렬한 다음, 이웃한 곧은 변의 교점으로 모서리를 다시 만든다.
type Edge = { i: number; j: number; ux: number; uy: number; mx: number; my: number; len: number; axis: number; straight: boolean };

let AXIS_DIRS: Pt[] = [];
/** 투영 축(화면 각도, 도)으로 교정 축을 정한다: 수직 + A축 + B축 + 수평 */
export function setTraceAxes(aDeg: number, bDeg: number) {
  const d = (t: number): Pt => [Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180)];
  AXIS_DIRS = [d(90), d(aDeg), d(bDeg), d(0)];
}
setTraceAxes(30, -30);

const SNAP = Math.sin((7 * Math.PI) / 180);

function polyEdges(p: Pt[], minLen: number): Edge[] {
  const n = p.length, E: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    let ux = dx / L, uy = dy / L, axis = -1;
    if (L >= minLen) {
      let best = SNAP;
      AXIS_DIRS.forEach((u, k) => { const c = Math.abs(ux * u[1] - uy * u[0]); if (c < best) { best = c; axis = k; } });
      if (axis >= 0) { const u = AXIS_DIRS[axis], sg = Math.sign(ux * u[0] + uy * u[1]) || 1; ux = u[0] * sg; uy = u[1] * sg; }
    }
    E.push({ i, j: (i + 1) % n, ux, uy, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, len: L, axis, straight: axis >= 0 });
  }
  return E;
}

/** 모든 윤곽의 축 변을 모아, 같은 축이고 옆으로 tol 안에 있는 변들을 한 줄(길이 가중 평균)로 맞춘다 */
function alignEdges(all: Edge[], tol: number) {
  for (let k = 0; k < AXIS_DIRS.length; k++) {
    const u = AXIS_DIRS[k], nx = -u[1], ny = u[0];
    const es = all.filter((e) => e.axis === k).map((e) => ({ e, off: e.mx * nx + e.my * ny, t: e.mx * u[0] + e.my * u[1] })).sort((a, b) => a.off - b.off);
    let cl: typeof es = [];
    const flush = () => {
      if (cl.length > 1) {
        let sw = 0, so = 0; for (const c of cl) { sw += c.e.len; so += c.off * c.e.len; }
        const tgt = so / sw;
        for (const c of cl) { const d = tgt - c.off; c.e.mx += nx * d; c.e.my += ny * d; }
      }
      cl = [];
    };
    for (const c of es) { if (cl.length && c.off - cl[0].off > tol) flush(); cl.push(c); }
    flush();
  }
}

function intersect(a: Edge, b: Edge): Pt | null {
  const den = a.ux * b.uy - a.uy * b.ux;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.mx - a.mx) * b.uy - (b.my - a.my) * b.ux) / den;
  return [a.mx + a.ux * t, a.my + a.uy * t];
}
const proj = (e: Edge, p: Pt): Pt => { const t = (p[0] - e.mx) * e.ux + (p[1] - e.my) * e.uy; return [e.mx + e.ux * t, e.my + e.uy * t]; };

/** 교정된 변으로 다각형 꼭짓점을 다시 만든다 */
function rebuild(p: Pt[], E: Edge[], maxMove: number): Pt[] {
  const n = p.length, out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const ePrev = E[(i - 1 + n) % n], eNext = E[i], v = p[i];
    let q: Pt = v;
    if (ePrev.straight && eNext.straight) {
      const X = ePrev.axis !== eNext.axis ? intersect(ePrev, eNext) : null;
      q = X && Math.hypot(X[0] - v[0], X[1] - v[1]) < maxMove ? X : (() => { const a = proj(ePrev, v), b = proj(eNext, v); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt; })();
    } else if (ePrev.straight) q = proj(ePrev, v);
    else if (eNext.straight) q = proj(eNext, v);
    if (Math.hypot(q[0] - v[0], q[1] - v[1]) > maxMove) q = v;
    out.push(q);
  }
  return out;
}

/** 교정된 다각형 → 패스. 곧은 변은 직선, 나머지 짧은 변 묶음은 매끈한 곡선 */
function polyPath(p: Pt[], E: Edge[]): string {
  const n = p.length;
  if (n < 3) return '';
  const corner = p.map((q, i) => {
    if (E[(i - 1 + n) % n].straight || E[i].straight) return true;
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const u = sub(q, a), v = sub(b, q), c = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) || 1);
    return c < Math.cos((55 * Math.PI) / 180);
  });
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p1 = p[i], p2 = p[(i + 1) % n];
    if (E[i].straight || corner[i] || corner[(i + 1) % n]) { d += `L${f1(p2[0])} ${f1(p2[1])}`; continue; }
    const p0 = p[(i - 1 + n) % n], p3 = p[(i + 2) % n];
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + 'Z';
}

/** 닫힌 윤곽 → 다각형(빠른 단순화) */
function loopPoly(loop: Pt[], eps: number): Pt[] {
  const p: Pt[] = [];
  for (let i = 0; i < loop.length; i += 120) {
    const piece = loop.slice(i, i + 121);
    if (i + 121 > loop.length) piece.push(loop[0]);
    p.push(...rdp(piece, eps).slice(0, -1));
  }
  // 거의 일직선으로 이어지는 꼭짓점은 지운다(긴 변이 쪼개져 있으면 교정이 안 되므로)
  let q = p, changed = true;
  while (changed && q.length > 3) {
    changed = false;
    for (let i = 0; i < q.length; i++) {
      const a = q[(i - 1 + q.length) % q.length], b = q[i], c = q[(i + 1) % q.length];
      const ac = sub(c, a), L = Math.hypot(ac[0], ac[1]) || 1e-9;
      if (Math.abs(ac[0] * (b[1] - a[1]) - ac[1] * (b[0] - a[0])) / L < eps * 1.6) { q = q.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  return q;
}

const vecCache = new Map<string, string>();

/**
 * 원본 벡터화: 구조 도형(structureSvg)이 이미 그린 선을 빼고, 나머지 원본 잉크를 윤곽 도형 패스 하나(d)로 돌려준다.
 * regions가 있으면 그 안만, null이면 그림 전체.
 */
export async function vectorizeInk(img: HTMLImageElement, structureSvg: string | null, regions: Region[] | null, key: string, onStage?: (s: string) => void): Promise<string> {
  const hit = vecCache.get(key);
  if (hit !== undefined) return hit;
  onStage?.('원본 선을 읽는 중…');
  await yieldUI();
  const W0 = img.naturalWidth, H0 = img.naturalHeight;
  const k = Math.max(1, Math.min(2, Math.sqrt(5e6 / (W0 * H0))));   // 작은 그림은 최대 2배로 키워서 딴다
  const { w, h, s } = inkStrength(img, k);
  if (regions) {
    const keep = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of regions) {
      const ax = Math.max(1, Math.floor(x0 * k)), ay = Math.max(1, Math.floor(y0 * k)), bx = Math.min(w - 2, Math.ceil(x1 * k)), by = Math.min(h - 2, Math.ceil(y1 * k));
      for (let y = ay; y <= by; y++) keep.fill(1, y * w + ax, y * w + bx + 1);
    }
    for (let i = 0; i < w * h; i++) if (!keep[i]) s[i] = 0;
  }
  if (structureSvg) {
    const struct = await strokeMask(structureSvg, w, h, Math.round(2 * k));
    for (let i = 0; i < w * h; i++) if (struct[i]) s[i] = 0;
  }
  onStage?.('윤곽을 곡선으로 따는 중…');
  await yieldUI();
  const loops = contours(s, w, h, 0.42).filter((l) => area(l) >= 6 * k * k).map((l) => l.map(([x, y]) => [x / k, y / k] as Pt));   // 6px² 미만 부스러기는 버림
  // 직선 교정: 다각형 → 축에 맞춘 변 → 같은 줄 정렬 → 교점으로 모서리
  const polys = loops.map((l) => loopPoly(l, 0.6)).filter((q) => q.length >= 3);
  const edges = polys.map((q) => polyEdges(q, 5));
  alignEdges(edges.flat(), 1.2);
  const d = polys.map((q, i) => polyPath(rebuild(q, edges[i], 4), edges[i])).join('');
  vecCache.set(key, d);
  return d;
}

// ================================================================ 색 면 벡터화(그래픽 벡터화 모드)
// 채도 있는 색 면과 옅은 회색 면을 몇 가지 색으로 나눠, 각 색의 영역 윤곽을 같은 직선 교정 방식으로 따서 채운다.
export type ColorLayer = { fill: string; d: string; share: number };

export async function vectorizeColors(img: HTMLImageElement, onStage?: (s: string) => void): Promise<ColorLayer[]> {
  onStage?.('색 면을 나누는 중…');
  await yieldUI();
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  // 칸: 채도 있는 색은 색상 12칸 × 밝기 2칸, 무채색은 옅은 회색 2칸
  const NB = 12 * 2 + 2, cls = new Int16Array(w * h).fill(-1);
  const sum = new Float64Array(NB * 3), cnt = new Float64Array(NB);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx - mn, lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    let c = -1;
    if (sat > 45) {
      let hue = 0;
      if (mx === r) hue = ((gg - b) / sat + 6) % 6; else if (mx === gg) hue = (b - r) / sat + 2; else hue = (r - gg) / sat + 4;
      c = Math.floor((hue / 6) * 12) % 12 * 2 + (lum < 150 ? 0 : 1);
    } else if (lum >= 165 && lum < 238) c = 24 + (lum < 205 ? 0 : 1);
    if (c < 0) continue;
    cls[i] = c; cnt[c]++; sum[c * 3] += r; sum[c * 3 + 1] += gg; sum[c * 3 + 2] += b;
  }
  const layers: ColorLayer[] = [];
  const order = [...Array(NB).keys()].filter((c) => cnt[c] > w * h * 0.003).sort((x, y) => cnt[y] - cnt[x]);
  for (const c of order) {
    // 칸 마스크를 5×5로 부드럽게(경계 계단·잡티 정리) → 0.5 등고선
    const m = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) m[i] = cls[i] === c ? 1 : 0;
    const t = new Float32Array(w * h), o = new Float32Array(w * h), R = 2;
    for (let y = 0; y < h; y++) { let acc = 0; for (let x = -R; x < w + R; x++) { if (x + R < w) acc += m[y * w + x + R]; if (x - R - 1 >= 0) acc -= m[y * w + x - R - 1]; if (x >= 0 && x < w) t[y * w + x] = acc / (2 * R + 1); } }
    for (let x = 0; x < w; x++) { let acc = 0; for (let y = -R; y < h + R; y++) { if (y + R < h) acc += t[(y + R) * w + x]; if (y - R - 1 >= 0) acc -= t[(y - R - 1) * w + x]; if (y >= 0 && y < h) o[y * w + x] = acc / (2 * R + 1); } }
    for (let x = 0; x < w; x++) { o[x] = 0; o[(h - 1) * w + x] = 0; }
    for (let y = 0; y < h; y++) { o[y * w] = 0; o[y * w + w - 1] = 0; }
    const loops = contours(o, w, h, 0.5).filter((l) => area(l) >= 40);
    if (!loops.length) continue;
    const polys = loops.map((l) => loopPoly(l, 0.8)).filter((q) => q.length >= 3);
    const edges = polys.map((q) => polyEdges(q, 6));
    alignEdges(edges.flat(), 1.5);
    const d = polys.map((q, i) => polyPath(rebuild(q, edges[i], 5), edges[i])).join('');
    const n = cnt[c], hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    layers.push({ fill: `#${hex(sum[c * 3])}${hex(sum[c * 3 + 1])}${hex(sum[c * 3 + 2])}`, d, share: n / (w * h) });
    await yieldUI();
  }
  return layers;
}

// ================================================================ 평면 그래픽 벡터화
// 대표 색을 k-평균으로 뽑아 화소마다 가장 가까운 색으로 나누고, 색마다 영역 윤곽을 따서 채운다.
// 곧은 변은 수평·수직(및 setTraceAxes로 정한 축)에 맞추고, 곡선은 매끈하게 둔다.
export type FlatLayer = { fill: string; d: string; strokes: { width: number; d: string }[] };
export type FlatResult = { w: number; h: number; bg: string; layers: FlatLayer[] };

export async function vectorizeFlat(img: HTMLImageElement, onStage?: (s: string) => void, maxColors = 10): Promise<FlatResult> {
  onStage?.('대표 색을 뽑는 중…');
  await yieldUI();
  const W0 = img.naturalWidth, H0 = img.naturalHeight;
  const k = Math.max(1, Math.min(2, Math.sqrt(4e6 / (W0 * H0))));      // 작은 그림은 키워서 가는 선을 살린다
  const w = Math.round(W0 * k), h = Math.round(H0 * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  // k-평균(표본 4만 개, 10회)
  const N = w * h, step = Math.max(1, Math.floor(N / 40000));
  const sample: number[][] = [];
  for (let i = 0; i < N; i += step) sample.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  let C = Array.from({ length: maxColors }, (_, j) => sample[Math.floor(((j + 0.5) / maxColors) * sample.length)].slice());
  // k-means++ 비슷하게: 서로 먼 색부터
  C = [sample[0].slice()];
  while (C.length < maxColors) {
    let best = sample[0], bd = -1;
    for (let i = 0; i < sample.length; i += 7) { const q = sample[i]; const d = Math.min(...C.map((c) => (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2)); if (d > bd) { bd = d; best = q; } }
    if (bd < 300) break;
    C.push(best.slice());
  }
  for (let it = 0; it < 10; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const q of sample) { let bi = 0, bd = Infinity; C.forEach((c, j) => { const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2; if (d < bd) { bd = d; bi = j; } }); const a = acc[bi]; a[0] += q[0]; a[1] += q[1]; a[2] += q[2]; a[3]++; }
    C = acc.filter((a) => a[3] > 0).map((a) => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
  }
  // 비슷한 색 합치기
  const merged: number[][] = [];
  for (const c of C) if (!merged.some((m) => (m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2 + (m[2] - c[2]) ** 2 < 16 ** 2)) merged.push(c);
  C = merged;
  onStage?.(`색 ${C.length}가지로 나누는 중…`);
  await yieldUI();
  const lab = new Uint8Array(N), cnt = new Float64Array(C.length);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    let bi = 0, bd = Infinity;
    for (let j = 0; j < C.length; j++) { const c = C[j], d = (c[0] - r) ** 2 + (c[1] - gg) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; bi = j; } }
    lab[i] = bi; cnt[bi]++;
  }
  // 경계의 중간색(두 주요 색을 잇는 선분 근처의 작은 무리)은 화소마다 가까운 쪽 주요 색으로 합친다
  const total = N, major = [...C.keys()].filter((j) => cnt[j] >= total * 0.012);
  if (major.length < 2) major.splice(0, major.length, ...[...C.keys()].sort((x, y) => cnt[y] - cnt[x]).slice(0, 2));
  const between = new Map<number, [number, number]>();
  for (const j of C.keys()) {
    if (major.includes(j)) continue;
    let best: [number, number] | null = null, bd = 26;
    for (let x = 0; x < major.length; x++) for (let y = x + 1; y < major.length; y++) {
      const A = C[major[x]], B = C[major[y]], c = C[j];
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [c[0] - A[0], c[1] - A[1], c[2] - A[2]];
      const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1, tt = (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / L2;
      if (tt < 0.05 || tt > 0.95) continue;
      const dd = Math.hypot(ac[0] - ab[0] * tt, ac[1] - ab[1] * tt, ac[2] - ab[2] * tt);
      if (dd < bd) { bd = dd; best = [major[x], major[y]]; }
    }
    if (best) between.set(j, best);
  }
  if (between.size) for (let i = 0; i < N; i++) {
    const pair = between.get(lab[i]);
    if (!pair) continue;
    const A = C[pair[0]], B = C[pair[1]], r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const tt = (ab[0] * (r - A[0]) + ab[1] * (gg - A[1]) + ab[2] * (b - A[2])) / L2;
    cnt[lab[i]]--; lab[i] = tt < 0.5 ? pair[0] : pair[1]; cnt[lab[i]]++;
  }
  // 경계 띠 색: 그 색 화소의 절반 이상이 '양옆이 서로 다른 두 색'인 1px 띠면, 화소마다 더 가까운 이웃 색으로 바꾼다
  for (const j of C.keys()) {
    if (cnt[j] === 0 || cnt[j] > N * 0.03) continue;
    let fr = 0, tot = 0;
    const isFringe = (i: number) => {
      const x = i % w; if (x < 1 || x >= w - 1 || i < w || i >= N - w) return -1;
      const L = lab[i - 1], R = lab[i + 1], U = lab[i - w], D = lab[i + w];
      if (L !== j && R !== j && L !== R) return 0;
      if (U !== j && D !== j && U !== D) return 1;
      return -1;
    };
    for (let i = 0; i < N; i++) if (lab[i] === j) { tot++; if (isFringe(i) >= 0) fr++; }
    if (!tot || fr / tot < 0.5) continue;
    for (let i = 0; i < N; i++) {
      if (lab[i] !== j) continue;
      const x = i % w; if (x < 1 || x >= w - 1 || i < w || i >= N - w) continue;
      const cands = [lab[i - 1], lab[i + 1], lab[i - w], lab[i + w]].filter((q) => q !== j);
      if (!cands.length) continue;
      const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
      let bi = cands[0], bd = Infinity;
      for (const q of cands) { const c = C[q], d = (c[0] - r) ** 2 + (c[1] - gg) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; bi = q; } }
      cnt[j]--; lab[i] = bi; cnt[bi]++;
    }
  }
  const order = [...C.keys()].filter((j) => cnt[j] > 0).sort((x, y) => cnt[y] - cnt[x]);
  const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const bg = hex(C[order[0]]);
  const layers: FlatLayer[] = [];
  const t = new Float32Array(N);
  const rT = Math.max(2, Math.round(3 * k));          // 이보다 얇으면(약 6px 미만) 선으로 본다
  for (const ci of order.slice(1)) {
    onStage?.(`색 면·선을 따는 중… (${layers.length + 1}/${order.length - 1})`);
    await yieldUI();
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = lab[i] === ci ? 1 : 0;
    // 열림 연산으로 굵은 부분(면)과 얇은 부분(선)을 나눈다
    const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = 1 - mask[i];
    const er = dilate(inv, w, h, rT); for (let i = 0; i < N; i++) er[i] = 1 - er[i];
    const thick = dilate(er, w, h, rT + 1); for (let i = 0; i < N; i++) thick[i] &= mask[i];
    // 아주 작은 면 조각(선이 꺾이며 살짝 두꺼워진 곳)은 선으로 되돌린다
    dropSmall(thick, w, h, (rT * 2.5) ** 2);
    const thin = new Uint8Array(N); for (let i = 0; i < N; i++) thin[i] = mask[i] && !thick[i] ? 1 : 0;
    // 면: 부드럽게 → 등고선 → 사각형·둥근 사각형·원·타원이면 정확한 도형, 아니면 직선 교정 패스
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      t[i] = (thick[i - w - 1] + thick[i - w] * 2 + thick[i - w + 1] + thick[i - 1] * 2 + thick[i] * 4 + thick[i + 1] * 2 + thick[i + w - 1] + thick[i + w] * 2 + thick[i + w + 1]) / 16;
    }
    for (let x = 0; x < w; x++) { t[x] = 0; t[(h - 1) * w + x] = 0; }
    for (let y = 0; y < h; y++) { t[y * w] = 0; t[y * w + w - 1] = 0; }
    const loops = contours(t, w, h, 0.45).filter((l) => area(l) >= 6 * k * k).map((l) => l.map(([x, y]) => [x / k, y / k] as Pt));
    const parts: string[] = [], free: Pt[][] = [];
    for (const l of loops) { const sh = fitShape(l); if (sh) parts.push(sh); else free.push(l); }
    const polys = free.map((l) => loopPoly(smoothClosed(l, 2), 0.5)).filter((q) => q.length >= 3);
    const edges = polys.map((q) => polyEdges(q, 6));
    alignEdges(edges.flat(), 1.2);
    parts.push(...polys.map((q, i) => polyPath(rebuild(q, edges[i], 3), edges[i])));
    // 선: 중심선을 따서 일정 굵기의 한 줄 패스로
    const strokes = await strokeVector(thin, thick, w, h, k);
    if (parts.length || strokes.length) layers.push({ fill: hex(C[ci]), d: parts.join(''), strokes });
  }
  return { w: W0, h: H0, bg, layers };
}

export function flatSvg(r: FlatResult) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.w} ${r.h}" width="${r.w}" height="${r.h}"><rect width="${r.w}" height="${r.h}" fill="${r.bg}"/>` +
    r.layers.map((l) => (l.d ? `<path fill="${l.fill}" fill-rule="evenodd" d="${l.d}"/>` : '') +
      l.strokes.map((st) => `<path fill="none" stroke="${l.fill}" stroke-width="${st.width}" stroke-linecap="round" stroke-linejoin="round" d="${st.d}"/>`).join('')).join('') + '</svg>';
}

// ---------------------------------------------------------------- 도형 맞춤
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
/** 윤곽이 원·타원·사각형·둥근 사각형에 가까우면 그 정확한 도형의 패스, 아니면 null */
function fitShape(l: Pt[]): string | null {
  if (l.length < 8) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 4 || bh < 4) return null;
  const A = area(l), fill = A / (bw * bh), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // 타원(원)
  const rx = bw / 2, ry = bh / 2;
  let err = 0;
  for (const [x, y] of l) err += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
  if (err / l.length < 0.035 && Math.abs(fill - Math.PI / 4) < 0.04) {
    const r2 = Math.abs(rx - ry) / Math.max(rx, ry) < 0.05 ? [(rx + ry) / 2, (rx + ry) / 2] : [rx, ry];
    return `M${n1(cx - r2[0])} ${n1(cy)}A${n1(r2[0])} ${n1(r2[1])} 0 1 0 ${n1(cx + r2[0])} ${n1(cy)}A${n1(r2[0])} ${n1(r2[1])} 0 1 0 ${n1(cx - r2[0])} ${n1(cy)}Z`;
  }
  // 사각형 / 둥근 사각형
  if (fill > 0.985) {
    // 모든 점이 상자 테두리 근처여야 사각형
    let bad = 0;
    for (const [x, y] of l) if (Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1)) > 1.2) bad++;
    if (bad / l.length < 0.03) return `M${n1(x0)} ${n1(y0)}H${n1(x1)}V${n1(y1)}H${n1(x0)}Z`;
  }
  if (fill > 0.78 && fill <= 0.995) {
    const r = Math.sqrt(Math.max(0, (bw * bh - A) / (4 - Math.PI)));
    if (r < 1.5 || r > Math.min(bw, bh) / 2 + 0.5) return null;
    // 둥근 사각형 테두리까지 거리 평균이 1px 안쪽이어야
    let e2 = 0;
    for (const [x, y] of l) {
      const qx = Math.max(Math.abs(x - cx) - (bw / 2 - r), 0), qy = Math.max(Math.abs(y - cy) - (bh / 2 - r), 0);
      const inner = Math.min(Math.max(Math.abs(x - cx) - bw / 2, Math.abs(y - cy) - bh / 2), 0);
      e2 += Math.abs(Math.hypot(qx, qy) + inner - r);
    }
    if (e2 / l.length > 0.9) return null;
    const rr = Math.min(r, bw / 2, bh / 2);
    return `M${n1(x0 + rr)} ${n1(y0)}H${n1(x1 - rr)}A${n1(rr)} ${n1(rr)} 0 0 1 ${n1(x1)} ${n1(y0 + rr)}V${n1(y1 - rr)}A${n1(rr)} ${n1(rr)} 0 0 1 ${n1(x1 - rr)} ${n1(y1)}H${n1(x0 + rr)}A${n1(rr)} ${n1(rr)} 0 0 1 ${n1(x0)} ${n1(y1 - rr)}V${n1(y0 + rr)}A${n1(rr)} ${n1(rr)} 0 0 1 ${n1(x0 + rr)} ${n1(y0)}Z`;
  }
  return null;
}

// ---------------------------------------------------------------- 가는 선 → 중심선 패스
/** 마스크 안쪽 거리(px, 3-4 체임퍼 근사) */
function insideDist(m: Uint8Array, w: number, h: number) {
  const d = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? 9999 : 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], d[i - 1] + 3, d[i - w] + 3, d[i - w - 1] + 4, d[i - w + 1] + 4);
  }
  for (let y = h - 2; y > 0; y--) for (let x = w - 2; x > 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], d[i + 1] + 3, d[i + w] + 3, d[i + w + 1] + 4, d[i + w - 1] + 4);
  }
  return d;
}

type SPiece = { a: Pt; b: Pt; straight: boolean; dir: number; pts: Pt[] };

async function strokeVector(thin: Uint8Array, thick: Uint8Array, w: number, h: number, k: number) {
  let any = false; for (let i = 0; i < w * h; i++) if (thin[i]) { any = true; break; }
  if (!any) return [];
  const dist = insideDist(thin, w, h);
  const sk = thin.slice();
  for (let x = 0; x < w; x++) { sk[x] = 0; sk[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { sk[y * w] = 0; sk[y * w + w - 1] = 0; }
  await thin2(sk, w, h);
  const raw = chains(sk, w, h);
  // 굵기: 중심선 위 거리의 2배(px), 선마다 중앙값
  const items = raw.map((c) => {
    const ws = c.map(([x, y]) => (2 * dist[y * w + x]) / 3 - 0.6).filter((v) => v > 0).sort((p, q) => p - q);   // 원본 획 폭(아래 면의 빈자리와 같게)
    return { c, width: (ws.length ? ws[ws.length >> 1] : 0) / k };
  }).filter((it) => it.width >= 0.75 && it.c.length >= Math.max(4, it.width * k * 1.5));   // 경계 잔선·짧은 가시는 버림
  // 끝끼리 가까운(굵기 2.5배 안) 선 조각은 하나의 선으로 이어 붙인다 → 한 패스
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (Math.abs(A.width - B.width) > Math.max(1, 0.35 * Math.max(A.width, B.width))) continue;
      const R = Math.max(4, Math.max(A.width, B.width) * k * 3.5);
      const ends: [Pt, Pt, boolean, boolean][] = [[A.c[A.c.length - 1], B.c[0], false, false], [A.c[A.c.length - 1], B.c[B.c.length - 1], false, true], [A.c[0], B.c[0], true, false], [A.c[0], B.c[B.c.length - 1], true, true]];
      for (const [p, q, revA, revB] of ends) {
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > R) continue;
        const ca = revA ? A.c.slice().reverse() : A.c, cb = revB ? B.c.slice().reverse() : B.c;
        A.c = [...ca, ...cb]; A.width = (A.width * ca.length + B.width * cb.length) / (ca.length + cb.length);
        items.splice(j, 1); changed = true; break outer;
      }
    }
  }
  // 끝 잇기: 자유로운 끝이 다른 선·면에서 굵기의 2.5배 안이면 그 점까지 늘인다
  const allPts: Pt[] = items.flatMap((it) => it.c);
  const grid = new Map<number, Pt[]>(), G = 8;
  for (const p of allPts) { const key = Math.floor(p[0] / G) * 100000 + Math.floor(p[1] / G); (grid.get(key) ?? grid.set(key, []).get(key)!).push(p); }
  const nearestOther = (p: Pt, own: Pt[], R: number): Pt | null => {
    let best: Pt | null = null, bd = R;
    for (let gx = Math.floor((p[0] - R) / G); gx <= Math.floor((p[0] + R) / G); gx++) for (let gy = Math.floor((p[1] - R) / G); gy <= Math.floor((p[1] + R) / G); gy++)
      for (const q of grid.get(gx * 100000 + gy) ?? []) { if (own.includes(q)) continue; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd && d > 1.5) { bd = d; best = q; } }
    // 굵은 면 가장자리
    for (let r = 1; r <= R; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = p[0] + dx, y = p[1] + dy;
      if (x > 0 && y > 0 && x < w && y < h && thick[y * w + x] && r < bd) { bd = r; best = [x, y]; }
    }
    return best;
  };
  for (const it of items) {
    const R = Math.max(3, it.width * k * 2.5);
    for (const end of [0, 1]) {
      const p = end ? it.c[it.c.length - 1] : it.c[0];
      const q = nearestOther(p, it.c, R);
      if (q) { if (end) it.c.push(q); else it.c.unshift(q); }
    }
  }
  // 조각으로 나눠 직선은 축에 맞추고(같은 줄은 정렬), 곡선은 매끈하게
  const pieces: { it: typeof items[number]; ps: SPiece[] }[] = [];
  const straightAll: SPiece[] = [];
  for (const it of items) {
    const ps: SPiece[] = [];
    for (const piece of splitCorners(it.c)) {
      if (piece.length < 2) continue;
      const pts = rdp(smooth(piece, 2), 0.7).map(([x, y]) => [x / k, y / k] as Pt);
      let a = pts[0], b = pts[pts.length - 1];
      const straight = pts.length === 2 || rdp(pts, 1.0).length === 2;
      let dir = -1;
      if (straight) {
        const vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1;
        AXIS_DIRS.forEach((u, j) => { if (Math.abs(u[0] * vy - u[1] * vx) / L < SNAP && dir < 0) dir = j; });
        if (dir >= 0) {
          const u = AXIS_DIRS[dir], m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], hl = (u[0] * vx + u[1] * vy) / 2;
          a = [m[0] - u[0] * hl, m[1] - u[1] * hl]; b = [m[0] + u[0] * hl, m[1] + u[1] * hl];
        }
      }
      const sp: SPiece = { a, b, straight, dir, pts };
      ps.push(sp);
      if (straight && dir >= 0) straightAll.push(sp);
    }
    pieces.push({ it, ps });
  }
  // 같은 축·같은 줄(1.5px 안) 직선은 한 줄로
  for (let j = 0; j < AXIS_DIRS.length; j++) {
    const u = AXIS_DIRS[j], nrm: Pt = [-u[1], u[0]];
    const L = straightAll.filter((p) => p.dir === j).map((p) => ({ p, o: nrm[0] * (p.a[0] + p.b[0]) / 2 + nrm[1] * (p.a[1] + p.b[1]) / 2 })).sort((x, y) => x.o - y.o);
    let g: typeof L = [];
    const flush = () => {
      if (g.length > 1) {
        const o = g.reduce((t, q) => t + q.o, 0) / g.length;
        for (const q of g) { const d = o - q.o; q.p.a = [q.p.a[0] + nrm[0] * d, q.p.a[1] + nrm[1] * d]; q.p.b = [q.p.b[0] + nrm[0] * d, q.p.b[1] + nrm[1] * d]; }
      }
      g = [];
    };
    for (const q of L) { if (g.length && q.o - g[g.length - 1].o > 1.5) flush(); g.push(q); }
    flush();
  }
  // 한 선 = 한 패스. 이웃 직선 조각은 교점에서 만나게
  const byWidth = new Map<number, string[]>();
  for (const { it, ps } of pieces) {
    if (!ps.length) continue;
    const pt: Pt[] = [];
    let d = '';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], prev = ps[i - 1];
      let start = p.a;
      if (prev && prev.straight && p.straight && prev.dir !== p.dir) {
        const X = lineX(prev.a, prev.b, p.a, p.b);
        if (X && Math.hypot(X[0] - p.a[0], X[1] - p.a[1]) < 3 * Math.max(2, it.width)) start = X;
      } else if (prev) start = prev.straight && p.straight ? [(prev.b[0] + p.a[0]) / 2, (prev.b[1] + p.a[1]) / 2] : (prev.straight ? prev.b : p.a);
      if (!i) d += `M${n1(start[0])} ${n1(start[1])}`; else d += `L${n1(start[0])} ${n1(start[1])}`;
      pt.push(start);
      if (p.straight) { const nx = ps[i + 1]; if (!nx || !nx.straight) d += `L${n1(p.b[0])} ${n1(p.b[1])}`; }
      else {
        const q = p.pts;
        for (let j = 0; j < q.length - 1; j++) {
          const p0 = q[j - 1] ?? q[j], p1 = q[j], p2 = q[j + 1], p3 = q[j + 2] ?? p2;
          d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`;
        }
      }
    }
    const wk = Math.round(it.width * 2) / 2;      // 0.5px 단위로 묶는다
    (byWidth.get(wk) ?? byWidth.set(wk, []).get(wk)!).push(d);
  }
  return [...byWidth].map(([width, ds]) => ({ width, d: ds.join('') }));
}
function lineX(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = [b[0] - a[0], b[1] - a[1]], s2 = [d[0] - c[0], d[1] - c[1]], den = r[0] * s2[1] - r[1] * s2[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((c[0] - a[0]) * s2[1] - (c[1] - a[1]) * s2[0]) / den;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}
const thin2 = (m: Uint8Array, w: number, h: number) => thin(m, w, h);
/** 면적이 minArea보다 작은 연결 덩어리를 지운다 */
function dropSmall(m: Uint8Array, w: number, h: number, minArea: number) {
  const seen = new Uint8Array(w * h), stack: number[] = [], comp: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || seen[i]) continue;
    comp.length = 0; stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!; comp.push(j);
      const x = j % w;
      for (const o of [x > 0 ? -1 : 0, x < w - 1 ? 1 : 0, -w, w]) { const q = j + o; if (o && q >= 0 && q < w * h && m[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    if (comp.length < minArea) for (const j of comp) m[j] = 0;
  }
}
function smoothClosed(l: Pt[], r: number): Pt[] {
  const n = l.length;
  if (n < 2 * r + 3) return l;
  return l.map((_, i) => { let x = 0, y = 0; for (let k = -r; k <= r; k++) { const q = l[(i + k + n) % n]; x += q[0]; y += q[1]; } return [x / (2 * r + 1), y / (2 * r + 1)] as Pt; });
}
