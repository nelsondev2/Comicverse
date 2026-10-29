/**
 * Produces the curated screenshots used in the README (docs/screenshots).
 * Runs the packaged .xdc with a messenger-like webxdc.js.
 *
 *   node dev/docs-shots.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

const puppeteer = (await import(process.env.PUPPETEER_MODULE || '../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const xdc = fs.readdirSync('release').filter((f) => f.endsWith('.xdc'))[0];
const dir = '/tmp/comicverse-docs';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
execSync(`unzip -q "release/${xdc}" -d "${dir}"`);
fs.writeFileSync(path.join(dir, 'webxdc.js'), `
window.webxdc = {
  selfAddr: 'docs@example.org', selfName: 'Nelson', isBroadcast: false, isAppSender: true,
  sendUpdateInterval: 1000, sendUpdateMaxSize: 128000,
  sendUpdate: function () {}, setUpdateListener: function () { return Promise.resolve(); },
  importFiles: function () { return Promise.resolve(window.__nextFiles || []); },
  sendToChat: function () { return Promise.resolve(); }
};`);

const port = 8124;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });

await sleep(1200);

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--force-color-profile=srgb'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
  protocolTimeout: 120000,
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

// load the example comics into the messenger picker
const fixtures = {};
for (const name of ['noches-de-neon.cbz', 'el-observador-001.cbz', 'manual-de-sombras.pdf']) {
  const res = await fetch('http://127.0.0.1:8080/tests/fixtures/' + name);
  fixtures[name] = Buffer.from(await res.arrayBuffer()).toString('base64');
}

await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.App && window.Library, { timeout: 20000 });
await sleep(1200);
await page.screenshot({ path: `${OUT}/01-welcome.png` });

await page.evaluate((fixtures) => {
  U.closeAllSheets();
  window.__nextFiles = Object.keys(fixtures).map((name) => {
    const bin = atob(fixtures[name]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'application/zip' });
  });
  Library.importFiles();
}, fixtures);
await page.waitForFunction(() => Library.books.length === 3, { timeout: 120000, polling: 200 });
await sleep(1200);
await page.screenshot({ path: `${OUT}/02-importing.png` });
await page.evaluate(() => U.closeAllSheets());
await sleep(4200); // let the import toast fade out

// give the library some life: progress, a favourite, a collection
await page.evaluate(async () => {
  const [a, b, c] = Library.books;
  a.page = 6; a.lastReadAt = Date.now() - 1000;
  b.page = 3; b.lastReadAt = Date.now() - 90000;
  c.favorite = true;
  const col = { id: 'col-manga', name: 'Manga', createdAt: Date.now() };
  Library.collections.push(col);
  a.collections = ['col-manga'];
  await Promise.all([DB.put('books', a), DB.put('books', b), DB.put('books', c), DB.put('collections', col)]);
  App.renderShelves();
  Library.render();
});
await sleep(900);
await page.screenshot({ path: `${OUT}/03-library.png` });

await page.evaluate(() => Library.openDetails(Library.books.find((b) => b.type === 'cbz' && b.title.startsWith('N')).id));
await sleep(900);
await page.screenshot({ path: `${OUT}/04-details.png` });
await page.keyboard.press('Escape');
await sleep(600);

await page.evaluate(() => Reader.open(Library.books.find((b) => b.type === 'cbz')));
await page.waitForFunction(() => window.Reader.isOpen() && document.querySelector('.page-holder img'), { timeout: 30000 });
await sleep(900);
await page.screenshot({ path: `${OUT}/05-reader.png` });

await page.evaluate(() => document.querySelector('#btnReaderSettings').click());
await sleep(800);
await page.screenshot({ path: `${OUT}/06-reader-settings.png` });
await page.keyboard.press('Escape');
await sleep(600);

await page.evaluate(() => document.querySelector('#btnThumbs').click());
await sleep(2200);
await page.screenshot({ path: `${OUT}/07-thumbnails.png` });
await page.keyboard.press('Escape');
await sleep(700);

await page.evaluate(() => Reader.setMode('double'));
await sleep(1400);
await page.screenshot({ path: `${OUT}/08-spread.png` });

await page.evaluate(() => Reader.setMode('scroll'));
await sleep(1800);
await page.screenshot({ path: `${OUT}/09-scroll.png` });

await page.evaluate(() => Reader.close());
await sleep(1500);

await page.evaluate(() => Reader.open(Library.books.find((b) => b.type === 'pdf')));
await page.waitForFunction(() => window.Reader.isOpen() && document.querySelector('.page-holder canvas'), { timeout: 40000 });
await sleep(1200);
await page.screenshot({ path: `${OUT}/10-pdf.png` });
await page.evaluate(() => Reader.close());
await sleep(1200);

await page.evaluate(() => App.setTab('shelves'));
await sleep(900);
await page.screenshot({ path: `${OUT}/11-shelves.png` });

await page.evaluate(() => App.setTab('stats'));
await sleep(900);
await page.screenshot({ path: `${OUT}/12-stats.png` });

await page.evaluate(() => App.setTab('settings'));
await sleep(1000);
await page.screenshot({ path: `${OUT}/13-settings.png` });

await page.evaluate(() => { App.settings.theme = 'light'; App.applyTheme(); App.setTab('library'); Library.render(); });
await sleep(900);
await page.screenshot({ path: `${OUT}/14-light.png` });
await page.evaluate(() => { App.settings.theme = 'dark'; App.settings.accent = 'violet'; App.applyTheme(); });

await page.setViewport({ width: 1180, height: 780, deviceScaleFactor: 1 });
await sleep(900);
await page.screenshot({ path: `${OUT}/15-desktop.png` });

await browser.close();
server.kill();
console.log('docs screenshots →', OUT);
console.log(fs.readdirSync(OUT).map((f) => f + ' ' + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + 'kB').join('\n'));
