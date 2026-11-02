// Unstash gesture checks: stash on the right, then pull the tab out in different ways.
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const browser = await launch({ exe: '/usr/bin/brave' });
const results = [];
try {
  const b = await browser.newPage();
  await b.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = await openYouTube(browser);
  await yt.bringToFront(); await sleep(1000);
  await b.bringToFront(); await sleep(1800);
  const vw = await b.evaluate(() => document.documentElement.clientWidth);

  async function drag(x0, y0, dx, steps, stepMs) {
    await b.mouse.move(x0, y0); await b.mouse.down();
    for (let i = 1; i <= steps; i++) { await b.mouse.move(x0 + (dx * i) / steps, y0); await sleep(stepMs); }
    await b.mouse.up(); await sleep(1100);
    return pipBox(b);
  }
  async function stashRight() {
    const p = await pipBox(b);
    if (/stashed/.test(p.cls)) return p;
    const r = await drag(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.8, 10, 16);
    return r;
  }
  const tab = (p) => [vw - 10, p.y + p.h / 2];
  const check = (name, p, wantStashed, wantSide) => {
    const stashed = /stashed/.test(p.cls);
    const side = /\bleft\b/.test(p.cls) ? 'left' : 'right';
    const ok = stashed === wantStashed && (!wantSide || side === wantSide);
    results.push({ name, ok, stashed, side, x: Math.round(p.x) });
  };

  let p = await stashRight(); check('stash right', p, true, 'right');
  // 1. tiny nudge (10px) stays stashed
  p = await drag(...tab(p), -10, 4, 30); check('10px nudge stays hidden', p, true, 'right');
  // 2. slow short pull of 40px brings it out on the right
  p = await drag(...tab(p), -40, 12, 40); check('slow 40px pull unstashes', p, false, 'right');
  // 3. fast flick of 80px in ~50ms: out, but still on the right edge
  p = await stashRight(); check('re-stash', p, true, 'right');
  p = await drag(...tab(p), -80, 3, 16); check('fast flick unstashes on same side', p, false, 'right');
  // 4. hard long throw (300px fast) must not fly to the left
  p = await stashRight();
  p = await drag(...tab(p), -300, 5, 12); check('hard throw stays on right edge', p, false, 'right');
  // 5. drag whole window past the middle switches side
  p = await stashRight();
  p = await drag(...tab(p), -(vw * 0.75), 30, 16); check('dragged across middle goes left', p, false, 'left');
  // 6. pull out a bit then push back in re-stashes
  p = await stashRight();
  await b.mouse.move(...tab(p)); await b.mouse.down();
  for (let i = 1; i <= 8; i++) { await b.mouse.move(vw - 10 - i * 8, p.y + p.h / 2); await sleep(30); }
  for (let i = 1; i <= 4; i++) { await b.mouse.move(vw - 74 + i * 16, p.y + p.h / 2); await sleep(12); }
  await b.mouse.up(); await sleep(1100);
  p = await pipBox(b); check('pull out then push back re-stashes', p, true, 'right');
} finally {
  await browser.close();
}
for (const r of results) console.log(r.ok ? 'PASS' : 'FAIL', r.name, JSON.stringify(r));
