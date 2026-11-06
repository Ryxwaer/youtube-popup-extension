// Composites the poses from shots.mjs into the store screenshots (1280x800, in
// the promo video's tablet frame). The promo tiles come from tiles.mjs.
//
//   node stills.mjs <shotsdir> <takedir (for favicons)> <outdir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [SHOTS, TAKE, OUT] = process.argv.slice(2).map((p) => path.resolve(p));
const here = import.meta.dirname;
const { zoom, shots } = JSON.parse(fs.readFileSync(path.join(SHOTS, 'shots.json'), 'utf8'));
const take = JSON.parse(fs.readFileSync(path.join(TAKE, 'take.json'), 'utf8'));
const ytTitle = take.events.findLast((e) => e.kind === 'title' && e.tab === 'yt')?.title ?? take.tabs.yt.title;
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(here, '../../extension/icons/icon128.png')).toString('base64');
const byName = Object.fromEntries(shots.map((s) => [s.name, s]));

const SCREENSHOTS = [
  ['corner', 'Keep watching on every tab. {It follows you when you switch.}'],
  ['drag', 'Drag it anywhere. {Flick it and it glides to an edge.}'],
  ['pinch', 'Pinch to resize. {Or double-tap to switch sizes.}'],
  ['tucked', 'Tuck it into the edge. {Pull it back anytime.}'],
  ['controls', 'Tap for controls. {Play, pause, skip, or go back.}'],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(here, 'stage.html#shot'), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.evaluate((s) => window.setup(s), { tabs: take.tabs, icon });

let n = 0;
for (const [name, caption] of SCREENSHOTS) {
  const s = byName[name];
  await page.evaluate((st) => window.draw(st), {
    tab: 'claude',
    frame: 'file://' + s.file,
    titles: { yt: ytTitle.replace(/^\(\d+\)\s*/, ''), claude: s.title },
    url: s.url,
    touches: s.touches.map((t) => ({ x: t.x * zoom, y: t.y * zoom, o: 1, s: 1 })),
    caption: { text: caption, o: 1 },
    end: 0,
  });
  const file = path.join(OUT, `screenshot-${++n}-${name}.png`);
  await page.screenshot({ path: file, omitBackground: false });
  console.log(file);
}

await browser.close();
