// 개발용: 공간 규칙(groundScene) 확인
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
await page.goto('http://localhost:5342/');
const r = await page.evaluate(async () => {
  const { groundScene } = await import('/src/fit.ts');
  const { defaults } = await import('/src/schema.ts');
  const E = (k, o) => ({ ...defaults(k), ...o, note: o.note ?? k });
  const els = [
    E('slab', { a0: 0, a1: 600, b0: -400, b1: 0 }),
    E('wall', { a0: 0, a1: 600, b0: -12, b1: 0, h: 300 }),
    E('table', { a0: 100, a1: 250, b0: -200, b1: -120, h: 74 }),
    E('lathe', { a0: 300, b0: -300, z: 140, note: '공중 화병' }),
    E('lathe', { a0: 150, b0: -160, z: 90, note: '책상 위 화병(높이 틀림)' }),
    E('monitor', { a0: 400, a1: 440, b0: -300, b1: -300, z: 74, note: '받침 없는 모니터' }),
    E('chair', { a0: 300, a1: 330, b0: -20, b1: 10, note: '벽에 박힌 의자' }),
    E('plant', { a0: 500, a1: 700, b0: -300, b1: -100, h: 400, note: '거대 화분' }),
    E('box', { a0: 900, a1: 950, b0: 200, b1: 250, note: '건물 밖 상자' }),
  ];
  const g = groundScene(els);
  return { stats: { lifted: g.lifted, dropped2floor: g.dropped2floor, pushed: g.pushed, removed: g.removed, resized: g.resized }, els: g.els.filter((e) => !['slab', 'wall', 'table'].includes(e.kind)).map((e) => `${e.note}: z=${e.z} a=${e.a0.toFixed(0)}..${e.a1.toFixed(0)} b=${e.b0.toFixed(0)}..${e.b1.toFixed(0)} h=${e.h}`) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
