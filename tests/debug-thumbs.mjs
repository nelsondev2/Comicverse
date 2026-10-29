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
await page.evaluate(()=>document.querySelector('#btnThumbs').click());
await new Promise(r=>setTimeout(r,2500));
console.log(await page.evaluate(()=>({
  thumbs: document.querySelectorAll('.thumb').length,
  imgs: document.querySelectorAll('.thumb img').length,
  phs: document.querySelectorAll('.thumb .thumb__ph').length,
  bodyH: document.querySelector('.sheet__body') && document.querySelector('.sheet__body').clientHeight,
  io: typeof IntersectionObserver,
})));
await page.screenshot({path:'tests/shots/debug-thumbs.png'});
await browser.close();
