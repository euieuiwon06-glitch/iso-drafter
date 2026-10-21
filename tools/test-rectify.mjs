// 개발용: rectifyRGBA 전체(축 변환 + 메시)를 돌려 결과를 저장. node tools/test-rectify.mjs in.png out.png
import { createRequire } from 'node:module'; import fs from 'node:fs'; import { PNG } from 'pngjs';
import { rectifyRGBA, readyCv } from '../src/convert/rectify.js';
const require = createRequire(import.meta.url);
globalThis.ImageData ??= class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
const cv = await readyCv(require('@techstark/opencv-js'));
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const r = await rectifyRGBA(cv, png.data.buffer.slice(png.data.byteOffset, png.data.byteOffset + png.data.length), png.width, png.height, (m) => console.log(' ', m));
console.log(r.width, r.height, r.stats, r.proj);
const o = new PNG({ width: r.width, height: r.height }); o.data = Buffer.from(r.data); fs.writeFileSync(process.argv[3], PNG.sync.write(o));
