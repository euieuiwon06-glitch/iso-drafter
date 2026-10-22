// 개발용: 세부 강화 부품 견본. npx tsx tools/showcase-detail.mts out.svg
import fs from 'node:fs';
import { renderSVG } from '../src/iso';
import { defaults, type El, type Kind } from '../src/schema';
const E = (k: Kind, o: Partial<El>): El => ({ ...defaults(k), ...o });
const els: El[] = [
  E('slab', { a0: 0, a1: 900, b0: -700, b1: 0, h: 18 }),
  E('wall', { a0: 0, a1: 900, b0: -12, b1: 0, h: 240 }),
  E('window', { a0: 120, a1: 300, b0: -12, b1: -12, z: 80, h: 110, n: 3 }),
  E('cabinet', { a0: 400, a1: 560, b0: -70, b1: -12, h: 210, n: 3, m: 0, dir: '-b' }),
  E('counter', { a0: 600, a1: 860, b0: -80, b1: -12, h: 90, n: 1, m: 4 }),
  E('bed', { a0: 60, a1: 270, b0: -300, b1: -140, dir: '-a', h: 100 }),
  E('cabinet', { a0: 60, a1: 100, b0: -345, b1: -305, h: 55, n: 0, m: 2, dir: '+a' }),
  E('sofa', { a0: 380, a1: 470, b0: -420, b1: -200, dir: '+a' }),
  E('chair', { a0: 620, a1: 646, b0: -260, b1: -234, dir: '-a' }),
  E('chair', { a0: 700, a1: 726, b0: -260, b1: -234, dir: '+b' }),
  E('table', { a0: 640, a1: 720, b0: -330, b1: -270, h: 74 }),
  E('toilet', { a0: 100, a1: 165, b0: -560, b1: -520, dir: '-a' }),
  E('bathtub', { a0: 200, a1: 370, b0: -640, b1: -565, dir: '-a' }),
];
const svg = renderSVG({ width: 1, height: 1, elements: els });
fs.writeFileSync(process.argv[2], svg.replace(/viewBox="[^"]*" width="1" height="1"/, 'viewBox="-640 -300 1450 900" width="1450" height="900"').replace('<rect width="1" height="1"', '<rect x="-640" y="-300" width="1450" height="900"'));
