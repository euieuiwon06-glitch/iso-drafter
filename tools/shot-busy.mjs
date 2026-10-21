// 개발용: 변환 시작 직후 로딩바를 캡처한다.
import { chromium } from 'playwright-core';
const [img, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto('http://localhost:5341/');
await page.evaluate(() => localStorage.setItem('iso-drafter:key', 'sk-ant-test-invalid'));
await page.reload(); await page.waitForTimeout(500);
await page.setInputFiles('#fileConvert', img);
await page.waitForTimeout(2500);
console.log('bar visible:', await page.evaluate(() => !document.querySelector('#convertView .loadbar').hidden), 'p=', await page.evaluate(() => document.querySelector('#convertView .loadbar').style.getPropertyValue('--p')));
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1500, height: 140 } });
await page.waitForFunction(() => document.querySelector('li.fail'), null, { timeout: 120000 }).catch(() => {});
console.log('after fail hidden:', await page.evaluate(() => document.querySelector('#convertView .loadbar').hidden));
await browser.close();
