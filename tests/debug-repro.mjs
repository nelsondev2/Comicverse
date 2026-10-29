const puppeteer = (await import('../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const browser = await puppeteer.launch({ executablePath:'/tmp/chromium', headless:'shell',
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote'],
  env:{...process.env, LD_LIBRARY_PATH:'/home/user/tools/stublibs'}, protocolTimeout:120000 });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.setViewport({width:390,height:844,deviceScaleFactor:2});
await page.goto('http://localhost:8080/', {waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,1200));
await page.evaluate(async () => {
  const names=['noches-de-neon.cbz','manual-de-sombras.pdf'];
  const files=[];
  for (const n of names){ const b=await (await fetch('/tests/fixtures/'+n)).blob(); files.push(new File([b],n)); }
  await Library.importFiles(files);
});
await new Promise(r=>setTimeout(r,4000));
await page.evaluate(()=>U.closeAllSheets());
await new Promise(r=>setTimeout(r,600));
await page.evaluate(() => Reader.open(Library.books.find(b=>b.type==='cbz')));
await new Promise(r=>setTimeout(r,2500));
await page.evaluate(() => Reader.setMode('scroll'));
await new Promise(r=>setTimeout(r,1500));
console.log('after scroll:', await page.evaluate(()=>JSON.stringify({app:App.settings.reader, bookPrefs:Library.books.map(b=>[b.type,b.prefs])})));
await page.evaluate(() => Reader.close());
await new Promise(r=>setTimeout(r,2000));
console.log('after close:', await page.evaluate(()=>JSON.stringify({app:App.settings.reader, bookPrefs:Library.books.map(b=>[b.type,JSON.stringify(b.prefs)])})));
await page.evaluate(() => Reader.open(Library.books.find(b=>b.type==='pdf')));
await new Promise(r=>setTimeout(r,3000));
console.log('pdf mode:', await page.evaluate(()=>Reader.current && JSON.stringify({mode:Reader.current.mode, prefs:Reader.current.book.prefs})));
await browser.close();
