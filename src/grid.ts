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

/** 원본(+선택적으로 겹칠 렌더)을 그리고 등각 격자를 얹는다. 긴 변은 maxSide로 줄인다. */
export async function griddedImage(base: HTMLImageElement, overlaySvg: string | null, maxSide = 1568, step = 100) {
  const W = base.naturalWidth, H = base.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.globalAlpha = overlaySvg ? 0.55 : 0.85;
  g.drawImage(base, 0, 0, cv.width, cv.height);
  g.globalAlpha = 1;
  if (overlaySvg) {
    // 현재 장면의 선만 빨간색으로 겹친다
    const red = overlaySvg.replace(/stroke="#2B2B2B"/g, 'stroke="#E00000"').replace(/fill="#(?:FFFFFF|F[0-9A-F]{5}|E[0-9A-F]{5}|D[0-9A-F]{5})"/gi, 'fill="none"');
    const url = URL.createObjectURL(new Blob([red], { type: 'image/svg+xml' }));
    try { g.drawImage(await loadImage(url), 0, 0, cv.width, cv.height); } finally { URL.revokeObjectURL(url); }
  }
  g.save();
  g.scale(k, k);
  const span = (W / C + 2 * H / S);
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
  g.font = `${Math.round(11 / k)}px sans-serif`;
  for (let a = lo; a <= hi; a += step) for (let b = lo; b <= hi; b += step) {
    if (((a / step) + (b / step)) % 2 !== 0) continue;
    const x = C * (a + b), y = S * (a - b);
    if (x < 0 || y < 0 || x > W || y > H) continue;
    g.fillText(`${a},${b}`, x + 2 / k, y - 2 / k);
  }
  g.restore();
  return { dataUrl: cv.toDataURL('image/jpeg', 0.9), scale: k };
}

export async function imageToJpeg(base: HTMLImageElement, maxSide = 1568) {
  const W = base.naturalWidth, H = base.naturalHeight, k = Math.min(1, maxSide / Math.max(W, H));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(base, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.92);
}
