// Composites the poses from shots.mjs into the store screenshots (1280x800, in
// the promo video's tablet frame) and renders the two promo tiles.
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

// Promo tiles: the same dark look, the icon and name, and the window in use.
const shot = 'file://' + byName.corner.file;
const tile = (W, H, s, compact) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Inter; src: url('file://${here}/fonts/InterVariable.ttf'); font-weight: 100 900; }
  body { margin: 0; }
  .t { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: Inter, sans-serif; color: #fff;
    -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(70% 90% at 78% 70%, rgba(255, 52, 64, .26), transparent 70%),
      radial-gradient(50% 60% at 10% 10%, rgba(120, 60, 255, .14), transparent 70%),
      linear-gradient(#0d0d12, #060608); }
  .txt { position: absolute; left: ${32 * s}px; top: 50%; transform: translateY(-50%); width: ${(compact ? 200 : 420) * s}px; }
  .txt img { width: ${(compact ? 52 : 64) * s}px; height: ${(compact ? 52 : 64) * s}px; display: block; margin-bottom: ${14 * s}px;
    filter: drop-shadow(0 ${6 * s}px ${14 * s}px rgba(0,0,0,.5)); }
  .name { font-size: ${(compact ? 27 : 46) * s}px; font-weight: 750; letter-spacing: -0.035em; line-height: 1.02; }
  .sub { margin-top: ${10 * s}px; font-size: ${(compact ? 15 : 20) * s}px; font-weight: 500; color: rgba(255,255,255,.7); line-height: 1.3; }
  .shot { position: absolute; overflow: hidden; background: url('${shot}') no-repeat;
    box-shadow: 0 0 0 ${1.5 * s}px #2a2a2e, 0 ${24 * s}px ${60 * s}px rgba(0,0,0,.6);
    ${compact
      // Small tile: a close-up of the window's corner of the screen.
      ? `right: -14px; bottom: -14px; width: 200px; height: 178px; border-radius: 12px; background-size: 270% auto; background-position: 100% 100%;`
      // Marquee: the whole screen, window in its corner.
      : `right: 60px; top: 50%; transform: translateY(-50%); width: 760px; height: ${Math.round((760 * 728) / 1194)}px; border-radius: 16px; background-size: cover;`}
  }
</style></head><body><div class="t">
  <div class="shot"></div>
  <div class="txt"><img src="${icon}"><div class="name">PiP Anywhere</div>
    <div class="sub">${compact ? 'Floating player<br>for YouTube' : 'A floating player for YouTube,<br>on every tab.'}</div></div>
</div></body></html>`;
for (const [name, W, H, s, compact] of [['promo-small-440x280', 440, 280, 1, true], ['promo-marquee-1400x560', 1400, 560, 1, false]]) {
  fs.writeFileSync(path.join(SHOTS, `${name}.html`), tile(W, H, s, compact));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(SHOTS, `${name}.html`), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
