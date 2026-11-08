// Settings page + configurable sizes: renders the page (light, dark, popup) and
// checks that double-tap cycles only through the enabled sizes, that turning a
// size off moves an open window to the nearest enabled one, and that the last
// size can't be turned off.
//
//   node sizes.mjs [outdir]
import path from 'node:path';
import fs from 'node:fs';
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';

const OUT = path.resolve(process.argv[2] || path.join(import.meta.dirname, 'settings-shots'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch({ exe: '/usr/bin/brave' });
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, ...(info && { info }) });
try {
  await sleep(1500);
  const sw = (await browser.targets()).find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://') && t.url().endsWith('/background.js'));
  const id = new URL(sw.url()).host;
  check('no welcome tab for an unpacked install', !(await browser.pages()).some((p) => p.url().includes('options.html')));

  // ---- the page itself
  const opt = await browser.newPage();
  await opt.setViewport({ width: 1100, height: 1180, deviceScaleFactor: 2 });
  await opt.goto(`chrome-extension://${id}/options.html`);
  await sleep(500);
  for (const scheme of ['light', 'dark']) {
    await opt.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await sleep(300);
    await opt.screenshot({ path: path.join(OUT, `options-${scheme}.png`) });
  }
  await opt.evaluate(() => document.documentElement.classList.add('popup'));
  for (const scheme of ['light', 'dark']) {
    await opt.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await sleep(300);
    const h = await opt.evaluate(() => document.body.scrollHeight);
    await opt.screenshot({ path: path.join(OUT, `popup-${scheme}.png`), clip: { x: 0, y: 0, width: 400, height: h } });
    if (scheme === 'light') check('popup fits 600px', h <= 600, { h });
  }
  await opt.evaluate(() => document.documentElement.classList.remove('popup'));
  await opt.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const enabled = () => opt.evaluate(() => [...document.querySelectorAll('.size')].map((b) => b.getAttribute('aria-checked') === 'true'));
  check('defaults: M, L, XL on', JSON.stringify(await enabled()) === '[false,true,true,true]', await enabled());
  const tile = async (i) => {
    await opt.evaluate((i) => document.querySelectorAll('.size')[i].click(), i);
    await sleep(150);
  };

  // ---- the window
  const b = await browser.newPage();
  await b.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = await openYouTube(browser);
  await yt.bringToFront(); await sleep(1000);
  await b.bringToFront(); await sleep(1800);
  const area = async () => {
    const p = await pipBox(b);
    return Math.round((p.w * p.w) / (16 / 9) / 1000);
  };
  const dbl = async () => {
    const p = await pipBox(b);
    await b.mouse.click(p.x + p.w / 2, p.y + p.h / 2);
    await sleep(60);
    await b.mouse.click(p.x + p.w / 2, p.y + p.h / 2);
    await sleep(900);
    return area();
  };
  const start = await area();
  check('starts at Large', Math.abs(start - 81) < 3, start);
  const cycle = [await dbl(), await dbl(), await dbl()];
  check('double-tap cycles L → XL → M → L', Math.abs(cycle[0] - 144) < 4 && Math.abs(cycle[1] - 41) < 2 && Math.abs(cycle[2] - 81) < 3, cycle);

  await dbl(); // XL
  await tile(3); // turn XL off while it's showing
  await sleep(900);
  const after = await area();
  check('turning off the open size moves it to the nearest (L)', Math.abs(after - 81) < 3, after);

  await tile(0); // Small on
  const withSmall = [await dbl(), await dbl(), await dbl()];
  check('enabled Small joins the cycle: L → S → M → L', Math.abs(withSmall[0] - 18) < 2 && Math.abs(withSmall[1] - 41) < 2 && Math.abs(withSmall[2] - 81) < 3, withSmall);

  await tile(0); await tile(1); // only L left
  await tile(2); // try to turn the last one off
  const only = await enabled();
  check('the last size stays on', JSON.stringify(only) === '[false,false,true,false]', only);
  check('warning shown', await opt.evaluate(() => document.querySelector('.footnote').classList.contains('warn')));
  check('double-tap with one size stays put', Math.abs((await dbl()) - 81) < 3);

  // reload keeps the choice, and a new page uses it
  await opt.reload(); await sleep(400);
  check('choice persists', JSON.stringify(await enabled()) === '[false,false,true,false]');
  await tile(1); await tile(3); // back to M, L, XL
  check('restored defaults', JSON.stringify(await enabled()) === '[false,true,true,true]');
} catch (e) {
  results.push({ name: 'error', ok: false, info: String(e.stack || e) });
} finally {
  await browser.close();
}
for (const r of results) console.log(r.ok ? 'PASS' : 'FAIL', r.name, r.info !== undefined ? JSON.stringify(r.info) : '');
console.log(`${results.filter((r) => r.ok).length}/${results.length}`);
console.log('shots in', OUT);
process.exit(results.every((r) => r.ok) ? 0 : 1);
