// The source tab navigates away while a second YouTube tab keeps playing:
// ownership must not stick to the departed one, and moves to the second tab
// once that one is watched.
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const browser = await launch({ exe: process.argv[2] || '/usr/bin/brave' });
const out = [];
try {
  const wt = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const worker = await wt.worker();
  const st = () => worker.evaluate(async () => (await chrome.storage.session.get('pipState')).pipState);
  const tabId = (page) => page.evaluate(() => 0) && worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());

  const ytB = await openYouTube(browser, 'aqz-KE-bpKQ');           // first tab: plays first
  const ytA = await browser.newPage();
  await ytA.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });
  await ytA.goto('https://www.youtube.com/watch?v=YE7VzlLtp-4', { waitUntil: 'domcontentloaded' });
  await ytA.waitForSelector('#movie_player video', { timeout: 30000 });
  await ytA.evaluate(() => { const v = document.querySelector('#movie_player video'); v.muted = true; v.play(); });
  await sleep(4000);
  const idA = await tabId(ytA), idB = await tabId(ytB);
  out.push(['A owns after starting last', (await st()).source?.tabId === idA, { idA, idB, src: (await st()).source?.tabId }]);
  const bPlaying = await ytB.evaluate(() => !document.querySelector('#movie_player video').paused);
  out.push(['B still playing', bPlaying]);

  await ytA.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const s1 = await st();
  out.push(['after A navigates away, A no longer owns', s1.source?.tabId !== idA, { src: s1.source?.tabId }]);

  const c = await browser.newPage();
  await c.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  await c.bringToFront(); await sleep(3500);
  // B only played in the background since A took over, so it doesn't float
  // until it's watched on its own tab again.
  out.push(['no window for a video only playing in the background', !(await pipBox(c))]);
  await ytB.bringToFront(); await sleep(2500);
  await c.bringToFront(); await sleep(3000);
  const s2 = await st();
  out.push(['B owns once watched', s2.source?.tabId === idB, { src: s2.source?.tabId }]);
  out.push(['overlay shows on tab C', !!(await pipBox(c))]);
} finally {
  await browser.close();
}
for (const [n, ok, d] of out) console.log(ok ? 'PASS' : 'FAIL', n, d ? JSON.stringify(d) : '');
