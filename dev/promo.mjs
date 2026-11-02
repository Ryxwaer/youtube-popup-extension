// Render the store promo tiles (440x280 small, 1400x560 marquee) from HTML.
// Usage: node promo.mjs <frame.png> <outdir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [frame, out] = process.argv.slice(2);
const img = 'data:image/png;base64,' + fs.readFileSync(frame).toString('base64');
const icon = 'data:image/png;base64,' + fs.readFileSync(new URL('../extension/icons/icon128.png', import.meta.url)).toString('base64');
const tile = (W, H, s) => `<!doctype html><html><body style="margin:0">
<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:Inter,'Helvetica Neue',Arial,sans-serif;
  background:radial-gradient(120% 140% at 0% 0%,#ff4b3e 0%,#d11a2a 38%,#5a0b2e 75%,#1b0a24 100%)">
  <div style="position:absolute;right:${-30*s}px;top:${38*s}px;width:${(s === 1 ? 225 : 300)*s}px;height:${H}px;border-radius:${14*s}px;
    background:#f4f4f7;box-shadow:0 ${10*s}px ${40*s}px rgba(0,0,0,.35);padding:${26*s}px ${22*s}px;box-sizing:border-box">
    ${[0.9,0.7,0.95,0.6,0.85,0.75,0.9].map((w,i)=>`<div style="height:${9*s}px;width:${w*100}%;background:#d9d9e0;border-radius:${5*s}px;margin-bottom:${13*s}px"></div>`).join('')}
  </div>
  <div style="position:absolute;right:${14*s}px;bottom:${20*s}px;width:${(s === 1 ? 172 : 190)*s}px;height:${(s === 1 ? 97 : 107)*s}px;border-radius:${8*s}px;overflow:hidden;
    background:url(${img}) center/cover;box-shadow:0 ${12*s}px ${30*s}px rgba(0,0,0,.45),0 ${2*s}px ${6*s}px rgba(0,0,0,.25)"></div>
  <div style="position:absolute;left:${28*s}px;top:${50*s}px;width:${200*s}px;color:#fff">
    <img src="${icon}" style="width:${56*s}px;height:${56*s}px;display:block;margin-bottom:${16*s}px;filter:drop-shadow(0 ${4*s}px ${10*s}px rgba(0,0,0,.3))">
    <div style="font-size:${30*s}px;font-weight:800;letter-spacing:-.02em;line-height:1.05">PiP Anywhere</div>
    <div style="font-size:${15*s}px;font-weight:500;opacity:.92;margin-top:${10*s}px;line-height:1.3">Floating video<br>on every tab</div>
  </div>
</div></body></html>`;
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true });
const p = await b.newPage();
for (const [name, W, H, s] of [['promo-small', 440, 280, 1], ['promo-marquee', 1400, 560, 2]]) {
  await p.setViewport({ width: W, height: H });
  await p.setContent(tile(W, H, s), { waitUntil: 'load' });
  await p.screenshot({ path: `${out}/${name}.png` });
}
await b.close();
