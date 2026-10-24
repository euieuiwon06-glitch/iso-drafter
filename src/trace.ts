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
let OUT = 1;      // 평면 그래픽: 기준 좌표 → 원래 크기
const f1 = (v: number) => (Math.round(v * OUT * 10) / 10).toString();

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
let SNAP = Math.sin((7 * Math.PI) / 180);
/** 투영 축(화면 각도, 도)으로 교정 축을 정한다: 수직 + A축 + B축 + 수평 */
export function setTraceAxes(aDeg: number, bDeg: number) {
  const d = (t: number): Pt => [Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180)];
  AXIS_DIRS = [d(90), d(aDeg), d(bDeg), d(0)];
  SNAP = Math.sin((7 * Math.PI) / 180);
}
/** 축 목록(화면 각도, 도)과 허용 각도로 교정 축을 정한다. 빈 목록이면 곧게 펴지 않는다 */
export function setTraceAxisList(degs: number[], tolDeg = 7) {
  AXIS_DIRS = degs.map((t): Pt => [Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180)]);
  SNAP = Math.sin((tolDeg * Math.PI) / 180);
}
setTraceAxes(30, -30);


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
    const d = polys.map((q, i) => polyPath(rebuild(q, edges[i], 3), edges[i])).join('');
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
export type FlatResult = { w: number; h: number; bg: string; layers: FlatLayer[]; axes: number[] };

export async function vectorizeFlat(img: HTMLImageElement, onStage?: (s: string) => void, maxColors = 10): Promise<FlatResult> {
  onStage?.('대표 색을 뽑는 중…');
  await yieldUI();
  const W0 = img.naturalWidth, H0 = img.naturalHeight;
  // 그림 크기와 상관없이 같은 기준으로 따도록 긴 변 1000px(기준 좌표)로 맞추고, 그 2배 해상도에서 작업한다. 출력은 원래 크기로 되돌린다
  const U = 1000 / Math.max(W0, H0), k = 2;
  const w = Math.round(W0 * U * k), h = Math.round(H0 * U * k);
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
  // 진짜 색 / 경계 중간색(안티앨리어싱) 가르기:
  // 양옆(1~2칸, 가로·세로·대각)이 서로 다른 두 색이고 그 화소 색이 두 색 사이에 있으면 경계 화소로 보고,
  // 그 화소는 주변의 진짜 색들 사이 섞임 비율(덮임 정도)로 나눠 준다 → 1px 선도 끊기지 않고, 면 가장자리에 다른 색 테가 생기지 않는다.
  const betw = (i: number, A: number, B: number) => {
    const ca = C[A], cb = C[B], ab0 = cb[0] - ca[0], ab1 = cb[1] - ca[1], ab2 = cb[2] - ca[2];
    const L2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2; if (L2 < 900) return false;
    const r = px[i * 4] - ca[0], gg = px[i * 4 + 1] - ca[1], b = px[i * 4 + 2] - ca[2];
    const t = (ab0 * r + ab1 * gg + ab2 * b) / L2;
    return t > 0.04 && t < 0.96 && Math.hypot(r - ab0 * t, gg - ab1 * t, b - ab2 * t) < 30;
  };
  const OFF = [1, w, w + 1, w - 1, 2, 2 * w, 2 * w + 2, 2 * w - 2];
  const solid = new Uint8Array(N), sc = new Float64Array(C.length);
  for (let i = 0; i < N; i++) {
    const j = lab[i], x = i % w;
    let f = false;
    if (x >= 2 && x < w - 2 && i >= 2 * w && i < N - 2 * w) for (const o of OFF) {
      const A = lab[i - o], B = lab[i + o];
      if (A !== j && B !== j && A !== B && betw(i, A, B)) { f = true; break; }
    }
    if (!f) { solid[i] = 1; sc[j]++; }
  }
  const real = new Uint8Array(C.length);
  for (const j of C.keys()) real[j] = sc[j] >= N * 0.0005 ? 1 : 0;
  if (!real.some((v) => v)) real[[...C.keys()].sort((x, y) => sc[y] - sc[x])[0]] = 1;
  const rT = Math.max(2, Math.round(3 * k));          // 이보다 얇으면(약 6px 미만) 선으로 본다
  // 선으로만 쓰인 색이 배경과 다른 선 색 사이에 있으면(옅게 번진 가는 선) 그 선 색으로 합친다
  const canon = [...C.keys()];
  {
    const bg0 = [...C.keys()].filter((j) => real[j]).sort((x, y) => sc[y] - sc[x])[0];
    const lineOnly = new Uint8Array(C.length);
    for (const j of C.keys()) {
      if (!real[j] || j === bg0) continue;
      const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = lab[i] === j ? 0 : 1;
      const er = dilate(inv, w, h, rT);
      let core = 0; for (let i = 0; i < N; i++) if (!er[i]) core++;
      lineOnly[j] = core < sc[j] * 0.08 ? 1 : 0;
    }
    const cB = C[bg0];
    for (const j of [...C.keys()].sort((x, y) => Math.hypot(...C[x].map((v, q) => v - cB[q])) - Math.hypot(...C[y].map((v, q) => v - cB[q])))) {
      if (!lineOnly[j]) continue;
      let best = -1, bd = Infinity;
      for (const B of C.keys()) {
        if (B === j || B === bg0 || !real[B] || !lineOnly[B]) continue;
        const ca = cB, cb = C[B], ab = cb.map((v, q) => v - ca[q]), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
        const ac = C[j].map((v, q) => v - ca[q]), t = (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / L2;
        if (t < 0.12 || t > 0.95) continue;
        if (Math.hypot(ac[0] - ab[0] * t, ac[1] - ab[1] * t, ac[2] - ab[2] * t) > 22) continue;
        const d = Math.hypot(...C[j].map((v, q) => v - cb[q]));
        if (d < bd) { bd = d; best = B; }
      }
      if (best >= 0) canon[j] = best;
    }
    for (const j of C.keys()) { let c = j; while (canon[c] !== c) c = canon[c]; canon[j] = c; }
    for (const j of C.keys()) if (canon[j] !== j) { sc[canon[j]] += sc[j]; real[j] = 0; }
  }
  const bgI = [...C.keys()].filter((j) => real[j]).sort((x, y) => sc[y] - sc[x])[0];
  const fgs = [...C.keys()].filter((j) => real[j] && j !== bgI).sort((x, y) => sc[y] - sc[x]);
  const cov = new Map<number, Float32Array>(fgs.map((j) => [j, new Float32Array(N)]));
  for (let i = 0; i < N; i++) {
    const j = canon[lab[i]];
    if (solid[i] && real[j]) { if (j !== bgI) cov.get(j)![i] = 1; continue; }
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    const S: number[] = [bgI];
    const x = i % w, y = (i / w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx, l = canon[lab[q]]; if (solid[q] && real[l] && !S.includes(l)) S.push(l);
    }
    if (S.length === 1) S.push(...fgs);
    let bA = -1, bB = -1, bt = 0, br = Infinity;
    for (const A of S) for (const B of S) {
      if (A === B || B === bgI) continue;
      const ca = C[A], cb = C[B], ab0 = cb[0] - ca[0], ab1 = cb[1] - ca[1], ab2 = cb[2] - ca[2];
      const L2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2 || 1;
      const t = Math.max(0, Math.min(1, (ab0 * (r - ca[0]) + ab1 * (gg - ca[1]) + ab2 * (b - ca[2])) / L2));
      const res = Math.hypot(r - ca[0] - ab0 * t, gg - ca[1] - ab1 * t, b - ca[2] - ab2 * t);
      if (res < br) { br = res; bA = A; bB = B; bt = t; }
    }
    if (bB < 0) continue;
    cov.get(bB)![i] += bt;
    if (bA !== bgI) cov.get(bA)![i] += 1 - bt;
  }
  const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const bg = hex(C[bgI]);
  type Pass = { fill: string; shapes: Pt[][]; polys: Pt[][]; lines: SLine[] };
  const pass: Pass[] = [];
  const samples: [number, number][] = [];               // 곧은 변·선의 [각도, 길이] → 그림의 축 판단
  const sm = new Float32Array(N), tf = new Float32Array(N), thickAll = new Uint8Array(N);
  const thicks = new Map<number, Uint8Array>();
  for (const ci of fgs) {
    onStage?.(`색 면을 나누는 중… (${thicks.size + 1}/${fgs.length})`);
    await yieldUI();
    const cv0 = cov.get(ci)!;
    blur3(cv0, sm, w, h);
    const mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = sm[i] >= 0.4 || cv0[i] >= 0.3 ? 1 : 0;
    // 열림 연산으로 굵은 부분(면)과 얇은 부분(선 후보)을 나눈다
    const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = 1 - mask[i];
    const er = dilate(inv, w, h, rT); for (let i = 0; i < N; i++) er[i] = 1 - er[i];
    const thick = dilate(er, w, h, rT + 1); for (let i = 0; i < N; i++) thick[i] &= mask[i];
    // 굵게 잡혔어도 길쭉한 띠(굵은 선의 일부)는 선 후보로
    const din = insideDist(mask, w, h);
    for (const comp of components(thick, w, h)) {
      let mx = 0; for (const j of comp) if (din[j] > mx) mx = din[j];
      const wpx = (2 * mx) / 3;
      if (wpx <= 6.5 * k && comp.length >= 5 * wpx * wpx) for (const j of comp) thick[j] = 0;
    }
    dropSmall(thick, w, h, (rT * 2.5) ** 2);
    for (let i = 0; i < N; i++) thickAll[i] |= thick[i];
    thicks.set(ci, thick);
  }
  // 선 후보: 모든 색의 얇은 부분을 한꺼번에 중심선으로(번진 가장자리 때문에 한 선이 여러 색으로 쪼개지지 않게)
  onStage?.('구조선을 찾는 중…');
  await yieldUI();
  const covU = new Float32Array(N);
  for (const c of cov.values()) for (let i = 0; i < N; i++) covU[i] += c[i];
  for (let i = 0; i < N; i++) if (covU[i] > 1) covU[i] = 1;
  blur3(covU, sm, w, h);
  const thinU = new Uint8Array(N);
  for (let i = 0; i < N; i++) thinU[i] = (sm[i] >= 0.4 || covU[i] >= 0.3) && !thickAll[i] ? 1 : 0;
  const plen = (c: Pt[]) => { let t = 0; for (let i = 1; i < c.length; i++) t += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); return t; };
  // 구조선만 다시 그린다: 길고(굵기의 12배·12px 이상) 굵기가 고른 선. 짧거나 굵기가 들쭉날쭉한 것(실루엣·나무·소품)은 원본 모양 그대로 면으로 둔다
  const dBg = (j: number) => Math.hypot(C[j][0] - C[bgI][0], C[j][1] - C[bgI][1], C[j][2] - C[bgI][2]);
  const colorOf = (c: Pt[]) => {
    const acc = new Map<number, number>();
    for (let i = 0; i < c.length; i++) {
      const x = Math.round(c[i][0]), y = Math.round(c[i][1]);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const q = y * w + x;
      for (const [j, cc] of cov) if (cc[q] > 0 && !thicks.get(j)![q]) acc.set(j, (acc.get(j) ?? 0) + cc[q]);
    }
    // 가장 많이 덮인 색이 기본. 그 색이 배경과 어떤 색 사이의 번진 색이고 그 색도 선 위에 꽤(30% 이상) 있으면 그 색이 본래 색
    let best = -1, bv = 0;
    for (const [j, v] of acc) if (v > bv) { bv = v; best = j; }
    if (best >= 0) for (const [j, v] of acc) {
      if (j === best || v < bv * 0.3 || dBg(j) <= dBg(best)) continue;
      const A = C[bgI], B = C[j], P = C[best], ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const ap = [P[0] - A[0], P[1] - A[1], P[2] - A[2]], t = (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / L2;
      if (t > 0.1 && t < 0.95 && Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) < 25) best = j;
    }
    return best;
  };
  // 같은 색이 번져 옅어진 관계(배경→진한 색 사이)면 같은 선으로 본다
  const onRay = (a: number, b: number) => {
    const A = C[bgI], B = C[b], P = C[a], ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const ap = [P[0] - A[0], P[1] - A[1], P[2] - A[2]], t = (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / L2;
    return t > 0.1 && t < 0.95 && Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) < 25;
  };
  const sameColor = (a: number, b: number) => a === b || (a >= 0 && b >= 0 && (onRay(a, b) || onRay(b, a)));
  const allChains = (await strokeLines(thinU, thickAll, covU, w, h, k, colorOf, sameColor)).filter((m) => {
    if (m.color < 0 || m.spread > 0.45 || plen(m.c) < Math.max(24 * k, 12 * m.width * k)) return false;
    // 구조선 = 대부분 직선이거나 완만한 곡선. 가지·덤불처럼 자주 꺾이는 선은 원본 모양 그대로(면) 둔다
    const segs = fitChain(m.c, k, m.width, m.closed);
    let ls = 0, lt = 0;
    for (const sg of segs) {
      const L = sg.t === 'L' ? Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) : sg.pts.reduce((t, q, i) => (i ? t + Math.hypot(q[0] - sg.pts[i - 1][0], q[1] - sg.pts[i - 1][1]) : 0), 0);
      lt += L; if (sg.t === 'L') ls += L;
    }
    if (lt > 0 && ls / lt >= 0.6) return true;
    const turns = rdp(m.c, 1.2 * k).length - 2;
    return turns <= (lt * k) / (18 * k) * 0.6;
  });
  const byColor = new Map<number, Chain[]>();
  for (const m of allChains) (byColor.get(m.color) ?? byColor.set(m.color, []).get(m.color)!).push(m);
  // 다시 그린 선 자리의 원본 화소는 면에서 뺀다
  const zone = new Uint8Array(N);
  const mU = new Uint8Array(N); for (let i = 0; i < N; i++) mU[i] = thinU[i] | thickAll[i];
  const dU = insideDist(mU, w, h), blob = new Uint8Array(N), nearFill = dilate(thickAll, w, h, rT + 1);
  let maxW = 0; for (const ms of byColor.values()) for (const m of ms) maxW = Math.max(maxW, m.width);
  for (const ms of byColor.values()) for (const m of ms) {
    const r = Math.ceil(m.width * k / 2 + 2), keepIn = (m.width * k / 2 + 1.5) * 3;   // 선보다 두꺼운 곳(동선의 점 등)은 남긴다
    for (const [px0, py0] of m.c) {
      const cx = Math.round(px0), cy = Math.round(py0);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || dx * dx + dy * dy > r * r) continue;
        const q = y * w + x; if (nearFill[q]) continue; if (dU[q] <= keepIn) zone[q] = 1; else blob[q] = 1;
      }
    }
  }
  { const keepB = dilate(blob, w, h, Math.ceil(maxW * k / 2 + 2)); for (let i = 0; i < N; i++) if (keepB[i]) zone[i] = 0; }   // 선 위의 점(동선 노드)은 통째로 남긴다
  // 면: 원본 모양 그대로(덮임 0.5 등고선) → 사각형·둥근 사각형·원·타원이면 정확한 도형, 아니면 직선 교정 패스
  for (const ci of fgs) {
    onStage?.(`색 면을 따는 중… (${pass.length + 1}/${fgs.length})`);
    await yieldUI();
    const s2 = cov.get(ci)!;      // 흐리지 않은 덮임 그대로 → 창문 같은 작은 구멍·디테일도 살린다
    for (let i = 0; i < N; i++) tf[i] = zone[i] ? 0 : s2[i];
    for (let x = 0; x < w; x++) { tf[x] = 0; tf[(h - 1) * w + x] = 0; }
    for (let y = 0; y < h; y++) { tf[y * w] = 0; tf[y * w + w - 1] = 0; }
    const loops = contours(tf, w, h, 0.5).filter((l) => area(l) >= 8 * k * k).map((l) => l.map(([x, y]) => [x / k, y / k] as Pt));
    const shapes: Pt[][] = [], free: Pt[][] = [];
    for (const l of loops) { if (fitShape(l)) shapes.push(l); else free.push(l); }
    const polys = free.map((l) => loopPoly(smoothClosed(l, 2), 0.5)).filter((q) => q.length >= 3);
    for (const q of polys) for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L >= 10) samples.push([angOf(a, b), L]);
    }
    pass.push({ fill: hex(C[ci]), shapes, polys, lines: [] });
  }
  const strokeLayers: { fill: string; lines: SLine[] }[] = [];
  for (const [j, ms] of byColor) {
    unifyWidths(ms);
    const lines = ms.map((m) => ({ width: m.width, closed: m.closed, segs: fitChain(m.c, k, m.width, m.closed) }));
    for (const ln of lines) for (const s of ln.segs) if (s.t === 'L') { const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); if (L >= 6) samples.push([angOf(s.a, s.b), L]); }
    strokeLayers.push({ fill: hex(C[j]), lines });
  }
  // 그림에 실제로 많이 쓰인 직선 방향만 축으로 삼는다(수평·수직이 없으면 안 맞추고, 대각선이 많으면 대각선도 축)
  const axes = detectAxes(samples);
  setTraceAxisList(axes, 4.5);
  const layers: FlatLayer[] = [];
  OUT = 1 / U;
  try {
  for (const P of pass) {
    const edges = P.polys.map((q) => polyEdges(q, 6));
    alignEdges(edges.flat(), 1.2);
    const parts = [...P.shapes.map((l) => fitShape(l)!), ...P.polys.map((q, i) => polyPath(rebuild(q, edges[i], 5), edges[i]))];
    const strokes = strokePaths(P.lines);
    if (parts.length || strokes.length) layers.push({ fill: P.fill, d: parts.join(''), strokes });
  }
  prepareLines(strokeLayers.flatMap((L) => L.lines));
  for (const L of strokeLayers) { const strokes = strokePaths(L.lines); if (strokes.length) layers.push({ fill: L.fill, d: '', strokes }); }
  } finally { OUT = 1; }
  return { w: W0, h: H0, bg, layers, axes: axes.map((a) => a) };
}

const angOf = (a: Pt, b: Pt) => ((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180) + 180) % 180;

/** 직선들의 [각도, 길이] 분포에서 봉우리(전체 길이의 6% 이상)를 축으로. 수평·수직 근처(2°)는 정확히 0°/90° */
function detectAxes(samples: [number, number][]): number[] {
  const raw = new Float64Array(180);
  let tot = 0;
  for (const [a, l] of samples) { raw[Math.round(a) % 180] += l; tot += l; }
  if (tot < 80) return [];
  const mass = (d: number) => { let s = 0; for (let q = -3; q <= 3; q++) s += raw[(d + q + 180) % 180]; return s; };
  const M = Array.from({ length: 180 }, (_, d) => mass(d));
  const peaks: { ang: number; m: number }[] = [];
  for (let d = 0; d < 180; d++) {
    const v = M[d];
    if (v < tot * 0.06 || v < 60) continue;
    let top = true; for (let q = -4; q <= 4; q++) if (q && M[(d + q + 180) % 180] > v) top = false;
    if (!top) continue;
    let sx = 0, sw = 0; for (let q = -3; q <= 3; q++) { sx += q * raw[(d + q + 180) % 180]; sw += raw[(d + q + 180) % 180]; }
    let ang = (((d + sx / (sw || 1)) % 180) + 180) % 180;
    if (Math.min(ang, 180 - ang) < 2) ang = 0; else if (Math.abs(ang - 90) < 2) ang = 90;
    if (!peaks.some((p) => Math.min(Math.abs(p.ang - ang), 180 - Math.abs(p.ang - ang)) < 6)) peaks.push({ ang, m: v });
  }
  return peaks.sort((a, b) => b.m - a.m).slice(0, 6).map((p) => Math.round(p.ang * 10) / 10);
}

function blur3(s: Float32Array, o: Float32Array, w: number, h: number) {
  const t = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (s[x > 0 ? i - 1 : i] + 2 * s[i] + s[x < w - 1 ? i + 1 : i]) / 4; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = (t[y > 0 ? i - w : i] + 2 * t[i] + t[y < h - 1 ? i + w : i]) / 4; }
}

/** 4방향 연결 덩어리(화소 번호 목록) */
function components(m: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h), out: number[][] = [], st: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || seen[i]) continue;
    const comp: number[] = []; st.push(i); seen[i] = 1;
    while (st.length) {
      const j = st.pop()!; comp.push(j);
      const x = j % w;
      for (const o of [x > 0 ? -1 : 0, x < w - 1 ? 1 : 0, -w, w]) { const q = j + o; if (o && q >= 0 && q < w * h && m[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
    }
    out.push(comp);
  }
  return out;
}

export function flatSvg(r: FlatResult) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.w} ${r.h}" width="${r.w}" height="${r.h}"><rect width="${r.w}" height="${r.h}" fill="${r.bg}"/>` +
    r.layers.map((l) => (l.d ? `<path fill="${l.fill}" fill-rule="evenodd" d="${l.d}"/>` : '') +
      l.strokes.map((st) => `<path fill="none" stroke="${l.fill}" stroke-width="${st.width}" stroke-linecap="round" stroke-linejoin="round" d="${st.d}"/>`).join('')).join('') + '</svg>';
}

// ---------------------------------------------------------------- 도형 맞춤
const n1 = (v: number) => (Math.round(v * OUT * 10) / 10).toString();
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
    if (r > Math.min(bw, bh) / 2 + 0.5) return null;
    // 모서리 번짐 정도로만 깎인 것(반지름이 작은 것)은 각진 사각형
    if (r < Math.max(2.5, 0.1 * Math.min(bw, bh))) {
      let bad = 0;
      for (const [x, y] of l) if (Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1)) > 1.5) bad++;
      return bad / l.length < 0.06 ? `M${n1(x0)} ${n1(y0)}H${n1(x1)}V${n1(y1)}H${n1(x0)}Z` : null;
    }
    // 둥근 사각형 테두리까지 거리 평균이 1px 안쪽이어야
    let e2 = 0;
    for (const [x, y] of l) {
      const qx = Math.max(Math.abs(x - cx) - (bw / 2 - r), 0), qy = Math.max(Math.abs(y - cy) - (bh / 2 - r), 0);
      const inner = Math.min(Math.max(Math.abs(x - cx) - bw / 2, Math.abs(y - cy) - bh / 2), 0);
      e2 += Math.abs(Math.hypot(qx, qy) + inner - r);
    }
    if (e2 / l.length > 0.9) return null;
    // 각진 사각형이 더 잘 맞으면 각진 사각형(모서리 번짐·붙은 선 때문에 둥글게 오판하지 않게)
    let eS = 0;
    for (const [x, y] of l) eS += Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1));
    if (eS <= e2 * 1.15) return `M${n1(x0)} ${n1(y0)}H${n1(x1)}V${n1(y1)}H${n1(x0)}Z`;
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

type Seg = { t: 'L'; a: Pt; b: Pt; dir: number } | { t: 'C'; pts: Pt[] };
type SLine = { width: number; closed: boolean; segs: Seg[] };

/** 가는 선 마스크 → 한 줄 선들(원본 좌표). 이어지는 조각은 하나로 잇고, 굵기는 색 덮임을 가로로 적분해 잰 뒤 비슷한 굵기끼리 하나로 맞춘다 */
type Chain = { c: Pt[]; width: number; closed: boolean; spread: number; color: number };
async function strokeLines(thin: Uint8Array, thick: Uint8Array, cv: Float32Array, w: number, h: number, k: number, colorOf: (c: Pt[]) => number = () => 0, sameColor: (a: number, b: number) => boolean = (a, b) => a === b): Promise<Chain[]> {
  let any = false; for (let i = 0; i < w * h; i++) if (thin[i]) { any = true; break; }
  if (!any) return [];
  const sk = thin.slice();
  for (let x = 0; x < w; x++) { sk[x] = 0; sk[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { sk[y * w] = 0; sk[y * w + w - 1] = 0; }
  await thin2(sk, w, h);
  // 굵기는 선 영역(면 제외)의 덮임으로만 잰다
  const zone = dilate(thin, w, h, 2), cl = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cl[i] = zone[i] && !thick[i] ? cv[i] : 0;
  cv = cl;
  const covAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (cv[i] * (1 - fx) + cv[i + 1] * fx) * (1 - fy) + (cv[i + w] * (1 - fx) + cv[i + w + 1] * fx) * fy;
  };
  // 원본 획 폭 = 선에 수직으로 덮임 정도를 적분한 값(안티앨리어싱까지 반영)
  const widthOf = (c: Pt[]) => {
    const ws: number[] = [], st = Math.max(1, Math.floor(c.length / 40));
    for (let i = Math.min(2, c.length - 1); i <= Math.max(0, c.length - 3); i += st) {
      const p = c[Math.max(0, i - 3)], q = c[Math.min(c.length - 1, i + 3)];
      const tx = q[0] - p[0], ty = q[1] - p[1], L = Math.hypot(tx, ty);
      const [x, y] = c[i];
      const dirs: Pt[] = L ? [[-ty / L, tx / L]] : [[1, 0], [0, 1]];
      let best = Infinity;
      for (const [nx, ny] of dirs) {
        let s = covAt(x, y) * 0.5;
        for (const sg of [1, -1]) for (let t = 0.5; t < 14 * k; t += 0.5) { const v = covAt(x + sg * nx * t, y + sg * ny * t); if (v < 0.05) break; s += v * 0.5; }
        best = Math.min(best, s);
      }
      ws.push(best);
    }
    ws.sort((a, b) => a - b);
    const med = ws[ws.length >> 1] ?? 0;
    return { w: Math.min(7, med / k), sp: ws.length >= 4 && med > 0 ? (ws[Math.floor(ws.length * 0.8)] - ws[Math.floor(ws.length * 0.2)]) / med : 0 };
  };
  const items = chains(sk, w, h).map((c) => { const r = widthOf(c); return { c, width: r.w, spread: r.sp }; }).filter((it) => it.width >= 0.35);
  const col = items.map((it) => colorOf(it.c));      // 색이 다른 선끼리는 잇지 않는다(녹색 선 끝에 흰 동선이 붙는 등)
  // 끝 잇기: 갈림점·모서리에서 만나는 끝, 같은 방향으로 끊긴 틈을 짝지어 한 줄로
  type End = { it: number; p: Pt; d: Pt };
  const ends: End[] = [];
  items.forEach((it, i) => {
    const c = it.c, L = c.length, m = Math.min(L - 1, Math.max(3, Math.round(2 * it.width * k)));
    for (const s of [0, 1]) {
      const p = s ? c[L - 1] : c[0], q = s ? c[L - 1 - m] : c[m];
      const dx = p[0] - q[0], dy = p[1] - q[1], n = Math.hypot(dx, dy) || 1;
      ends.push({ it: i, p, d: [dx / n, dy / n] });
    }
  });
  const cand: [number, number, number][] = [];
  for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
    const A = ends[a], B = ends[b];
    if (A.it === B.it && items[A.it].c.length < 12) continue;
    if (!sameColor(col[A.it], col[B.it])) continue;
    const wa = items[A.it].width, wb = items[B.it].width, wm = Math.max(wa, wb);
    const dx = B.p[0] - A.p[0], dy = B.p[1] - A.p[1];
    const G = Math.max(14 * k, 10 * wm * k);
    if (Math.abs(dx) > G || Math.abs(dy) > G) continue;
    if (Math.abs(wa - wb) > Math.max(0.6, 0.4 * wm)) continue;
    const dd = Math.hypot(dx, dy), Rj = Math.max(3, 1.8 * wm * k), dot = A.d[0] * B.d[0] + A.d[1] * B.d[1];
    if (dd <= Rj) { if (dot <= 0.3) cand.push([dd / Rj + 1 + dot, a, b]); }
    else if (dd <= G && (A.d[0] * dx + A.d[1] * dy) / dd > 0.985 && -(B.d[0] * dx + B.d[1] * dy) / dd > 0.985 &&
      Math.abs(A.d[0] * dy - A.d[1] * dx) < Math.max(2 * k, 1.5 * wm * k)) cand.push([2 + dd / G, a, b]);   // 같은 줄 위에서 끊긴 틈
    else if (dd <= G * 0.6 && (A.d[0] * dx + A.d[1] * dy) / dd > 0.92 && -(B.d[0] * dx + B.d[1] * dy) / dd > 0.92) cand.push([3 + dd / G, a, b]);   // 곡선 위에서 끊긴 틈
  }
  cand.sort((x, y) => x[0] - y[0]);
  const partner = new Int32Array(ends.length).fill(-1);
  for (const [, a, b] of cand) if (partner[a] < 0 && partner[b] < 0) { partner[a] = b; partner[b] = a; }
  const vis = new Uint8Array(items.length), merged: Chain[] = [];
  const follow = (start: number, side: number) => {
    const pts: Pt[] = [];
    let it = start, sd = side, ws = 0, ls = 0, sp = 0, closed = false;
    for (;;) {
      vis[it] = 1;
      const c = items[it].c;
      pts.push(...(sd === 0 ? c : c.slice().reverse()));
      ws += items[it].width * c.length; sp += items[it].spread * c.length; ls += c.length;
      const pe = partner[it * 2 + (1 - sd)];
      if (pe < 0) break;
      const nx = ends[pe].it;
      if (vis[nx]) { if (nx === start && pe === start * 2 + side) closed = true; break; }
      it = nx; sd = pe - nx * 2;
    }
    merged.push({ c: pts, width: ws / ls, closed, spread: sp / ls, color: colorOf(pts) });
  };
  for (let i = 0; i < items.length; i++) for (const s of [0, 1]) if (!vis[i] && partner[i * 2 + s] < 0) follow(i, s);
  for (let i = 0; i < items.length; i++) if (!vis[i]) follow(i, 0);
  // 면 모서리에 남은 짧은 가시는 버린다
  const nearThick = (p: Pt, r: number) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = p[0] + dx, y = p[1] + dy; if (x >= 0 && y >= 0 && x < w && y < h && thick[y * w + x]) return true; } return false; };
  const plen = (c: Pt[]) => { let s = 0; for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); return s; };
  const keep = merged.filter((m) => {
    const L = plen(m.c), wk = m.width * k;
    if (m.closed) return L > 3 * k;
    if (L < 2.5 * wk && (nearThick(m.c[0], Math.ceil(wk) + 2) || nearThick(m.c[m.c.length - 1], Math.ceil(wk) + 2))) return false;
    return !(L < 1.2 * wk && m.width < 1.2);
  });
  // 긴 선 바로 옆에 겹쳐 붙은 짧은 조각(교차부 혹·이중선)은 버린다
  {
    const GS2 = 6, lg = new Map<number, Pt[]>();
    const lens = keep.map((m) => plen(m.c));
    keep.forEach((m, i) => { if (lens[i] >= 8 * m.width * k) for (const p of m.c) { const key = Math.floor(p[0] / GS2) * 100000 + Math.floor(p[1] / GS2); (lg.get(key) ?? lg.set(key, []).get(key)!).push(p); } });
    const near = (p: Pt, r: number) => {
      for (let gx = Math.floor((p[0] - r) / GS2); gx <= Math.floor((p[0] + r) / GS2); gx++) for (let gy = Math.floor((p[1] - r) / GS2); gy <= Math.floor((p[1] + r) / GS2); gy++)
        for (const q of lg.get(gx * 100000 + gy) ?? []) if (Math.abs(q[0] - p[0]) <= r && Math.abs(q[1] - p[1]) <= r) return true;
      return false;
    };
    for (let i = keep.length - 1; i >= 0; i--) {
      const m = keep[i];
      if (m.closed || lens[i] >= 8 * m.width * k) continue;
      let hit = 0; for (const p of m.c) if (near(p, Math.max(2, m.width * k))) hit++;
      if (hit >= m.c.length * 0.6) { keep.splice(i, 1); continue; }
      // 갈림점에 낀 짧은 이음 조각(양끝이 모두 다른 긴 선에 닿음)도 버린다 → 이음새 혹 방지
      const e0 = m.c[0], e1 = m.c[m.c.length - 1];
      if (lens[i] < 3 * m.width * k && near(e0, Math.max(3, 2 * m.width * k)) && near(e1, Math.max(3, 2 * m.width * k))) keep.splice(i, 1);
    }
  }
  // 자유로운 끝: 앞쪽(또는 아주 가까이)에 다른 선·면이 있으면 그 점까지 늘인다
  const grid = new Map<number, Pt[]>(), GS = 8;
  for (const m of keep) for (const p of m.c) { const key = Math.floor(p[0] / GS) * 100000 + Math.floor(p[1] / GS); (grid.get(key) ?? grid.set(key, []).get(key)!).push(p); }
  for (const m of keep) {
    if (m.closed || m.c.length < 2) continue;
    const own = new Set(m.c), wk = m.width * k, R = Math.max(3, 2.5 * wk);
    for (const end of [0, 1]) {
      const c = m.c, L = c.length, p = end ? c[L - 1] : c[0], q0 = end ? c[Math.max(0, L - 1 - Math.round(2 * wk))] : c[Math.min(L - 1, Math.round(2 * wk))];
      const dl = Math.hypot(p[0] - q0[0], p[1] - q0[1]) || 1, dir: Pt = [(p[0] - q0[0]) / dl, (p[1] - q0[1]) / dl];
      const ok = (q: Pt, d: number) => d <= 1.5 * wk || ((q[0] - p[0]) * dir[0] + (q[1] - p[1]) * dir[1]) / d > 0.7;
      let best: Pt | null = null, bd = R;
      for (let gx = Math.floor((p[0] - R) / GS); gx <= Math.floor((p[0] + R) / GS); gx++) for (let gy = Math.floor((p[1] - R) / GS); gy <= Math.floor((p[1] + R) / GS); gy++)
        for (const q of grid.get(gx * 100000 + gy) ?? []) { if (own.has(q)) continue; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd && d > 1.5 && ok(q, d)) { bd = d; best = q; } }
      for (let r = 1; r <= R && r < bd; r++) {
        const q: Pt = [Math.round(p[0] + dir[0] * r), Math.round(p[1] + dir[1] * r)];
        if (q[0] > 0 && q[1] > 0 && q[0] < w && q[1] < h && thick[q[1] * w + q[0]]) { bd = r; best = q; break; }
      }
      if (best) { if (end) c.push(best); else c.unshift(best); }
    }
  }
  return keep;
}

/** 굵기 통일 */
function unifyWidths(keep: Chain[]) {
  const plen = (c: Pt[]) => { let s = 0; for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); return s; };
  // 굵기 통일: 비슷한 굵기(1.3배 안)끼리 묶어 길이 가중 중앙값 하나로, 아주 적게 쓰인 굵기는 가까운 굵기로
  const groups: { lo: number; hi: number; items: { m: typeof keep[number]; L: number }[] }[] = [];
  for (const m of keep.map((m) => ({ m, L: plen(m.c) })).sort((a, b) => a.m.width - b.m.width)) {
    const g = groups[groups.length - 1];
    if (g && m.m.width <= g.hi * 1.3 + 0.3) { g.items.push(m); g.hi = m.m.width; } else groups.push({ lo: m.m.width, hi: m.m.width, items: [m] });
  }
  const tot = keep.reduce((s, m) => s + plen(m.c), 0) || 1;
  const val = groups.map((g) => {
    const s = g.items.reduce((t, q) => t + q.L, 0); let acc = 0;
    for (const q of g.items) { acc += q.L; if (acc >= s / 2) return { v: q.m.width, s }; }
    return { v: g.lo, s };
  });
  // 많이 쓰인 굵기부터 기준으로 삼고, 1.6배 안쪽 굵기는 모두 그 굵기로(확실히 다른 굵기만 따로 남긴다)
  const kept: number[] = [];
  for (const i of val.map((_, i) => i).sort((a, b) => val[b].s - val[a].s)) {
    let v = val[i].v, bj = -1, br = val[i].s < tot * 0.08 ? 2.2 : 1.6;
    kept.forEach((u, j) => { const r = Math.max(u, v) / Math.min(u, v); if (r < br) { br = r; bj = j; } });
    if (bj >= 0) v = kept[bj]; else kept.push(v);
    v = Math.max(0.5, Math.round(v * 4) / 4);
    for (const q of groups[i].items) q.m.width = v;
  }
}

/** 중심선 → 직선 조각(길고 곧은 부분)과 곡선 조각(나머지)으로. 좌표는 원본 크기로 */
function fitChain(c: Pt[], k: number, wpx: number, closed: boolean): Seg[] {
  const wk = wpx * k;
  const r = Math.max(2, Math.round(0.8 * wk));
  let sp = closed ? smoothClosed(c, r) : smooth(c, r);
  if (closed) sp = [...sp, sp[0]];
  if (sp.length < 2) sp = [c[0], c[0]];
  const eps = Math.max(0.7 * k, 0.2 * wk), Ls = Math.max(14 * k, 5 * wk);
  const idx = rdpIdx(sp, eps), segs: Seg[] = [];
  let run = -1;
  const curve = (i0: number, i1: number) => {
    const q = rdp(smooth(sp.slice(i0, i1 + 1), Math.max(2, Math.round(1.2 * wk))), 0.3 * k).map(([x, y]) => [x / k, y / k] as Pt);
    if (q.length >= 2) segs.push({ t: 'C', pts: q });
  };
  for (let s = 0; s < idx.length - 1; s++) {
    const i0 = idx[s], i1 = idx[s + 1];
    if (idx.length === 2 || Math.hypot(sp[i1][0] - sp[i0][0], sp[i1][1] - sp[i0][1]) >= Ls) {
      if (run >= 0) { curve(run, i0); run = -1; }
      segs.push(fitLine(sp, i0, i1, k));
    } else if (run < 0) run = i0;
  }
  if (run >= 0) curve(run, idx[idx.length - 1]);
  return segs;
}
function rdpIdx(pts: Pt[], eps: number): number[] {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st: [number, number][] = [[0, pts.length - 1]];
  while (st.length) {
    const [i0, i1] = st.pop()!, a = pts[i0], ab = sub(pts[i1], a), L = Math.hypot(ab[0], ab[1]);
    let bd = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) { const d = L > 1e-9 ? Math.abs(ab[0] * (pts[i][1] - a[1]) - ab[1] * (pts[i][0] - a[0])) / L : Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]); if (d > bd) { bd = d; bi = i; } }
    if (bd > eps) { keep[bi] = 1; st.push([i0, bi], [bi, i1]); }
  }
  const out: number[] = []; keep.forEach((v, i) => v && out.push(i));
  return out;
}
/** 점들에 맞는 직선(주성분 방향), 끝점은 첫·끝 점의 투영 */
function fitLine(sp: Pt[], i0: number, i1: number, k: number): Seg {
  let mx = 0, my = 0; const n = i1 - i0 + 1;
  for (let i = i0; i <= i1; i++) { mx += sp[i][0]; my += sp[i][1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = i0; i <= i1; i++) { const dx = sp[i][0] - mx, dy = sp[i][1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(th), uy = Math.sin(th);
  if ((sp[i1][0] - sp[i0][0]) * ux + (sp[i1][1] - sp[i0][1]) * uy < 0) { ux = -ux; uy = -uy; }
  const pr = (p: Pt): Pt => { const t = (p[0] - mx) * ux + (p[1] - my) * uy; return [(mx + ux * t) / k, (my + uy * t) / k]; };
  return { t: 'L', a: pr(sp[i0]), b: pr(sp[i1]), dir: -1 };
}

/** 모든 선(색 구분 없이): 직선 조각을 그림 축에 맞추고 같은 줄은 정렬 → 선 안의 꺾임은 교점으로 → 선 끝은 만나는 선 위에 정확히 */
function prepareLines(lines: SLine[]) {
  const Ls = lines.flatMap((ln) => ln.segs.filter((s): s is Extract<Seg, { t: 'L' }> => s.t === 'L'));
  for (const s of Ls) {
    const vx = s.b[0] - s.a[0], vy = s.b[1] - s.a[1], L = Math.hypot(vx, vy);
    if (L < 3) continue;
    let best = SNAP, bj = -1;
    AXIS_DIRS.forEach((u, j) => { const c = Math.abs(u[0] * vy - u[1] * vx) / L; if (c < best) { best = c; bj = j; } });
    if (bj < 0) continue;
    const u = AXIS_DIRS[bj], m: Pt = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], hl = (u[0] * vx + u[1] * vy) / 2;
    s.a = [m[0] - u[0] * hl, m[1] - u[1] * hl]; s.b = [m[0] + u[0] * hl, m[1] + u[1] * hl]; s.dir = bj;
  }
  for (let j = 0; j < AXIS_DIRS.length; j++) {
    const u = AXIS_DIRS[j], nrm: Pt = [-u[1], u[0]];
    const G = Ls.filter((s) => s.dir === j).map((s) => ({ s, o: (nrm[0] * (s.a[0] + s.b[0]) + nrm[1] * (s.a[1] + s.b[1])) / 2, L: Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) })).sort((x, y) => x.o - y.o);
    let g: typeof G = [];
    const flush = () => {
      if (g.length > 1) {
        const sw = g.reduce((t, q) => t + q.L, 0), o = g.reduce((t, q) => t + q.o * q.L, 0) / sw;
        for (const q of g) { const d = o - q.o; q.s.a = [q.s.a[0] + nrm[0] * d, q.s.a[1] + nrm[1] * d]; q.s.b = [q.s.b[0] + nrm[0] * d, q.s.b[1] + nrm[1] * d]; }
      }
      g = [];
    };
    for (const q of G) { if (g.length && q.o - g[g.length - 1].o > 1.5) flush(); g.push(q); }
    flush();
  }
  // 선 안: 직선 사이에 낀 짧은 곡선(뭉개진 모서리)은 교점 모서리로, 이웃 조각은 같은 점에서 만나게
  for (const ln of lines) {
    const near = 3 * Math.max(2, ln.width);
    let S = ln.segs;
    S = S.filter((s, i) => {
      if (s.t !== 'C') return true;
      const p = S[i - 1], n = S[i + 1];
      if (p?.t !== 'L' || n?.t !== 'L') return true;
      // 굵기 정도로 아주 짧은 곡선만(뭉개진 모서리) 교점으로. 동선의 둥근 모서리는 곡선 그대로
      const len = s.pts.reduce((t, q, i) => (i ? t + Math.hypot(q[0] - s.pts[i - 1][0], q[1] - s.pts[i - 1][1]) : 0), 0);
      const X = lineX(p.a, p.b, n.a, n.b);
      return !(X && len < 2.5 * Math.max(2, ln.width));
    });
    const join = (p: Seg, n: Seg) => {
      if (p.t === 'L' && n.t === 'L') {
        const X = lineX(p.a, p.b, n.a, n.b);
        const q: Pt = X && Math.hypot(X[0] - n.a[0], X[1] - n.a[1]) < near ? X : [(p.b[0] + n.a[0]) / 2, (p.b[1] + n.a[1]) / 2];
        p.b = q; n.a = q;
      } else if (p.t === 'L' && n.t === 'C') n.pts[0] = p.b;
      else if (p.t === 'C' && n.t === 'L') p.pts[p.pts.length - 1] = n.a;
    };
    for (let i = 1; i < S.length; i++) join(S[i - 1], S[i]);
    if (ln.closed && S.length > 1) join(S[S.length - 1], S[0]);
    ln.segs = S;
  }
  // 선 끝: 근처(굵기의 1.6배 안)에 다른 선이 있으면 그 선의 중심선 위로 정확히(직선끼리는 교점) — T자·모서리 이음새가 어긋나거나 삐져나오지 않게
  type Piece = { a: Pt; b: Pt; ln: SLine; seg: Seg };
  const pieces: Piece[] = [];
  for (const ln of lines) for (const s of ln.segs) {
    if (s.t === 'L') pieces.push({ a: s.a, b: s.b, ln, seg: s });
    else for (let i = 0; i < s.pts.length - 1; i++) pieces.push({ a: s.pts[i], b: s.pts[i + 1], ln, seg: s });
  }
  const closest = (p: Pt, q: Piece): [Pt, number] => {
    const vx = q.b[0] - q.a[0], vy = q.b[1] - q.a[1], L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - q.a[0]) * vx + (p[1] - q.a[1]) * vy) / L2));
    const c: Pt = [q.a[0] + vx * t, q.a[1] + vy * t];
    return [c, Math.hypot(c[0] - p[0], c[1] - p[1])];
  };
  for (const ln of lines) {
    if (ln.closed || !ln.segs.length) continue;
    for (const end of [0, 1]) {
      const s = end ? ln.segs[ln.segs.length - 1] : ln.segs[0];
      const p: Pt = s.t === 'L' ? (end ? s.b : s.a) : (end ? s.pts[s.pts.length - 1] : s.pts[0]);
      let best: Piece | null = null, bp: Pt = p, bd = Infinity;
      for (const q of pieces) {
        if (q.ln === ln) continue;
        const tol = 1.6 * Math.max(ln.width, q.ln.width, 1.5);
        if (Math.min(q.a[0], q.b[0]) - tol > p[0] || Math.max(q.a[0], q.b[0]) + tol < p[0] || Math.min(q.a[1], q.b[1]) - tol > p[1] || Math.max(q.a[1], q.b[1]) + tol < p[1]) continue;
        const [c, d] = closest(p, q);
        if (d <= tol && d < bd) { bd = d; bp = c; best = q; }
      }
      if (!best) continue;
      let target = bp;
      if (s.t === 'L' && best.seg.t === 'L') {
        const X = lineX(s.a, s.b, best.a, best.b);
        if (X && Math.hypot(X[0] - p[0], X[1] - p[1]) <= 2.5 * Math.max(ln.width, best.ln.width, 1.5)) target = X;
      }
      if (s.t === 'L') { if (end) s.b = target; else s.a = target; }
      else if (end) s.pts[s.pts.length - 1] = target; else s.pts[0] = target;
    }
  }
}

/** 선들 → 굵기별 패스(한 선 = 한 패스) */
function strokePaths(lines: SLine[]): { width: number; d: string }[] {
  const byWidth = new Map<number, string[]>();
  for (const ln of lines) {
    const S = ln.segs;
    if (!S.length) continue;
    const first = S[0].t === 'L' ? S[0].a : S[0].pts[0];
    let d = `M${n1(first[0])} ${n1(first[1])}`;
    for (const s of S) {
      if (s.t === 'L') { d += `L${n1(s.b[0])} ${n1(s.b[1])}`; continue; }
      const q = s.pts;
      for (let j = 0; j < q.length - 1; j++) {
        const p0 = q[j - 1] ?? q[j], p1 = q[j], p2 = q[j + 1], p3 = q[j + 2] ?? p2;
        d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`;
      }
    }
    if (ln.closed) d += 'Z';
    (byWidth.get(ln.width) ?? byWidth.set(ln.width, []).get(ln.width)!).push(d);
  }
  return [...byWidth].map(([width, ds]) => ({ width: Math.round(width * OUT * 100) / 100, d: ds.join('') }));
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
