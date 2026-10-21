// 개발용: 예시 장면(원본에 맞춘 것)으로 원본 대조 점수·자리 맞춤을 검증한다. vite dev(5342)에 public/__crop.png 필요
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
page.on('console', (m) => console.log(m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5342/');
const r = await page.evaluate(async () => {
  const fit = await import('/src/fit.ts');
  const scene = (await import('/src/sample-scene.json')).default;
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = '/__crop.png'; });
  const t0 = performance.now(); const f = fit.edgeField(img); const tField = performance.now() - t0;
  const scored = scene.elements.map((e) => fit.support(e, f)).filter((s) => s !== null);
  const avg = scored.reduce((a, b) => a + b, 0) / scored.length;
  // 일부러 12만큼 밀어 놓고 되돌아오는지
  const boxy = scene.elements.filter((e) => ['wall', 'table', 'shelf', 'glass', 'slab'].includes(e.kind) && fit.support(e, f) > 0.4);
  let back = 0, tested = 0;
  for (const e of boxy.slice(0, 40)) {
    const moved = { ...e, a0: e.a0 + 12, a1: e.a1 + 12, b0: e.b0 - 8, b1: e.b1 - 8 };
    const s = fit.snap(moved, f); tested++;
    if (Math.abs(s.el.a0 - e.a0) <= 4 && Math.abs(s.el.b0 - e.b0) <= 4) back++; else if (tested < 40) console.log(e.kind, fit.support(e, f).toFixed(2), fit.support(moved, f).toFixed(2), s.score?.toFixed(2), s.el.a0 - e.a0, s.el.b0 - e.b0);
  }
  // 엉뚱한 곳(원본에 없는 자리)에 놓은 가짜 벽
  const fake = { ...scene.elements.find((e) => e.kind === 'wall'), a0: 1200, a1: 1500, b0: 600, b1: 612, z: 0, h: 300 };
  const t1 = performance.now(); fit.fitDraft(scene.elements, f); const tFit = performance.now() - t1;
  const low = scene.elements.map((e) => [e.kind, fit.support(e, f)]).filter(([, s]) => s !== null && s < 0.2);
  return { low: JSON.stringify(low), tField: Math.round(tField), tFit: Math.round(tFit), n: scored.length, avg: avg.toFixed(2), back: `${back}/${tested}`, fake: fit.support(fake, f) };
});
console.log(r);
await browser.close();
