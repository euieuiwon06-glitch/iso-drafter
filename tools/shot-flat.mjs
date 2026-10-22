// 개발용: 평면 그래픽 모드 전체 흐름
import { chromium } from 'playwright-core';
const [img, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5341/');
await page.click('#convMode button[data-m=flat]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-upload.png` });
const t = Date.now();
await page.setInputFiles('#fileConvert', img);
await page.waitForFunction(() => !document.getElementById('stepResult').hidden || document.querySelector('li.fail'), null, { timeout: 120000 });
console.log('done in', Date.now() - t, 'ms |', await page.textContent('#resStats'), '|', (await page.textContent('#runMsg')).slice(0, 120));
await page.click('#cmpMode button[data-m=result]'); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-result.png` });
await browser.close();
