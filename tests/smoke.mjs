/**
 * Comicverse end-to-end smoke test + screenshots.
 * Requires: python3 dev/serve.py 8080 running, fixtures in tests/fixtures.
 *
 *   node tests/smoke.mjs
 */
import fs from 'node:fs';
const puppeteer = (await import(process.env.PUPPETEER_MODULE || '../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;

const SHOTS = 'tests/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--force-color-profile=srgb'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
  protocolTimeout: 120000,
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('CONSOLE: ' + m.text());
  if (m.type() === 'warning' && !/deprecated|Deprecation/i.test(m.text())) problems.push('WARN: ' + m.text());
});
page.on('pageerror', (e) => problems.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => {
  if (!/webxdc\.js|favicon/.test(r.url())) problems.push('REQFAIL: ' + r.url());
});

const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts });
  console.log('  📸', name);
};
const wait = async (fn, timeout = 15000, label = 'condition') => {
  try { await page.waitForFunction(fn, { timeout, polling: 120 }); return true; }
  catch (e) { problems.push('TIMEOUT: ' + label); console.log('  ⏱ timeout:', label); return false; }
};
const evalJs = (fn, ...args) => page.evaluate(fn, ...args);

console.log('\n== boot ==');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await wait(() => !!window.App && !!window.Library && !!document.querySelector('.tabbar'), 10000, 'boot');
await sleep(900);
await shot('01-welcome');
check('welcome sheet visible', await evalJs(() => !!document.querySelector('.sheet__title')));
await evalJs(() => { const b = [...document.querySelectorAll('.sheet .btn')].find((x) => /Explorar/.test(x.textContent)); if (b) b.click(); });
await sleep(600);
await shot('02-empty-library');
check('empty state visible', await evalJs(() => !document.querySelector('#libraryEmpty').hidden));

console.log('\n== import ==');
await evalJs(async () => {
  const names = ['el-observador-001.cbz', 'noches-de-neon.cbz', 'manual-de-sombras.pdf'];
  const files = [];
  for (const n of names) {
    const blob = await (await fetch('/tests/fixtures/' + n)).blob();
    files.push(new File([blob], n, { type: n.endsWith('.pdf') ? 'application/pdf' : 'application/zip' }));
  }
  window.__importPromise = Library.importFiles(files);
});
await wait(() => {
  const items = document.querySelectorAll('.import-item');
  const doneBtn = [...document.querySelectorAll('.sheet .btn')].find((b) => /Listo/.test(b.textContent));
  return items.length === 3 && doneBtn && !doneBtn.disabled;
}, 120000, 'import complete');
await sleep(600);
await shot('03-import-done');
await evalJs(() => { const b = [...document.querySelectorAll('.sheet .btn')].find((x) => /Listo/.test(x.textContent)); if (b) b.click(); });
await sleep(900);
await shot('04-library-grid');
const books = await evalJs(() => Library.books.map((b) => ({ t: b.title, p: b.pageCount, type: b.type, cover: !!b.cover })));
check('3 books imported with covers', books.length === 3 && books.every((b) => b.cover), books);

console.log('\n== library interactions ==');
await evalJs(() => Library.openDetails(Library.books[0].id));
await sleep(800);
await shot('05-details');
check('details sheet open', await evalJs(() => !!document.querySelector('.sheet .detail-title')));
await page.keyboard.press('Escape');
await sleep(500);
check('escape closes details', await evalJs(() => !document.querySelector('.sheet')));

await page.click('#btnSearch');
await page.type('#searchInput', 'neon');
await sleep(500);
await shot('06-search');
check('search filters to 1', await evalJs(() => document.querySelectorAll('.book-card').length) === 1);
await page.click('#btnSearchClear');
await sleep(400);

await evalJs(() => { Library.state.layout = 'list'; Library.render(); });
await sleep(500);
await shot('07-library-list');
check('list layout applied', await evalJs(() => document.querySelector('#libraryGrid').classList.contains('is-list')));
await evalJs(() => { Library.state.layout = 'grid'; Library.render(); });
await sleep(300);

console.log('\n== reader: CBZ ==');
await evalJs(() => Reader.open(Library.books.find((b) => b.type === 'cbz')));
await wait(() => window.Reader.isOpen() && document.querySelector('.page-layer[data-layer="a"] .page-holder img'), 30000, 'cbz page render');
await sleep(900);
await shot('08-reader-page1');
check('reader shows image page', await evalJs(() => !!document.querySelector('.page-holder img')));
const stage = await evalJs(() => { const r = document.querySelector('#readerStage').getBoundingClientRect(); return { w: r.width, h: r.height }; });

await page.keyboard.press('ArrowRight');
await sleep(800);
await shot('09-reader-page2');
check('keyboard next page', (await evalJs(() => Reader.current.page)) === 1);

// swipe with mouse
await page.mouse.move(stage.w * 0.78, stage.h * 0.5);
await page.mouse.down();
await page.mouse.move(stage.w * 0.28, stage.h * 0.5, { steps: 14 });
await sleep(200);
await shot('10-reader-swipe-mid');
await page.mouse.up();
await sleep(900);
await shot('11-reader-swipe-done');
check('swipe advances page', (await evalJs(() => Reader.current.page)) >= 2, await evalJs(() => Reader.current.page));

// swipe back
await page.mouse.move(stage.w * 0.25, stage.h * 0.5);
await page.mouse.down();
await page.mouse.move(stage.w * 0.8, stage.h * 0.5, { steps: 14 });
await page.mouse.up();
await sleep(900);
check('swipe back goes previous', (await evalJs(() => Reader.current.page)) <= 1);

// tap zones / chrome toggle
await page.mouse.click(stage.w * 0.5, stage.h * 0.5);
await sleep(500);
check('center tap hides chrome', await evalJs(() => document.querySelector('#reader').classList.contains('is-immersive')));
await page.mouse.click(stage.w * 0.5, stage.h * 0.5);
await sleep(400);
check('center tap shows chrome', await evalJs(() => !document.querySelector('#reader').classList.contains('is-immersive')));

// reader settings sheet (must be above the reader)
await page.click('#btnReaderSettings');
await sleep(700);
await shot('12-reader-settings');
const sheetZ = await evalJs(() => {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return null;
  const cs = getComputedStyle(sheet);
  const reader = getComputedStyle(document.querySelector('#reader'));
  return { sheet: +cs.zIndex, reader: +reader.zIndex, visible: sheet.getBoundingClientRect().top < window.innerHeight };
});
check('reader settings above reader', !!sheetZ && sheetZ.sheet > sheetZ.reader && sheetZ.visible, sheetZ);
await page.keyboard.press('Escape');
await sleep(500);
check('escape on sheet keeps reader open', await evalJs(() => Reader.isOpen()));

// spread mode via settings sheet
await evalJs(() => Reader.setMode('double'));
await sleep(1200);
await shot('13-reader-spread');
check('spread renders two pages', (await evalJs(() => document.querySelectorAll('.page-holder > div').length)) === 2);
check('reader mode is double', (await evalJs(() => Reader.current.mode)) === 'double');

// zoom via double tap
await page.mouse.click(stage.w * 0.5, stage.h * 0.45);
await sleep(120);
await page.mouse.click(stage.w * 0.5, stage.h * 0.45);
await sleep(700);
await shot('14-reader-zoom');
check('double tap zooms', (await evalJs(() => Reader.current.zoom.scale)) > 1.5, await evalJs(() => Reader.current.zoom.scale));
await page.mouse.click(stage.w * 0.5, stage.h * 0.45);
await sleep(120);
await page.mouse.click(stage.w * 0.5, stage.h * 0.45);
await sleep(600);

// scroll mode
await evalJs(() => Reader.setMode('scroll'));
await sleep(1800);
await shot('15-reader-scroll');
check('scroll mode renders pages', (await evalJs(() => document.querySelectorAll('.scroll-page img').length)) > 0);
await evalJs(() => { const s = document.querySelector('#scrollView'); s.scrollTop = s.scrollHeight / 2; });
await sleep(1200);
await shot('16-reader-scroll-mid');
check('scroll updates page counter', (await evalJs(() => Reader.current.page)) > 0);

// thumbnails
await evalJs(() => document.querySelector('#btnThumbs').click());
await sleep(2000);
await shot('17-thumbnails');
check('thumbnails render', (await evalJs(() => document.querySelectorAll('.thumb img, .thumb canvas').length)) > 3);
await page.keyboard.press('Escape');
await sleep(600);

// bookmark
await evalJs(() => Reader.setMode('single'));
await sleep(900);
await evalJs(() => Reader.toggleBookmark());
await sleep(400);
check('bookmark toggled', (await evalJs(() => Reader.current.bookmarks.length)) > 0);
check('bookmark button active', await evalJs(() => document.querySelector('#btnBookmark').classList.contains('is-on')));

await evalJs(() => Reader.close());
await wait(() => !window.Reader.isOpen(), 10000, 'reader closed');
await sleep(1400);
await shot('18-library-progress');
check('continue rail visible', await evalJs(() => !document.querySelector('#continueStrip').hidden));

console.log('\n== reader: PDF ==');
await evalJs(() => Reader.open(Library.books.find((b) => b.type === 'pdf')));
await wait(() => window.Reader.isOpen() && document.querySelector('.page-layer[data-layer="a"] .page-holder canvas'), 40000, 'pdf render');
await sleep(1200);
await shot('19-reader-pdf');
const pdfCanvas = await evalJs(() => { const c = document.querySelector('.page-holder canvas'); return c ? { w: c.width, h: c.height } : null; });
check('pdf renders canvas', !!pdfCanvas && pdfCanvas.w > 100, pdfCanvas);
await page.keyboard.press('ArrowRight');
await sleep(1200);
await shot('20-reader-pdf-page2');
check('pdf page turns', (await evalJs(() => Reader.current.page)) === 1);
await evalJs(() => Reader.setMode('scroll'));
await sleep(2000);
await shot('21-reader-pdf-scroll');
check('pdf scroll renders', (await evalJs(() => document.querySelectorAll('.scroll-page canvas').length)) > 0);
await evalJs(() => Reader.close());
await sleep(1200);

console.log('\n== shelves / stats / settings ==');
await evalJs(() => App.setTab('shelves'));
await sleep(700);
await shot('22-shelves');
check('smart shelves present', (await evalJs(() => document.querySelectorAll('.shelf-card').length)) >= 3);
await evalJs(() => Library.createCollection());
await sleep(600);
await evalJs(() => {
  const i = document.querySelector('.sheet input');
  if (i) { i.value = 'Manga'; i.dispatchEvent(new Event('input', { bubbles: true })); }
  const b = [...document.querySelectorAll('.sheet .btn')].find((x) => /Guardar/.test(x.textContent));
  if (b) b.click();
});
await sleep(900);
check('collection created', (await evalJs(() => Library.collections.length)) === 1);
await evalJs(() => { Library.books[0].collections = [Library.collections[0].id]; DB.put('books', Library.books[0]); App.renderShelves(); });
await sleep(500);
await shot('23-shelves-collection');

await evalJs(() => App.setTab('stats'));
await sleep(900);
await shot('24-stats');
check('stats rendered', (await evalJs(() => document.querySelectorAll('.stat-card').length)) === 4);

await evalJs(() => App.setTab('settings'));
await sleep(1100);
await shot('25-settings');
check('settings groups rendered', (await evalJs(() => document.querySelectorAll('.settings-group').length)) >= 4);
check('storage bar present', await evalJs(() => !!document.querySelector('.storage-bar span')));

console.log('\n== themes ==');
await evalJs(() => { App.settings.theme = 'light'; App.applyTheme(); App.setTab('library'); Library.render(); });
await sleep(800);
await shot('26-light-library');
check('light theme applied', (await evalJs(() => document.documentElement.getAttribute('data-theme'))) === 'light');
await evalJs(() => Reader.open(Library.books[0]));
await sleep(1600);
await shot('27-light-reader');
await evalJs(() => Reader.close());
await sleep(900);
await evalJs(() => { App.settings.theme = 'dark'; App.applyTheme(); });
await sleep(300);

console.log('\n== desktop layout ==');
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1.5 });
await sleep(1000);
await shot('28-desktop-library');
await evalJs(() => App.setTab('stats'));
await sleep(700);
await shot('29-desktop-stats');
await evalJs(() => App.setTab('library'));
await sleep(500);
await evalJs(() => Reader.open(Library.books.find((b) => b.type === 'cbz')));
await sleep(1500);
await shot('30-desktop-reader');
await evalJs(() => Reader.close());
await sleep(800);

console.log('\n== persistence ==');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.reload({ waitUntil: 'networkidle2' });
await wait(() => window.Library && Library.books.length > 0, 20000, 'reload persistence');
await sleep(1400);
await shot('31-reload-persisted');
const persisted = await evalJs(() => Library.books.map((b) => ({ title: b.title, page: b.page, cols: b.collections.length })));
check('library persisted after reload', persisted.length === 3, persisted);
check('reading progress persisted', persisted.some((b) => b.page > 0));
check('collection persisted', (await evalJs(() => Library.collections.length)) === 1);

console.log('\n== reader defaults from settings ==');
await evalJs(() => App.saveSetting('reader', Object.assign({}, App.settings.reader, { mode: 'double', fit: 'height', dir: 'rtl' })));
await page.reload({ waitUntil: 'networkidle2' });
await wait(() => window.Reader, 15000, 'reload 2');
await sleep(900);
await evalJs(() => { U.closeAllSheets(); });
const unread = await evalJs(() => { const b = Library.books.find((x) => x.page === 0); Reader.open(b); return b.title; });
await sleep(1600);
check('new book uses default reader mode', (await evalJs(() => Reader.current.mode)) === 'double');
await shot('32-reader-defaults');
await evalJs(() => { Reader.close(); });
await sleep(600);
// restore defaults for later manual testing
await evalJs(() => App.saveSetting('reader', { mode: 'single', dir: 'ltr', fit: 'page', bg: 'black' }));

console.log('\n=== CHECKS ===');
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log('\n=== PROBLEMS (' + [...new Set(problems)].length + ') ===');
[...new Set(problems)].forEach((p) => console.log('•', p));
await browser.close();
process.exit(failed.length || problems.length ? 1 : 0);
