// 투시 교정 본체. 워커(GitHub Pages)와 메인 스레드(claude.ai 아티팩트) 양쪽에서 쓴다.
import { detectSegments, classify, fitMesh, remapImage, residualAngles } from './warp.js';
import { angDiff } from './geom.js';

const MAX_SIDE = 2000;

/** RGBA 버퍼를 교정해 {data(ArrayBuffer), width, height, stats}를 돌려준다. */
export async function rectifyRGBA(cv, data, width, height, post = () => {}) {
  let src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(data), width, height));
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (k < 1) { const d = new cv.Mat(); cv.resize(src, d, new cv.Size(Math.round(width * k), Math.round(height * k)), 0, 0, cv.INTER_AREA); src.delete(); src = d; }
  const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  post('직선을 찾는 중…');
  const kept = classify(detectSegments(cv, gray));
  gray.delete();
  const before = kept.map((s) => angDiff(s.ang, s.target)).sort((a, b) => a - b);

  let out = src, stats = { lines: kept.length, before: 0, after: 0 };
  if (kept.length >= 12) {
    post('투시를 바로잡는 중…');
    const mesh = await fitMesh(src.cols, src.rows, kept);
    const after = residualAngles(mesh, kept).sort((a, b) => a - b);
    const p90 = (a) => a[Math.floor(a.length * 0.9)] ?? 0;
    stats = { lines: kept.length, before: p90(before), after: p90(after) };
    out = remapImage(cv, src, mesh).mat;
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
  return { data: buf.buffer, width: cw, height: ch, stats };
}

/** opencv.js 모듈/전역 객체를 사용 가능한 상태로 만든다. */
export async function readyCv(mod) {
  let cv = mod;
  if (cv instanceof Promise || (cv && typeof cv.then === 'function' && !cv.Mat)) cv = await cv;
  if (!cv.Mat) await new Promise((r) => (cv.onRuntimeInitialized = r));
  return cv;
}
