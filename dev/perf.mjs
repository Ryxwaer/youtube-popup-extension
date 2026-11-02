// Measure CPU (% of one core) and memory (PSS) of the whole browser process tree.
// argv: withExtension(1/0)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { EXT, openYouTube, pipBox, sleep } from './harness.mjs';
const withExt = process.argv[2] === '1';
const HZ = 100;
const args = ['--autoplay-policy=no-user-gesture-required', '--lang=en-US', '--window-size=1440,900', '--no-first-run'];
if (withExt) args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/brave', headless: true, userDataDir: fs.mkdtempSync('/tmp/pip-perf-'), defaultViewport: null, args });
const root = browser.process().pid;

function tree() {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
      const ppid = +f[1];
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push({ pid: +d, cpu: +f[11] + +f[12], name: s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')) });
    } catch {}
  }
  const out = [];
  const walk = (pid) => { for (const k of kids.get(pid) || []) { out.push(k); walk(k.pid); } };
  walk(root);
  try { const s = fs.readFileSync(`/proc/${root}/stat`, 'utf8'); const f = s.slice(s.lastIndexOf(')') + 2).split(' '); out.push({ pid: root, cpu: +f[11] + +f[12] }); } catch {}
  return out;
}
const cpuTicks = () => tree().reduce((a, p) => a + p.cpu, 0);
const pssMB = () => tree().reduce((a, p) => {
  try { const m = /Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p.pid}/smaps_rollup`, 'utf8')); return a + (m ? +m[1] : 0); } catch { return a; }
}, 0) / 1024;
function byProc() { const m = new Map(); for (const p of tree()) { let t = 'browser'; try { const c = fs.readFileSync(`/proc/${p.pid}/cmdline`, 'utf8'); const k = /--type=([\w-]+)/.exec(c); const u = /--utility-sub-type=([\w.]+)/.exec(c); t = k ? k[1] + (u ? ':' + u[1].split('.').pop() : '') + ':' + p.pid : 'browser'; } catch {} m.set(t, p.cpu); } return m; }
async function measure(label, ms) {
  const b0 = byProc();
  const c0 = cpuTicks(), t0 = Date.now();
  await sleep(ms);
  const c1 = cpuTicks(), dt = (Date.now() - t0) / 1000;
  const b1 = byProc(); const rows = []; for (const [k, v] of b1) { const d = (v - (b0.get(k) ?? v)) / HZ / dt * 100; if (d > 4) rows.push(k.padEnd(40) + d.toFixed(0) + '%'); }
  console.log('       ' + rows.join('\n       '));
  console.log(`${withExt ? 'EXT ' : 'BASE'} ${label.padEnd(28)} cpu ${((c1 - c0) / HZ / dt * 100).toFixed(0).padStart(4)}% of a core   mem ${pssMB().toFixed(0)} MB`);
}
try {
  const other = await browser.newPage();
  await other.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = await openYouTube(browser);
  await yt.bringToFront();
  await sleep(1500);
  await measure('YouTube tab in front', 7000);
  await other.bringToFront();
  await sleep(2500);
  if (withExt) {
    console.log('     pip visible:', !!(await pipBox(other)));
    const cdp = await other.createCDPSession();
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let vid = null;
    const walk = (n) => { if (vid) return; if (n.nodeName === 'VIDEO') { vid = n; return; } for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); };
    walk(doc);
    if (vid) {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId: vid.nodeId });
      const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, awaitPromise: true,
        functionDeclaration: 'async function(){ const q0=this.getVideoPlaybackQuality().totalVideoFrames; await new Promise(r=>setTimeout(r,2000)); const q1=this.getVideoPlaybackQuality().totalVideoFrames; return this.videoWidth+"x"+this.videoHeight+" @ "+((q1-q0)/2).toFixed(0)+"fps"; }' });
      console.log('     received stream:', r.result.value);
    }
    await cdp.detach();
  }
  await measure('other tab in front', 7000);
  const v = await yt.evaluate(() => { const v = document.querySelector('#movie_player video'); return { t: v.currentTime.toFixed(1), res: v.videoWidth + 'x' + v.videoHeight, ok: v.readyState >= 3 }; });
  console.log('     source still playing:', JSON.stringify(v));
} finally {
  await browser.close();
}
