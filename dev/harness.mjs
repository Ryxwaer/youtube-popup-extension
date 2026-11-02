// Shared test harness: launches Chromium (or Brave) with the extension loaded.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
export const EXT = path.resolve(import.meta.dirname, '../extension');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ exe = '/usr/bin/chromium', headless = true, width = 1440, height = 900, dpr = 1 } = {}) {
  if (headless !== true) throw new Error('The review harness only runs headless browsers.');
  const userDataDir = fs.mkdtempSync('/tmp/pip-prof-');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: exe,
      headless,
      userDataDir,
      defaultViewport: null,
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--autoplay-policy=no-user-gesture-required',
        '--lang=en-US',
        `--window-size=${width},${height}`,
        `--force-device-scale-factor=${dpr}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
  } catch (e) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw e;
  }
  const close = browser.close.bind(browser);
  browser.close = async () => {
    try { await close(); }
    finally { await fs.promises.rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  };
  return browser;
}

export async function openYouTube(browser, id = 'aqz-KE-bpKQ', { mute = true } = {}) {
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });
  await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  await page.evaluate((mute) => {
    const v = document.querySelector('#movie_player video');
    v.muted = mute;
    v.play();
  }, mute);
  // wait until real content (no ad) plays
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => {
      const v = document.querySelector('#movie_player video');
      const ad = !!document.querySelector('#movie_player.ad-showing');
      if (ad) document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern')?.click();
      return { t: v.currentTime, p: v.paused, ad };
    });
    if (!s.ad && !s.p && s.t > 1.5) break;
    await sleep(500);
  }
  return page;
}

// Locate the PiP element inside the closed shadow root through CDP.
export async function pipBox(page) {
  const cdp = await page.createCDPSession();
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let found = null;
    const walk = (n) => {
      if (found) return;
      if (n.attributes) {
        for (let i = 0; i < n.attributes.length; i += 2)
          if (n.attributes[i] === 'class' && /(^|\s)pip(\s|$)/.test(n.attributes[i + 1])) { found = n; return; }
      }
      for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c);
    };
    walk(root);
    if (!found) return null;
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: found.nodeId });
    const q = model.border;
    const cls = found.attributes[found.attributes.indexOf('class') + 1];
    return { x: q[0], y: q[1], w: q[2] - q[0], h: q[5] - q[1], cls };
  } finally {
    await cdp.detach();
  }
}
