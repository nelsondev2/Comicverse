/**
 * Generates sample comics for local testing (CBZ + PDF).
 * Requires the dev server + puppeteer-core (@sparticuz/chromium) from ./tools.
 *
 *   node tests/make-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
const puppeteer = (await import(process.env.PUPPETEER_MODULE || '../../tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;

const OUT = process.env.FIXTURES_DIR || '/home/user/Comicverse/tests/fixtures';
fs.mkdirSync(OUT, { recursive: true });
const TMP = '/tmp/comicverse-fixtures';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote'],
  env: { ...process.env, LD_LIBRARY_PATH: '/home/user/tools/stublibs' },
});

const page = await browser.newPage();

const PALETTES = [
  ['#f4a261', '#e76f51', '#264653', '#e9c46a'],
  ['#a78bfa', '#7c3aed', '#1e1b4b', '#f0abfc'],
  ['#34d399', '#059669', '#052e2b', '#a7f3d0'],
  ['#f87171', '#b91c1c', '#2a0a0a', '#fecaca'],
  ['#38bdf8', '#0369a1', '#082f49', '#bae6fd'],
  ['#fbbf24', '#b45309', '#2a1a05', '#fde68a'],
];

function comicPage(title, index, total, palette) {
  const [c1, c2, c3, c4] = palette;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 900px; height: 1350px; background: #f7f4ec; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      padding: 42px; display: flex; flex-direction: column; gap: 18px;
      background-image: radial-gradient(circle at 20% 10%, #ffffff88, transparent 45%), radial-gradient(circle at 80% 90%, #e8e0d066, transparent 50%);
    }
    .masthead { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 4px solid #14141c; padding-bottom: 8px; }
    .masthead h1 { font-size: 34px; font-weight: 900; letter-spacing: -1.5px; color: #14141c; text-transform: uppercase; }
    .masthead span { font-size: 13px; font-weight: 700; color: #6b6b80; letter-spacing: 2px; }
    .grid { flex: 1; display: grid; gap: 14px; grid-template-rows: 1.25fr .9fr 1fr; }
    .row { display: grid; gap: 14px; }
    .row.two { grid-template-columns: 1.3fr .9fr; }
    .row.three { grid-template-columns: 1fr 1fr; }
    .panel {
      position: relative; border: 3px solid #14141c; border-radius: 4px; overflow: hidden;
      background: linear-gradient(135deg, ${c1}, ${c2});
      box-shadow: 6px 6px 0 #14141c22;
    }
    .panel.dark { background: linear-gradient(150deg, ${c3}, #0b0b12); }
    .panel.light { background: radial-gradient(circle at 30% 25%, #fff, ${c4}); }
    .panel::after {
      content: ""; position: absolute; inset: 0; opacity: .18;
      background-image: radial-gradient(#000 1px, transparent 1.4px); background-size: 7px 7px;
    }
    .sun { position: absolute; width: 190px; height: 190px; border-radius: 50%; background: ${c4}; filter: blur(1px); opacity: .85; }
    .bubble {
      position: absolute; background: #fff; color: #14141c; border: 3px solid #14141c; border-radius: 22px;
      padding: 14px 18px; font-size: 22px; font-weight: 800; line-height: 1.15; max-width: 62%; z-index: 3;
      box-shadow: 4px 4px 0 #14141c; letter-spacing: -.3px;
    }
    .bubble::after { content: ""; position: absolute; bottom: -16px; left: 26px; width: 0; height: 0; border: 10px solid transparent; border-top-color: #14141c; }
    .bubble.right { right: 22px; top: 22px; }
    .bubble.left { left: 22px; bottom: 26px; }
    .bubble.small { font-size: 17px; }
    .caption {
      position: absolute; left: 0; top: 0; background: #14141c; color: #fff; font-size: 15px; font-weight: 800;
      padding: 8px 16px; letter-spacing: 1px; z-index: 3; text-transform: uppercase;
    }
    .figure { position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); width: 220px; height: 330px; }
    .figure .head { position: absolute; left: 50%; top: 0; transform: translateX(-50%); width: 92px; height: 92px; border-radius: 50%; background: #14141c; }
    .figure .body { position: absolute; left: 50%; top: 82px; transform: translateX(-50%); width: 150px; height: 250px; border-radius: 60px 60px 10px 10px; background: #14141c; }
    .figure .cape { position: absolute; left: 50%; top: 70px; transform: translateX(-46%); width: 200px; height: 250px; border-radius: 90px 30px 20px 20px; background: ${c2}; opacity: .9; }
    .speed { position: absolute; height: 6px; background: #14141ccc; border-radius: 4px; }
    .footer { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #6b6b80; font-weight: 700; letter-spacing: 1.5px; border-top: 2px solid #14141c22; padding-top: 8px; }
    .title { position: absolute; right: 18px; bottom: 14px; font-size: 13px; font-weight: 900; color: #ffffffcc; letter-spacing: 2px; z-index: 4; }
  </style></head><body>
    <div class="masthead"><h1>${title}</h1><span>CAP. ${index + 1} · ${String(index + 1).padStart(2, '0')}/${total}</span></div>
    <div class="grid">
      <div class="row two">
        <div class="panel">
          <div class="sun" style="right:-30px;top:-40px"></div>
          <div class="caption">Ciudad Meridiana · 1987</div>
          <div class="bubble right">${['¿Otra vez tú?', 'Esto no ha hecho más que empezar.', 'No deberías estar aquí.', 'La ciudad nunca duerme.'][index % 4]}</div>
          <div class="figure"><div class="cape"></div><div class="body"></div><div class="head"></div></div>
        </div>
        <div class="panel dark">
          <div class="speed" style="width:120px;top:40%;left:10%"></div>
          <div class="speed" style="width:80px;top:55%;left:20%"></div>
          <div class="speed" style="width:150px;top:70%;left:5%"></div>
          <div class="bubble left small">Sigue la señal…</div>
          <div class="title">${String(index + 1).padStart(2, '0')}</div>
        </div>
      </div>
      <div class="row three">
        <div class="panel light">
          <div class="bubble right small">El observador lo vio todo.</div>
          <div class="speed" style="width:100px;bottom:30px;left:30px;background:#14141c55"></div>
        </div>
        <div class="panel">
          <div class="sun" style="left:-60px;bottom:-60px"></div>
          <div class="caption">Más tarde…</div>
          <div class="speed" style="width:140px;top:30px;right:20px;background:#14141c88"></div>
        </div>
      </div>
      <div class="panel dark">
        <div class="bubble left">${['Nos vemos en el próximo número.', 'Nada es lo que parece.', 'El silencio también habla.', 'Corre.'][index % 4]}</div>
        <div class="speed" style="width:220px;top:30%;left:30%"></div>
        <div class="speed" style="width:160px;top:45%;left:45%"></div>
        <div class="speed" style="width:280px;top:60%;left:20%"></div>
        <div class="title">FIN DEL CAPÍTULO</div>
      </div>
    </div>
    <div class="footer"><span>COMICVERSE · NÚMERO DE PRUEBA</span><span>${index + 1} / ${total}</span></div>
  </body></html>`;
}

async function renderCbz(name, title, pages) {
  const files = [];
  for (let i = 0; i < pages; i++) {
    await page.setViewport({ width: 900, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(comicPage(title, i, pages, PALETTES[i % PALETTES.length]), { waitUntil: 'load' });
    const file = path.join(TMP, `${name}-${String(i + 1).padStart(3, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
    files.push(file);
  }
  const info = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${name === 'noches-de-neon' ? 'Noches de Neón' : 'El Observador'}</Title>
  <Series>${name === 'noches-de-neon' ? 'Noches de Neón' : 'El Observador'}</Series>
  <Number>1</Number>
  <Writer>Nelson Dev</Writer>
  <Publisher>Comicverse Press</Publisher>
  <Year>2026</Year>
  <Genre>Ciencia ficción, Superhéroes</Genre>
  <Summary>Un mensajero nocturno descubre que la ciudad esconde más de lo que aparenta.</Summary>
  <LanguageISO>es</LanguageISO>
  <PageCount>${files.length}</PageCount>
</ComicInfo>`;
  const infoPath = path.join(TMP, 'ComicInfo.xml');
  fs.writeFileSync(infoPath, info);
  const zipPath = path.join(OUT, `${name}.cbz`);
  fs.rmSync(zipPath, { force: true });
  const { execSync } = await import('node:child_process');
  execSync(`cd ${TMP} && zip -q -9 "${zipPath}" ComicInfo.xml ${files.map((f) => path.basename(f)).join(' ')}`);
  console.log('CBZ →', zipPath);
}

async function renderPdf(name, title, pages) {
  const pdfPath = path.join(OUT, `${name}.pdf`);
  await page.setViewport({ width: 900, height: 1350, deviceScaleFactor: 1 });
  const imgs = [];
  for (let i = 0; i < pages; i++) {
    await page.setContent(comicPage(title, i, pages, PALETTES[(i + 2) % PALETTES.length]), { waitUntil: 'load' });
    const file = path.join(TMP, `${name}-pdf-${String(i + 1).padStart(3, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
    imgs.push(`<img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}">`);
  }
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:900px 1350px;margin:0} html,body{margin:0;padding:0;background:#fff}
    img{display:block;width:900px;height:1350px;page-break-after:always;break-after:page}
    img:last-child{page-break-after:auto;break-after:auto}
  </style></head><body>${imgs.join('')}</body></html>`, { waitUntil: 'load' });
  await page.pdf({ path: pdfPath, width: '900px', height: '1350px', printBackground: true });
  console.log('PDF →', pdfPath, fs.statSync(pdfPath).size);
}

await renderCbz('el-observador-001', 'EL OBSERVADOR', 14);
await renderCbz('noches-de-neon', 'NOCHES DE NEÓN', 18);
await renderPdf('manual-de-sombras', 'MANUAL DE SOMBRAS', 10);

await browser.close();
console.log('Fixtures ready in', OUT);
