const puppeteer = (await import('../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const browser = await puppeteer.launch({ executablePath:'/tmp/chromium', headless:'shell',
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote'],
  env:{...process.env, LD_LIBRARY_PATH:'/home/user/tools/stublibs'}, protocolTimeout:120000 });
const page = await browser.newPage();
page.on('console', m => console.log('['+m.type()+']', m.text().slice(0,300)));
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.setViewport({width:390,height:844,deviceScaleFactor:2});
await page.goto('http://localhost:8080/', {waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,1200));
await page.evaluate(async () => {
  const b = await (await fetch('/tests/fixtures/el-observador-001.cbz')).blob();
  await Library.importFiles([new File([b],'el-observador-001.cbz')]);
});
await new Promise(r=>setTimeout(r,4000));
await page.evaluate(()=>U.closeAllSheets());
await new Promise(r=>setTimeout(r,500));
await page.evaluate(()=>Reader.open(Library.books[0]));
await new Promise(r=>setTimeout(r,2500));
const res = await page.evaluate(async () => {
  const src = Reader.current.source;
  const out = { type: src.type, hasRaw: typeof src.rawUrl };
  try { const url = await src.rawUrl(2); out.url = url.slice(0,30); } catch(e) { out.err = e.message; }
  // now check thumb stripping: simulate the observer manually
  document.querySelector('#btnThumbs').click();
  await new Promise(r=>setTimeout(r,500));
  const thumbs = document.querySelectorAll('.thumb');
  out.count = thumbs.length;
  out.firstRect = thumbs[0] && JSON.stringify(thumbs[0].getBoundingClientRect());
  out.bodyRect = JSON.stringify(document.querySelector('.sheet__body').getBoundingClientRect());
  return out;
});
console.log(res);
await new Promise(r=>setTimeout(r,1500));
console.log(await page.evaluate(()=>document.querySelectorAll('.thumb img').length));
await browser.close();
