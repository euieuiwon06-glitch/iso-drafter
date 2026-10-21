// claude.ai 아티팩트용 단일 HTML을 만든다: dist의 CSS/JS를 인라인하고 문서 뼈대 태그를 뺀다.
// node tools/build-artifact.mjs  →  artifact/iso-drafter.html
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npm run build', { stdio: 'inherit' });
const dist = 'dist';
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g)].map((m) => read(m[1])).join('\n');
const jsHref = html.match(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/)[1];
// 인라인 스크립트가 일찍 닫히지 않게 </script를 끊고, U+FFFD는 이스케이프로 바꾼다(아티팩트가 깨진 문자로 거부함)
const js = read(jsHref).replace(/<\/script/gi, '<\\/script').replace(/�/g, '\\uFFFD');

const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, '');

const out = `<title>ISO DRAFTER</title>
${fonts}
<style>
${css}
</style>
${body.trim()}
<script type="module">
${js}
</script>
`;
fs.mkdirSync('artifact', { recursive: true });
fs.writeFileSync('artifact/iso-drafter.html', out);
console.log('artifact/iso-drafter.html', (out.length / 1024).toFixed(0), 'KB');
