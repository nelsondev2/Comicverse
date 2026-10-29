const puppeteer = (await import(process.env.PUPPETEER_MODULE || '../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
  protocolTimeout: 60000,
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type().toUpperCase()+': '+m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'tests/shots/quick-1.png' });
console.log(JSON.stringify({ errors, title: await page.title(), hasApp: await page.evaluate(() => !!window.App), books: await page.evaluate(() => window.Library ? Library.books.length : -1) }, null, 2));
await browser.close();
