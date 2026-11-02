import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const out = process.argv[2] || 'shots';
import fs from 'node:fs'; fs.mkdirSync(out, { recursive: true });
const browser = await launch({});
const yt = await openYouTube(browser);
const b = await browser.newPage();
await b.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
await b.bringToFront();
await sleep(150);
await b.screenshot({ path: `${out}/01-flyin-150ms.png` });
await sleep(1800);
console.log('box', await pipBox(b));
await b.screenshot({ path: `${out}/02-corner.png` });
const bx = await pipBox(b);
if (bx) {
  await b.mouse.click(bx.x + bx.w / 2, bx.y + bx.h / 2);
  await sleep(700);
  await b.screenshot({ path: `${out}/03-controls.png` });
  // drag to left middle
  await b.mouse.move(bx.x + bx.w / 2, bx.y + bx.h / 2);
  await b.mouse.down();
  for (let i = 1; i <= 20; i++) { await b.mouse.move(bx.x + bx.w / 2 - i * 45, bx.y + bx.h / 2 - i * 15); await sleep(16); }
  await sleep(120);
  await b.mouse.up();
  await sleep(1200);
  console.log('after drag', await pipBox(b));
  await b.screenshot({ path: `${out}/04-left.png` });
  const c = await pipBox(b);
  await b.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
  await b.mouse.down();
  for (let i = 1; i <= 10; i++) { await b.mouse.move(c.x + c.w / 2 - i * 22, c.y + c.h / 2); await sleep(16); }
  await b.mouse.up();
  await sleep(1200);
  console.log('stash', await pipBox(b));
  await b.screenshot({ path: `${out}/05-stashed.png` });
}
const stats = await yt.evaluate(() => ({ t: document.querySelector('#movie_player video').currentTime, vis: document.visibilityState }));
console.log('yt', stats);
await browser.close();
