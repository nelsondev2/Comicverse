/**
 * Comicverse — auditoría automatizada.
 *
 * Mide (no solo "pasa o falla"): fugas de listeners, crecimiento de memoria,
 * dobles invocaciones, peticiones externas, accesibilidad, robustez ante
 * archivos corruptos y round-trip de copias de seguridad.
 *
 *   node tests/audit.mjs            # requiere python3 dev/serve.py 8080
 */
import fs from 'node:fs';

const puppeteer = (await import(process.env.PUPPETEER_MODULE || '/home/user/tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FINDINGS = [];
const add = (id, severity, title, detail, status = 'open') => {
  FINDINGS.push({ id, severity, title, detail, status });
  console.log(`${status === 'open' ? '▸' : '✓'} [${severity}] ${id} ${title} — ${detail}`);
};

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--js-flags=--expose-gc'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
  protocolTimeout: 180000,
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));

// instrument: count listeners added to window/document
await page.evaluateOnNewDocument(() => {
  window.__counts = { window: {}, document: {}, element: 0 };
  const wrap = (obj, label) => {
    const orig = obj.addEventListener.bind(obj);
    const origRemove = obj.removeEventListener.bind(obj);
    obj.addEventListener = function (type, fn, opts) {
      window.__counts[label][type] = (window.__counts[label][type] || 0) + 1;
      return orig(type, fn, opts);
    };
    obj.removeEventListener = function (type, fn, opts) {
      window.__counts[label][type] = (window.__counts[label][type] || 0) - 1;
      return origRemove(type, fn, opts);
    };
  };
  wrap(window, 'window');
  wrap(document, 'document');
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    if (this !== window && this !== document && this instanceof Element) window.__counts.element++;
    return origAdd.apply(this, args);
  };
  window.__urls = new Set();
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = origCreate(b); window.__urls.add(u); return u; };
  URL.revokeObjectURL = (u) => { window.__urls.delete(u); return origRevoke(u); };
});

const externalRequests = [];
page.on('request', (req) => {
  const url = req.url();
  if (!/^https?:\/\/(127\.0\.0\.1|localhost):8080\//.test(url) && !/^(blob|data):/.test(url)) externalRequests.push(url);
});

console.log('\n=== 1. carga inicial y red ===');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const t0 = Date.now();
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.App && !!window.Library, { timeout: 20000 });
const bootMs = Date.now() - t0;
console.log('  boot:', bootMs, 'ms');
const assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => ({ n: r.name.split('/').pop(), kb: Math.round(r.transferSize / 1024), ms: Math.round(r.duration) })));
console.log('  recursos:', assets.length, 'total', assets.reduce((a, b) => a + b.kb, 0), 'KB');
const externalInPage = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => !/^(blob|data):/.test(r.name) && r.name.indexOf(location.origin) !== 0).map((r) => r.name));
if (externalInPage.length) add('NET-01', 'alta', 'Peticiones externas', externalInPage.join(', '));
else add('NET-01', 'info', 'Sin peticiones externas', 'todas las URLs son locales', 'ok');

// CSP-ish sanity: mixed content / eval
const security = await page.evaluate(() => ({
  evalUsed: /\beval\s*\(|new Function\s*\(/.test(document.documentElement.innerHTML),
  inlineHandlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length,
  iframes: document.querySelectorAll('iframe').length,
}));
console.log('  seguridad DOM:', security);

console.log('\n=== 2. importación: disparadores duplicados ===');
await page.evaluate(() => U.closeAllSheets());
await sleep(400);
const importCalls = await page.evaluate(() => {
  let calls = 0;
  const orig = Library.importFiles;
  Library.importFiles = function (...a) { calls++; return Promise.resolve(); };
  document.querySelector('#fabImport').click();
  return new Promise((r) => setTimeout(() => { Library.importFiles = orig; r(calls); }, 300));
});
if (importCalls > 1) add('UI-01', 'alta', 'El botón «Añadir» abre el importador varias veces', `importFiles invocada ${importCalls}× por clic`);
else add('UI-01', 'info', 'Un solo disparador de importación por clic', `${importCalls}×`, 'ok');

console.log('\n=== 3. fugas: hojas modales ===');
const before = await page.evaluate(() => JSON.stringify(window.__counts));
await page.evaluate(async () => {
  for (let i = 0; i < 12; i++) {
    const s = U.sheet({ title: 'prueba ' + i, content: document.createElement('div') });
    s.close();
  }
  await new Promise((r) => setTimeout(r, 500));
});
const docListeners = await page.evaluate(() => window.__counts.document);
console.log('  listeners en document:', docListeners);
if ((docListeners.mousemove || 0) !== 0) add('MEM-01', 'alta', 'Listeners de document sin liberar al cerrar hojas', `${docListeners.mousemove || 0} mousemove acumulados`);

console.log('\n=== 4. lector: apertura/cierre repetido ===');
await page.evaluate(async () => {
  const blob = await (await fetch('/tests/fixtures/noches-de-neon.cbz')).blob();
  await Library.importFiles([new File([blob], 'noches-de-neon.cbz')]);
});
await page.waitForFunction(() => Library.books.length === 1, { timeout: 60000 });
await page.evaluate(() => U.closeAllSheets());
await sleep(800);
const memSamples = [];
for (let i = 0; i < 6; i++) {
  await page.evaluate(async () => { await Reader.open(Library.books[0]); });
  await sleep(500);
  await page.evaluate(async () => { Reader.setMode('scroll'); });
  await sleep(700);
  await page.evaluate(async () => { Reader.close(); });
  await sleep(500);
  const m = await page.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, urls: window.__urls.size }));
  memSamples.push(m);
}
console.log('  memoria (MB) / blob URLs vivas:', memSamples.map((m) => `${m.heap}/${m.urls}`).join('  '));
const heapGrowth = memSamples[memSamples.length - 1].heap - memSamples[1].heap;
if (memSamples[memSamples.length - 1].urls > 2) add('MEM-02', 'alta', 'Blob URLs sin revocar', `${memSamples[memSamples.length - 1].urls} URLs vivas tras cerrar el lector`);
if (heapGrowth > 40) add('MEM-03', 'media', 'Crecimiento de heap tras 6 ciclos abrir/cerrar', `${heapGrowth} MB`);

const scrollListeners = await page.evaluate(() => {
  // count scroll listeners indirectly: instrument again
  let added = 0;
  const el = document.querySelector('#scrollView');
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, ...rest) { if (t === 'scroll') added++; return orig.call(this, t, ...rest); };
  return new Promise((res) => {
    (async () => {
      await Reader.open(Library.books[0]);
      Reader.setMode('scroll');
      await new Promise((r) => setTimeout(r, 700));
      Reader.setMode('single');
      Reader.setMode('scroll');
      await new Promise((r) => setTimeout(r, 700));
      EventTarget.prototype.addEventListener = orig;
      await Reader.close();
      res(added);
    })();
  });
});
console.log('  listeners "scroll" añadidos en 2 cambios de modo:', scrollListeners);
if (scrollListeners > 2) add('MEM-04', 'media', 'Listeners de scroll duplicados en modo tira', `${scrollListeners} registros para 2 entradas al modo`);

console.log('\n=== 5. robustez de archivos ===');
const robustness = await page.evaluate(async () => {
  const results = {};
  const tryImport = async (name, bytes) => {
    const before = Library.books.length;
    await Library.importFiles([new File([bytes], name)]);
    await new Promise((r) => setTimeout(r, 900));
    return { added: Library.books.length - before, error: document.querySelector('.import-item .import-item__state')?.textContent || '' };
  };
  results.emptyZip = await tryImport('vacio.cbz', new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const rar = new Uint8Array(64); rar.set([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
  results.rar = await tryImport('archivo.cbr', rar);
  const junk = new Uint8Array(2048).fill(7);
  results.junk = await tryImport('basura.cbz', junk);
  results.pdfCorrupt = await tryImport('roto.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 1, 2, 3]));
  U.closeAllSheets();
  return results;
});
console.log('  resultados:', robustness);
for (const [k, v] of Object.entries(robustness)) {
  if (v.added > 0) add('FILE-' + k, 'media', `Archivo inválido aceptado: ${k}`, JSON.stringify(v));
}

console.log('\n=== 6. copia de seguridad (ida y vuelta) ===');
const backupRound = await page.evaluate(async () => {
  const book = Library.books[0];
  await DB.put('bookmarks', { id: 'bm-1', bookId: book.id, page: 3, note: 'test', createdAt: Date.now() });
  // build the backup exactly like the UI does
  let captured = null;
  window.webxdc.sendToChat = (msg) => { captured = msg; return Promise.resolve(); };
  App.setTab('settings');
  await new Promise((r) => setTimeout(r, 600));
  const row = [...document.querySelectorAll('.setting-row')].find((r) => /Exportar copia/.test(r.textContent));
  row.click();
  await new Promise((r) => setTimeout(r, 900));
  if (!captured) return { error: 'no backup produced' };
  const text = await captured.file.blob.text();
  const json = JSON.parse(text);
  return {
    books: json.books.length,
    bookmarks: (json.bookmarks || []).length,
    bookmarkFields: json.bookmarks && json.bookmarks[0] ? Object.keys(json.bookmarks[0]) : [],
    hasHashes: (json.books || []).every((b) => !!b.hash),
  };
});
console.log('  backup:', backupRound);
if (backupRound.bookmarkFields && !backupRound.bookmarkFields.includes('bookHash')) {
  add('DATA-01', 'alta', 'Los marcadores no se pueden restaurar', `se exportan con bookId (local) y la restauración busca bookHash`);
}

console.log('\n=== 7. accesibilidad ===');
await page.evaluate(() => { U.closeAllSheets(); App.setTab('library'); Library.render(); });
await sleep(600);
const a11y = await page.evaluate(() => {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (hex) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)); };
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--bg').trim();
  const contrast = {
    text: ratio(cs.getPropertyValue('--text').trim(), bg),
    muted: ratio(cs.getPropertyValue('--muted').trim(), bg),
    faint: ratio(cs.getPropertyValue('--faint').trim(), bg),
  };
  const small = [...document.querySelectorAll('button, a, .chip, .icon-btn')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; });
  const tooSmall = small.filter((s) => s.w < 40 || s.h < 40);
  const unlabeled = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.textContent.trim() && !b.getAttribute('aria-label')).length;
  const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
  const viewport = document.querySelector('meta[name=viewport]').content;
  return { contrast, tooSmall: tooSmall.slice(0, 8), smallCount: tooSmall.length, unlabeled, imgsNoAlt, viewport, lang: document.documentElement.lang };
});
console.log('  contraste:', a11y.contrast, '| objetivos pequeños:', a11y.tooSmall);
console.log('   zócalo:', a11y.smallCount, '| botones sin nombre:', a11y.unlabeled, '| imgs sin alt:', a11y.imgsNoAlt);
if (a11y.contrast.faint < 4.5) add('A11Y-01', 'media', 'Texto secundario con contraste insuficiente', `--faint ${a11y.contrast.faint}:1 (mínimo 4.5)`);
if (a11y.smallCount > 0) add('A11Y-02', 'baja', 'Objetivos táctiles < 40px', `${a11y.smallCount} elementos`);
if (/user-scalable=no|maximum-scale=1/.test(a11y.viewport)) add('A11Y-03', 'media', 'Zoom del navegador bloqueado', a11y.viewport);

console.log('\n=== 8. teclado y foco ===');
await page.evaluate(() => Library.openDetails(Library.books[0].id));
await sleep(700);
const focusInSheet = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet');
  return { activeInside: sheet.contains(document.activeElement), role: sheet.getAttribute('role'), modal: sheet.getAttribute('aria-modal') };
});
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focusEscapes = await page.evaluate(() => !document.querySelector('.sheet').contains(document.activeElement));
await page.keyboard.press('Escape');
await sleep(400);
const focusRestored = await page.evaluate(() => document.activeElement === document.body || document.activeElement === null);
console.log('  foco:', focusInSheet, 'se escapa del diálogo:', focusEscapes, 'restaurado:', focusRestored);
if (!focusInSheet.activeInside) add('A11Y-04', 'media', 'El foco no entra en la hoja modal', JSON.stringify(focusInSheet));
if (focusEscapes) add('A11Y-05', 'media', 'El foco escapa del diálogo modal (Tab)', 'sin focus trap');

console.log('\n=== 9. sincronización con el chat ===');
const sync = await page.evaluate(async () => {
  window.__sent = [];
  window.webxdc.sendUpdate = (u) => window.__sent.push(u);
  await Reader.open(Library.books[0], { startPage: Library.books[0].pageCount - 1 });
  await new Promise((r) => setTimeout(r, 900));
  Reader.next();          // dispara "terminado"
  await new Promise((r) => setTimeout(r, 1500));
  Reader.next();
  await new Promise((r) => setTimeout(r, 1500));
  const finished = window.__sent.length;
  await Reader.close();
  await new Promise((r) => setTimeout(r, 1500));
  return { sent: window.__sent.length, finishedMsgs: finished, payloads: window.__sent.map((u) => u.payload.type || (u.payload.items && 'batch')) };
});
console.log('  actualizaciones enviadas:', sync.payloads);
if (sync.finishedMsgs > 1) add('SYNC-01', 'media', 'Mensajes de «terminado» repetidos al chat', `${sync.finishedMsgs} envíos por una sola lectura`);

console.log('\n=== 10. inyección de HTML en metadatos ===');
const xss = await page.evaluate(async () => {
  const book = Library.books[0];
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2<\/script>';
  book.title = payload;
  book.author = payload;
  book.tags = [payload];
  book.notes = payload;
  const col = { id: U.uid(), name: payload, createdAt: Date.now() };
  Library.collections.push(col);
  book.collections = [col.id];
  Library.render();
  await new Promise((r) => setTimeout(r, 400));
  const card = document.querySelector('.book-card');
  const leakedNodes = document.querySelectorAll('.book-card img[src="x"], .book-card script, .chip-row script, .chip-row img[src="x"]').length;
  // details sheet + collection chip + tags
  const sheet = await Library.openDetails(book.id);
  await new Promise((r) => setTimeout(r, 500));
  const sheetInjected = document.querySelectorAll('.sheet img[src="x"], .sheet script').length;
  U.closeAllSheets();
  await new Promise((r) => setTimeout(r, 300));
  const titleText = card ? card.querySelector('.book-card__title').textContent : '';
  return { executed: !!window.__xss, leakedNodes, sheetInjected, titleRendersAsText: titleText.includes('onerror'), cardHtmlHasImg: card ? card.innerHTML.includes('<img src="x"') : null };
});
console.log('  ', xss);
if (xss.executed) add('SEC-01', 'critica', 'Ejecución de script desde metadatos del cómic', 'window.__xss definido tras renderizar');
if (xss.leakedNodes || xss.sheetInjected) add('SEC-02', 'alta', 'HTML de metadatos inyectado en el DOM', `nodos: ${xss.leakedNodes}/${xss.sheetInjected}`);
if (!xss.executed && !xss.leakedNodes && !xss.sheetInjected) add('SEC-01', 'info', 'Metadatos escapados correctamente', 'sin nodos inyectados ni script ejecutado', 'ok');

await page.evaluate(async () => {
  const book = Library.books[0];
  book.title = 'Noches de neón';
  book.author = 'Ana Ruiz';
  book.tags = [];
  book.notes = '';
  book.collections = [];
  Library.collections.length = 0;
  await DB.put('books', book);
  Library.render();
});
await sleep(400);

console.log('\n=== 11. ciclo de vida de recursos en modo tira ===');
const lifecycle = await page.evaluate(async () => {
  const before = window.__urls.size;
  await Reader.open(Library.books[0], { startPage: 0 });
  Reader.setMode('scroll');
  await new Promise((r) => setTimeout(r, 1500));
  // recorrer toda la tira para forzar la creación y liberación de páginas
  const strip = document.querySelector('#scrollView');
  for (let y = 0; y < strip.scrollHeight; y += 600) {
    strip.scrollTop = y;
    strip.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const during = window.__urls.size;
  const rendered = document.querySelectorAll('.scroll-page[data-rendered]').length;
  const imgs = document.querySelectorAll('#scrollView img').length;
  await Reader.close();
  await new Promise((r) => setTimeout(r, 800));
  const after = window.__urls.size;
  const imgsAfter = document.querySelectorAll('#scrollView img').length;
  return { before, during, after, rendered, imgs, imgsAfter, pages: Library.books[0].pageCount };
});
console.log('  URLs blob antes/durante/después:', lifecycle.before, lifecycle.during, lifecycle.after, '| páginas pintadas:', lifecycle.rendered, '| <img> en la tira:', lifecycle.imgs, '→ tras cerrar:', lifecycle.imgsAfter);
if (lifecycle.after > lifecycle.before) add('MEM-05', 'alta', 'URLs blob sin liberar tras recorrer la tira', `${lifecycle.during} vivas durante, ${lifecycle.after} tras cerrar`);
if (lifecycle.imgsAfter > 0) add('MEM-06', 'media', 'Las páginas de la tira no liberan sus <img>', `${lifecycle.imgsAfter} imágenes aún en el DOM tras cerrar`);
if (lifecycle.rendered === 0) add('MEM-07', 'alta', 'El modo tira no pinta ninguna página', 'IntersectionObserver sin disparar');

console.log('\n=== 12. límites de sendUpdate ===');
const syncLimits = await page.evaluate(async () => {
  const sent = [];
  window.webxdc.sendUpdate = (u) => sent.push({ at: Date.now(), u });
  await Reader.open(Library.books[0], { startPage: 0 });
  await new Promise((r) => setTimeout(r, 800));
  for (let i = 0; i < 12; i++) { Reader.next(); await new Promise((r) => setTimeout(r, 150)); }
  await new Promise((r) => setTimeout(r, 2500));
  await Reader.close();
  await new Promise((r) => setTimeout(r, 2000));
  const sizes = sent.map((s) => JSON.stringify(s.u.payload || {}).length);
  const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
  return {
    count: sent.length,
    maxSize: Math.max(0, ...sizes),
    minGap: gaps.length ? Math.min(...gaps) : null,
    interval: window.webxdc.sendUpdateInterval || 10000,
    maxSizeAllowed: window.webxdc.sendUpdateMaxSize || 128000,
    kinds: sent.map((s) => (s.u.payload && s.u.payload.type) || 'batch'),
  };
});
console.log('  ', syncLimits);
if (syncLimits.maxSize > syncLimits.maxSizeAllowed) add('SYNC-02', 'alta', 'Actualización mayor que sendUpdateMaxSize', `${syncLimits.maxSize} B`);
if (syncLimits.minGap !== null && syncLimits.minGap < syncLimits.interval * 0.9) add('SYNC-03', 'media', 'Actualizaciones más rápidas que sendUpdateInterval', `separación mínima ${syncLimits.minGap} ms (límite ${syncLimits.interval})`);
if (syncLimits.count > 4) add('SYNC-04', 'media', 'Demasiados mensajes al chat por una lectura', `${syncLimits.count} actualizaciones`);
if (syncLimits.count <= 4 && syncLimits.maxSize <= syncLimits.maxSizeAllowed && (syncLimits.minGap === null || syncLimits.minGap >= syncLimits.interval * 0.9)) {
  add('SYNC-02', 'info', 'Envíos al chat dentro de los límites', `${syncLimits.count} mensajes, ${syncLimits.maxSize} B, separación ${syncLimits.minGap} ms`, 'ok');
}

console.log('\n=== 13. escala de la biblioteca (250 cómics) ===');
const scale = await page.evaluate(async () => {
  const originals = Library.books.slice();
  const many = [];
  for (let i = 0; i < 250; i++) {
    many.push({
      id: 'synthetic-' + i, hash: 'h' + i, title: 'Cómic de prueba ' + i, author: 'Autor ' + (i % 7),
      type: i % 5 === 0 ? 'pdf' : 'cbz', pageCount: 20 + (i % 60), page: (i * 3) % 20,
      addedAt: Date.now() - i * 1000, lastReadAt: Date.now() - i * 500, favorite: i % 11 === 0,
      tags: i % 3 === 0 ? ['Muestra'] : [], collections: [], finished: i % 9 === 0, readingTime: i * 40,
    });
  }
  Library.books = many;
  const t0 = performance.now();
  Library.render();
  const renderMs = Math.round(performance.now() - t0);
  const cards = document.querySelectorAll('.book-card').length;
  await Library.openDetails('synthetic-3');
  await new Promise((r) => setTimeout(r, 300));
  U.closeAllSheets();
  App.setTab('shelves');
  const t1 = performance.now();
  App.renderShelves();
  const shelvesMs = Math.round(performance.now() - t1);
  App.setTab('stats');
  const t2 = performance.now();
  App.renderStats();
  const statsMs = Math.round(performance.now() - t2);
  App.setTab('library');
  Library.books = originals;
  Library.render();
  return { renderMs, cards, shelvesMs, statsMs, nodes: document.querySelectorAll('*').length };
});
console.log('  ', scale);
if (scale.renderMs > 250) add('PERF-01', 'media', 'Render de la biblioteca lento', `${scale.renderMs} ms con 250 cómics`);
if (scale.shelvesMs > 200) add('PERF-02', 'baja', 'Estanterías lentas', `${scale.shelvesMs} ms`);
if (scale.statsMs > 200) add('PERF-03', 'baja', 'Estadísticas lentas', `${scale.statsMs} ms`);
if (scale.renderMs <= 250 && scale.shelvesMs <= 200 && scale.statsMs <= 200) {
  add('PERF-01', 'info', 'Biblioteca de 250 cómics fluida', `${scale.renderMs} ms lista, ${scale.cards} tarjetas`, 'ok');
}

console.log('\n=== 14. carreras: abrir/cerrar el lector sin esperar ===');
const race = await page.evaluate(async () => {
  const before = window.__urls.size;
  const book = Library.books[0];
  Reader.open(book);
  Reader.open(book);
  Reader.close();
  await new Promise((r) => setTimeout(r, 700));
  const openAfterRace = Reader.isOpen();
  const urlsAfterRace = window.__urls.size;
  await Reader.open(book);
  await new Promise((r) => setTimeout(r, 1200));
  const reopened = Reader.isOpen() && !!Reader.current;
  const pageOk = reopened ? Reader.current.page >= 0 : false;
  await Reader.close();
  await new Promise((r) => setTimeout(r, 700));
  return { openAfterRace, urlsAfterRace, before, reopened, pageOk, closed: !Reader.isOpen() };
});
console.log('  ', race);
if (race.openAfterRace) add('ROB-01', 'alta', 'Estado inconsistente tras abrir/cerrar en paralelo', JSON.stringify(race));
if (!race.reopened) add('ROB-02', 'alta', 'El lector no vuelve a abrirse tras un cierre en carrera', JSON.stringify(race));
if (race.urlsAfterRace > race.before + 1) add('ROB-03', 'media', 'URLs blob huérfanas tras la carrera', `${race.before} → ${race.urlsAfterRace}`);

console.log('\n=== 15. teclado y navegación del lector ===');
const keyboard = await page.evaluate(async () => {
  await Reader.open(Library.books[0], { startPage: 2 });
  await new Promise((r) => setTimeout(r, 900));
  Reader.setMode('single');          // escenario determinista para las teclas
  await new Promise((r) => setTimeout(r, 900));
  const start = Reader.current.page;
  const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  press('ArrowRight');
  await new Promise((r) => setTimeout(r, 500));
  const afterRight = Reader.current.page;
  press('ArrowLeft');
  await new Promise((r) => setTimeout(r, 500));
  const afterLeft = Reader.current.page;
  press('End');
  await new Promise((r) => setTimeout(r, 600));
  const mode = Reader.current.mode;
  const lastStart = Reader.current.source.pageCount - (mode === 'double' ? 2 : 1);
  const atEnd = Reader.current.page >= lastStart;
  const pageAfterEnd = Reader.current.page;
  press('m');
  await new Promise((r) => setTimeout(r, 400));
  const marked = await DB.getAllByIndex('bookmarks', 'bookId', Library.books[0].id);
  press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  return { start, afterRight, afterLeft, atEnd, mode, pageAfterEnd, lastStart, bookmarks: marked.length, closedByEsc: !Reader.isOpen(), historyOk: !history.state || !history.state.comicverseReader };
});
console.log('  ', keyboard);
if (keyboard.afterRight !== keyboard.start + 1) add('KBD-01', 'media', 'La flecha derecha no avanza de página', `${keyboard.start} → ${keyboard.afterRight}`);
if (!keyboard.atEnd) add('KBD-02', 'media', 'La tecla Fin no salta a la última página', 'sin efecto');
if (!keyboard.bookmarks) add('KBD-03', 'baja', 'El atajo «m» no crea marcadores', 'sin marcador tras pulsar m');
if (!keyboard.closedByEsc) add('KBD-04', 'media', 'Escape no cierra el lector', 'sigue abierto');
if (keyboard.afterRight === keyboard.start + 1 && keyboard.atEnd && keyboard.bookmarks && keyboard.closedByEsc) {
  add('KBD-01', 'info', 'Atajos del lector correctos', '←/→, Fin, m, Esc', 'ok');
}

console.log('\n=== 16. datos: archivo ausente ===');
const missing = await page.evaluate(async () => {
  const book = Library.books[0];
  await DB.del('files', book.id);
  await Reader.open(book);
  await new Promise((r) => setTimeout(r, 1200));
  const open = Reader.isOpen();
  const toastText = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ');
  if (Reader.isOpen()) await Reader.close();
  return { open, toastText };
});
console.log('  lector abierto sin archivo:', missing.open, '| aviso:', missing.toastText);
if (missing.open) add('DATA-02', 'media', 'El lector no informa de la ausencia del archivo', JSON.stringify(missing));

console.log('\n=== 17. errores de consola durante la auditoría ===');
const uniqueErrors = [...new Set(consoleErrors)];
console.log('  ', uniqueErrors.length ? uniqueErrors.slice(0, 6) : 'ninguno');
if (uniqueErrors.length) add('ERR-01', 'media', 'Errores en consola', uniqueErrors.slice(0, 3).join(' | '));

fs.writeFileSync('tests/audit-findings.json', JSON.stringify({ when: new Date().toISOString(), bootMs, findings: FINDINGS }, null, 2));
console.log('\n=== RESUMEN ===');
for (const f of FINDINGS) console.log(`[${f.status === 'ok' ? 'OK ' : f.severity.toUpperCase()}] ${f.id} — ${f.title}`);
await browser.close();
