// The floating window must stay clickable above a fullscreen page element.
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const browser = await launch({ exe: process.argv[2] || '/usr/bin/brave' });
const out = [];
try {
  const page = await browser.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const stage = document.createElement('div');
    stage.id = 'stage';
    stage.style.cssText = 'background:#123;width:100%;height:300px';
    const btn = document.createElement('button');
    btn.id = 'fs';
    btn.textContent = 'fullscreen';
    btn.onclick = () => stage.requestFullscreen();
    document.body.prepend(btn, stage);
  });
  const yt = await openYouTube(browser);
  await yt.bringToFront(); await sleep(800);
  await page.bringToFront(); await sleep(2500);
  out.push(['pip shown', !!(await pipBox(page))]);
  await page.click('#fs'); await sleep(1500);
  out.push(['in fullscreen', await page.evaluate(() => document.fullscreenElement?.id === 'stage')]);
  let b = await pipBox(page);
  const hit = await page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); return el?.hasAttribute('popover') ? 'pip host' : el?.id || el?.tagName; }, b.x + b.w / 2, b.y + b.h / 2);
  out.push(['hit test in fullscreen is the pip', hit === 'pip host', hit]);
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2); await sleep(700);
  out.push(['click opens controls in fullscreen', /\bctl\b/.test((await pipBox(page)).cls)]);
  await page.evaluate(() => document.exitFullscreen()); await sleep(1500);
  b = await pipBox(page);
  const hit2 = await page.evaluate((x, y) => document.elementFromPoint(x, y)?.hasAttribute('popover'), b.x + b.w / 2, b.y + b.h / 2);
  out.push(['hit test after exit', hit2]);
  out.push(['host back under <html>', await page.evaluate(() => document.querySelector('[popover]')?.parentElement === document.documentElement)]);
} finally {
  await browser.close();
}
for (const [n, ok, d] of out) console.log(ok ? 'PASS' : 'FAIL', n, d ?? '');
