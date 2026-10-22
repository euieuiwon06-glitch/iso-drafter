// 개발용: 평면 그래픽 벡터화. node tools/test-flat.mjs __flat.png out.svg  (vite dev 5342)
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const [name, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5342/');
const r = await page.evaluate(async (src) => {
  const t = await import('/src/trace.ts');
  t.setTraceAxes(0, 90);
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  const t0 = performance.now();
  const f = await t.vectorizeFlat(img);
  return { axes: f.axes, t: Math.round(performance.now() - t0), colors: [f.bg, ...f.layers.map((l) => l.fill)], svg: t.flatSvg(f) };
}, '/' + name);
console.log("axes", r.axes, "ms", r.t, 'colors', r.colors.join(' '), 'kb', Math.round(r.svg.length / 1024));
fs.writeFileSync(out, r.svg);
await browser.close();
