// 개발용: 선분 각도 분포(길이 가중, 5° 칸)
import { createRequire } from 'node:module'; import fs from 'node:fs'; import { PNG } from 'pngjs';
import { detectSegments } from '../src/convert/warp.js';
const require = createRequire(import.meta.url);
let cv = require('@techstark/opencv-js'); if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise((r) => (cv.onRuntimeInitialized = r));
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const src = cv.matFromImageData({ data: png.data, width: png.width, height: png.height });
const g = new cv.Mat(); cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
const segs = detectSegments(cv, g); const h = new Array(36).fill(0);
for (const s of segs) h[Math.floor(s.ang / 5) % 36] += s.len;
console.log(png.width, png.height, h.map((v, i) => `${i * 5}:${Math.round(v)}`).join(' '));
