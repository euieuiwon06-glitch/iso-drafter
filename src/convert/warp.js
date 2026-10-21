// 투시 교정: 직선들이 정확한 등각 축(90°, 150°, 30°)에 오도록 메시를 변형하고 이미지를 다시 샘플링한다.
import { angDiff } from './geom.js';

/** HoughLinesP로 선분을 찾는다. 반환: [{x1,y1,x2,y2,len,ang}] */
export function detectSegments(cv, gray) {
  const edges = new cv.Mat(), lines = new cv.Mat(), blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
  cv.Canny(blur, edges, 40, 120);
  cv.HoughLinesP(edges, lines, 1, Math.PI / 720, 40, 30, 3);
  const out = [];
  for (let i = 0, cnt = lines.rows * lines.cols; i < cnt; i++) {
    const [x1, y1, x2, y2] = lines.data32S.subarray(i * 4, i * 4 + 4);
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    out.push({ x1, y1, x2, y2, len: L, ang: ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180 });
  }
  edges.delete(); lines.delete(); blur.delete();
  return out;
}

/** 각 선분을 세 축 계열 중 하나로 분류한다. 주변 선분들의 각도 중앙값과 일치하는 것만 남긴다. */
export function classify(segs) {
  const fam = (a) => (Math.abs(a - 90) < 16 ? 0 : a > 115 && a < 178 ? 1 : a > 2 && a < 70 ? 2 : -1);
  const target = [90, 150, 30];
  const cand = segs.map((s) => ({ ...s, f: fam(s.ang), mx: (s.x1 + s.x2) / 2, my: (s.y1 + s.y2) / 2 })).filter((s) => s.f >= 0);
  const big = cand.filter((s) => s.len > 60);
  const kept = [];
  for (const s of cand) {
    const near = big.filter((q) => q.f === s.f && Math.hypot(q.mx - s.mx, q.my - s.my) < 380).map((q) => q.ang).sort((a, b) => a - b);
    const ref = near.length >= 3 ? near[near.length >> 1] : target[s.f];
    if (angDiff(s.ang, ref) < 4.5) kept.push({ ...s, target: target[s.f] });
  }
  return kept;
}

/** 희소 최소제곱(CGLS)로 메시 꼭짓점 위치를 푼다. */
export async function fitMesh(W, H, segs, opts = {}) {
  const h = opts.cell ?? Math.max(32, Math.round(Math.max(W, H) / 54));
  const nx = Math.ceil(W / h) + 1, ny = Math.ceil(H / h) + 1, N = nx * ny, NU = 2 * N;
  const vid = (i, j) => j * nx + i;
  const rows = [];            // {idx:Int32Array, val:Float64Array, b}
  const row = (idx, val, b) => rows.push({ idx, val, b });

  const bil = (x, y) => {
    const i = Math.min(Math.max(0, Math.floor(x / h)), nx - 2), j = Math.min(Math.max(0, Math.floor(y / h)), ny - 2);
    const u = x / h - i, v = y / h - j;
    return [[vid(i, j), vid(i + 1, j), vid(i, j + 1), vid(i + 1, j + 1)], [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v]];
  };

  const WL = opts.lineWeight ?? 4;
  for (const s of segs) {
    const th = (s.target * Math.PI) / 180, n = [-Math.sin(th), Math.cos(th)];
    const K = Math.max(2, Math.floor(s.len / 16) + 1);
    const [i0, w0] = bil(s.x1, s.y1);
    const wk = WL * Math.sqrt(s.len / K);
    for (let q = 1; q < K; q++) {
      const t = q / (K - 1);
      const [ik, w] = bil(s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t);
      const idx = [], val = [];
      for (let m = 0; m < 4; m++) { idx.push(2 * ik[m], 2 * ik[m] + 1); val.push(n[0] * w[m] * wk, n[1] * w[m] * wk); }
      for (let m = 0; m < 4; m++) { idx.push(2 * i0[m], 2 * i0[m] + 1); val.push(-n[0] * w0[m] * wk, -n[1] * w0[m] * wk); }
      row(Int32Array.from(idx), Float64Array.from(val), 0);
    }
  }
  const WS = 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const ia = i - di, ja = j - dj, ib = i + di, jb = j + dj;
      if (ia >= 0 && ib < nx && ja >= 0 && jb < ny)
        for (let c = 0; c < 2; c++) row(Int32Array.of(2 * vid(ia, ja) + c, 2 * vid(i, j) + c, 2 * vid(ib, jb) + c), Float64Array.of(WS, -2 * WS, WS), 0);
    }
    if (i < nx - 1 && j < ny - 1)
      for (let c = 0; c < 2; c++) row(Int32Array.of(2 * vid(i, j) + c, 2 * vid(i + 1, j) + c, 2 * vid(i, j + 1) + c, 2 * vid(i + 1, j + 1) + c), Float64Array.of(WS, -WS, -WS, WS), 0);
  }
  const WA = 0.02;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    row(Int32Array.of(2 * vid(i, j)), Float64Array.of(WA), WA * i * h);
    row(Int32Array.of(2 * vid(i, j) + 1), Float64Array.of(WA), WA * j * h);
  }

  // CGLS
  const Ax = (x) => { const r = new Float64Array(rows.length); for (let k = 0; k < rows.length; k++) { const { idx, val } = rows[k]; let s = 0; for (let m = 0; m < idx.length; m++) s += val[m] * x[idx[m]]; r[k] = s; } return r; };
  const ATy = (y) => { const r = new Float64Array(NU); for (let k = 0; k < rows.length; k++) { const { idx, val } = rows[k], yk = y[k]; if (!yk) continue; for (let m = 0; m < idx.length; m++) r[idx[m]] += val[m] * yk; } return r; };
  const x = new Float64Array(NU);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { x[2 * vid(i, j)] = i * h; x[2 * vid(i, j) + 1] = j * h; }
  const b = Float64Array.from(rows, (r) => r.b);
  const ax0 = Ax(x);
  const r = b.map((v, k) => v - ax0[k]);
  let s = ATy(r), p = s.slice(), gamma = s.reduce((t, v) => t + v * v, 0);
  const g0 = gamma, iters = opts.iters ?? 4000;
  for (let it = 0; it < iters && gamma > g0 * 1e-14; it++) {
    if (it % 60 === 59) await new Promise((r) => setTimeout(r, 0));   // 메인 스레드에서 돌 때 화면이 멈추지 않게
    const q = Ax(p);
    const alpha = gamma / q.reduce((t, v) => t + v * v, 0);
    for (let m = 0; m < NU; m++) x[m] += alpha * p[m];
    for (let k = 0; k < r.length; k++) r[k] -= alpha * q[k];
    s = ATy(r);
    const g1 = s.reduce((t, v) => t + v * v, 0);
    const beta = g1 / gamma; gamma = g1;
    for (let m = 0; m < NU; m++) p[m] = s[m] + beta * p[m];
  }
  return { h, nx, ny, V: x };
}

export function meshForward(mesh, px, py) {
  const { h, nx, ny, V } = mesh;
  const i = Math.min(Math.max(0, Math.floor(px / h)), nx - 2), j = Math.min(Math.max(0, Math.floor(py / h)), ny - 2);
  const u = px / h - i, v = py / h - j, id = (a, b) => 2 * (b * nx + a);
  const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v], ids = [id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1)];
  let X = 0, Y = 0; for (let m = 0; m < 4; m++) { X += w[m] * V[ids[m]]; Y += w[m] * V[ids[m] + 1]; }
  return [X, Y];
}

/** 메시를 따라 이미지를 다시 샘플링한다. 반환: {mat(RGBA), offX, offY} */
export function remapImage(cv, srcRGBA, mesh) {
  const { h, nx, ny, V } = mesh;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < nx * ny; k++) { minX = Math.min(minX, V[2 * k]); maxX = Math.max(maxX, V[2 * k]); minY = Math.min(minY, V[2 * k + 1]); maxY = Math.max(maxY, V[2 * k + 1]); }
  // 원본 이미지 범위만 쓰도록 출력 크기를 원본 경계의 변형 결과로 제한
  const OW = Math.ceil(maxX - minX), OH = Math.ceil(maxY - minY);
  const mapX = new cv.Mat(OH, OW, cv.CV_32FC1, new cv.Scalar(-1)), mapY = new cv.Mat(OH, OW, cv.CV_32FC1, new cv.Scalar(-1));
  const MX = mapX.data32F, MY = mapY.data32F;
  const P = (i, j) => [V[2 * (j * nx + i)] - minX, V[2 * (j * nx + i) + 1] - minY];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const src = [[i * h, j * h], [(i + 1) * h, j * h], [(i + 1) * h, (j + 1) * h], [i * h, (j + 1) * h]];
    const dst = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
      const [a, b, c] = tri.map((t) => dst[t]), [sa, sb, sc] = tri.map((t) => src[t]);
      const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(det) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(OW - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(OH - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const l1 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / det;
        const l2 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const o = y * OW + x;
        MX[o] = l1 * sa[0] + l2 * sb[0] + l3 * sc[0];
        MY[o] = l1 * sa[1] + l2 * sb[1] + l3 * sc[1];
      }
    }
  }
  const out = new cv.Mat();
  cv.remap(srcRGBA, out, mapX, mapY, cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
  mapX.delete(); mapY.delete();
  return { mat: out, offX: minX, offY: minY };
}

/** 교정 후 남은 각도 오차(도) */
export function residualAngles(mesh, segs) {
  return segs.map((s) => {
    const [ax, ay] = meshForward(mesh, s.x1, s.y1), [bx, by] = meshForward(mesh, s.x2, s.y2);
    const a = ((Math.atan2(by - ay, bx - ax) * 180) / Math.PI + 180) % 180;
    return angDiff(a, s.target);
  });
}
