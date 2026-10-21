// 개발용: 곡선 요소 견본. npx tsx tools/showcase-curves.mts out.svg
import fs from 'node:fs';
import { renderSVG } from '../src/iso';
import { defaults, type El } from '../src/schema';
const P = (a: number, b: number, z = 0) => ({ a, b, z });
const els: El[] = [
  { ...defaults('slab'), a0: 0, a1: 700, b0: -500, b1: 0, h: 18 },
  { ...defaults('floor'), color: 'green', m: 1, points: [P(80, -120), P(220, -80), P(260, -200), P(160, -280), P(60, -230)] },
  { ...defaults('prism'), n: 1, h: 42, points: [P(110, -150), P(200, -130), P(220, -200), P(150, -240), P(100, -210)] },
  { ...defaults('prism'), n: 1, h: 40, points: [P(320, -100), P(470, -100), P(480, -150), P(400, -170), P(330, -150)] },
  { ...defaults('lathe'), a0: 400, b0: -320, points: [P(14, 0, 0), P(22, 0, 25), P(12, 0, 60), P(9, 0, 70)] },
  { ...defaults('lathe'), a0: 500, b0: -320, points: [P(18, 0, 0), P(3, 0, 4), P(3, 0, 120), P(28, 0, 135), P(14, 0, 165)] },
  { ...defaults('lathe'), a0: 600, b0: -320, points: [P(16, 0, 0), P(18, 0, 8), P(18, 0, 60), P(22, 0, 64)] },
  { ...defaults('curve'), points: [P(560, -100, 0), P(560, -100, 80), P(590, -100, 110), P(620, -100, 95)] },
  { ...defaults('lathe'), a0: 250, b0: -400, points: [P(30, 0, 0), P(26, 0, 30), P(34, 0, 42), P(34, 0, 45)] },
];
const svg = renderSVG({ width: 1, height: 1, elements: els });
fs.writeFileSync(process.argv[2], svg.replace(/viewBox="[^"]*" width="1" height="1"/, 'viewBox="-480 -150 1100 650" width="1100" height="650"').replace('<rect width="1" height="1"', '<rect x="-480" y="-150" width="1100" height="650"'));
