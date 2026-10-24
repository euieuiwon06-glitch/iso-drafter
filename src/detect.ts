// 그림 종류 판단: 아이소메트릭 그림은 서로 대칭인 대각선 두 방향(예: 30°·150°)의 선이 많고,
// 평면 그래픽(포스터·인포그래픽)은 수평·수직 위주에 대각선은 한 방향뿐이거나 없다.

export type Kind = 'iso' | 'flat';

export async function guessKind(file: Blob): Promise<{ kind: Kind; diag: number }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 420 / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * s)), h = Math.max(8, Math.round(bmp.height * s));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const d = g.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // 가장자리 방향 분포(길이 대신 경사 세기 가중, 1° 칸)
  const hist = new Float64Array(180);
  let tot = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
    const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    const m = Math.hypot(gx, gy);
    if (m < 60) continue;
    const a = ((((Math.atan2(gy, gx) * 180) / Math.PI + 90) % 180) + 180) % 180;      // 선 방향 = 경사 방향 + 90°
    hist[Math.round(a) % 180] += m; tot += m;
  }
  if (tot <= 0) return { kind: 'flat', diag: 0 };
  const band = (c: number, r: number) => { let v = 0; for (let q = -r; q <= r; q++) v += hist[(c + q + 180) % 180]; return v; };
  // 오른쪽 아래(12~78°)와 오른쪽 위(102~168°)에서 가장 강한 방향
  let ma = 0, mb = 0;
  for (let c = 12; c <= 78; c++) ma = Math.max(ma, band(c, 6));
  for (let c = 102; c <= 168; c++) mb = Math.max(mb, band(c, 6));
  const diag = Math.min(ma, mb) / tot;
  // 바탕이 어둡거나 채도 높은 색 면이 넓으면 포스터형 평면 그래픽(도면 그림은 밝은 바탕에 선)
  const Ls = Array.from(L).sort((a, b) => a - b), med = Ls[Ls.length >> 1];
  let sat = 0;
  for (let i = 0; i < w * h; i++) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); if (mx > 60 && (mx - mn) / mx > 0.4) sat++; }
  const poster = med < 80 || sat > w * h * 0.25;
  const kind: Kind = diag >= 0.1 || (!poster && diag >= 0.04) ? 'iso' : 'flat';
  return { kind, diag };
}
