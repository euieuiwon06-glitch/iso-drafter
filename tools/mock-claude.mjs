// 개발용: window.claude(구독 호출)를 흉내 내서 아티팩트 경로 전체를 브라우저에서 돌린다.
// node tools/mock-claude.mjs <image> <outPrefix> [mode]  mode: ok | oneimage | fail
import { chromium } from 'playwright-core';
const [img, out, mode = 'ok'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.text().startsWith('MOCK')) console.log(m.text()); });
await page.addInitScript((mode) => {
  let calls = 0;
  const C = Math.cos(Math.PI / 6), S = 0.5;
  const sample = async (prompt, opts) => {
    calls++;
    const m = prompt.match(/x (\d+)\.\.(\d+), y (\d+)\.\.(\d+)/);
    console.log(`MOCK call ${calls} images=${opts.images.length} sizes=${opts.images.map((b) => Math.round(b.size / 1024) + 'KB').join(',')} band=${m ? m.slice(1).join(',') : 'none'} cont=${prompt.includes('YOU ALREADY')} effort=${opts.effort}`);
    if (mode === 'fail') { await new Promise((r) => setTimeout(r, 300)); throw { code: 'upstream_error', message: 'x' }; }
    await new Promise((r) => setTimeout(r, 400));
    const [x0, x1, y0, y1] = m.slice(1).map(Number);
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const x = x0 + (x1 - x0) * (0.2 + 0.2 * i), y = (y0 + y1) / 2 + (i - 1.5) * 30;
      const a = Math.round((x / C + y / S) / 2), b = Math.round((x / C - y / S) / 2);
      lines.push(JSON.stringify(['node', a, a, b, b, 0, 0, 0, 0, '+b', 'white', `n${calls}-${i}`, []]));
    }
    const text = lines.join('\n');
    opts.onText?.({ text, delta: text });
    // 첫 호출은 잘린 것처럼: 이어 받기 확인
    return { text, truncated: calls === 1 };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: mode === 'oneimage' ? 1 : 4, maxInputBytes: 2e7, mediaTypes: ['image/jpeg'] } });
  window.claude = { use: async (name) => (name === 'sample' ? sample : name === 'downloads' ? { save: async () => ({}) } : null) };
}, mode);
await page.goto('http://localhost:5341/');
await page.waitForTimeout(800);
console.log('keyState:', await page.textContent('#keyState'));
const t = Date.now();
await page.setInputFiles('#fileConvert', img);
await page.waitForFunction(() => !document.getElementById('stepResult').hidden || document.querySelector('li.fail'), null, { timeout: 300000 });
console.log('finished in', Date.now() - t, 'ms | steps:', (await page.textContent('#steps')).replace(/\s+/g, ' '));
console.log('msg:', (await page.textContent('#runMsg')).replace(/\n/g, ' / '), '| stats:', await page.textContent('#resStats'));
await page.screenshot({ path: `${out}.png` });
await browser.close();
