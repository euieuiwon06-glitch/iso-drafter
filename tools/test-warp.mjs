// 개발용: 원본 PNG에 투시 교정을 돌리고 결과/잔차를 출력한다. node tools/test-warp.mjs in.png out.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { detectSegments, classify, fitMesh, remapImage, residualAngles } from '../src/convert/warp.js';
const require = createRequire(import.meta.url);
let cv = require('@techstark/opencv-js');
if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise((r) => (cv.onRuntimeInitialized = r));
const [inp, out] = process.argv.slice(2);
const png = PNG.sync.read(fs.readFileSync(inp));
let src = cv.matFromImageData({ data: png.data, width: png.width, height: png.height });
const k = Math.min(1, 2000 / Math.max(png.width, png.height));
if (k < 1) { const d = new cv.Mat(); cv.resize(src, d, new cv.Size(Math.round(png.width * k), Math.round(png.height * k)), 0, 0, cv.INTER_AREA); src.delete(); src = d; }
const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
let t = Date.now();
const segs = detectSegments(cv, gray); const kept = classify(segs);
console.log('segments', segs.length, 'kept', kept.length, [0, 1, 2].map((f) => kept.filter((s) => s.target === [90, 150, 30][f]).length), Date.now() - t, 'ms');
const before = kept.map((s) => Math.abs(((s.ang - s.target + 270) % 180) - 90));
t = Date.now();
const mesh = await fitMesh(src.cols, src.rows, kept);
console.log('mesh', mesh.nx, 'x', mesh.ny, Date.now() - t, 'ms');
const res = residualAngles(mesh, kept).sort((a, b) => a - b), bs = before.sort((a, b) => a - b);
const q = (a, p) => a[Math.floor(a.length * p)].toFixed(2);
console.log('angle err before med/p90', q(bs, .5), q(bs, .9), ' after', q(res, .5), q(res, .9));
t = Date.now();
const { mat } = remapImage(cv, src, mesh);
console.log('remap', mat.cols, 'x', mat.rows, Date.now() - t, 'ms');
const o = new PNG({ width: mat.cols, height: mat.rows }); o.data = Buffer.from(mat.data); fs.writeFileSync(out, PNG.sync.write(o));
