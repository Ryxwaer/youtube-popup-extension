// The live connection dies mid-playback (as on a network change): the floating
// window must reconnect on its own and show moving frames again.
import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
const browser = await launch({ exe: process.argv[2] || '/usr/bin/brave' });
const out = [];
try {
  const wt = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const worker = await wt.worker();
  const page = await browser.newPage();
  await page.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = await openYouTube(browser);
  await yt.bringToFront(); await sleep(1500);
  await page.bringToFront(); await sleep(3000);
  const frames = async () => {
    const cdp = await page.createCDPSession();
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let vid = null;
    const walk = (n) => { if (vid) return; if (n.nodeName === 'VIDEO' && n.attributes?.includes('disablepictureinpicture')) { vid = n; return; } for (const k of [...(n.children || []), ...(n.shadowRoots || [])]) walk(k); };
    walk(root);
    const { object } = await cdp.send('DOM.resolveNode', { nodeId: vid.nodeId });
    const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function(){return this.getVideoPlaybackQuality().totalVideoFrames}' });
    await cdp.detach();
    return r.result.value;
  };
  const moving = async () => { const a = await frames(); await sleep(1500); return (await frames()) - a; };
  out.push(['live frames before the cut', (await moving()) > 10]);
  // Cut the connection from the YouTube side.
  await worker.evaluate(async () => {
    const st = (await chrome.storage.session.get('pipState')).pipState;
    await chrome.tabs.sendMessage(st.source.tabId, { type: 'src:rtc-close' });
  });
  await sleep(2500);
  out.push(['frozen right after the cut', (await moving()) === 0]);
  let recovered = false, waited = 0;
  for (; waited < 14 && !recovered; waited += 2) { recovered = (await moving()) > 10; if (!recovered) await sleep(500); }
  out.push([`live again without switching tabs (~${waited * 2}s)`, recovered]);
  out.push(['still the same window (no tab switch)', !!(await pipBox(page))]);
} finally {
  await browser.close();
}
for (const [n, ok] of out) console.log(ok ? 'PASS' : 'FAIL', n);
