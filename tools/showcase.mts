// 개발용: 요소 견본 장면을 SVG로 렌더한다. npx tsx tools/showcase.mts out.svg
import fs from 'node:fs';
import { renderSVG } from '../src/iso';
import { defaults, type El, type Kind } from '../src/schema';
const kinds: Kind[] = ['sofa', 'armchair', 'roundTable', 'plant', 'planter', 'counter', 'panel', 'prism', 'chair', 'taskChair', 'table', 'shelf'];
const els: El[] = [];
els.push({ ...defaults('slab'), a0: 0, a1: 900, b0: -700, b1: 0, h: 18 });
kinds.forEach((k, i) => {
  const e = defaults(k), col = i % 4, row = Math.floor(i / 4);
  const oa = 80 + row * 260, ob = -620 + col * 160;
  const sh = (q: { a: number; b: number; z: number }) => ({ ...q, a: q.a + oa, b: q.b + ob });
  if (['chair', 'taskChair'].includes(k)) Object.assign(e, { a0: oa, a1: oa + 26, b0: ob, b1: ob + 26 });
  else Object.assign(e, { a0: e.a0 + oa, a1: e.a1 + oa, b0: e.b0 + ob, b1: e.b1 + ob });
  if (k === 'roundTable') Object.assign(e, { a1: e.a0 + 120, b1: e.b0 + 70 });
  if (k === 'planter') Object.assign(e, { a1: e.a0 + 180, b1: e.b0 + 40, n: 5 });
  e.points = e.points.map(sh);
  els.push(e);
});
const svg = renderSVG({ width: 1300, height: 900, elements: els.map((e) => ({ ...e, a0: e.a0, b0: e.b0 })) });
// 장면을 화면 가운데로 옮긴다
fs.writeFileSync(process.argv[2], svg.replace(/viewBox="[^"]*" width="1300" height="900"/, 'viewBox="-560 -150 1400 1000" width="1400" height="1000"').replace('<rect width="1300" height="900"', '<rect x="-560" y="-150" width="1400" height="1000"'));
