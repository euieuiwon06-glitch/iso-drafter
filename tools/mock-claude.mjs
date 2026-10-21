// 개발용: window.claude(구독 호출)를 흉내 내서 아티팩트 경로 전체를 브라우저에서 돌린다.
// node tools/mock-claude.mjs <image> <outPrefix> [mode]  mode: ok | oneimage | fail
import { chromium } from 'playwright-core';
const [img, out, mode = 'ok'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.text().startsWith('MOCK')) console.log(m.text()); });
await page.exposeFunction('logMsg', (t) => console.log('MSG', t));
await page.addInitScript((mode) => {
  let calls = 0;
  const C = Math.cos(Math.PI / 6), S = 0.5;
  const sample = async (prompt, opts) => {
    calls++;
    const m = prompt.match(/x (\d+)\.\.(\d+), y (\d+)\.\.(\d+)/);
    console.log(`MOCK call ${calls} images=${opts.images.length} sizes=${opts.images.map((b) => Math.round(b.size / 1024) + 'KB').join(',')} band=${m ? m.slice(1).join(',') : 'none'} cont=${prompt.includes('YOU ALREADY')} effort=${opts.effort}`);
    if (mode === 'fail') { await new Promise((r) => setTimeout(r, 300)); throw { code: 'upstream_error', message: 'x' }; }
    await new Promise((r) => setTimeout(r, 3000));
    const [x0, x1, y0, y1] = m.slice(1).map(Number);
    if (prompt.includes('Current elements in this band, numbered')) {
      // 보정: 0번을 3배로 키우는 수정(막혀야 함), 1번 삭제, 화분 하나 추가
      const cur = [...prompt.matchAll(/^(\d+): (\[.*\])$/gm)].map((x) => JSON.parse(x[2]));
      const out = [];
      if (cur[0]) { const e = cur[0].slice(); e[2] = e[1] + (e[2] - e[1]) * 3 + 60; e[4] = e[3] + (e[4] - e[3]) * 3 + 60; out.push(JSON.stringify(['edit', 0, e])); }
      if (cur[1]) out.push(JSON.stringify(['del', 1]));
      const x = (x0 + x1) / 2, y = (y0 + y1) / 2, a = Math.round((x / C + y / S) / 2), b = Math.round((x / C - y / S) / 2);
      out.push(JSON.stringify(['add', ['plant', a, a + 30, b, b + 30, 0, 70, 0, 0, '+b', 'white', 'added', []]]));
      const text = out.join('\n');
      opts.onText?.({ text, delta: text });
      console.log(`MOCK refine band=${m.slice(1).join(',')} cur=${cur.length} -> ${out.length} changes`);
      return { text, truncated: false };
    }
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const x = x0 + (x1 - x0) * (0.2 + 0.2 * i), y = (y0 + y1) / 2 + (i - 1.5) * 30;
      const a = Math.round((x / C + y / S) / 2), b = Math.round((x / C - y / S) / 2);
      const kinds = [['plant', 30, 70], ['box', 50, 35], ['chair', 26, 0], ['taskChair', 30, 0]];
      const [kind, sz, h] = kinds[i];
      lines.push(JSON.stringify([kind, a, a + sz, b, b + sz, 0, h, 0, 0, '+b', 'white', `${kind}${calls}-${i}`, []]));
      if (i === 0) lines.push(JSON.stringify(['node', a, a, b, b, 0, 0, 0, 0, '+b', 'white', 'marker', []]));
    }
    const text = lines.join('\n');
    opts.onText?.({ text, delta: text });
    // 첫 호출은 잘린 것처럼: 이어 받기 확인
    return { text, truncated: false };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: mode === 'oneimage' ? 1 : 4, maxInputBytes: 2e7, mediaTypes: ['image/jpeg'] } });
  window.claude = { use: async (name) => (name === 'sample' ? sample : name === 'downloads' ? { save: async () => ({}) } : null) };
}, mode);
await page.goto('http://localhost:5341/');
await page.evaluate(() => new MutationObserver(() => { const t = document.getElementById('runMsg').textContent; if (t.includes('수정 ') || t.includes('건너뜀')) window.logMsg(t); }).observe(document.getElementById('runMsg'), { childList: true, characterData: true, subtree: true }));
await page.waitForTimeout(800);
console.log('keyState:', await page.textContent('#keyState'));
const t = Date.now();
await page.setInputFiles('#fileConvert', img);
await page.waitForFunction(() => !document.getElementById('stepResult').hidden || document.querySelector('li.fail'), null, { timeout: 300000 });
console.log('finished in', Date.now() - t, 'ms | steps:', (await page.textContent('#steps')).replace(/\s+/g, ' '));
console.log('msg:', (await page.textContent('#runMsg')).replace(/\n/g, ' / '), '| stats:', await page.textContent('#resStats'));
await page.screenshot({ path: `${out}.png` });
if (!(await page.isHidden('#stepResult'))) { await page.fill('#rngResStroke', '250'); await page.dispatchEvent('#rngResStroke', 'input'); await page.mouse.click(500, 450); await page.waitForTimeout(400); await page.screenshot({ path: `${out}-result.png` }); await page.click('#cmpMode button[data-m=result]'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}-only.png`, clip: { x: 240, y: 180, width: 720, height: 160 } });
  console.log('cmp class:', await page.getAttribute('#cmp', 'class'), 'x:', await page.evaluate(() => getComputedStyle(document.getElementById('cmp')).getPropertyValue('--x'))); }
await browser.close();
