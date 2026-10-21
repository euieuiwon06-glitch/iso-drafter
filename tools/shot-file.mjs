// 개발용: 로컬 HTML 파일을 라이트/다크로 스크린샷. node tools/shot-file.mjs <file> <outPrefix>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const [file, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-${scheme}.png` });
  await page.close();
}
const ph = await browser.newPage({ viewport: { width: 400, height: 800 } });
await ph.goto(pathToFileURL(file).href); await ph.waitForTimeout(800);
console.log('phone overflow:', await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await browser.close();
