// 개발용: 원본 벡터화 결과 SVG 만들기. node tools/test-vec.mjs <public 이미지 경로> <out.svg> [sample]
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const [srcName, out, withScene] = process.argv.slice(2); const src = '/' + srcName.replace(/^.*[/]/, '');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto('http://localhost:5342/');
const r = await page.evaluate(async ([src, withScene]) => {
  const { vectorizeInk } = await import('/src/trace.ts');
  const { renderSVG, DETAIL_KINDS } = await import('/src/iso.ts');
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  const W = img.naturalWidth, H = img.naturalHeight;
  let structSvg = null, base = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/></svg>`;
  if (withScene) {
    const scene = (await import('/src/sample-scene.json')).default;
    structSvg = renderSVG({ ...scene, elements: scene.elements.filter((e) => !DETAIL_KINDS.has(e.kind)) });
    base = structSvg;
  }
  const t0 = performance.now();
  const d = await vectorizeInk(img, structSvg, null, 'k');
  return { t: Math.round(performance.now() - t0), svg: base.replace(/<\/svg>$/, `<path fill="#2B2B2B" fill-rule="evenodd" d="${d}"/></svg>`) };
}, [src, withScene]);
console.log('ms', r.t, 'kb', Math.round(r.svg.length / 1024));
fs.writeFileSync(out, r.svg);
await browser.close();
