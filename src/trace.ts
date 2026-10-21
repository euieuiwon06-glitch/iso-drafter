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

/** 닫힌 윤곽 → 매끈한 패스(모서리는 각지게) */
function loopPath(loop: Pt[]): string {
  // 닫힌 윤곽을 120점 조각으로 나눠 단순화(긴 윤곽에서도 빠르게)
  const p: Pt[] = [];
  for (let i = 0; i < loop.length; i += 120) {
    const piece = loop.slice(i, i + 121);
    if (i + 121 > loop.length) piece.push(loop[0]);
    p.push(...rdp(piece, 0.35).slice(0, -1));
  }
  const n = p.length;
  if (n < 3) return '';
  const corner = p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const u = sub(q, a), v = sub(b, q), c = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) || 1);
    return c < Math.cos((55 * Math.PI) / 180);
  });
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p1 = p[i], p2 = p[(i + 1) % n];
    if (corner[i] || corner[(i + 1) % n]) { d += `L${f1(p2[0])} ${f1(p2[1])}`; continue; }
    const p0 = p[(i - 1 + n) % n], p3 = p[(i + 2) % n];
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + 'Z';
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
  const loops = contours(s, w, h, 0.42).filter((l) => area(l) >= 2 * k * k).map((l) => l.map(([x, y]) => [x / k, y / k] as Pt));
  const d = loops.map(loopPath).join('');
  vecCache.set(key, d);
  return d;
}
