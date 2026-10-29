/** Render dev/icon.html → icon.png (512×512) and dev/icon-128.png */
import fs from 'node:fs';
import path from 'node:path';
const puppeteer = (await import(process.env.PUPPETEER_MODULE || '../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote','--force-color-profile=srgb'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
});
const page = await browser.newPage();
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.goto('file://' + path.resolve('dev/icon.html'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'icon.png', clip: { x: 0, y: 0, width: 512, height: 512 }, omitBackground: false });
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.screenshot({ path: 'dev/icon-128.png', clip: { x: 0, y: 0, width: 512, height: 512 }, omitBackground: false });
console.log('icon.png', fs.statSync('icon.png').size, 'bytes');
await browser.close();
