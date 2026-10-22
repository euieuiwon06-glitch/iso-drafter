// 투시 교정 본체. 워커(GitHub Pages)와 메인 스레드(claude.ai 아티팩트) 양쪽에서 쓴다.
import { detectSegments, classify, fitMesh, remapImage, residualAngles } from './warp.js';
import { angDiff } from './geom.js';

const MAX_SIDE = 2000;

/** RGBA 버퍼를 교정해 {data(ArrayBuffer), width, height, stats}를 돌려준다. */
export async function rectifyRGBA(cv, data, width, height, post = () => {}, mode = 'iso') {
  let src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(data), width, height));
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (k < 1) { const d = new cv.Mat(); cv.resize(src, d, new cv.Size(Math.round(width * k), Math.round(height * k)), 0, 0, cv.INTER_AREA); src.delete(); src = d; }
  const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  post('직선을 찾는 중…');
  let kept = classify(detectSegments(cv, gray), { flat: mode === 'flat' });
  gray.delete();

  // 그림의 축 각도를 그대로 쓴다(30° 등각으로 돌리지 않는다). 투영: A = 오른쪽 아래 축, B = 오른쪽 위 축
  const ax = kept.axes ?? {};
  const proj = { a: ax.down ?? 30, b: ax.up != null ? ax.up - 180 : -30 };
  const before = kept.map((s) => angDiff(s.ang, s.target)).sort((a, b) => a - b);

  let out = src, stats = { lines: kept.length, before: 0, after: 0 };
  if (kept.length >= 12) {
    post('투시를 바로잡는 중…');
    const mesh = await fitMesh(src.cols, src.rows, kept);
    const after = residualAngles(mesh, kept).sort((a, b) => a - b);
    const p90 = (a) => a[Math.floor(a.length * 0.9)] ?? 0;
    stats = { lines: kept.length, before: p90(before), after: p90(after) };
    out = remapImage(cv, src, mesh, mode === 'flat').mat;
    src.delete();
  }

  post('여백을 정리하는 중…');
  // 내용이 있는 범위로 자르고 여백 40px
  const g2 = new cv.Mat(); cv.cvtColor(out, g2, cv.COLOR_RGBA2GRAY);
  const ink = new cv.Mat(); cv.threshold(g2, ink, 235, 255, cv.THRESH_BINARY_INV);
  const r = cv.boundingRect(ink);
  g2.delete(); ink.delete();
  const m = 40, has = r.width > 10 && r.height > 10;
  const x0 = Math.max(0, r.x - m), y0 = Math.max(0, r.y - m);
  const x1 = Math.min(out.cols, r.x + r.width + m), y1 = Math.min(out.rows, r.y + r.height + m);
  // ROI.clone()이 연속 메모리를 보장하지 않으므로 행 단위로 직접 복사한다
  const W0 = out.cols, src8 = out.data;
  const ox = has ? x0 : 0, oy = has ? y0 : 0, cw = has ? x1 - x0 : W0, ch = has ? y1 - y0 : out.rows;
  const buf = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) buf.set(src8.subarray(((oy + y) * W0 + ox) * 4, ((oy + y) * W0 + ox + cw) * 4), y * cw * 4);
  out.delete();
  return { data: buf.buffer, width: cw, height: ch, stats, proj };
}

/** 축 각도(도)들로 2×2 변환을 만든다. 이미 등각에 가까우면 null. */
function axisAffine(axes) {
  if (!axes || axes.down == null || axes.up == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const uA = [Math.cos(rad(axes.down)), Math.sin(rad(axes.down))];          // 오른쪽 아래
  const uB = [-Math.cos(rad(axes.up)), -Math.sin(rad(axes.up))];            // 오른쪽 위
  const c = Math.cos(Math.PI / 6), sn = 0.5;
  const tA = [c, sn], tB = [c, -sn];
  // 수직선이 있으면 수직이 수직으로 남도록 두 축의 배율 비를 정한다
  let kA = 1, kB = 1;
  const det = uA[0] * uB[1] - uB[0] * uA[1];
  if (Math.abs(det) < 1e-3) return null;
  const build = (ka, kb) => {
    const inv = [[uB[1] / det, -uB[0] / det], [-uA[1] / det, uA[0] / det]];
    const T = [[ka * tA[0], kb * tB[0]], [ka * tA[1], kb * tB[1]]];
    return [
      [T[0][0] * inv[0][0] + T[0][1] * inv[1][0], T[0][0] * inv[0][1] + T[0][1] * inv[1][1]],
      [T[1][0] * inv[0][0] + T[1][1] * inv[1][0], T[1][0] * inv[0][1] + T[1][1] * inv[1][1]],
    ];
  };
  // 2×2 행렬의 찌그러짐(큰 특이값/작은 특이값)
  const aniso = (m) => {
    const a = m[0][0], b = m[0][1], c = m[1][0], d = m[1][1];
    const s1 = a * a + b * b + c * c + d * d, s2 = Math.abs(a * d - b * c);
    const q = Math.sqrt(Math.max(0, s1 * s1 / 4 - s2 * s2));
    return Math.sqrt((s1 / 2 + q) / Math.max(1e-9, s1 / 2 - q));
  };
  if (axes.vert == null) {
    // 수직선이 없으면(평면도에 가까운 그림) 모양이 가장 덜 찌그러지는 축 배율 비를 고른다
    let best = { r: 1, v: Infinity };
    for (let r = 0.3; r <= 3.001; r *= 1.02) { const v = aniso(build(1 / Math.sqrt(r), Math.sqrt(r))); if (v < best.v) best = { r, v }; }
    kA = 1 / Math.sqrt(best.r); kB = Math.sqrt(best.r);
  }
  if (axes.vert != null) {
    const al = (0 * uB[1] - uB[0] * 1) / det, be = (uA[0] * 1 - 0 * uA[1]) / det;   // (0,1) = al·uA + be·uB
    const r = be !== 0 ? -al / be : 0;                                            // kB/kA (수직 성분이 0이 되는 비)
    if (r > 0.3 && r < 3) { kA = 1 / Math.sqrt(r); kB = Math.sqrt(r); }
  }
  // M = [kA·tA  kB·tB] · [uA uB]^-1
  const inv = [[uB[1] / det, -uB[0] / det], [-uA[1] / det, uA[0] / det]];
  const T = [[kA * tA[0], kB * tB[0]], [kA * tA[1], kB * tB[1]]];
  const M = [
    [T[0][0] * inv[0][0] + T[0][1] * inv[1][0], T[0][0] * inv[0][1] + T[0][1] * inv[1][1]],
    [T[1][0] * inv[0][0] + T[1][1] * inv[1][0], T[1][0] * inv[0][1] + T[1][1] * inv[1][1]],
  ];
  const off = Math.abs(M[0][0] - 1) + Math.abs(M[0][1]) + Math.abs(M[1][0]) + Math.abs(M[1][1] - 1);
  return off < 0.06 ? null : M;
}

/** 2×2 변환을 적용하고, 결과가 화면 안에 들어오도록 옮긴다(긴 변 MAX_SIDE 유지). */
function warpAffineFit(cv, src, M) {
  const W = src.cols, H = src.rows;
  const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y]);
  const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
  const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
  const sc = Math.min(1.5, MAX_SIDE / Math.max(maxX - minX, maxY - minY));
  const OW = Math.round((maxX - minX) * sc), OH = Math.round((maxY - minY) * sc);
  const A = cv.matFromArray(2, 3, cv.CV_64F, [M[0][0] * sc, M[0][1] * sc, -minX * sc, M[1][0] * sc, M[1][1] * sc, -minY * sc]);
  const out = new cv.Mat();
  cv.warpAffine(src, out, A, new cv.Size(OW, OH), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
  A.delete();
  return out;
}

/** opencv.js 모듈/전역 객체를 사용 가능한 상태로 만든다. */
export async function readyCv(mod) {
  let cv = mod;
  if (cv instanceof Promise || (cv && typeof cv.then === 'function' && !cv.Mat)) cv = await cv;
  if (!cv.Mat) await new Promise((r) => (cv.onRuntimeInitialized = r));
  return cv;
}
