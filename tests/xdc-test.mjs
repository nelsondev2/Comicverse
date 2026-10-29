/**
 * Tests the packaged .xdc exactly as a messenger would run it:
 * unzip → add a messenger-provided webxdc.js → serve → drive with puppeteer.
 *
 *   node tests/xdc-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

const puppeteer = (await import(process.env.PUPPETEER_MODULE || '../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;

const SHOTS = 'tests/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
};

const XDC = process.argv[2] || fs.readdirSync("release").filter((f) => f.endsWith('.xdc')).map((f) => path.join('release', f))[0];
if (!XDC || !fs.existsSync(XDC)) {
  console.error('No .xdc found — run ./build.sh first');
  process.exit(1);
}
console.log('Testing package:', XDC, '(' + (fs.statSync(XDC).size / 1024 / 1024).toFixed(2) + ' MB)');

const dir = '/tmp/xdc-run';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
execSync(`unzip -q "${XDC}" -d "${dir}"`);

// A messenger injects this file; emulate the parts Comicverse uses.
fs.writeFileSync(path.join(dir, 'webxdc.js'), `
window.__sentUpdates = [];
window.webxdc = {
  selfAddr: 'alice@example.org', selfName: 'Alicia',
  isBroadcast: false, isAppSender: true,
  sendUpdateInterval: 200, sendUpdateMaxSize: 128000,
  sendUpdate: function (update, descr) {
    window.__sentUpdates.push(update);
    if (window.__onSent) window.__onSent(update);
  },
  setUpdateListener: function (cb, serial) { window.__listener = cb; return Promise.resolve(); },
  importFiles: function (filter) {
    window.__importFilter = filter;
    return Promise.resolve(window.__nextFiles || []);
  },
  sendToChat: function (msg) {
    window.__sentToChat = msg;
    return Promise.resolve();
  }
};
`);

const port = 8123;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
await sleep(1200);

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--force-color-profile=srgb'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
  protocolTimeout: 120000,
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') problems.push('CONSOLE: ' + m.text()); });
page.on('pageerror', (e) => problems.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => problems.push('REQFAIL: ' + r.url()));

try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => !!window.App && !!window.Library, { timeout: 15000 });
  await sleep(1000);
  check('app boots from .xdc', true);
  check('manifest loaded by messenger', fs.readFileSync(path.join(dir, 'manifest.toml'), 'utf8').includes('name = "Comicverse"'));
  check('icon present (512px)', fs.statSync(path.join(dir, 'icon.png')).size > 1000);
  check('webxdc API detected', await page.evaluate(() => WX.available === true));
  await page.screenshot({ path: `${SHOTS}/xdc-01-boot.png` });
  await page.evaluate(() => U.closeAllSheets());

  // --- import through the messenger file picker -----------------------------
  console.log('→ import via webxdc.importFiles');
  // fixtures are served by the dev server, so fetch them through it and hand them to the picker
  const fixtures = {};
  for (const name of ['el-observador-001.cbz', 'manual-de-sombras.pdf']) {
    const res = await fetch('http://127.0.0.1:8080/tests/fixtures/' + name);
    fixtures[name] = Buffer.from(await res.arrayBuffer()).toString('base64');
  }
  await page.evaluate(async (fixtures) => {
    window.__nextFiles = Object.keys(fixtures).map((name) => {
      const bin = atob(fixtures[name]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'application/zip' });
    });
    Library.importFiles();
  }, fixtures);
  await page.waitForFunction(() => Library.books.length === 2, { timeout: 120000, polling: 200 });
  check('webxdc.importFiles used with CBZ + PDF', true, await page.evaluate(() => Library.books.map((b) => b.type)));
  check('import filter passed to messenger', await page.evaluate(() => !!window.__importFilter && window.__importFilter.extensions.includes('.cbz')));
  await sleep(500);
  await page.evaluate(() => U.closeAllSheets());
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/xdc-02-library.png` });

  // --- read + progress sync -------------------------------------------------
  console.log('→ reading & chat sync');
  await page.evaluate(() => Reader.open(Library.books.find((b) => b.type === 'cbz')));
  await page.waitForFunction(() => window.Reader.isOpen() && document.querySelector('.page-holder img'), { timeout: 30000 });
  await sleep(600);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await sleep(350); }
  await page.screenshot({ path: `${SHOTS}/xdc-03-reader.png` });
  await page.evaluate(() => Reader.close());
  await sleep(1500);
  const sent = await page.evaluate(() => window.__sentUpdates.map((u) => u.payload));
  check('progress update sent to chat', sent.some((p) => (p.type === 'batch' ? p.items : [p]).some((i) => i && i.type === 'progress')), sent);
  const payload = JSON.parse(JSON.stringify(sent)).find((p) => (p.type === 'batch' ? p.items : [p]).some((i) => i && i.type === 'progress'));
  const prog = payload.type === 'batch' ? payload.items.find((i) => i.type === 'progress') : payload;
  check('progress payload carries book hash + page', !!prog.book && typeof prog.page === 'number', { page: prog.page, by: prog.by });

  // --- incoming update from another peer -----------------------------------
  console.log('→ incoming update');
  await page.evaluate((prog) => {
    window.__listener && window.__listener({
      serial: 9, max_serial: 9,
      payload: { type: 'progress', book: prog.book, title: 'x', page: 5, pageCount: prog.pageCount, updatedAt: Date.now() + 1000, by: 'bob@example.org' }
    });
  }, prog);
  await sleep(900);
  const remote = await page.evaluate((hash) => {
    const b = Library.books.find((x) => x.hash === hash);
    return b ? b.page : null;
  }, prog.book);
  check('remote progress applied locally', remote === 5, { page: remote });

  // --- send file to chat ---------------------------------------------------
  console.log('→ sendToChat');
  await page.evaluate(() => Library.exportBook(Library.books[0]));
  await sleep(900);
  const toChat = await page.evaluate(() => window.__sentToChat && { name: window.__sentToChat.file.name, size: window.__sentToChat.file.blob.size });
  check('sendToChat receives the comic file', !!toChat && toChat.size > 1000, toChat);

  // --- offline / reload persistence ---------------------------------------
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.Library && Library.books.length === 2, { timeout: 20000 });
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}/xdc-04-reload.png` });
  check('library survives in webxdc storage', true);

  // --- PDF still readable --------------------------------------------------
  await page.evaluate(() => Reader.open(Library.books.find((b) => b.type === 'pdf')));
  await page.waitForFunction(() => window.Reader.isOpen() && document.querySelector('.page-holder canvas'), { timeout: 40000 });
  await sleep(800);
  await page.screenshot({ path: `${SHOTS}/xdc-05-pdf.png` });
  check('PDF renders inside .xdc', true);
  await page.evaluate(() => Reader.close());
  await sleep(800);

  // --- narrow webview (messenger side panel) -------------------------------
  await page.setViewport({ width: 320, height: 620, deviceScaleFactor: 2 });
  await sleep(700);
  await page.screenshot({ path: `${SHOTS}/xdc-06-narrow.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal overflow at 320px', overflow <= 1, { overflow });
} finally {
  await browser.close();
  server.kill();
}

console.log('\n=== CHECKS ===');
checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log('problems:', [...new Set(problems)].slice(0, 10));
process.exit(failed.length || problems.length ? 1 : 0);
