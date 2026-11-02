// Store screenshots (1280x800): captured at DPR 2 in headless Brave, downscaled later.
// Usage: node store-shots.mjs <scene> <outdir>
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const [scene, out] = process.argv.slice(2);
const PAGES = {
  corner: 'https://en.wikipedia.org/wiki/Picture-in-picture',
  controls: 'https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API',
  stash: 'https://en.wikipedia.org/wiki/Big_Buck_Bunny',
  edge: 'https://en.wikipedia.org/wiki/Blender_Foundation',
  small: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement',
};
const browser = await launch({ exe: '/usr/bin/brave', width: 1280, height: 800, dpr: 2 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto(PAGES[scene], { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  const yt = await openYouTube(browser, 'aqz-KE-bpKQ');
  await yt.bringToFront();
  // Headless YouTube stops after ~30s, so wait for the meadow scene (~17s) instead of seeking.
  for (let i = 0; i < 40; i++) {
    if ((await yt.evaluate(() => document.querySelector('#movie_player video').currentTime)) >= 16) break;
    await sleep(500);
  }
  await page.bringToFront();
  await sleep(2500);
  let b = await pipBox(page);
  const drag = async (dx, dy, steps = 14) => {
    const x0 = b.x + b.w / 2, y0 = b.y + b.h / 2;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps); await sleep(20); }
    await sleep(150); await page.mouse.up(); await sleep(1200);
    b = await pipBox(page);
  };
  if (scene === 'controls') { await page.mouse.click(b.x + b.w / 2, b.y + b.h * 0.3); await sleep(700); }
  if (scene === 'stash') { await drag(0, -260); await drag(b.w * 0.75, 0, 8); }
  if (scene === 'edge') { await drag(-900, -300); }
  if (scene === 'small') { for (let i = 0; i < 3 && b.w > 200; i++) { await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2); await sleep(70); await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2); await sleep(1200); b = await pipBox(page); } }
  await page.screenshot({ path: `${out}/${scene}.png` });
} finally {
  await browser.close();
}

