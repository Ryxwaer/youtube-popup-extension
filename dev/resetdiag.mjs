// Diagnose: does the YouTube source media reset across many tab switches?
// argv: exe withExtension(1/0) cycles
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { EXT, openYouTube, pipBox, sleep } from './harness.mjs';
const [exe = '/usr/bin/brave', withExt = '1', cycles = '12'] = process.argv.slice(2);
const args = ['--autoplay-policy=no-user-gesture-required', '--lang=en-US', '--window-size=1440,900', '--no-first-run'];
if (withExt === '1') args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: fs.mkdtempSync('/tmp/pip-diag-'), defaultViewport: null, args });
try {
  const other = await browser.newPage();
  await other.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = await openYouTube(browser);
  yt.on('console', (m) => { const t = m.text(); if (/error|fail|reset/i.test(t)) console.log('  [yt console]', t.slice(0, 160)); });
  const probe = () => yt.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    const err = document.querySelector('.ytp-error')?.innerText?.slice(0, 80) || null;
    return { t: +v.currentTime.toFixed(1), rs: v.readyState, d: v.duration, src: v.src.slice(-8), paused: v.paused, err, ad: !!document.querySelector('#movie_player.ad-showing') };
  });
  for (let i = 0; i < +cycles; i++) {
    await other.bringToFront();
    await sleep(4000);
    const box = withExt === '1' ? await pipBox(other) : 'n/a';
    const a = await probe();
    await yt.bringToFront();
    await sleep(2500);
    const b = await probe();
    console.log(i, 'away', JSON.stringify(a), 'pip', box ? 'yes' : 'NO', '| back', JSON.stringify(b));
  }
} finally {
  await browser.close();
}
