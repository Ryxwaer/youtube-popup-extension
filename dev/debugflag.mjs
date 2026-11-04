// Diagnostics are off by default and switch on with chrome.storage.local pipDebug.
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const browser = await launch({ exe: process.argv[2] || '/usr/bin/brave' });
const out = [];
const consoleLines = [];
try {
  const wt = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const worker = await wt.worker();
  const page = await browser.newPage();
  page.on('console', (m) => m.text().includes('[PiP]') && consoleLines.push(m.text()));
  await page.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = await openYouTube(browser);
  // Read __pipLog from the extension's isolated world on a page.
  const readLog = async (p) => {
    const cdp = await p.createCDPSession();
    const ctxs = [];
    cdp.on('Runtime.executionContextCreated', (e) => ctxs.push(e.context));
    await cdp.send('Runtime.enable'); await sleep(300);
    const ctx = ctxs.find((c) => c.auxData?.type === 'isolated' && /PiP Anywhere/.test(c.name));
    const r = await cdp.send('Runtime.evaluate', { contextId: ctx.id, returnByValue: true, expression: 'window.__pipLog ? window.__pipLog.length : null' });
    await cdp.detach();
    return r.result.value;
  };
  await yt.bringToFront(); await sleep(1500);
  await page.bringToFront(); await sleep(3000);
  out.push(['window shows with diagnostics off', !!(await pipBox(page))]);
  out.push(['no log buffer when off', (await readLog(page)) === null]);
  out.push(['no [PiP] console output when off', consoleLines.length === 0]);
  await worker.evaluate(() => chrome.storage.local.set({ pipDebug: true }));
  await yt.bringToFront(); await sleep(1500);
  await page.bringToFront(); await sleep(3000);
  const n = await readLog(page);
  out.push(['log buffer fills once switched on', n > 0, n]);
  out.push(['console output when on', consoleLines.length > 0, consoleLines.length]);
} finally {
  await browser.close();
}
for (const [name, ok, d] of out) console.log(ok ? 'PASS' : 'FAIL', name, d ?? '');
