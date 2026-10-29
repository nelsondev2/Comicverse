const puppeteer = (await import('../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const browser = await puppeteer.launch({ executablePath:'/tmp/chromium', headless:'shell',
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote'],
  env:{...process.env, LD_LIBRARY_PATH:'/home/user/tools/stublibs'}, protocolTimeout:120000 });
const page = await browser.newPage();
page.on('console', m => console.log('['+m.type()+']', m.text()));
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.setViewport({width:390,height:844,deviceScaleFactor:2});
await page.goto('http://localhost:8080/', {waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,1200));
console.log('settings', await page.evaluate(()=>JSON.stringify(App.settings)));
await page.evaluate(async () => {
  const blob = await (await fetch('/tests/fixtures/manual-de-sombras.pdf')).blob();
  await Library.importFiles([new File([blob],'manual-de-sombras.pdf',{type:'application/pdf'})]);
});
await new Promise(r=>setTimeout(r,3000));
await page.evaluate(() => { U.closeAllSheets(); });
await new Promise(r=>setTimeout(r,600));
console.log('books', await page.evaluate(()=>Library.books.map(b=>[b.title,b.type,b.pageCount,JSON.stringify(b.prefs)])));
await page.evaluate(() => Reader.open(Library.books.find(b=>b.type==='pdf')));
await new Promise(r=>setTimeout(r,4000));
console.log('mode', await page.evaluate(()=>Reader.current && Reader.current.mode));
console.log('state', await page.evaluate(()=>({
  imgs: document.querySelectorAll('.page-holder img').length,
  canvases: document.querySelectorAll('.page-holder canvas').length,
  scrollCanvases: document.querySelectorAll('.scroll-page canvas').length,
  scrollImgs: document.querySelectorAll('.scroll-page img').length,
  loading: document.querySelector('#readerLoading').className,
  holderHTML: document.querySelector('.page-layer .page-holder') ? document.querySelector('.page-layer .page-holder').innerHTML.slice(0,300) : 'none'
})));
await page.screenshot({path:'tests/shots/debug-pdf.png'});
await browser.close();
