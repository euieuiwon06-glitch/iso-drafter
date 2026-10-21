// 개발용: 예시 장면 구조 + 원본(public/__crop.png)으로 곡선 따기 결과 SVG를 만든다. vite dev(5342) 필요
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5342/');
const r = await page.evaluate(async () => {
  const { traceDetails } = await import('/src/trace.ts');
  const { renderSVG, DETAIL_KINDS, screenBox } = await import('/src/iso.ts');
  const scene = (await import('/src/sample-scene.json')).default;
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = '/__crop.png'; });
  const structure = { ...scene, elements: scene.elements.filter((e) => !DETAIL_KINDS.has(e.kind)) };
  const s = renderSVG(structure, { wscale: 1.35 });
  const t0 = performance.now();
  const regions = scene.elements.filter((e) => DETAIL_KINDS.has(e.kind)).map((e) => screenBox(e));
  const paths = await traceDetails(img, s, regions, 'k');
  const t = performance.now() - t0;
  const svg = s.replace(/<\/svg>$/, `<g fill="none" stroke="#2B2B2B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${paths.join('')}"/></g></svg>`);
  return { t: Math.round(t), n: paths.length, svg };
});
console.log('ms', r.t, 'paths', r.n, 'kb', Math.round(r.svg.length / 1024));
fs.writeFileSync(process.argv[2], r.svg);
await browser.close();
