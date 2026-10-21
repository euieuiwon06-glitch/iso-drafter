// 원본 위에 등각 좌표 격자(차트 좌표 라벨 포함)를 그려 AI에게 보낼 이미지를 만든다.
import { C, S } from './iso';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

export type Rect = { x: number; y: number; w: number; h: number };

/** 현재 장면의 선만 빨간색으로 바꾼 SVG(겹쳐 보기용) */
const redOverlay = (svg: string) =>
  svg.replace(/stroke="#2B2B2B"/g, 'stroke="#E00000"').replace(/fill="#(?:FFFFFF|F[0-9A-F]{5}|E[0-9A-F]{5}|D[0-9A-F]{5})"/gi, 'fill="none"');

/**
 * 원본의 한 영역(crop, 원본 픽셀 좌표)을 그린다. grid = 등각 격자와 차트 좌표 라벨을 얹을지.
 * 라벨은 원본 전체 기준 좌표라서 잘라도 그대로 유효하다. 출력은 최대 maxPixels 화소.
 */
export async function renderRegion(base: HTMLImageElement, opts: { crop?: Rect; overlaySvg?: string | null; grid?: boolean; maxPixels?: number; maxSide?: number; step?: number } = {}) {
  const W = base.naturalWidth, H = base.naturalHeight;
  const r = opts.crop ?? { x: 0, y: 0, w: W, h: H };
  const step = opts.step ?? 100;
  let k = Math.min(1, Math.sqrt((opts.maxPixels ?? 1.15e6) / (r.w * r.h)));
  if (opts.maxSide) k = Math.min(k, opts.maxSide / Math.max(r.w, r.h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(r.w * k); cv.height = Math.round(r.h * k);
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.save();
  g.scale(k, k); g.translate(-r.x, -r.y);
  g.globalAlpha = opts.grid ? (opts.overlaySvg ? 0.55 : 0.85) : 1;
  g.drawImage(base, 0, 0, W, H);
  g.globalAlpha = 1;
  if (opts.overlaySvg) {
    const url = URL.createObjectURL(new Blob([redOverlay(opts.overlaySvg)], { type: 'image/svg+xml' }));
    try { g.drawImage(await loadImage(url), 0, 0, W, H); } finally { URL.revokeObjectURL(url); }
  }
  if (opts.grid) {
    const span = W / C + (2 * H) / S;
    const lo = -Math.ceil(span / step) * step, hi = -lo;
    g.lineWidth = 1 / k;
    for (let v = lo; v <= hi; v += step / 2) {
      const major = v % step === 0;
      // A = v 인 선 (B를 따라 변함) / B = v 인 선
      g.strokeStyle = major ? 'rgba(220,0,0,.55)' : 'rgba(255,120,120,.35)';
      g.beginPath(); g.moveTo(C * (v + lo), S * (v - lo)); g.lineTo(C * (v + hi), S * (v - hi)); g.stroke();
      g.strokeStyle = major ? 'rgba(0,0,220,.55)' : 'rgba(120,120,255,.35)';
      g.beginPath(); g.moveTo(C * (lo + v), S * (lo - v)); g.lineTo(C * (hi + v), S * (hi - v)); g.stroke();
    }
    g.fillStyle = '#7A007A';
    g.font = `${Math.round(12 / k)}px sans-serif`;
    for (let a = lo; a <= hi; a += step) for (let b = lo; b <= hi; b += step) {
      if ((a / step + b / step) % 2 !== 0) continue;
      const x = C * (a + b), y = S * (a - b);
      if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
      g.fillText(`${a},${b}`, x + 2 / k, y - 2 / k);
    }
  }
  g.restore();
  return cv.toDataURL('image/jpeg', 0.9);
}

/** 전체 이미지 + 격자(긴 변 maxSide) — API 키 경로용 */
export async function griddedImage(base: HTMLImageElement, overlaySvg: string | null, maxSide = 1568) {
  return { dataUrl: await renderRegion(base, { overlaySvg, grid: true, maxPixels: Infinity, maxSide }) };
}

export async function imageToJpeg(base: HTMLImageElement, maxSide = 1568) {
  return renderRegion(base, { maxPixels: Infinity, maxSide });
}

/** 이미지를 긴 쪽 방향으로 n개 구역으로 나눈다. core = 겹치지 않는 담당 영역, crop = 앞뒤로 여유를 둔 보낼 영역. */
export function splitRegions(W: number, H: number, n: number, overlap = 0.12): { core: Rect; crop: Rect }[] {
  const vertical = H >= W;
  const L = vertical ? H : W, seg = L / n, pad = L * overlap;
  return Array.from({ length: n }, (_, i) => {
    const c0 = i * seg, c1 = (i + 1) * seg;
    const p0 = Math.max(0, c0 - pad), p1 = Math.min(L, c1 + pad);
    return vertical
      ? { core: { x: 0, y: c0, w: W, h: c1 - c0 }, crop: { x: 0, y: p0, w: W, h: p1 - p0 } }
      : { core: { x: c0, y: 0, w: c1 - c0, h: H }, crop: { x: p0, y: 0, w: p1 - p0, h: H } };
  });
}
