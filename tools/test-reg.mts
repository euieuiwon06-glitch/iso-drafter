// 개발용: 구조 정리 전/후 SVG. npx tsx tools/test-reg.mts out-prefix
import fs from 'node:fs';
import { renderSVG } from '../src/iso';
import { regularizeStructure } from '../src/fit';
import { defaults, type El, type Kind } from '../src/schema';
const E = (k: Kind, o: Partial<El>): El => ({ ...defaults(k), ...o });
const els: El[] = [
  E('slab', { a0: -8, a1: 508, b0: -406, b1: 7, h: 18 }),
  E('wall', { a0: 3, a1: 495, b0: -6, b1: 6, h: 280 }),          // 뒤 벽(A 방향)
  E('wall', { a0: -6, a1: 6, b0: -390, b1: 9, h: 300 }),          // 왼쪽 벽(B 방향), 끝이 모자람
  E('wall', { a0: 240, a1: 252, b0: -395, b1: -12, h: 240 }),     // 칸막이, 앞 벽에 안 닿음
  E('glass', { a0: 8, a1: 230, b0: -398, b1: -392, h: 230, n: 3 }), // 앞 유리(약간 기울어짐)
  E('glass', { a0: 260, a1: 500, b0: -404, b1: -404, h: 260, n: 3 }),
  E('cabinet', { a0: 20, a1: 70, b0: -150, b1: -40, h: 190, n: 2, dir: '+a' }),   // 벽에서 14 떨어진 옷장
  E('bed', { a0: 300, a1: 480, b0: -160, b1: -17, dir: '+b' }),
];
const box = (svg: string) => svg.replace(/viewBox="[^"]*" width="1" height="1"/, 'viewBox="-420 -350 1000 800" width="1000" height="800"').replace('<rect width="1" height="1"', '<rect x="-420" y="-350" width="1000" height="800"');
const [out] = process.argv.slice(2);
fs.writeFileSync(out + '-before.svg', box(renderSVG({ width: 1, height: 1, elements: els })));
fs.writeFileSync(out + '-after.svg', box(renderSVG({ width: 1, height: 1, elements: regularizeStructure(els) })));
