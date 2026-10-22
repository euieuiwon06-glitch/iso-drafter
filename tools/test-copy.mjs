// 개발용: 평면 모드 변환 후 SVG 복사 확인
import { chromium } from 'playwright-core';
const [img] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5341/');
await page.click('#convMode button[data-m=flat]');
await page.setInputFiles('#fileConvert', img);
await page.waitForFunction(() => !document.getElementById('stepResult').hidden, null, { timeout: 120000 });
await page.click('#btnResCopy');
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
console.log('button:', await page.textContent('#btnResCopy'), '| clipboard starts:', clip.slice(0, 60), '| length', clip.length);
await browser.close();
