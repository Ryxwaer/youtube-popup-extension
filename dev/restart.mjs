// A YouTube tab that starts playing in the background (as after a browser
// restart) must not pop up a floating window until it was watched on screen.
import { launch, pipBox, sleep } from './harness.mjs';
const browser = await launch({ exe: process.argv[2] || '/usr/bin/brave' });
const out = [];
try {
  const c = (await browser.pages())[0];
  await c.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  await c.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });
  const cdp = await c.createCDPSession();
  await cdp.send('Target.createTarget', { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', background: true });
  const t = await browser.waitForTarget((x) => x.url().includes('youtube.com/watch'));
  const yt = await t.page();
  await yt.waitForSelector('#movie_player video', { timeout: 30000 });
  out.push(['YouTube tab is in the background', (await yt.evaluate(() => document.visibilityState)) === 'hidden']);
  await yt.evaluate(() => { const v = document.querySelector('#movie_player video'); v.muted = true; v.play(); });
  await sleep(4000);
  out.push(['background video is playing', await yt.evaluate(() => !document.querySelector('#movie_player video').paused)]);
  out.push(['no floating window for a video never watched', !(await pipBox(c))]);
  // Switch tabs away and back, as the user would after restart.
  const d = await browser.newPage();
  await d.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  out.push(['still none on another tab', !(await pipBox(d))]);
  // Now watch it on its tab, then leave.
  await yt.bringToFront(); await sleep(2500);
  await c.bringToFront(); await sleep(2500);
  out.push(['window appears after watching it on YouTube', !!(await pipBox(c))]);
} finally {
  await browser.close();
}
for (const [n, ok] of out) console.log(ok ? 'PASS' : 'FAIL', n);
