import puppeteer from 'puppeteer-core';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a4f"/><stop offset="1" stop-color="#1c1c1e"/></linearGradient>
<linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a4e"/><stop offset="1" stop-color="#e5161b"/></linearGradient></defs>
<rect x="4" y="4" width="120" height="120" rx="27" fill="url(#g)"/>
<rect x="20" y="30" width="88" height="62" rx="11" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="7"/>
<rect x="58" y="58" width="42" height="28" rx="7" fill="url(#r)"/>
<path d="M74 66v12l10-6z" fill="#fff"/>
</svg>`;
const b = await puppeteer.launch({executablePath:'/usr/bin/chromium', headless:true});
const p = await b.newPage();
for (const s of [16,32,48,128]) {
  await p.setViewport({width:s,height:s});
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({path:`extension/icons/icon${s}.png`, omitBackground:true});
}
await b.close();
